"""Account-isolated sync API. PostgreSQL in deployment; SQLite for local tests.

No model credentials or AI proxy traffic are accepted by this service.
"""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import secrets
import threading
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import (
    BigInteger,
    Column,
    ForeignKey,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    delete,
    func,
    insert,
    select,
    update,
)
from sqlalchemy.exc import IntegrityError

metadata = MetaData()
users = Table(
    "users",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("username", String(64), unique=True, nullable=False),
    Column("password_hash", Text, nullable=False),
    Column("revision", BigInteger, nullable=False, default=0),
)
sessions = Table(
    "sessions",
    metadata,
    Column("token_hash", String(64), primary_key=True),
    Column("user_id", ForeignKey("users.id"), nullable=False),
    Column("device_id", String(128), nullable=False),
    Column("device_name", String(100), nullable=False),
    Column("expires_at", BigInteger, nullable=False),
)
notes = Table(
    "notes",
    metadata,
    Column("user_id", ForeignKey("users.id"), primary_key=True),
    Column("id", String(128), primary_key=True),
    Column("revision", BigInteger, nullable=False),
    Column("payload", Text, nullable=False),
)
changes = Table(
    "changes",
    metadata,
    Column("user_id", ForeignKey("users.id"), primary_key=True),
    Column("revision", BigInteger, primary_key=True),
    Column("record", Text, nullable=False),
)
receipts = Table(
    "receipts",
    metadata,
    Column("user_id", ForeignKey("users.id"), primary_key=True),
    Column("op_id", String(128), primary_key=True),
    Column("digest", String(64), nullable=False),
    Column("result", Text, nullable=False),
)
attachments = Table(
    "attachments",
    metadata,
    Column("user_id", ForeignKey("users.id"), primary_key=True),
    Column("id", String(64), primary_key=True),
    Column("size", BigInteger, nullable=False),
)


def digest(value):
    return hashlib.sha256(
        value if isinstance(value, bytes) else value.encode()
    ).hexdigest()


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=12, max_length=128)
    device_id: str = Field(min_length=1, max_length=128)
    device_name: str = Field(default="只言设备", max_length=100)
    invite_code: str = Field(default="", max_length=200)


class AccountDeletion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=1, max_length=128)
    confirm: str = Field(max_length=50)


class Note(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_-]+$")
    created_at: int = Field(ge=0, le=9007199254740991)
    updated_at: int = Field(ge=0, le=9007199254740991)
    source: str = Field(max_length=30)
    raw: str = Field(default="", max_length=200000)
    transcript: str | None = Field(default=None, max_length=200000)
    summary: str | None = Field(default=None, max_length=10000)
    tags: list[str] = Field(default_factory=list, max_length=50)
    ai_tags: list[str] = Field(default_factory=list, max_length=20)
    attachment_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    dur: float = Field(default=0, ge=0, le=86400, allow_inf_nan=False)
    state: str = Field(default="done", max_length=30)
    deleted: bool = False

    @field_validator("tags", "ai_tags")
    @classmethod
    def tag_lengths(cls, values):
        if any(len(v) > 100 for v in values):
            raise ValueError("标签过长")
        return values


class Operation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    op_id: str = Field(min_length=1, max_length=128)
    base_rev: int = Field(ge=0)
    note: Note


