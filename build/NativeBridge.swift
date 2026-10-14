import AVFoundation
import Foundation
import WebKit

#if os(macOS)
  import AppKit
#elseif os(iOS)
  import UIKit
#endif

// MARK: - JS 桥接

/// 前端所有原生能力都从这里过。
/// 协议：JS 调 window.zyNative.call({op, ...})，
///       原生侧处理完 evaluateJavaScript("window.__zyReply(seq, ok, data)") 回话。
final class NativeBridge: NSObject, WKScriptMessageHandler {

  let store: DataStore
  let platform: String
  let recorder = Recorder()
  let player = NotePlayer()
  private let dataQueueKey = DispatchSpecificKey<Bool>()
  private let dataQueue = DispatchQueue(label: "com.duketao.zhiyan.database")
  private var preferences: [String: String] = [:]
  private var preferencesURL: URL {
    URL(fileURLWithPath: store.path).deletingLastPathComponent().appendingPathComponent(
      "preferences.json")
  }
  /// JS 那边注册的回调，用来往回推数据
  weak var webView: WKWebView?

  /// 请求序号 → 待回话。JS 用它把响应接回对应的 Promise
  private var pending = 0

  init(store: DataStore, platform: String) {
    self.store = store
    self.platform = platform
    super.init()
    dataQueue.setSpecific(key: dataQueueKey, value: true)
    if let data = try? Data(contentsOf: preferencesURL),
      let values = try? JSONDecoder().decode([String: String].self, from: data)
    {
      preferences = values
    }
    // The Rust core enforces model consent from its own database (model.rs
    // Core::consented). Re-sync on launch so consent given by an older build,
    // which only wrote preferences.json, is not lost.
    if let consent = preferences["aiConsent"] {
      try? Self.syncConsent(consent, database: store.path)
    }
  }

  /// Mirror the aiConsent preference into the core DB (app_meta.preferences),
  /// which is what aiRun and the gateway check before sending anything.
  static func syncConsent(_ value: String, database: String) throws {
    _ = try CoreServices.call(
      path: database, request: ["op": "prefsSet", "key": "aiConsent", "value": value])
  }

  var bootstrapPreferences: [String: String] { preferences }

