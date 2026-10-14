# 只言同步服务 · HTTPS 公网部署

基于 `server/compose.yaml`（PostgreSQL + API）与 `server/compose.public.yaml` + `server/Caddyfile`（自动 HTTPS）。本文不含任何真实密钥；所有口令只写在服务器上的 `server/.env`（已被 `.gitignore` 忽略）。

## 1. 前置条件

- 一台 Linux 服务器（≥1 vCPU / 1 GB 内存），已安装 Docker Engine 与 Compose v2（`docker compose version`）。
- 一个域名，例如 `sync.example.com`，A/AAAA 记录已指向服务器公网 IP。
- 防火墙/安全组只放行 TCP 22、80、443（以及 UDP 443 用于 HTTP/3，可选）。**不要**放行 8787 或 5432。

## 2. 配置

```sh
git clone https://github.com/Eileenes/zhiyan-notes.git && cd zhiyan-notes/server
cp .env.example .env
chmod 600 .env
# 生成随机值（不要提交到仓库）：
python3 -c "import secrets;print('POSTGRES_PASSWORD='+secrets.token_urlsafe(32))"
python3 -c "import secrets;print('REGISTRATION_INVITE='+secrets.token_urlsafe(12))"
```

编辑 `.env`：

| 变量 | 说明 |
|---|---|
| `POSTGRES_PASSWORD` | 上面生成的随机值（URL-safe） |
| `REGISTRATION_MODE` | 内测用 `invite`；稳定后可 `closed` |
| `REGISTRATION_INVITE` | 邀请码，只发给内测用户 |
| `SYNC_DOMAIN` | 域名本身，不带 `https://` |
| `TRUSTED_PROXIES` | 使用随附 Caddy 时**留空**（由 `compose.public.yaml` 固定为 Caddy 的地址）；见第 5 节 |

## 3. 启动

```sh
docker compose -f compose.yaml -f compose.public.yaml up -d --build
docker compose -f compose.yaml -f compose.public.yaml ps
curl -fsS https://$SYNC_DOMAIN/health        # {"ok":true,"protocol":1}
```

Caddy 首次启动会通过 80/443 自动申请并续期 Let's Encrypt 证书（证书保存在 `caddy_data` 卷）。若申请失败，检查 DNS 是否生效、80 端口是否可达：`docker compose ... logs caddy`。

客户端在「账号与同步」中填写 `https://sync.example.com`。

升级：

```sh
git pull && docker compose -f compose.yaml -f compose.public.yaml up -d --build
```

## 4. 备份与恢复

数据在两个卷里，**必须一起备份**：`postgres`（账号、笔记、会话）和 `audio`（录音文件）。只备份数据库无法恢复录音。

```sh
# 每日备份（建议 cron），在 server/ 目录执行
TS=$(date +%Y%m%d-%H%M%S); mkdir -p ~/zhiyan-backup
docker compose exec -T postgres pg_dump -U zhiyan -Fc zhiyan > ~/zhiyan-backup/db-$TS.dump
docker compose run --rm --no-deps -v ~/zhiyan-backup:/backup api \
  tar czf /backup/audio-$TS.tgz -C /data attachments
```

- 先导出数据库、后打包附件：附件只会新增（以内容哈希命名），所以这个顺序下数据库引用的文件一定都在备份里。
- 把备份复制到异地（对象存储/另一台机器），并加密保存：备份里含有用户笔记明文。
- 定期演练恢复：

```sh
docker compose -f compose.yaml -f compose.public.yaml down        # 不加 -v，卷保留
docker compose up -d postgres
docker compose exec -T postgres pg_restore -U zhiyan -d zhiyan --clean --if-exists < db-XXXX.dump
docker compose run --rm --no-deps -v ~/zhiyan-backup:/backup api \
  sh -c "rm -rf /data/attachments/* && tar xzf /backup/audio-XXXX.tgz -C /data"
docker compose -f compose.yaml -f compose.public.yaml up -d
```

用户通过「删除账号」（`DELETE /v1/account`）删除的数据仍可能存在于旧备份中；请在隐私政策中写明备份保留期，并按期轮换删除旧备份。

## 5. 真实客户端 IP 与限流

注册（每 IP 5 次/小时）和登录（每 IP 30 次/5 分钟）的限流按客户端 IP 计数。API 只在 **TCP 对端属于 `TRUSTED_PROXIES`** 时才读取 `X-Forwarded-For`，并从右往左取第一个不可信地址；否则一律使用 TCP 对端地址。因此直连 API 的人伪造 `X-Forwarded-For` 不能换桶绕过限流（见 `server/tests/test_proxy.py`）。

- **随附 Caddy（推荐）**：`compose.public.yaml` 给 Caddy 固定地址 `172.31.87.10` 并设置 `TRUSTED_PROXIES=172.31.87.10`。Caddyfile 用 `header_up X-Forwarded-For {remote_host}` **覆盖**客户端传来的值，所以 API 拿到的就是真实对端 IP。若 `172.31.87.0/24` 与服务器已有网络冲突，同时修改 compose 文件中的子网、Caddy 地址和 `TRUSTED_PROXIES`。
- **Caddy 前面还有 CDN / 负载均衡**：在 Caddyfile 全局选项里配置 `servers { trusted_proxies static <CDN 网段> }` 并改为 `header_up X-Forwarded-For {client_ip}`；只能填 CDN 官方公布的网段。
- **自建 Nginx 等反代到 `127.0.0.1:8787`**：Docker 会把来源映射为网桥网关地址（通常 `172.17.0.1` 或 compose 网络的 `.1`）。把这个地址填到 `.env` 的 `TRUSTED_PROXIES`，并在 Nginx 中用 `proxy_set_header X-Forwarded-For $remote_addr;`（覆盖，不要用 `$proxy_add_x_forwarded_for`）。
- uvicorn 已用 `--no-proxy-headers` 启动，代理头只由应用按上述规则处理。
- 限流是单进程内存状态，Dockerfile 只开 1 个 worker；多实例部署需要换成共享存储（如 Redis），目前未实现。

验证（在服务器上）：

```sh
for i in $(seq 31); do curl -s -o /dev/null -w "%{http_code} " -H "X-Forwarded-For: 1.2.3.$i" \
  -H 'content-type: application/json' https://$SYNC_DOMAIN/v1/auth/login \
  -d '{"username":"nobody","password":"wrong-password-1","device_id":"x"}'; done; echo
# 期望前 30 个为 401，第 31 个为 429（同一来源 IP），尽管每次 XFF 都不同。
```

## 6. 安全清单

- [ ] `.env` 权限 600，不进 git；`git status` 中看不到 `.env`。
- [ ] 8787、5432 未对公网开放（`ss -ltnp` 中 8787 只监听 127.0.0.1）。
- [ ] `REGISTRATION_MODE` 为 `invite` 或 `closed`。
- [ ] `API_DOCS` 未设置。
- [ ] 每日备份 + 异地副本 + 至少一次恢复演练。
- [ ] 服务器自动安全更新已开启。
