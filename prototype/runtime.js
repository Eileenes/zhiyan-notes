// Native adapters: Apple injects zyNative; Tauri shares the exact same operation interface.
window.runtimeReady = Promise.resolve();
if (window.__TAURI_INTERNALS__) {
  const invoke = (m) =>
    window.__TAURI_INTERNALS__.invoke("native_call", { message: m });
  let recorder,
    stream,
    chunks = [],
    started = 0,
    context,
    analyser,
    player,
    playerID = "",
    playerURL,
    stoppedAt = 0,
    stopped,
    recordingMime = "";
  const audioStatus = () => ({
    id: playerID,
    playing: !!player && !player.paused,
    seconds: player?.currentTime || 0,
    duration: player?.duration || 0,
  });
  const stopTracks = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    context?.close();
    context = null;
    analyser = null;
  };
  const recorderStop = async () => {
    if (!recorder || !stopped) throw new Error("没有可以保存的录音");
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: recordingMime });
    if (!blob.size) throw new Error("没有录到声音，请检查麦克风权限");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    // Keep stopped chunks available if native storage fails, so Save can be retried.
    const result = await invoke({
      op: "mediaWrite",
      format: blob.type.includes("mp4") ? "m4a" : "webm",
      data: btoa(binary),
    });
    const duration = stoppedAt - started;
    recorder = null;
    chunks = [];
    stopped = null;
    return { path: result.path, dur: duration };
  };
  window.zyNative = {
    call: async (m) => {
      if (m.op === "recStart") {
        if (recorder?.state === "recording")
          throw new Error("已有一段录音正在进行");
        if (
          !navigator.mediaDevices?.getUserMedia ||
          typeof MediaRecorder === "undefined"
        )
          throw new Error(
            "当前系统的录音组件不可用，请检查 WebView 与麦克风权限",
          );
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        try {
          const mime = [
            "audio/mp4",
            "audio/webm;codecs=opus",
            "audio/webm",
          ].find((t) => MediaRecorder.isTypeSupported(t));
          recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
          chunks = [];
          stoppedAt = 0;
          recordingMime = recorder.mimeType;
          stopped = new Promise((resolve) => {
            recorder.onstop = () => {
              stoppedAt = Date.now();
              stopTracks();
              resolve();
            };
          });
          recorder.ondataavailable = (e) => {
            if (e.data.size) chunks.push(e.data);
            if (
              chunks.reduce((size, item) => size + item.size, 0) >
                90 * 1024 * 1024 &&
              recorder?.state === "recording"
            )
              recorder.stop();
          };
          recorder.onerror = () => {
            if (recorder?.state === "recording") recorder.stop();
          };
          context = new AudioContext();
          analyser = context.createAnalyser();
          context.createMediaStreamSource(stream).connect(analyser);
          started = Date.now();
          recorder.start(500);
          return { ok: true };
        } catch (error) {
          stopTracks();
          throw error;
        }
      }
      if (m.op === "recStop") return recorderStop();
      if (m.op === "recStatus") {
        let level = 0;
        if (analyser) {
          const data = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(data);
          level = Math.sqrt(
            data.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0) /
              data.length,
          );
        }
        return {
          recording: recorder?.state === "recording",
          seconds: ((stoppedAt || Date.now()) - started) / 1000,
          level,
        };
      }
      if (m.op === "recCancel") {
        if (recorder) {
          recorder.ondataavailable = null;
          if (recorder.state !== "inactive") recorder.stop();
          if (stopped) await stopped;
        }
        recorder = null;
        chunks = [];
        stopped = null;
        stopTracks();
        const draft = JSON.parse(
          window.zyPreferences?.recordingDraft || "null",
        );
        if (draft?.path) await invoke({ op: "mediaDiscard", path: draft.path });
        return true;
      }
      if (m.op === "audioPlay") {
        if (playerID !== m.id) {
          player?.pause();
          if (playerURL) URL.revokeObjectURL(playerURL);
          const result = await invoke({ op: "mediaRead", id: m.id });
          const bytes = Uint8Array.from(atob(result.data), (c) =>
            c.charCodeAt(0),
          );
          playerURL = URL.createObjectURL(
            new Blob([bytes], { type: result.mime }),
          );
          player = new Audio(playerURL);
          playerID = m.id;
        }
        await player.play();
        return audioStatus();
      }
      if (m.op === "audioPause") {
        player?.pause();
        return audioStatus();
      }
      if (m.op === "audioSeek") {
        if (player) player.currentTime = m.seconds;
        return audioStatus();
      }
      if (m.op === "audioStop") {
        player?.pause();
        player = null;
        playerID = "";
        if (playerURL) URL.revokeObjectURL(playerURL);
        playerURL = null;
        return audioStatus();
      }
      if (m.op === "audioStatus") return audioStatus();
      return invoke(m);
    },
  };
  window.runtimeReady = invoke({ op: "prefsGet" }).then((p) => {
    window.zyPreferences = p;
  });
}
