# 07 · 部署

> 四种部署形态，按"要发给谁"选。所有命令都是可复制执行的，不是示意。

## 0. 先选形态

| 形态 | 谁用 | 前置 | 成本 | 断线风险 |
|---|---|---|---|---|
| **A 本机** | 自己 | 无 | 0 | 电脑关就断 |
| **B 局域网** | 同 WiFi 的同事 | 无 | 0 | 电脑睡眠就断 |
| **C 隧道** | 外地客户试用几天 | 装 cloudflared | 0 | 电脑必须开着 |
| **D 云服务器** | 正式对客 | 买机器 + 域名 | ¥90–180/月 | 靠运维 |

## A. 本机

```bash
cd starbox-clone
cp config.example.json config.json && $EDITOR config.json
./start.sh
# → http://127.0.0.1:7777
```

## B. 局域网

```bash
SB_HOST=0.0.0.0 ./start.sh
# macOS 查 IP
ipconfig getifaddr en0        # 例如 192.168.0.99
# → http://192.168.0.99:7777
```

同事要能访问，注意两点：

1. 你的电脑防火墙要允许该端口的入站；
2. 手机/同事电脑要在同一网段（公司 WiFi 的"访客网络"通常隔离，会连不上）。

## C. 隧道（临时公网）

```bash
# 安装
brew install cloudflared          # macOS
# 起隧道（指向本机 7777）
cloudflared tunnel --url http://127.0.0.1:7777
# 输出形如 https://xxx-yyy-zzz.trycloudflare.com
```

特点：**链接谁拿到谁能打开**，安全全靠登录密码；换个进程就换链接。
适合"给客户看两天"，不适合长期。

## D. 云服务器（正式）

以 Ubuntu 22.04 / Debian 12 为例。

### D.1 装机

```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git caddy

# 建一个不能登录的系统用户跑服务
sudo useradd --system --create-home --shell /usr/sbin/nologin starriver
```

### D.2 放代码

```bash
sudo mkdir -p /opt/star-river && sudo chown starriver:starriver /opt/star-river
sudo -u starriver git clone <repo-url> /opt/star-river
cd /opt/star-river

# 配置（用 starriver 身份写，权限 600）
sudo -u starriver cp config.example.json config.json
sudo -u starriver chmod 600 config.json
sudo -u starriver $EDITOR config.json          # 填 Key + 初始密码

sudo -u starriver mkdir -p data && sudo -u starriver chmod 700 data
```

### D.3 systemd 守护

仓库里已带好单元文件：`deploy/star-river.service`

```bash
sudo cp deploy/star-river.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now star-river
sudo systemctl status star-river --no-pager

# 看日志
sudo journalctl -u star-river -f
```

单元文件里已经做了这些事：

- `SB_HOST=127.0.0.1`（只让反代进来，不直接暴露）；
- `Restart=always`（崩了 3 秒后拉起）；
- `ProtectSystem=strict` + `ReadWritePaths=/opt/star-river/data`（只能写数据目录）；
- 日志交 journald（不自己写文件，免得磁盘写满）。

### D.4 HTTPS 反代

**首选 Caddy**（自动申请证书，两行配置）：

```bash
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo $EDITOR /etc/caddy/Caddyfile      # 改域名与邮箱
sudo systemctl reload caddy
```

**或 Nginx**：

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/star-river
sudo $EDITOR /etc/nginx/sites-available/star-river   # 改域名
sudo ln -s /etc/nginx/sites-available/star-river /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d star.example.com
```

⚠️ **SSE 必须关缓冲**，否则 `/api/chat` 的流式会攒成一坨再吐（表现为"点了发送半天没反应，然后整段出现"）：

- Caddy：`flush_interval -1`
- Nginx：`proxy_buffering off;` + `chunked_transfer_encoding on;`

### D.5 首次登录与改密

```bash
curl -s -X POST https://star.example.com/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"config 里那个初始密码"}'
```

登录成功即完成明文迁移。**之后立刻在界面里改一次密码**（`账号与权限 → 改密码`），
并把 `config.json` 里的 `auth.password` 换成一个不用的随机串。

### D.6 备份

```bash
# 手工跑一次，确认能生成包
sudo CONFIG_FILE=/opt/star-river/config.json /opt/star-river/scripts/backup.sh

