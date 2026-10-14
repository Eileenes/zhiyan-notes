// ============================================================================
// 只言 · 应用壳（macOS + iOS 模拟器/真机）
// 一份源码编两个平台。
//
// 本版变更（v0.5，从「纯演示壳」升级为「真数据 App」）：
//   1. 接入 Data.swift：真实 SQLite 落库、FTS5 双表中文检索、一键导出
//   2. 新增 JS↔Swift 桥接（WKScriptMessageHandler，名字 "native"）
//   3. 新增真实录音：AVAudioRecorder 真录 m4a 到本地，本轮不做转写
//      → 录音后 process_state = 'pending'，界面显示「待转写」
//   4. 修复 --page 深链双重编码：传 "#/search" 会被编成 "#%23/search"
//      导致自拍停在首页。调用方传 "search" 或 "#/search" 现在都能用。
//
// 自拍模式（仅在传入 --snapshot 时启用，不影响正常启动）：
//   壳自己把 WKWebView 的真实渲染结果写成 PNG 再退出。
//   验证渲染不需要任何系统录屏权限，且拍到的是真实窗口里的真实页面。
// ============================================================================

import Foundation
import WebKit
import AVFoundation
#if canImport(Darwin)
import Darwin   // _NSGetExecutablePath：iOS 侧 Foundation 不再透传 Darwin
#endif

/// 自拍模式的诊断输出统一走 stderr，正常启动不会刷屏
func log(_ s: String) {
    FileHandle.standardError.write(Data((s + "\n").utf8))
}

#if os(macOS)
import AppKit
import AVFoundation   // 麦克风权限查询
#elseif os(iOS)
import UIKit
#endif

// MARK: - 启动参数

struct Options {
    var snapshotPath: String?
    var theme: String?
    var hash: String?
    var action: String?
    var offline: Bool = false
    var resetDB: Bool = false
    var databasePath: String?

    static func parse() -> Options {
        var o = Options()
        let args = CommandLine.arguments
        var i = 1
        while i < args.count {
            let a = args[i]
            func value() -> String? { (i + 1 < args.count) ? args[i + 1] : nil }
            switch a {
            case "--snapshot":  o.snapshotPath = value(); i += 2
            case "--theme":     o.theme = value(); i += 2
            case "--page":      o.hash = value(); i += 2
            case "--act":       o.action = value(); i += 2
            case "--offline":   o.offline = true; i += 1
            case "--database": o.databasePath = value(); i += 2
            case "--reset-db":  o.resetDB = true; i += 1
            default:            i += 1
            }
        }
        if ["selftest", "rectest", "garden-test", "draft-check", "export-check", "services-test", "gateway-test"].contains(o.action ?? ""), o.databasePath == nil {
            fail("自检必须传入 --database 指向隔离数据库，避免改动个人记录")
        }
        return o
    }
}

struct PageTarget {
    let url: URL
    let readAccess: URL
}

enum Web {
    /// Web 资源放在 bundle 内 Web/。
    /// 为什么不用 Bundle.main.resourceURL 当唯一来源：实测它在 macOS 上会返回**相对路径**
    /// （"Contents/Resources/"），拼出来的 URL 不是 file:// 绝对地址，
    /// loadFileURL 会静默不回调 —— 界面永远停在空白，且没有任何错误日志。
    static func directory() -> URL? {
        var candidates: [URL] = []

        #if os(macOS)
        var capacity: Int32 = 4096
        var exePath = [CChar](repeating: 0, count: Int(capacity))
        if _NSGetExecutablePath(&exePath, &capacity) > 0 {
            let exeDir = URL(fileURLWithPath: String(cString: exePath))
                .resolvingSymlinksInPath().deletingLastPathComponent()
            // macOS: <App>.app/Contents/MacOS/<bin>  → Web 在 ../../Resources/Web
            candidates.append(exeDir.deletingLastPathComponent()
                                  .deletingLastPathComponent()
                                  .appendingPathComponent("Resources/Web"))
            candidates.append(exeDir.deletingLastPathComponent().appendingPathComponent("Web"))
            candidates.append(exeDir)
        }
        #endif

        if let exe = Bundle.main.executableURL {
            let exeDir = exe.deletingLastPathComponent()
            // iOS: <App>.app/<bin>  → Web 在 ../Web
            candidates.append(exeDir.appendingPathComponent("Web"))
            // macOS: <App>.app/Contents/MacOS/<bin> → Resources/Web
            candidates.append(exeDir.deletingLastPathComponent()
                                  .deletingLastPathComponent()
                                  .appendingPathComponent("Resources/Web"))
            candidates.append(exeDir)
        }
        if let res = Bundle.main.resourceURL {
            candidates.append(res.appendingPathComponent("Web"))
            candidates.append(res)
        }
        candidates.append(URL(fileURLWithPath: FileManager.default.currentDirectoryPath))

        return candidates.lazy
            .map { URL(fileURLWithPath: $0.path, isDirectory: true).standardizedFileURL }
            .first { FileManager.default.fileExists(atPath: $0.appendingPathComponent("index.html").path) }
    }
}

