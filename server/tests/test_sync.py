import hashlib
import os
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from server.app import create_app


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setenv("REGISTRATION_MODE", "open")
    url = os.getenv("ZHIYAN_TEST_DATABASE_URL") or "sqlite:///" + str(
        tmp_path / "server.db"
    )
    if os.getenv("ZHIYAN_TEST_DATABASE_URL"):
        assert url.endswith("/zhiyan_test"), (
            "Only the isolated zhiyan_test database may be reset"
        )
        from sqlalchemy import create_engine
        from server.app import metadata

        engine = create_engine(url)
        metadata.drop_all(engine)
        engine.dispose()
    with TestClient(create_app(url, tmp_path / "audio", False)) as c:
        yield c


def account(api, name="alice", device="phone"):
    body = dict(username=name, password="test-password-123", device_id=device)
    r = api.post("/v1/auth/register", json=body)
    if r.status_code == 409:
        r = api.post("/v1/auth/login", json=body)
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


def operation(text="hello", revision=0, op="op1", id="note1", **extras):
    return dict(
        op_id=op,
        base_rev=revision,
        note=dict(id=id, created_at=1, updated_at=2, source="text", raw=text, **extras),
    )


def push(api, h, ops, device="phone"):
    return api.post(
        "/v1/sync/push", headers=h, json={"device_id": device, "operations": ops}
    )


def test_auth_isolation_and_revocation(api):
    a = account(api)
    b = account(api, "bob")
    assert api.get("/v1/sync/pull").status_code == 401
    assert push(api, a, [operation()]).status_code == 200
    assert api.get("/v1/sync/pull", headers=b).json()["records"] == []
    assert push(api, a, [], device="wrong").status_code == 403
    assert (
        api.post(
            "/v1/auth/login",
            json=dict(username="alice", password="wrong-password", device_id="x"),
        ).status_code
        == 401
    )
    assert api.post("/v1/auth/logout", headers=a).status_code == 200
    assert api.get("/v1/sync/pull", headers=a).status_code == 401


def test_idempotence_conflict_delete_restore(api):
    h = account(api)
    first = push(api, h, [operation()]).json()
    assert push(api, h, [operation()]).json() == first
    assert push(api, h, [operation(text="different")]).status_code == 409
    assert (
        push(api, h, [operation(op="op2")]).json()["results"][0]["status"] == "conflict"
    )
    assert (
        push(api, h, [operation(op="op3", revision=1, deleted=True)]).json()["results"][
            0
        ]["record"]["server_rev"]
        == 2
    )
    assert push(api, h, [operation(op="op4", revision=2)]).status_code == 200
    records = api.get("/v1/sync/pull?cursor=1", headers=h).json()["records"]
    assert [r["note"]["deleted"] for r in records] == [True, False]
    assert len(api.get("/v1/sync/pull", headers=h).json()["records"]) == 3


def test_attachment_scope_hash_and_missing(api):
    a = account(api)
    b = account(api, "bob")
    data = b"RIFFtest sound"
    aid = hashlib.sha256(data).hexdigest()
    url = "/v1/attachments/" + aid
    assert api.put(url, headers=a, content=b"wrong").status_code == 422
    assert push(api, a, [operation(attachment_id=aid)]).status_code == 422
    assert api.put(url, headers=a, content=data).status_code == 200
    assert api.get(url, headers=a).content == data
    assert api.get(url, headers=b).status_code == 404
    assert push(api, b, [operation(attachment_id=aid)]).status_code == 422
    assert push(api, a, [operation(attachment_id=aid)]).status_code == 200


