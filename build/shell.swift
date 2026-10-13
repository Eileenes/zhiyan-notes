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
            case "--reset-db":  o.resetDB = true; i += 1
            default:            i += 1
            }
        }
        return o
    }
}

/// 自拍前的真实交互脚本。
/// 目的不是「造出」某种界面，而是验证壳里 JS 真的能跑、事件真的绑上了。
func actionScript(_ name: String) -> String? {
    switch name {
    case "mic":
        return "document.querySelector('.btn-mic').click(); 'ok';"
    case "ob":
        return """
        var b = document.querySelector('[data-act="ob-start"]') || document.querySelector('[data-act="ob-close"]');
        if (b) b.click(); 'ok';
        """
    case "capture":
        return """
        var b = document.querySelector('[data-act="ob-start"]') || document.querySelector('[data-act="ob-close"]');
        if (b) b.click();
        var it = document.querySelectorAll('.cap-item');
        if (it.length) it[2].click();
        'ok';
        """
    case "search", "search2":
        // 2 字查询：trigram 失效，全靠 unigram 兜底，这条专门验它
        //
        // ⚠️ 必须整体包在 IIFE 里。evaluateJavaScript 不接受**顶层 return**
        //    （会当成 SyntaxError，报出来的是「发生了JavaScript异常」这种毫无信息量的文案）。
        //    之前踩过一次：为了加诊断写了 `if (!q) return 'ERR:...'`，结果脚本直接语法错误，
        //    反而把真正的空指针给掩盖了。
        let term = (name == "search") ? "包子" : "咖啡"
        return """
        (function () {
          var n = document.querySelector('[data-p="search"]');
          if (!n) return 'ERR:no-nav';
          n.click();
          var q = document.getElementById('q');
          if (!q) return 'ERR:no-input-after-click';
          // 只赋值 + 派发 input，**不** focus。
          // 加上 focus() 会拉起软键盘，iOS 把可视视口压到 377px、页面放大 6.7%，
          // 截图里表现为整页横向被切掉一半 —— 那是键盘行为，不是版式缺陷，
          // 用它做版式验证会得到误导性的结论。
          q.value = '\(term)';
          q.dispatchEvent(new Event('input', {bubbles:true}));
          return 'typed:' + q.value;
        })();
        """
    case "settings":
        return "document.querySelector('[data-p=\"settings\"]').click(); 'ok';"
    case "sync":
        return """
        document.querySelector('[data-p="settings"]').click();
        document.querySelector('.row-stacked[data-p="sync"]').click();
        'ok';
        """
    case "rectest":
        // iOS 录音链路端到端自检：真录 2 秒 → 停止 → 落库 → 检查文件真的有内容。
        // 录音是核心功能，但在模拟器上有三处未知：能不能录、权限弹窗怎么办、
        // 文件是不是真落盘。没验过就等于没实现。
        // 权限用 `xcrun simctl privacy <udid> grant microphone <bundleid>` 预授，
        // 否则系统弹窗程序化点不掉。
        return """
        (function () {
          var call = window.zyNative.call;
          var out = [];
          var ck = function (n, got, want) {
            var ok = got === want;
            out.push((ok ? 'PASS ' : 'FAIL ') + n + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
          };
          (async function () {
           // 全程 try/catch：之前这里任何一步 reject 都会让整条链静默中断，
           // 结果就是「命令跑了、什么都没输出」，根本分不清是没录到还是没跑到
           try {
            var perm = await call({ op: 'micPerm' });
            out.push('INFO 麦克风权限=' + perm);
            var st = await call({ op: 'recStart' });
            out.push('INFO recStart → ' + JSON.stringify(st));
            await new Promise(function (r) { setTimeout(r, 2000); });
            var sp = await call({ op: 'recStop' });
            out.push('INFO recStop → ' + JSON.stringify(sp));
            ck('录音时长 > 1 秒', sp.dur > 1000, true);
            ck('返回了文件路径', typeof sp.path === 'string' && sp.path.length > 0, true);

            var id = await call({ op: 'save', text: '', source: 'voice',
                                  audio: sp.path, dur: sp.dur, state: 'pending' });
            out.push('INFO 落库 id=' + id.id);

            var all = await call({ op: 'load' });
            var hit = (all.notes || []).filter(function (n) { return n.id === id.id; })[0];
            ck('语音记录已入库', !!hit, true);
            ck('入库带音频路径', !!(hit && hit.audio), true);
            ck('状态为待转写', hit && hit.state === 'pending', true);

            var ex = await call({ op: 'export', format: 'json' });
            out.push('INFO 导出 → ' + ex.path);
            // 导出目录按平台不同：iOS 在 Documents（用户能在「文件」App 里看到），
            // macOS 在 Application Support（不该往桌面丢文件，用户自己挑地方导出更合适）
            var wantDir = '/Application Support/';
            var win = document.querySelector('body').className.indexOf('ios') >= 0;
            if (win) { wantDir = '/Documents/'; }
            ck('导出落在预期目录 ' + wantDir, ex.path.indexOf(wantDir) > 0, true);
            out.push('INFO 导出实际路径 ' + ex.path);

            var pass = out.filter(function (l) { return l.indexOf('PASS') === 0; }).length;
            var fail = out.filter(function (l) { return l.indexOf('FAIL') === 0; }).length;
            await call({ op: 'log', lines: out, pass: pass, fail: fail });
           } catch (e) {
            out.push('FAIL 异常: ' + (e && e.message ? e.message : String(e)));
            await call({ op: 'log', lines: out, pass: 0, fail: 1 });
           }
          })();
          return 'rectest-started';
        })();
        """
    case "probe":
        // iOS 横向被切：找出比可视视口宽的元素。
        // 已知 clientWidth=402 但 visualViewport.width=377，iOS 于是把页面放大到 1.067
        // 并横向平移，左半边被推出画面。这里把比 vv 宽的元素逐个报出来。
        return """
        (function () {
          setTimeout(function () {
            var vv = window.visualViewport, vw = vv ? vv.width : innerWidth;
            var d = document.documentElement;
            var out = ['vv=' + Math.round(vw) + ' client=' + d.clientWidth +
                       ' scroll=' + d.scrollWidth + ' inner=' + innerWidth,
                       'vvOffsetLeft=' + Math.round(vv.offsetLeft)];
            document.querySelectorAll('body *').forEach(function (e) {
              var r = e.getBoundingClientRect();
              if (r.width <= vw + 1) return;
              var cs = getComputedStyle(e);
              out.push('WIDE ' + e.tagName + '.' +
                       (typeof e.className === 'string' ? e.className : 'svg') +
                       ' w=' + Math.round(r.width) + ' left=' + Math.round(r.left) +
                       ' pos=' + cs.position + ' overflowX=' + cs.overflowX);
            });
            if (out.length === 2) out.push('（没有单元素比 vv 宽 → 是根节点/缩放层的问题）');
            window.zyNative.call({ op: 'dump', lines: out.slice(0, 40) });
          }, 6000);
          return 'probe-armed';
        })();
        """
    case "selftest":
        // 端到端自检：在页面里真调原生桥接，断言落库 / 中文检索 / 导出。
        // 每一条都直接打回 stderr，失败时壳以退出码 3 结束，构建脚本据此判定。
        return """
        (async function () {
          const L = []; let pass = 0, fail = 0;
          const ck = (name, got, want) => {
            const ok = got === want;
            ok ? pass++ : fail++;
            L.push((ok ? 'PASS ' : 'FAIL ') + name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
          };
          const call = window.zyNative.call;
          if (!call) { L.push('FAIL 桥接未注入'); call({ op: 'log', lines: L, pass: 0, fail: 1 }); return; }

          await call({ op: 'wipe' });
          const saved = await call({ op: 'save', text: '小区口包子店租金要翻倍，老板大概撑不过这个冬天', source: 'text', tags: ['早餐店'], state: 'done' });
          await call({ op: 'save', text: '跟李彦在望京SOHO楼下那家云南米线聊了二十分钟', source: 'voice', tags: ['李彦'], state: 'done' });
          await call({ op: 'save', text: '今天下雨了，地铁站里全是伞', source: 'text', state: 'done' });
          L.push('INFO 写入完成 id=' + saved.id);

          const all = await call({ op: 'load' });
          ck('落库条数', (all.notes || []).length, 3);

          // 2 字与 1 字：trigram 失效、全靠 unigram 的路径
          ck('搜 包子 (2字)', (await call({ op: 'search', q: '包子' })).count, 1);
          ck('搜 李彦 (2字)', (await call({ op: 'search', q: '李彦' })).count, 1);
          ck('搜 雨   (1字)', (await call({ op: 'search', q: '雨' })).count, 1);
          ck('搜 咖啡 (无此词)', (await call({ op: 'search', q: '咖啡' })).count, 0);
          // 3 字与西文：trigram 路径
          ck('搜 包子店 (3字)', (await call({ op: 'search', q: '包子店' })).count, 1);
          ck('搜 SOHO (西文)', (await call({ op: 'search', q: 'SOHO' })).count, 1);
          // 标签也要能搜到（unigram 必须覆盖 tags，否则漏一半）
          ck('搜标签 早餐店', (await call({ op: 'search', q: '早餐店' })).count, 1);
          // 多词 AND
          ck('搜 李彦 米线 (AND)', (await call({ op: 'search', q: '李彦 米线' })).count, 1);
          ck('搜 李彦 包子 (AND 不该命中)', (await call({ op: 'search', q: '李彦 包子' })).count, 0);

          const st = await call({ op: 'stats' });
          ck('统计条数', st.total, 3);

          const ex = await call({ op: 'export', format: 'json' });
          L.push('INFO 导出路径 ' + ex.path);

          await call({ op: 'log', lines: L, pass: pass, fail: fail });
          return 'done';
        })(); 'selftest-started';
        """
    default:
        return nil
    }
}