/// index.html 的最终 URL。
func pageTarget(platform: String, opts: Options) -> PageTarget? {
    guard let dir = Web.directory() else { return nil }
    let index = dir.appendingPathComponent("index.html")
    // file:// has no response headers, so the CSP lives in a <meta> that
    // build.sh / stage-web inject. Fail closed if a page was staged without it.
    guard let html = try? String(contentsOf: index, encoding: .utf8),
          WebPolicy.pageIsProtected(html) else {
        FileHandle.standardError.write("index.html 缺少有效的 Content-Security-Policy（script-src 不得含 unsafe-inline / unsafe-eval / 通配或主机来源），拒绝加载\n".data(using: .utf8)!)
        return nil
    }
    guard var comps = URLComponents(url: index, resolvingAgainstBaseURL: false) else { return nil }
    var items: [URLQueryItem] = []
    if platform == "ios" { items.append(URLQueryItem(name: "plat", value: "ios")) }
    if opts.offline { items.append(URLQueryItem(name: "offline", value: "1")) }
    if let t = opts.theme { items.append(URLQueryItem(name: "theme", value: t)) }
    if !items.isEmpty { comps.queryItems = items }

    // ⚠️ 修复点：URLComponents.fragment 赋值时会自己编码 '#'。
    //    之前直接 `comps.fragment = opts.hash`，传 "#/search" 会得到
    //    "#%23/search"，App 认不出来就停在首页 —— 而截图看起来是「成功」的，
    //    因为页面照样渲染了，只是渲染的不是要拍的那一页。
    //    这里先剥掉前导 '#'，两种传法都归一到正确结果。
    if let h = opts.hash, !h.isEmpty {
        comps.fragment = h.hasPrefix("#") ? String(h.dropFirst()) : h
    }

    guard let url = comps.url else { return nil }
    return PageTarget(url: url, readAccess: dir)
}

// MARK: - 共用引导

/// 把 Web 资源装进一个 WKWebView 并挂上桥接
func makeWebView(bridge: NativeBridge) -> WKWebView {
    let cfg = WKWebViewConfiguration()
    cfg.suppressesIncrementalRendering = false
    // 原型是纯本地静态页，不开外部能力；数据存储留在内存，避免污染用户磁盘
    // （真数据在 SQLite 里，不依赖这个 store）
    cfg.websiteDataStore = .nonPersistent()

    // 桥接注入：页面里的 window.zyNative.call({op:...}) 落到这里
    let preferences = (try? JSONSerialization.data(withJSONObject: bridge.bootstrapPreferences)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    let source = "window.zyPreferences = " + preferences + ";window.__zyPending = {};"
        + "window.__zySeq = 0;"
        + "window.zyNative = { call: function(m) {"
        + "  m.seq = ++window.__zySeq;"
        + "  return new Promise(function(res, rej) {"
        + "    var timer = setTimeout(function(){ delete window.__zyPending[m.seq]; rej(new Error('操作超时，请重试')); }, ['aiRun','providerTest','syncRun','audioDownload'].includes(m.op) ? 300000 : m.op === 'export' ? 90000 : 30000); window.__zyPending[m.seq] = { res: res, rej: rej, timer: timer };"
        + "    window.webkit.messageHandlers.native.postMessage(m);"
        + "  });"
        + "} };"
        + "window.__zyReply = function(p) {"
        + "  var h = window.__zyPending[p.seq];"
        + "  if (!h) return;"
        + "  clearTimeout(h.timer); delete window.__zyPending[p.seq];"
        + "  p.ok ? h.res(p.data) : h.rej(new Error(p.data));"
        + "};"
    let uc = WKUserContentController()
    uc.addUserScript(WKUserScript(source: source,
                                  injectionTime: .atDocumentStart,
                                  forMainFrameOnly: true))
    // ⚠️ 这一行不能漏。漏了页面里 postMessage 会静默失败，
    //    Promise 永远挂着不 resolve，表现为「按钮点了没反应」而不是报错。
    uc.add(bridge, name: "native")
    cfg.userContentController = uc

    let wv = WKWebView(frame: .zero, configuration: cfg)
    bridge.webView = wv
    // The controller retains its message handler; the bridge keeps a weak WebView reference.
    return wv
}

/// 自拍：注入脚本 → 等一帧 → 截图 → 退出
/// 自检类 action：它们会在原生侧自己 exit(0|3)，**不需要也不能**再截图。
/// 原因：截图路径固定在 action 之后 0.9s 触发并 exit，
/// 而这些脚本要录 2 秒音频 + 若干次异步往返，等不到就中途被杀，
/// 表现为「脚本启动了但一条断言都没输出」—— 而且退出码 0，看起来像成功。
let SELF_TEST_ACTIONS: Set<String> = ["selftest", "rectest", "probe", "garden-test", "draft-check", "export-check", "services-test", "gateway-test"]

#if !DEBUG
/// Release builds ship without Diagnostics.swift: no --act self-test scripts.
func actionScript(_ name: String) -> String? { nil }
#endif

func runActionThenSnapshot(webView w: WKWebView, path: String?, act: String?) {
    // 没有 action 也没有截图路径 → 什么都不用做，正常启动路径
    guard act != nil || path != nil else { return }

    guard let act, let js = actionScript(act) else {
        if let path { return snapshot(webView: w, to: path) }
        return
    }
    let isSelfTest = SELF_TEST_ACTIONS.contains(act)
    log("[shell] injecting action=\(act)")
    w.evaluateJavaScript(js) { value, err in
        if let err {
            // JS 异常的 localizedDescription 是「发生了JavaScript异常」这种废话，
            // 把注入的脚本首行一起打出来，至少能看出是哪个 action、哪一步炸的
            log("[shell][WARN] action \(act) failed: \(err.localizedDescription)")
            log("[shell][WARN] script head: \(js.prefix(160).replacingOccurrences(of: "\n", with: " ⏎ "))")
        }
        if let v = value, !(v is NSNull) { log("[shell] action \(act) → \(v)") }
        // 自检类等它自己 exit；普通 action 走截图
        guard !isSelfTest else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
            if let path { snapshot(webView: w, to: path) }
        }
    }
}