def test_atomic_batch_and_concurrent_revision(api):
    h = account(api)
    bad = [operation(id="one"), operation(id="two", op="op2", attachment_id="a" * 64)]
    assert push(api, h, bad).status_code == 422
    assert api.get("/v1/sync/pull", headers=h).json()["records"] == []
    with ThreadPoolExecutor(max_workers=6) as pool:
        outcomes = list(
            pool.map(
                lambda i: push(api, h, [operation(id=f"n{i}", op=f"o{i}")]).status_code,
                range(20),
            )
        )
    assert outcomes == [200] * 20
    records = api.get("/v1/sync/pull", headers=h).json()["records"]
    assert [r["server_rev"] for r in records] == list(range(1, 21))


def test_body_limits_and_validation(api):
    h = account(api)
    assert push(api, h, [operation(id="../escape")]).status_code == 422
    assert (
        api.post(
            "/v1/sync/push",
            headers={**h, "content-length": str(3 * 1024 * 1024)},
            content=b"{}",
        ).status_code
        == 413
    )
    assert (
        api.post(
            "/v1/sync/push", headers=h, content=(b"x" * (2 * 1024 * 1024 + 1))
        ).status_code
        == 413
    )


def test_invite_registration(api, monkeypatch):
    monkeypatch.setenv("REGISTRATION_MODE", "invite")
    monkeypatch.setenv("REGISTRATION_INVITE", "test-invite")
    body = dict(username="inviteuser", password="test-password-123", device_id="phone")
    assert api.post("/v1/auth/register", json=body).status_code == 403
    assert (
        api.post(
            "/v1/auth/register", json={**body, "invite_code": "test-invite"}
        ).status_code
        == 200
    )


def delete_account(api, h, **body):
    return api.request(
        "DELETE",
        "/v1/account",
        headers=h,
        json={"password": "test-password-123", "confirm": "alice", **body},
    )


def test_delete_account_removes_data_files_sessions(api, tmp_path):
    from sqlalchemy import func, select
    from server.app import attachments, changes, notes, receipts, sessions, users

    a = account(api)
    second_device = account(api, device="laptop")
    b = account(api, "bob")
    data = b"RIFFdelete me"
    aid = hashlib.sha256(data).hexdigest()
    assert api.put("/v1/attachments/" + aid, headers=a, content=data).status_code == 200
    assert api.put("/v1/attachments/" + aid, headers=b, content=data).status_code == 200
    assert push(api, a, [operation(attachment_id=aid)]).status_code == 200
    assert push(api, b, [operation()]).status_code == 200
    engine = api.app.state.engine
    with engine.connect() as conn:
        uid = conn.scalar(select(users.c.id).where(users.c.username == "alice"))
    folder = tmp_path / "audio" / uid
    assert (folder / aid).is_file()

    assert api.request("DELETE", "/v1/account", json={"password": "x", "confirm": "alice"}).status_code == 401
    assert delete_account(api, a, password="wrong-password-1").status_code == 403
    assert delete_account(api, a, confirm="bob").status_code == 422
    assert (folder / aid).is_file()

    r = delete_account(api, a)
    assert r.status_code == 200, r.text
    assert not folder.exists()
    with engine.connect() as conn:
        for table in (notes, changes, receipts, attachments, sessions):
            assert conn.scalar(select(func.count()).select_from(table).where(table.c.user_id == uid)) == 0
        assert conn.scalar(select(func.count()).select_from(users).where(users.c.id == uid)) == 0
    # Old tokens of every device are dead.
    for h in (a, second_device):
        assert api.get("/v1/sync/pull", headers=h).status_code == 401
        assert api.get("/v1/devices", headers=h).status_code == 401
        assert delete_account(api, h).status_code == 401
    assert api.post("/v1/auth/login", json=dict(username="alice", password="test-password-123", device_id="phone")).status_code == 401
    # Other accounts are untouched.
    assert len(api.get("/v1/sync/pull", headers=b).json()["records"]) == 1
    assert api.get("/v1/attachments/" + aid, headers=b).content == data
    # Username can be registered again as a fresh, empty account.
    fresh = account(api)
    assert api.get("/v1/sync/pull", headers=fresh).json()["records"] == []