// MARK: - 资源定位

/// 加载目标：页面 URL + 读权限目录。
/// 这两个必须分开：pageURL 上可能挂了 ?plat=ios / ?theme=…，
/// 而 allowingReadAccessTo 要的是干净的目录 URL（带 query 的目录会让读权限判断失效）。
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

// MARK: - 录音

/// 真录音，但不做转写。
/// 为什么不接 ASR：语音转文字依赖云端服务商与生成式 AI 备案，这条链路还没打通
/// （见 PRODUCT-PLAN.md 第七章）。这一版的取舍是 —— **录音是真的、文件在本地、
/// 状态标「待转写」**，而不是拿一段动画假装录了。
final class Recorder: NSObject, AVAudioRecorderDelegate {
    private var recorder: AVAudioRecorder?
    private(set) var currentURL: URL?
    private(set) var startedAt: Date?

    var isRecording: Bool { recorder?.isRecording ?? false }

    /// 返回错误文案；成功返回 nil
    func start(to url: URL, platform: String) -> String? {
        // AVAudioSession 是 iOS 专属（macOS SDK 里标了 unavailable）。
        // macOS 录文件不需要配置会话，插上麦克风就能录，省掉这一段。
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        do {
            // 只申请麦克风；不混外部放音，不申请语音识别
            if #available(iOS 17.0, *) {
                try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            } else {
                try session.setCategory(.playAndRecord, mode: .default)
            }
            try session.setActive(true)
        } catch {
            return "无法启用录音：\(error.localizedDescription)"
        }
        #endif

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        do {
            let r = try AVAudioRecorder(url: url, settings: settings)
            r.delegate = self
            guard r.record() else { return "录音启动失败" }
            recorder = r
            currentURL = url
            startedAt = Date()
            return nil
        } catch {
            return "录音失败：\(error.localizedDescription)"
        }
    }

    /// 停止。成功返回 (时长毫秒, 文件路径)，失败返回原因文案。
    /// 用自定义 Error 而不是 Result<_, String>：String 不符合 Error 协议，
    /// 会让 `case .failure(let e)` 拿不到 e，只能写成无类型的负载。
    enum RecordError: Error { case failed(String) }

    func stop() -> Result<(ms: Int, path: String), RecordError> {
        guard let r = recorder, let url = currentURL else { return .failure(.failed("没有正在进行的录音")) }
        let ms = Int(r.currentTime * 1000)
        r.stop()
        recorder = nil
        startedAt = nil
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif

        guard FileManager.default.fileExists(atPath: url.path) else {
            return .failure(.failed("录音文件没有生成"))
        }
        // ⚠️ 空文件检测。麦克风权限被拒时，AVAudioRecorder **依然会创建文件并返回成功**，
        //    只是里面没有数据 —— 实测 macOS 上得到一个 28 字节的空 m4a 容器。
        //    如果不查这一步，用户点完录音会看到「已保存 · 待转写」，
        //    结果播放出来是空的，而且**没有任何异常提示**，这是最坏的一种失败。
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        guard (size ?? 0) >= 1024 else {
            try? FileManager.default.removeItem(at: url)
            return .failure(.failed("没有录到声音，请检查麦克风权限"))
        }
        return .success((ms: ms, path: url.path))
    }

    /// 当前麦克风权限。文案只说事实，不说教。
    static func micPermission() -> String {
        #if os(iOS)
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: return "granted"
        case .denied: return "denied"
        default: return "undetermined"
        }
        #else
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        default: return "undetermined"
        }
        #endif
    }

    /// 放弃这次录音并删掉文件（用户点了关闭，没保存的东西不该留在磁盘上）
    func cancel() {
        guard let r = recorder, let url = currentURL else { return }
        r.stop()
        recorder = nil
        startedAt = nil
        try? FileManager.default.removeItem(at: url)
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }
}