class Push(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_id: str = Field(min_length=1, max_length=128)
    operations: list[Operation] = Field(max_length=100)


def create_app(database_url=None, storage_dir=None, rate_limit=True):
    url = database_url or os.getenv("DATABASE_URL", "sqlite:///./server/data/sync.db")
    storage = Path(
        storage_dir or os.getenv("ATTACHMENTS_DIR", "./server/data/attachments")
    )
    storage.mkdir(parents=True, exist_ok=True)
    if url.startswith("sqlite:///"):
        Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        url,
        pool_pre_ping=True,
        connect_args={"check_same_thread": False, "timeout": 15}
        if url.startswith("sqlite")
        else {},
    )
    metadata.create_all(engine)
    hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
    dummy_hash = hasher.hash(secrets.token_urlsafe(32))
    lock = (
        threading.RLock()
    )  # SQLite local tests and a single process; PostgreSQL also locks user rows.
    limits = defaultdict(deque)
    limits_lock = threading.Lock()
    max_file = int(os.getenv("MAX_AUDIO_BYTES", str(100 * 1024 * 1024)))
    user_quota = int(os.getenv("USER_STORAGE_BYTES", str(1024 * 1024 * 1024)))

    @asynccontextmanager
    async def lifespan(app):
        yield
        engine.dispose()

    app = FastAPI(
        title="只言同步服务",
        version="0.7.0",
        lifespan=lifespan,
        docs_url="/docs" if os.getenv("API_DOCS") == "1" else None,
        redoc_url=None,
    )
    app.state.engine = engine

    def limit(key, maximum, seconds=60):
        if not rate_limit:
            return
        with limits_lock:
            now = time.monotonic()
            if len(limits) > 10000:
                for old in list(limits):
                    if not limits[old] or limits[old][-1] < now - 600:
                        del limits[old]
            q = limits[key]
            while q and q[0] < now - seconds:
                q.popleft()
            if len(q) >= maximum:
                raise HTTPException(429, "请求过于频繁，请稍后重试")
            q.append(now)

    @app.middleware("http")
    async def bounds(request, call_next):
        length = request.headers.get("content-length")
        cap = max_file if "/attachments/" in request.url.path else 2 * 1024 * 1024
        if length and (not length.isdigit() or int(length) > cap):
            from fastapi.responses import JSONResponse

            return JSONResponse({"detail": "请求过大"}, status_code=413)
        if "/attachments/" not in request.url.path and request.method in (
            "POST",
            "PUT",
            "PATCH",
        ):
            from fastapi.responses import JSONResponse

            chunks = []
            size = 0
            async for chunk in request.stream():
                size += len(chunk)
                if size > cap:
                    return JSONResponse({"detail": "请求过大"}, status_code=413)
                chunks.append(chunk)
            request._body = b"".join(chunks)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    def identity(authorization):
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "请先登录")
        token = authorization[7:]
        if len(token) > 200:
            raise HTTPException(401, "登录已失效")
        with engine.connect() as conn:
            row = (
                conn.execute(
                    select(sessions).where(
                        sessions.c.token_hash == digest(token),
                        sessions.c.expires_at > int(time.time()),
                    )
                )
                .mappings()
                .first()
            )
        if not row:
            raise HTTPException(401, "登录已过期，请重新登录")
        limit(("api", row["user_id"]), 240)
        return row

    def make_session(conn, user, body):
        token = secrets.token_urlsafe(32)
        conn.execute(
            delete(sessions).where(
                sessions.c.user_id == user["id"], sessions.c.device_id == body.device_id
            )
        )
        conn.execute(delete(sessions).where(sessions.c.expires_at < int(time.time())))
        conn.execute(
            insert(sessions).values(
                token_hash=digest(token),
                user_id=user["id"],
                device_id=body.device_id,
                device_name=body.device_name,
                expires_at=int(time.time()) + 30 * 86400,
            )
        )
        return {
            "token": token,
            "user": {"id": user["id"], "username": user["username"]},
        }

    @app.get("/health")
    def health():
        with engine.connect() as conn:
            conn.execute(select(1))
        return {"ok": True, "protocol": 1}

    @app.post("/v1/auth/register")
    def register(body: Credentials, request: Request):
        limit(("register", request.client.host), 5, 3600)
        mode = os.getenv("REGISTRATION_MODE", "open")
        code = os.getenv("REGISTRATION_INVITE", "")
        if mode == "closed" or (
            mode == "invite"
            and (not code or not secrets.compare_digest(body.invite_code, code))
        ):
            raise HTTPException(403, "注册未开放或邀请码不正确")
        row = {
            "id": str(uuid.uuid4()),
            "username": body.username.lower(),
            "password_hash": hasher.hash(body.password),
            "revision": 0,
        }
        try:
            with lock, engine.begin() as conn:
                conn.execute(insert(users).values(**row))
                return make_session(conn, row, body)
        except IntegrityError:
            raise HTTPException(409, "此用户名无法注册，请更换")

    @app.post("/v1/auth/login")
    def login(body: Credentials, request: Request):
        limit(("login-ip", request.client.host), 30, 300)
        limit(("login-user", body.username.lower()), 10, 300)
        with engine.connect() as conn:
            row = (
                conn.execute(
                    select(users).where(users.c.username == body.username.lower())
                )
                .mappings()
                .first()
            )
        try:
            hasher.verify(row["password_hash"] if row else dummy_hash, body.password)
        except (VerifyMismatchError, InvalidHashError):
            raise HTTPException(401, "用户名或密码不正确")
        if not row:
            raise HTTPException(401, "用户名或密码不正确")
        with lock, engine.begin() as conn:
            return make_session(conn, row, body)

    @app.post("/v1/auth/logout")
    def logout(authorization: str | None = Header(default=None)):
        session = identity(authorization)
        with engine.begin() as conn:
            conn.execute(
                delete(sessions).where(sessions.c.token_hash == session["token_hash"])
            )
        return {"ok": True}

    @app.get("/v1/devices")
    def devices(authorization: str | None = Header(default=None)):
        session = identity(authorization)
        with engine.connect() as conn:
            rows = (
                conn.execute(
                    select(
                        sessions.c.device_id,
                        sessions.c.device_name,
                        sessions.c.expires_at,
                    ).where(sessions.c.user_id == session["user_id"])
                )
                .mappings()
                .all()
            )
        return {"devices": [dict(r) for r in rows]}

    @app.delete("/v1/devices/{device_id}")
    def revoke(device_id: str, authorization: str | None = Header(default=None)):
        session = identity(authorization)
        with engine.begin() as conn:
            conn.execute(
                delete(sessions).where(
                    sessions.c.user_id == session["user_id"],
                    sessions.c.device_id == device_id,
                )
            )
        return {"ok": True}

    @app.delete("/v1/account")
    def delete_account(
        body: AccountDeletion, authorization: str | None = Header(default=None)
    ):
        """Permanently delete the caller's account and every server-side copy.

        Requires the current password and the username typed again, so a stolen
        bearer token alone cannot wipe an account.
        """
        session = identity(authorization)
        uid = session["user_id"]
        limit(("delete-account", uid), 5, 300)
        with engine.connect() as conn:
            user = conn.execute(select(users).where(users.c.id == uid)).mappings().one()
        if body.confirm.lower() != user["username"]:
            raise HTTPException(422, "请输入当前用户名以确认删除")
        try:
            hasher.verify(user["password_hash"], body.password)
        except (VerifyMismatchError, InvalidHashError):
            raise HTTPException(403, "密码不正确")
        with lock, engine.begin() as conn:
            conn.execute(
                select(users.c.id).where(users.c.id == uid).with_for_update()
            ).one()
            for table in (receipts, changes, notes, attachments, sessions):
                conn.execute(delete(table).where(table.c.user_id == uid))
            conn.execute(delete(users).where(users.c.id == uid))
        # Files go after the commit: a crash leaves orphaned files (no owner row,
        # unreachable) rather than rows pointing at missing audio.
        folder = storage / uid
        if folder.resolve().parent == storage.resolve():
            shutil.rmtree(folder, ignore_errors=True)
        return {"ok": True, "deleted": True}

    @app.post("/v1/sync/push")
    def push(body: Push, authorization: str | None = Header(default=None)):
        session = identity(authorization)
        uid = session["user_id"]
        if body.device_id != session["device_id"]:
            raise HTTPException(403, "设备身份不匹配")
        results = []
        with lock, engine.begin() as conn:
            user = (
                conn.execute(select(users).where(users.c.id == uid).with_for_update())
                .mappings()
                .one()
            )
            revision = user["revision"]
            for op in body.operations:
                payload = op.note.model_dump()
                checksum = digest(
                    json.dumps(op.model_dump(), sort_keys=True, ensure_ascii=False)
                )
                receipt = (
                    conn.execute(
                        select(receipts).where(
                            receipts.c.user_id == uid, receipts.c.op_id == op.op_id
                        )
                    )
                    .mappings()
                    .first()
                )
                if receipt:
                    if receipt["digest"] != checksum:
                        raise HTTPException(409, "操作 ID 已用于不同内容")
                    results.append(json.loads(receipt["result"]))
                    continue
                current = (
                    conn.execute(
                        select(notes).where(
                            notes.c.user_id == uid, notes.c.id == payload["id"]
                        )
                    )
                    .mappings()
                    .first()
                )
                if op.base_rev != (current["revision"] if current else 0):
                    result = {
                        "id": payload["id"],
                        "status": "conflict",
                        "record": {
                            "id": current["id"],
                            "server_rev": current["revision"],
                            "note": json.loads(current["payload"]),
                        }
                        if current
                        else None,
                    }
                else:
                    aid = payload["attachment_id"]
                    if (
                        aid
                        and not conn.execute(
                            select(attachments.c.id).where(
                                attachments.c.user_id == uid, attachments.c.id == aid
                            )
                        ).first()
                    ):
                        raise HTTPException(422, "请先上传录音附件")
                    if (
                        not current
                        and conn.scalar(
                            select(func.count())
                            .select_from(notes)
                            .where(notes.c.user_id == uid)
                        )
                        >= 50000
                    ):
                        raise HTTPException(413, "记录数量已达到当前账号上限")
                    revision += 1
                    value = json.dumps(
                        payload, ensure_ascii=False, separators=(",", ":")
                    )
                    if current:
                        conn.execute(
                            update(notes)
                            .where(notes.c.user_id == uid, notes.c.id == payload["id"])
                            .values(revision=revision, payload=value)
                        )
                    else:
                        conn.execute(
                            insert(notes).values(
                                user_id=uid,
                                id=payload["id"],
                                revision=revision,
                                payload=value,
                            )
                        )
                    record = {
                        "id": payload["id"],
                        "server_rev": revision,
                        "note": payload,
                    }
                    conn.execute(
                        insert(changes).values(
                            user_id=uid,
                            revision=revision,
                            record=json.dumps(record, ensure_ascii=False),
                        )
                    )
                    result = {
                        "id": payload["id"],
                        "status": "accepted",
                        "record": record,
                    }
                conn.execute(
                    insert(receipts).values(
                        user_id=uid,
                        op_id=op.op_id,
                        digest=checksum,
                        result=json.dumps(result, ensure_ascii=False),
                    )
                )
                results.append(result)
            conn.execute(
                update(users).where(users.c.id == uid).values(revision=revision)
            )
        return {"results": results}

    @app.get("/v1/sync/pull")
    def pull(cursor: int = 0, authorization: str | None = Header(default=None)):
        if cursor < 0:
            raise HTTPException(422, "同步游标错误")
        session = identity(authorization)
        with engine.connect() as conn:
            rows = (
                conn.execute(
                    select(changes)
                    .where(
                        changes.c.user_id == session["user_id"],
                        changes.c.revision > cursor,
                    )
                    .order_by(changes.c.revision)
                    .limit(201)
                )
                .mappings()
                .all()
            )
        selected = []
        size = 0
        for row in rows[:200]:
            next_size = len(row["record"].encode())
            if selected and size + next_size > 1_500_000:
                break
            selected.append(row)
            size += next_size
        return {
            "records": [json.loads(r["record"]) for r in selected],
            "cursor": selected[-1]["revision"] if selected else cursor,
            "has_more": len(rows) > len(selected),
        }

    @app.put("/v1/attachments/{attachment_id}")
    async def upload(
        attachment_id: str,
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        session = identity(authorization)
        if not re.fullmatch("[a-f0-9]{64}", attachment_id):
            raise HTTPException(422, "附件标识错误")
        uid = session["user_id"]
        folder = storage / uid
        folder.mkdir(parents=True, exist_ok=True)
        temp = folder / (str(uuid.uuid4()) + ".part")
        size = 0
        h = hashlib.sha256()
        try:
            with temp.open("wb") as out:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > max_file:
                        raise HTTPException(413, "录音文件过大")
                    h.update(chunk)
                    out.write(chunk)
            if h.hexdigest() != attachment_id:
                raise HTTPException(422, "附件校验失败")
            with lock, engine.begin() as conn:
                conn.execute(
                    select(users.c.id).where(users.c.id == uid).with_for_update()
                ).one()
                exists = conn.execute(
                    select(attachments).where(
                        attachments.c.user_id == uid, attachments.c.id == attachment_id
                    )
                ).first()
                if not exists:
                    used = conn.scalar(
                        select(func.coalesce(func.sum(attachments.c.size), 0)).where(
                            attachments.c.user_id == uid
                        )
                    )
                    if used + size > user_quota:
                        raise HTTPException(413, "此账号的音频存储空间不足")
                    os.replace(temp, folder / attachment_id)
                    conn.execute(
                        insert(attachments).values(
                            user_id=uid, id=attachment_id, size=size
                        )
                    )
            return {"id": attachment_id, "size": size}
        finally:
            temp.unlink(missing_ok=True)

    @app.get("/v1/attachments/{attachment_id}")
    def download(attachment_id: str, authorization: str | None = Header(default=None)):
        session = identity(authorization)
        with engine.connect() as conn:
            row = conn.execute(
                select(attachments).where(
                    attachments.c.user_id == session["user_id"],
                    attachments.c.id == attachment_id,
                )
            ).first()
        if not row:
            raise HTTPException(404, "附件不存在")
        path = storage / session["user_id"] / attachment_id
        if not path.is_file():
            raise HTTPException(503, "附件暂不可用，请稍后重试")
        return FileResponse(
            path, media_type="application/octet-stream", filename=attachment_id
        )

    return app


app = create_app()
