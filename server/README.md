# 只言同步服务

多用户同步 API，客户端直连自己的模型服务商，API Key 不发送到这个同步服务。

## 本地运行

在仓库根目录执行：

```sh
python3 -m venv server/.venv
server/.venv/bin/pip install -r server/requirements.txt
server/.venv/bin/uvicorn server.app:app --host 127.0.0.1 --port 8787 --no-access-log
```

默认使用 `server/data/sync.db` 和 `server/data/attachments/`，本地开发允许注册。Mac 与 iOS 模拟器填写 `http://127.0.0.1:8787`；Android 模拟器使用 `http://10.0.2.2:8787`。真机不能用电脑的 localhost，请部署 HTTPS 服务。

在两台设备上使用同一个服务地址和账号。首次登录会上传当前本机资料库里的记录，界面已说明此行为。不要把测试客户端连接到个人或生产资料库。

## PostgreSQL 部署

```sh
cd server
cp .env.example .env
# 修改 POSTGRES_PASSWORD、REGISTRATION_INVITE；口令使用 URL-safe 随机字符。
docker compose up -d --build
curl http://127.0.0.1:8787/health
```

此配置只把 API 暴露到服务器的回环地址，PostgreSQL 不映射端口。部署默认要求邀请码；设置 `REGISTRATION_MODE=closed` 可以关闭新注册，已有账号仍能登录。`open` 允许公开注册。

在已有 HTTPS 反向代理中转发到 `127.0.0.1:8787`，或使用随附 Caddy 配置：将已解析到服务器的域名写进 `.env` 的 `SYNC_DOMAIN`，运行：

```sh
docker compose -f compose.yaml -f compose.public.yaml up -d --build
```

完整的 HTTPS 部署、备份恢复与真实客户端 IP 配置见 [HTTPS 部署指南](../docs/DEPLOY-HTTPS.md)。Caddy 使用 80 / 443 端口申请并续期域名证书。只有域名、DNS 和服务器防火墙就绪后才能验证公网访问；本轮未部署或申请证书。Dockerfile 默认只运行一个 API worker，当前限流为进程内状态。

## 数据与运维

- `postgres` 卷保存账号、密码哈希、哈希化会话、笔记、变更日志、幂等记录。
- `audio` 卷按用户 UUID 分目录存放 SHA-256 命名的录音，读取必须通过账号鉴权。
- 同时备份数据库与附件；仅备份数据库不能恢复录音。建议在停止写入后备份两者并验证恢复。
- 密码由 Argon2id 哈希处理；会话 30 天过期。不同用户无法按猜测的 note ID / 附件 hash 访问他人的内容。
- 使用 HTTPS 不等于端到端加密：服务运营者可以读取笔记和录音。对外使用时需要如实向用户说明。
- `/v1/devices` 列出当前账号设备，`DELETE /v1/devices/{device_id}` 撤销对应会话。退出当前账号调用 `/v1/auth/logout`。离线退出仅清除本机令牌，无法立即撤销服务器会话。
- 数据库首次启动自动创建表；现有 schema 的后续版本迁移需要显式设计，不能依赖 `create_all` 修改列。
- 当前版本没有邮件验证、密码找回、用户自助账号删除、分布式限流、附件清理和历史压缩。先用邀请制验证，再完善公开运营能力。

配置项：`DATABASE_URL`、`TRUSTED_PROXIES`（可信反代 IP/CIDR，逗号分隔；为空时忽略 X-Forwarded-For）、`ATTACHMENTS_DIR`、`REGISTRATION_MODE`、`REGISTRATION_INVITE`、`MAX_AUDIO_BYTES`（默认 100 MB）、`USER_STORAGE_BYTES`（默认 1 GB）。`API_DOCS=1` 可开启开发用 `/docs`，默认关闭。

测试见 [跨端说明](../docs/CROSS-PLATFORM-PLAN.md)。部署清单准备完毕不代表已经上线。