// MARK: - JS 桥接

/// 前端所有原生能力都从这里过。
/// 协议：JS 调 window.zyNative.call({op, ...})，
///       原生侧处理完 evaluateJavaScript("window.__zyReply(seq, ok, data)") 回话。
final class NativeBridge: NSObject, WKScriptMessageHandler {

    let store: DataStore
    let platform: String
    let recorder = Recorder()
    /// JS 那边注册的回调，用来往回推数据
    weak var webView: WKWebView?

    /// 请求序号 → 待回话。JS 用它把响应接回对应的 Promise
    private var pending = 0

    init(store: DataStore, platform: String) {
        self.store = store
        self.platform = platform
    }

    func userContentController(_ ucc: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "native",
              let body = message.body as? [String: Any] else { return }
        handle(body)
    }

    private func reply(_ seq: Any?, _ ok: Bool, _ data: Any) {
        guard let web = webView else { return }
        let payload: [String: Any] = ["seq": (seq as Any?) ?? NSNull(), "ok": ok, "data": data]
        guard let json = try? JSONSerialization.data(withJSONObject: payload),
              let js = String(data: json, encoding: .utf8) else { return }
        let wrapped = "window.__zyReply && window.__zyReply(\(js));"
        DispatchQueue.main.async { web.evaluateJavaScript(wrapped, completionHandler: nil) }
    }

