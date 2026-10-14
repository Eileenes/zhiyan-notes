"""Real Rust client requests against a temporary sync server and protocol fixtures.
Never reads the user's database, credentials or audio.
"""

import base64
from contextlib import contextmanager
import json
from pathlib import Path
import socket
import sqlite3
import subprocess
import threading
import time

from fastapi import FastAPI, Request
import pytest
import uvicorn
from server.app import create_app

ROOT = Path(__file__).resolve().parents[2]
BIN = ROOT / "core/target/debug/zhiyan-core"


@contextmanager
def serve(app):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level="error", access_log=False))
    thread = threading.Thread(target=lambda: server.run(sockets=[sock]), daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.02)
    assert server.started
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(5)
        sock.close()


class Client:
    def __init__(self, folder):
        folder.mkdir()
        self.path = folder / "notes.db"

    def call(self, op, **args):
        proc = subprocess.run(
            [str(BIN), str(self.path)],
            input=json.dumps(dict(op=op, **args)) + "\n",
            text=True,
            capture_output=True,
            timeout=20,
            check=True,
        )
        result = json.loads(proc.stdout)
        assert result["ok"], result.get("error")
        return result["data"]

    def login(self, url, name="alice", register=False):
        self.device = self.call("deviceID")
        result = self.call(
            "syncAuth",
            url=url,
            username=name,
            password="fixture-password-123",
            device_id=self.device,
            device_name="test",
            register=register,
        )
        self.token = result["token"]
        self.call("syncBind", url=url, user=result["user"], device_id=self.device)

    def sync(self):
        return self.call("syncRun", token=self.token)


@pytest.fixture(scope="module", autouse=True)
def compiled_client():
    subprocess.run(
        [
            "cargo",
            "build",
            "--manifest-path",
            str(ROOT / "core/Cargo.toml"),
            "--locked",
        ],
        check=True,
        capture_output=True,
    )


