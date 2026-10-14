"""Rate limiting must not be bypassable with a forged X-Forwarded-For."""

import pytest
from fastapi.testclient import TestClient
from server.app import client_ip, create_app, parse_trusted_proxies

PROXY = "172.31.87.10"
TRUSTED = parse_trusted_proxies(PROXY + ",10.0.0.0/8")


def test_client_ip_rules():
    # Untrusted peer: header ignored entirely.
    assert client_ip("203.0.113.5", "1.2.3.4", TRUSTED) == "203.0.113.5"
    assert client_ip("203.0.113.5", "1.2.3.4", ()) == "203.0.113.5"
    # Trusted proxy: right-most untrusted hop wins; forged left entries ignored.
    assert client_ip(PROXY, "198.51.100.7", TRUSTED) == "198.51.100.7"
    assert client_ip(PROXY, "6.6.6.6, 198.51.100.7", TRUSTED) == "198.51.100.7"
    assert client_ip(PROXY, "6.6.6.6, 198.51.100.7, 10.1.2.3", TRUSTED) == "198.51.100.7"
    # Garbage never escapes to an attacker-chosen key.
    assert client_ip(PROXY, "not-an-ip", TRUSTED) == PROXY
    assert client_ip(PROXY, "", TRUSTED) == PROXY
    assert client_ip(PROXY, "2001:db8::1", TRUSTED) == "2001:db8::1"


def make(tmp_path, monkeypatch, peer, trusted):
    monkeypatch.setenv("REGISTRATION_MODE", "open")
    app = create_app(
        "sqlite:///" + str(tmp_path / "s.db"), tmp_path / "a", True, trusted
    )
    return TestClient(app, client=(peer, 40000))


def login(c, xff, n):
    return c.post(
        "/v1/auth/login",
        headers={"X-Forwarded-For": xff} if xff else {},
        json=dict(username=f"user{n}", password="wrong-password-12", device_id="d"),
    )


def test_forged_xff_from_direct_client_cannot_bypass(tmp_path, monkeypatch):
    with make(tmp_path, monkeypatch, "203.0.113.5", PROXY) as c:
        codes = [login(c, f"10.9.{i}.{i}", i).status_code for i in range(31)]
    assert codes[:30] == [401] * 30
    assert codes[30] == 429


def test_forged_xff_through_trusted_proxy_cannot_bypass(tmp_path, monkeypatch):
    # The proxy appends the real client (198.51.100.7) after the forged value.
    with make(tmp_path, monkeypatch, PROXY, PROXY) as c:
        codes = [
            login(c, f"1.1.{i}.{i}, 198.51.100.7", i).status_code for i in range(31)
        ]
        assert codes[30] == 429
        # A genuinely different client behind the same proxy has its own bucket.
        assert login(c, "198.51.100.8", 99).status_code == 401


def test_untrusted_default_ignores_header(tmp_path, monkeypatch):
    monkeypatch.delenv("TRUSTED_PROXIES", raising=False)
    with make(tmp_path, monkeypatch, "127.0.0.1", None) as c:
        codes = [login(c, f"9.9.9.{i}", i).status_code for i in range(31)]
    assert codes[30] == 429


def test_invalid_trusted_proxy_config_fails_fast(tmp_path):
    with pytest.raises(ValueError):
        create_app("sqlite:///" + str(tmp_path / "s.db"), tmp_path / "a", True, "nope")