func snapshot(webView web: WKWebView, to path: String) {
    let cfg = WKSnapshotConfiguration()
    cfg.rect = web.bounds
    cfg.snapshotWidth = NSNumber(value: Double(web.bounds.width))
    web.takeSnapshot(with: cfg) { image, error in
        #if os(macOS)
        if let error { fail("截图失败: \(error)") }
        guard let image, let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else { fail("无法编码 PNG") }
        #else
        if let error { fail("截图失败: \(error)") }
        guard let image, let png = image.pngData() else { fail("无法编码 PNG") }
        #endif
        do {
            try png.write(to: URL(fileURLWithPath: path))
            log("[shell] snapshot ok \(web.bounds.size) -> \(path)")
            exit(0)
        } catch { fail("写文件失败: \(error)") }
    }
}

func fail(_ msg: String) -> Never {
    log("[shell][FATAL] \(msg)")
    exit(2)
}

// MARK: - macOS

#if os(macOS)

let APP_TITLE = "只言"
let BUNDLE_ID  = "com.duketao.zhiyan"
/// 自拍前给 WebView 的落定时间：didFinish 只代表 DOM 解析完，
/// CSS 布局、字体替换、淡入动画都还在后面，给足 1.2s。
let SETTLE: TimeInterval = 1.2

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    let opts = Options.parse()
    var window: NSWindow!
    var webView: WKWebView!
    var bridge: NativeBridge!
    var didFinish = false

    func applicationDidFinishLaunching(_ n: Notification) {
        let path = opts.databasePath ?? DataStore.defaultPath(platform: "mac")
        let store = DataStore(path: path)
        if opts.resetDB { store.wipe() }
        log("[shell] db=\(path) notes=\(store.stats()["total"] ?? 0)")
        bridge = NativeBridge(store: store, platform: "mac")
        webView = makeWebView(bridge: bridge)
        webView.navigationDelegate = self

        let style: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .resizable]
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1120, height: 760),
                          styleMask: style, backing: .buffered, defer: false)
        window.title = APP_TITLE
        window.titlebarAppearsTransparent = false
        if #available(macOS 11.0, *) { window.titlebarSeparatorStyle = .none }
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 900, height: 600)
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        let maskDesc = [style.contains(.titled) ? "titled" : "",
                        style.contains(.closable) ? "closable" : "",
                        style.contains(.miniaturizable) ? "miniaturizable" : "",
                        style.contains(.resizable) ? "resizable" : ""]
            .filter { !$0.isEmpty }.joined(separator: "|")
        log("[shell] window title=\(window.title) content=\(window.contentView?.bounds ?? .zero)"
            + " styleMask=\(maskDesc) minSize=\(window.minSize)")

        guard let target = pageTarget(platform: "mac", opts: opts) else {
            fail("找不到 Web 资源目录（index.html）")
        }
        log("[shell] load url=\(target.url.absoluteString)")
        webView.loadFileURL(target.url, allowingReadAccessTo: target.readAccess)
    }


    /// Only the bundled UI loads in the web view: http(s)/mailto open in the
    /// system browser, anything else (other files, javascript:, data:) is cancelled.
    func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let root = Web.directory() else { return decisionHandler(.cancel) }
        switch WebPolicy.decide(action.request.url, webRoot: root) {
        case .allow: decisionHandler(.allow)
        case .cancel:
            log("[shell] blocked navigation \(action.request.url?.absoluteString ?? "nil")")
            decisionHandler(.cancel)
        case .openExternally(let url):
            decisionHandler(.cancel)
            guard action.navigationType == .linkActivated else { return }  // only user clicks
            NSWorkspace.shared.open(url)
        }
    }
    func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
        didFinish = true
        log("[shell] didFinish bounds=\(w.bounds)")
        // ⚠️ 不能 guard 截图路径 —— 那样只传 --act 时整个回调直接返回，
        //    action 根本不会执行，而且**没有任何报错**，
        //    表现为「命令跑了但什么都没发生」，极难定位。
        guard opts.snapshotPath != nil || opts.action != nil else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + SETTLE) {
            runActionThenSnapshot(webView: w, path: self.opts.snapshotPath, act: self.opts.action)
        }
    }

    func webView(_ w: WKWebView, didFail nav: WKNavigation!, withError e: Error) { fail("加载失败: \(e)") }
    func webView(_ w: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError e: Error) {
        fail("无法开始加载: \(e)")
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()

#elseif os(iOS)

// MARK: - iOS

final class AppDelegate: UIResponder, UIApplicationDelegate, WKNavigationDelegate {
    let opts = Options.parse()
    var window: UIWindow!
    var webView: WKWebView!
    var bridge: NativeBridge!

    func application(_ app: UIApplication,
                     didFinishLaunchingWithOptions o: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let path = opts.databasePath ?? DataStore.defaultPath(platform: "ios")
        let store = DataStore(path: path)
        if opts.resetDB { store.wipe() }
        log("[shell] db=\(path) notes=\(store.stats()["total"] ?? 0)")
        bridge = NativeBridge(store: store, platform: "ios")
        webView = makeWebView(bridge: bridge)
        webView.navigationDelegate = self

        window = UIWindow(frame: UIScreen.main.bounds)
        window.backgroundColor = .systemBackground

        let vc = UIViewController()
        vc.view.backgroundColor = .systemBackground
        webView.translatesAutoresizingMaskIntoConstraints = false
        vc.view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: vc.view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: vc.view.safeAreaLayoutGuide.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: vc.view.safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: vc.view.safeAreaLayoutGuide.trailingAnchor),
        ])
        window.rootViewController = vc
        window.makeKeyAndVisible()

        guard let target = pageTarget(platform: "ios", opts: opts) else { fail("找不到 Web 资源目录（index.html）") }
        webView.loadFileURL(target.url, allowingReadAccessTo: target.readAccess)
        return true
    }


    /// Only the bundled UI loads in the web view: http(s)/mailto open in the
    /// system browser, anything else (other files, javascript:, data:) is cancelled.
    func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let root = Web.directory() else { return decisionHandler(.cancel) }
        switch WebPolicy.decide(action.request.url, webRoot: root) {
        case .allow: decisionHandler(.allow)
        case .cancel:
            log("[shell] blocked navigation \(action.request.url?.absoluteString ?? "nil")")
            decisionHandler(.cancel)
        case .openExternally(let url):
            decisionHandler(.cancel)
            guard action.navigationType == .linkActivated else { return }  // only user clicks
            UIApplication.shared.open(url)
        }
    }
    func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
        guard opts.snapshotPath != nil || opts.action != nil else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            runActionThenSnapshot(webView: w, path: self.opts.snapshotPath, act: self.opts.action)
        }
    }

    func webView(_ w: WKWebView, didFail nav: WKNavigation!, withError e: Error) { fail("加载失败: \(e)") }
    func webView(_ w: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError e: Error) {
        fail("无法开始加载: \(e)")
    }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))

#endif