# 每天 3:30 自动跑，保留 14 天
sudo crontab -u starriver -e
# 30 3 * * * CONFIG_FILE=/opt/star-river/config.json KEEP=14 /opt/star-river/scripts/backup.sh >> /var/log/sr-backup.log 2>&1
```

备份包含：`data/`（db.json + 全部媒体）+ `config.json`。
**两者必须一起备** —— 只恢复 db.json 会出现"资产记录在、图片 404"。

### D.7 体验环境（和正式共存）

```bash
# 同一台机器，第二个实例
sudo -u starriver cp -r /opt/star-river /opt/star-river-demo   # 或同目录不同数据
cd /opt/star-river
SB_DATA=/opt/star-river/data-demo PORT=7788 SB_HOST=127.0.0.1 \
SB_USER=demo SB_PASS='换成体验密码' node server.js
```

建议再写一个 `star-river-demo.service`（复制主单元，改 `Port`/`SB_DATA`/`SB_USER`），
反代到 `demo.example.com`。

## 3. 升级与回滚

```bash
# 升级前先备份
sudo CONFIG_FILE=/opt/star-river/config.json /opt/star-river/scripts/backup.sh

# 拉新代码（config.json 与 data/ 已被 gitignore，不会被动到）
sudo -u starriver git -C /opt/star-river pull --ff-only

# 重启（restart 会重跑 migrate + reconcile）
sudo systemctl restart star-river
sudo journalctl -u star-river -n 30 --no-pager

# 冒烟
curl -s https://star.example.com/api/ping
```

回滚：

```bash
sudo -u starriver git -C /opt/star-river checkout <上一个 tag>
sudo systemctl restart star-river
# 若数据也要回滚：
sudo systemctl stop star-river
sudo tar xzf /opt/star-river/backups/sr-YYYYmmdd-HHMMSS.tgz -C /opt/star-river
sudo chown -R starriver:starriver /opt/star-river/data
sudo systemctl start star-river
```

## 4. 上线检查清单

- [ ] `curl https://域名/api/ping` 返回 `{"ok":true}`
- [ ] 未登录访问 `/` 显示介绍页；点「登录工作台」能进
- [ ] 登录后访问 `/` 直接 302 到工作台
- [ ] 发一条消息，文字是**一段一段冒出来**的（不是一次性出现）
- [ ] 未登录 `curl -I https://域名/img/任意.png` → 401
- [ ] 手机打开，侧栏是抽屉（☰），主区不被挤
- [ ] `journalctl -u star-river` 里没有反复出现的上游 401/429
- [ ] 备份跑通，包能 `tar tzf` 列出内容
- [ ] `config.json` 权限 600、`data` 权限 700
- [ ] 体验环境与正式环境数据目录不同

## 5. 常见部署故障

| 现象 | 原因 | 修法 |
|---|---|---|
| 502 Bad Gateway | 服务没起 / 端口不对 | `systemctl status star-river`；`curl 127.0.0.1:7777/api/ping` |
| 页面能开但一直转圈 | SSE 被反代缓冲 | Caddy `flush_interval -1`；Nginx `proxy_buffering off` |
| 图片全部 404 | 媒体目录没跟着代码搬 | 确认 `data/images` 存在且属主正确 |
| 登录后立刻掉线 | Cookie 没跨过反代（Secure/域名不匹配） | 统一用同一域名访问，别混用 IP 和域名 |
| 上传 413 | 反代体积限制 | Caddy `request_body max_size`；Nginx `client_max_body_size` |
| 中文文件名乱码 | 系统 locale | `localectl set-locale LANG=C.UTF-8` 后重启服务 |
| 时间/日期不对 | 时区 | `timedatectl set-timezone Asia/Shanghai`；台账 `day` 按本地时区 |
| 磁盘满了 | 图片/视频堆积 | 清旧媒体 + 加 `backups` 轮转 + 配 journald `SystemMaxUse` |