def test_two_device_sync_audio_conflicts_and_restart(tmp_path, monkeypatch):
    monkeypatch.setenv("REGISTRATION_MODE", "open")
    with serve(
        create_app(
            "sqlite:///" + str(tmp_path / "server.db"), tmp_path / "server-audio", False
        )
    ) as url:
        a = Client(tmp_path / "phone")
        b = Client(tmp_path / "desktop")
        c = Client(tmp_path / "another-user")
        a.login(url, register=True)
        b.login(url)
        c.login(url, "bob", True)
        a.call("save", id="memory1", text="在上海看花", tags=["旅行"])
        # A real valid WAV header plus silent PCM; no microphone access.
        import io, wave

        out = io.BytesIO()
        with wave.open(out, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(b"\0" * 32000)
        data = out.getvalue()
        media = a.call("mediaWrite", format="wav", data=base64.b64encode(data).decode())
        a.call(
            "save", id="audio1", text="", source="voice", audio=media["path"], dur=1000
        )
        assert a.sync()["pending"] == 0
        assert b.sync()["pending"] == 0
        assert b.call("get", id="memory1")["raw"] == "在上海看花"
        remote = b.call("get", id="audio1")
        assert remote["audio"] is None and remote["attachment_id"]
        downloaded = b.call("audioDownload", id="audio1", token=b.token)
        assert Path(downloaded["audio"]).read_bytes() == data
        c.sync()
        assert c.call("stats")["total"] == 0
        a.call("update", id="memory1", text="手机版本", tags=[])
        b.call("update", id="memory1", text="电脑版本", tags=[])
        a.sync()
        assert b.sync()["conflicts"] == 1
        assert b.call("get", id="memory1")["raw"] == "电脑版本"
        b.call("syncResolve", id="memory1", choice="both")
        b.sync()
        a.sync()
        records = a.call("page")["notes"]
        assert {r["raw"] for r in records} == {"手机版本", "电脑版本", ""}
        a.call("delete", id="memory1")
        a.sync()
        b.sync()
        assert b.call("stats")["total"] == 2
        a.call("restore", id="memory1")
        a.sync()
        b.sync()
        assert b.call("stats")["total"] == 3
        # Every request reopens SQLite: outbox, cursor and conflict state survive process restart.
        assert b.sync()["pending"] == 0
        with sqlite3.connect(tmp_path / "server.db") as db:
            wire = db.execute("select payload from notes").fetchall()
            assert str(tmp_path) not in str(wire)
            assert a.token not in str(wire)


@pytest.fixture
def protocols():
    app = FastAPI()
    seen = []
    gate = threading.Event()
    release = threading.Event()

    @app.post("/{path:path}")
    async def request(path: str, request: Request):
        assert (
            request.headers.get("authorization") == "Bearer fixture-key"
            or request.headers.get("x-api-key") == "fixture-key"
        )
        if path.endswith("audio/transcriptions"):
            body = await request.body()
            assert b'name="file"' in body and b"RIFF" in body
            seen.append("transcription")
            return {"text": "录音里的小花"}
        body = await request.json()
        seen.append(body["model"])
        if body["model"] == "slow":
            gate.set()
            import asyncio

            await asyncio.to_thread(release.wait, 5)
        prompt = str(body.get("messages") or body.get("input"))
        text = (
            "OK"
            if "连接测试" in prompt
            else json.dumps(
                {"summary": "一次赏花记录", "tags": ["小花"]}, ensure_ascii=False
            )
        )
        if path.endswith("messages"):
            assert (
                request.headers.get("anthropic-version") == "2023-06-01"
                and body["max_tokens"] > 0
            )
            return {"content": [{"type": "text", "text": text}]}
        if path.endswith("responses"):
            assert body["store"] is False
            return {"output": [{"content": [{"type": "output_text", "text": text}]}]}
        assert path.endswith("chat/completions") and body["stream"] is False
        return {"choices": [{"message": {"content": text}}]}

    with serve(app) as url:
        yield url, seen, gate, release


def test_model_protocols_and_non_destructive_jobs(tmp_path, protocols):
    url, seen, gate, release = protocols
    c = Client(tmp_path / "client")
    providers = [
        dict(
            id=p, name=p, protocol=p, baseUrl=url + "/custom/v1", model=p, enabled=True
        )
        for p in ("openai", "anthropic", "openai-responses", "transcription")
    ]
    c.call("providersSave", providers=providers)
    for p in providers:
        assert c.call("providerTest", provider=p, key="fixture-key")["ok"]
    for p in providers[:3]:
        c.call("save", id=p["id"], text="原文不能被摘要覆盖", tags=["手写标签"])
        jobs = c.call("aiEnqueue", id=p["id"], kind="summary", provider_id=p["id"])
        job = next(j for j in jobs if j["note_id"] == p["id"])
        c.call("aiRun", id=job["id"], key="fixture-key")
        note = c.call("get", id=p["id"])
        assert note["raw"] == "原文不能被摘要覆盖"
        assert (
            note["summary"] == "一次赏花记录"
            and note["tags"] == ["手写标签"]
            and note["ai_tags"] == ["小花"]
        )
    assert len(c.call("search", q="小花")["hits"]) == 3
    # Transcription writes a separate field and is searchable.
    audio = c.call(
        "mediaWrite", data=base64.b64encode(b"RIFF fixture").decode(), format="wav"
    )
    c.call("save", id="voice", text="", audio=audio["path"], source="voice", dur=1000)
    job = c.call(
        "aiEnqueue", id="voice", kind="transcription", provider_id="transcription"
    )[0]
    c.call("aiRun", id=job["id"], key="fixture-key")
    assert c.call("get", id="voice")["transcript"] == "录音里的小花"
    # Editing while an HTTP request is in flight must invalidate the generated result.
    providers[0]["model"] = "slow"
    c.call("providersSave", providers=providers)
    c.call("save", id="race", text="before")
    job = c.call("aiEnqueue", id="race", kind="summary", provider_id="openai")[0]
    failures = []

    def run():
        try:
            c.call("aiRun", id=job["id"], key="fixture-key")
        except AssertionError as e:
            failures.append(str(e))

    worker = threading.Thread(target=run)
    worker.start()
    assert gate.wait(5)
    c.call("update", id="race", text="after", tags=[])
    release.set()
    worker.join(5)
    assert failures and "STALE" in failures[0]
    note = c.call("get", id="race")
    assert note["raw"] == "after" and note["summary"] is None
    assert "fixture-key" not in c.path.read_bytes().decode("utf-8", errors="ignore")


def test_lost_push_reply_retry_does_not_lose_later_edit(tmp_path, monkeypatch):
    from fastapi.responses import JSONResponse

    monkeypatch.setenv("REGISTRATION_MODE", "open")
    app = create_app(
        "sqlite:///" + str(tmp_path / "server.db"), tmp_path / "audio", False
    )
    dropped = False

    @app.middleware("http")
    async def drop_first_reply(request, call_next):
        nonlocal dropped
        result = await call_next(request)
        if request.url.path == "/v1/sync/push" and not dropped:
            dropped = True
            return JSONResponse(
                {"detail": "simulated lost reply after commit"}, status_code=503
            )
        return result

    with serve(app) as url:
        c = Client(tmp_path / "phone")
        c.login(url, register=True)
        c.call("save", id="note", text="first version")
        with pytest.raises(AssertionError, match="503"):
            c.sync()
        c.call("update", id="note", text="edited while retry pending", tags=[])
        assert c.sync()["pending"] == 1
        assert c.call("get", id="note")["raw"] == "edited while retry pending"
        assert c.sync()["pending"] == 0
        other = Client(tmp_path / "desktop")
        other.login(url)
        other.sync()
        assert other.call("get", id="note")["raw"] == "edited while retry pending"
        assert other.sync()["conflicts"] == 0


def test_large_unicode_notes_split_sync_batches(tmp_path, monkeypatch):
    monkeypatch.setenv("REGISTRATION_MODE", "open")
    with serve(
        create_app(
            "sqlite:///" + str(tmp_path / "server.db"), tmp_path / "audio", False
        )
    ) as url:
        a = Client(tmp_path / "a")
        b = Client(tmp_path / "b")
        a.login(url, register=True)
        b.login(url)
        for i in range(4):
            a.call("save", id=f"big{i}", text="花" * 190000)
        assert a.sync()["pending"] == 2
        assert a.sync()["pending"] == 0
        assert b.sync()["pending"] == 0
        assert b.call("stats")["total"] == 4