    private func handle(_ m: [String: Any]) {
        let seq = m["seq"]
        let op = (m["op"] as? String) ?? ""

        switch op {
        case "ping":
            reply(seq, true, "pong")

        case "load":
            let notes = store.loadAll()
            reply(seq, true, ["notes": notes, "stats": store.stats()])

        case "save":
            let id = store.save(id: m["id"] as? String,
                                text: (m["text"] as? String) ?? "",
                                source: (m["source"] as? String) ?? "text",
                                tags: m["tags"] as? [String] ?? [],
                                summary: m["summary"] as? String,
                                audioPath: m["audio"] as? String,
                                durationMs: (m["dur"] as? Int) ?? 0,
                                processState: m["state"] as? String)
            reply(seq, true, ["id": id, "stats": store.stats()])

        case "delete":
            store.delete(id: (m["id"] as? String) ?? "")
            reply(seq, true, store.stats())

        case "search":
            let hits = store.search((m["q"] as? String) ?? "")
            reply(seq, true, ["hits": hits, "count": hits.count])

        case "stats":
            reply(seq, true, store.stats())

        case "export":
            let format = (m["format"] as? String) ?? "json"
            guard let p = store.writeExport(format: format, platform: platform) else {
                reply(seq, false, "写入文件失败")
                return
            }
            // macOS 顺手在访达里选中它，用户不用自己找
            #if os(macOS)
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: p)])
            #endif
            reply(seq, true, ["path": p, "stats": store.stats()])

        case "rebuild":
            store.rebuildIndex()
            reply(seq, true, "ok")

        case "wipe":
            store.wipe()
            reply(seq, true, store.stats())

        case "seed":
            // 载入示例数据。真实用户第一次打开是空库，这只是给评审/演示用的
            let items = (m["items"] as? [[String: Any]]) ?? []
            let n = store.importSamples(items)
            reply(seq, true, ["imported": n, "stats": store.stats()])

        case "recStart":
            let dir = DataStore.mediaDir(platform: platform)
            let url = dir.appendingPathComponent("voice-\(Int(Date().timeIntervalSince1970 * 1000)).m4a")
            if let err = recorder.start(to: url, platform: platform) {
                reply(seq, false, err)
            } else {
                reply(seq, true, ["url": url.lastPathComponent])
            }

        case "recStop":
            switch recorder.stop() {
            case .success(let r):
                reply(seq, true, ["dur": r.ms, "path": r.path])
            case .failure(let err):
                if case .failed(let msg) = err { reply(seq, false, msg) }
            }

        case "micPerm":
            reply(seq, true, Recorder.micPermission())

        case "recCancel":
            recorder.cancel()
            reply(seq, true, "ok")

        case "dump":
            let lines = m["lines"] as? [String] ?? []
            for l in lines { log("[probe] " + l) }
            // 同时落一份到 Documents，宿主机可从容器里读 ——
            // simctl launch --console-pty 在本机会挂住，不能只依赖 stderr
            if let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
                let f = docs.appendingPathComponent("probe.txt")
                try? lines.joined(separator: "\n").write(to: f, atomically: true, encoding: .utf8)
            }
            reply(seq, true, "ok")
            exit(0)

        case "log":
            // 自检用：页面里跑完断言，把结果打到 stderr。
            // 没有它的话，页面只能靠截图「看起来对」来判断，等于没验证。
            let lines = m["lines"] as? [String] ?? []
            for l in lines { log("[selftest] " + l) }
            let pass = (m["pass"] as? Int) ?? 0
            let fail = (m["fail"] as? Int) ?? 0
            log("[selftest] ===== 通过 \(pass) / 失败 \(fail) =====")
            reply(seq, true, "ok")
            if fail == 0 {
                log("[selftest] RESULT=PASS")
                exit(0)
            } else {
                log("[selftest] RESULT=FAIL")
                exit(3)
            }

        default:
            reply(seq, false, "未知操作：\(op)")
        }
    }
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
    let source = "window.__zyPending = {};"
        + "window.__zySeq = 0;"
        + "window.zyNative = { call: function(m) {"
        + "  m.seq = ++window.__zySeq;"
        + "  return new Promise(function(res, rej) {"
        + "    window.__zyPending[m.seq] = { res: res, rej: rej };"
        + "    window.webkit.messageHandlers.native.postMessage(m);"
        + "  });"
        + "} };"
        + "window.__zyReply = function(p) {"
        + "  var h = window.__zyPending[p.seq];"
        + "  if (!h) return;"
        + "  delete window.__zyPending[p.seq];"
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
    // ⚠️ WKUserContentController 对 message handler 只持**弱**引用，
    //    handler 被释放后页面 call() 会静默不回调（不报错，只是永远等不到）。
    //    所以必须有人强持有 NativeBridge —— AppDelegate 的 bridge 属性就是干这个的，
    //    不要为了「保持结构好看」把它改成可选。
    return wv
}

/// 自拍：注入脚本 → 等一帧 → 截图 → 退出
/// 自检类 action：它们会在原生侧自己 exit(0|3)，**不需要也不能**再截图。
/// 原因：截图路径固定在 action 之后 0.9s 触发并 exit，
/// 而这些脚本要录 2 秒音频 + 若干次异步往返，等不到就中途被杀，
/// 表现为「脚本启动了但一条断言都没输出」—— 而且退出码 0，看起来像成功。
let SELF_TEST_ACTIONS: Set<String> = ["selftest", "rectest", "probe"]

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
        let path = DataStore.defaultPath(platform: "mac")
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
        let path = DataStore.defaultPath(platform: "ios")
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