  func userContentController(
    _ ucc: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard message.name == "native",
      message.frameInfo.isMainFrame,
      message.frameInfo.request.url?.isFileURL == true,
      let body = message.body as? [String: Any]
    else { return }
    let op = body["op"] as? String ?? ""
    if CoreServices.operations.contains(op) || op.hasPrefix("secret") || op.hasPrefix("gateway") {
      let path = store.path
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let result = try op.hasPrefix("gateway")
            ? GatewayServices.handle(body, database: path)
            : op.hasPrefix("secret")
            ? Credentials.handle(body, database: path)
            : CoreServices.call(path: path, request: body)
          self.reply(body["seq"], true, result)
        } catch { self.reply(body["seq"], false, error.localizedDescription) }
      }
      return
    }
    if op.hasPrefix("rec") || op.hasPrefix("audio")
      || ["micPerm", "prefsSet", "log", "ping", "clipboardWrite"].contains(op)
    {
      handle(body)
    } else {
      dataQueue.async {
        self.store.clearFailure()
        if let error = self.store.initializationError {
          self.reply(body["seq"], false, error)
          return
        }
        self.handle(body)
      }
    }
  }

  private func reply(_ seq: Any?, _ ok: Bool, _ data: Any) {
    guard let web = webView else { return }
    if ok, DispatchQueue.getSpecific(key: dataQueueKey) == true, let failure = store.failure {
      reply(seq, false, failure)
      return
    }
    let payload: [String: Any] = ["seq": (seq as Any?) ?? NSNull(), "ok": ok, "data": data]
    guard let json = try? JSONSerialization.data(withJSONObject: payload),
      let js = String(data: json, encoding: .utf8)
    else { return }
    let wrapped = "window.__zyReply && window.__zyReply(\(js));"
    DispatchQueue.main.async { web.evaluateJavaScript(wrapped, completionHandler: nil) }
  }

  private func handle(_ m: [String: Any]) {
    let seq = m["seq"]
    let op = (m["op"] as? String) ?? ""

    do {
      switch op {
      case "ping":
        reply(seq, true, "pong")
      case "clipboardWrite":
        guard let text = m["text"] as? String, text.utf8.count <= 16384 else {
          throw StoreError.failed("复制内容无效或过长")
        }
        #if os(macOS)
          NSPasteboard.general.clearContents()
          guard NSPasteboard.general.setString(text, forType: .string) else { throw StoreError.failed("无法写入剪贴板") }
        #else
          UIPasteboard.general.string = text
        #endif
        reply(seq, true, true)

      case "load":
        let notes = store.loadAll()
        reply(seq, true, ["notes": notes, "stats": store.stats()])

      case "save":
        if let path = m["audio"] as? String {
          let file = URL(fileURLWithPath: path).resolvingSymlinksInPath().path
          let media = store.mediaDirectory.resolvingSymlinksInPath().path + "/"
          guard file.hasPrefix(media), FileManager.default.fileExists(atPath: file) else {
            throw StoreError.failed("找不到录音文件，请保留草稿后重试")
          }
        }
        let id = try store.save(
          id: m["id"] as? String,
          text: (m["text"] as? String) ?? "",
          source: (m["source"] as? String) ?? "text",
          tags: m["tags"] as? [String] ?? [],
          summary: m["summary"] as? String,
          audioPath: m["audio"] as? String,
          durationMs: (m["dur"] as? Int) ?? 0,
          processState: m["state"] as? String)
        reply(seq, true, ["id": id, "stats": store.stats()])

      case "delete":
        try store.delete(id: (m["id"] as? String) ?? "")
        reply(seq, true, store.stats())

      case "search":
        let hits = store.search((m["q"] as? String) ?? "", source: m["source"] as? String)
        reply(seq, true, ["hits": hits, "count": hits.count])

      case "page":
        reply(
          seq, true,
          [
            "notes": store.page(
              before: m["before"] as? Int, beforeID: m["beforeID"] as? String ?? ""),
            "stats": store.stats(),
          ])
      case "get":
        guard let note = store.get(id: m["id"] as? String ?? "") else {
          throw StoreError.failed("这条记忆已不存在")
        }
        reply(seq, true, note)
      case "update":
        try store.updateText(
          id: m["id"] as? String ?? "", text: m["text"] as? String ?? "",
          tags: m["tags"] as? [String] ?? [])
        reply(seq, true, "ok")
      case "restore":
        try store.restore(id: m["id"] as? String ?? "")
        reply(seq, true, "ok")
      case "prefsSet":
        guard let key = m["key"] as? String,
          ["draft", "theme", "onboarded", "recordingDraft", "aiConsent"].contains(key),
          let value = m["value"] as? String
        else { throw StoreError.failed("无效的设置") }
        // Core first: if it fails, preferences.json is left unchanged so the
        // UI never shows consent that the core would not honour.
        if key == "aiConsent" { try Self.syncConsent(value, database: store.path) }
        var next = preferences
        next[key] = value
        try JSONEncoder().encode(next).write(to: preferencesURL, options: .atomic)
        preferences = next
        reply(seq, true, "ok")
      case "audioPlay":
        // Only play paths looked up from the user's note, never paths supplied by JavaScript.
        let id = m["id"] as? String ?? ""
        dataQueue.async {
          let path = self.store.get(id: id)?["audio"] as? String
          DispatchQueue.main.async {
            do {
              guard let path else { throw StoreError.failed("这条记忆没有音频文件") }
              try self.player.play(id: id, path: path)
              self.reply(seq, true, self.player.status())
            } catch { self.reply(seq, false, error.localizedDescription) }
          }
        }
      case "audioPause":
        player.pause()
        reply(seq, true, player.status())
      case "audioSeek":
        player.seek(m["seconds"] as? Double ?? 0)
        reply(seq, true, player.status())
      case "audioStop":
        player.stop()
        reply(seq, true, player.status())
      case "audioStatus":
        reply(seq, true, player.status())
      case "recStatus":
        reply(seq, true, recorder.status())
      case "stats":
        reply(seq, true, store.stats())

      case "export":
        let format = (m["format"] as? String) ?? "json"
        guard let result = try CoreServices.call(path: store.path, request: m) as? [String: Any], let p = result["path"] as? String
        else {
          reply(seq, false, "写入文件失败")
          return
        }
        // macOS 顺手在访达里选中它，用户不用自己找
        #if os(macOS)
          if m["reveal"] as? Bool != false {
            DispatchQueue.main.async {
              NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: p)])
            }
          }
        #elseif os(iOS)
          if m["reveal"] as? Bool != false {
            DispatchQueue.main.async {
              guard let controller = self.webView?.window?.rootViewController else {
                self.reply(seq, false, "文件已导出，但当前无法打开分享面板")
                return
              }
              let share = UIActivityViewController(
                activityItems: [URL(fileURLWithPath: p)], applicationActivities: nil)
              share.popoverPresentationController?.sourceView = controller.view
              share.popoverPresentationController?.sourceRect = CGRect(
                x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 0, height: 0)
              controller.present(share, animated: true) {
                self.reply(seq, true, ["path": p])
              }
            }
            return
          }
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
        let n = try store.importSamples(items)
        reply(seq, true, ["imported": n, "stats": store.stats()])

      case "recStart":
        player.stop()
        guard !recorder.isRecording else { throw StoreError.failed("已有一段录音正在进行") }
        let dir = store.mediaDirectory
        let url = dir.appendingPathComponent(
          "voice-\(Int(Date().timeIntervalSince1970 * 1000)).m4a")
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
        let draft = preferences["recordingDraft"] ?? ""
        let object = (try? JSONSerialization.jsonObject(with: Data(draft.utf8))) as? [String: Any]
        guard let path = object?["path"] as? String else {
          reply(seq, true, "ok")
          return
        }
        dataQueue.async {
          self.store.clearFailure()
          let file = URL(fileURLWithPath: path).resolvingSymlinksInPath().path
          let media = self.store.mediaDirectory.resolvingSymlinksInPath().path + "/"
          let referenced = self.store.referencesAudio(path: path)
          if self.store.failure == nil && file.hasPrefix(media) && !referenced {
            do {
              if FileManager.default.fileExists(atPath: file) {
                try FileManager.default.removeItem(atPath: file)
              }
            } catch {
              self.reply(seq, false, error.localizedDescription)
              return
            }
          }
          self.reply(seq, true, "ok")
        }

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
    } catch { reply(seq, false, error.localizedDescription) }
  }
}
