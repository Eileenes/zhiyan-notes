import AVFoundation
import Foundation

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
      r.isMeteringEnabled = true
      guard r.record() else { return "录音启动失败" }
      recorder = r
      currentURL = url
      startedAt = Date()
      return nil
    } catch {
      return "录音失败：\(error.localizedDescription)"
    }
  }

  func status() -> [String: Any] {
    recorder?.updateMeters()
    return [
      "recording": isRecording, "seconds": recorder?.currentTime ?? 0,
      "level": pow(10.0, Double(recorder?.averagePower(forChannel: 0) ?? -160) / 20),
    ]
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
    guard size >= 1024 else {
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

/// One native player owns audio lifecycle across both platforms.
final class NotePlayer {
  private var player: AVAudioPlayer?
  private var noteID = ""
  func play(id: String, path: String) throws {
    if noteID != id || player == nil {
      player?.stop()
      player = try AVAudioPlayer(contentsOf: URL(fileURLWithPath: path))
      noteID = id
    }
    #if os(iOS)
      try AVAudioSession.sharedInstance().setCategory(.playback)
      try AVAudioSession.sharedInstance().setActive(true)
    #endif
    guard player?.play() == true else { throw StoreError.failed("无法播放这段录音") }
  }
  func pause() { player?.pause() }
  func stop() {
    player?.stop()
    player = nil
    noteID = ""
  }
  func seek(_ seconds: Double) {
    guard seconds.isFinite else { return }
    player?.currentTime = min(max(0, seconds), player?.duration ?? 0)
  }
  func status() -> [String: Any] {
    [
      "id": noteID, "playing": player?.isPlaying ?? false,
      "seconds": player?.currentTime ?? 0, "duration": player?.duration ?? 0,
    ]
  }
}
