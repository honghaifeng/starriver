# 08 · 运维手册

> 值班时先看第 1 节的速查表，再往下翻细节。

## 1. 速查表

| 我要… | 命令 |
|---|---|
| 看服务活着吗 | `curl -s localhost:7777/api/ping` |
| 重启 | `sudo systemctl restart star-river` |
| 看实时日志 | `sudo journalctl -u star-river -f` |
| 看最近 100 行 | `sudo journalctl -u star-river -n 100 --no-pager` |
| 看端口谁占着 | `lsof -nP -iTCP:7777 -sTCP:LISTEN` |
| 看余额 | `curl -s -b cookies.txt localhost:7777/api/org` |
| 对账 | `curl -s -b cookies.txt localhost:7777/api/billing/audit` |
| 备份 | `CONFIG_FILE=$PWD/config.json ./scripts/backup.sh` |
| 看库多大 | `du -sh data/* \| sort -h` |
| 看谁在线 | `cat data/sessions.json \| node -e "…"`（见 §5） |
| 清空某人的会话 | 界面操作，或改库（§6） |

## 2. 启停

```bash
# systemd（服务器）
sudo systemctl start|stop|restart|status star-river

# 前台（本机调试）
./start.sh
# Ctrl+C 结束

# 后台跑但不装服务（临时）
nohup node server.js > /tmp/sr.log 2>&1 &
```

**什么时候必须重启**：改了 `server.js` / `store.js` / `lib/*` / `config.json`。
**改前端不用重启**：`public/*` 是静态文件，刷新即生效（必要时强刷清缓存）。

> 踩过的坑：改完服务端代码直接跑验收脚本 → 测的是旧进程里的旧代码 → 绿灯是假的。

## 3. 日志

服务端只往 stdout 打，交给 journald / 你的终端：

| 级别 | 例子 | 何时出现 |
|---|---|---|
| 启动 | `春科 · 星河 StarRiver → http://127.0.0.1:7777` | 每次启动 |
| 迁移 | `已建立账号体系：owner=qiufeng` | 首次或库被清 |
| 上游错误 | `上游 429` / `上游 401` | Key 失效、超限 |
| 异常 | `[chat] TypeError: …` | 代码 bug |

```bash
# 只看错误
sudo journalctl -u star-river -p err -n 50 --no-pager

# 看某个时间段
sudo journalctl -u star-river --since "2026-10-29 09:00" --until "2026-10-29 11:00"
```

**没有文件日志**是有意的：单文件日志需要自己处理轮转，容易写满磁盘。
需要留存就配 journald：

```bash
sudo mkdir -p /etc/systemd/journald.conf.d
echo -e '[Journal]\nSystemMaxUse=500M\nSystemMaxFileSize=50M' | \
  sudo tee /etc/systemd/journald.conf.d/star-river.conf
sudo systemctl restart systemd-journald
```

## 4. 备份与恢复

### 4.1 备份什么

| 内容 | 为什么 | 丢了会怎样 |
|---|---|---|
| `data/db.json` | 全部业务数据 | 全没了 |
| `data/images` `data/videos` | 生成的媒体 | 资产记录在、文件 404 |
| `data/uploads` | 用户附件 | 老对话的附件打不开 |
| `data/exports` | 导出件 | 老下载链接失效 |
| `config.json` | Key 与配置 | 换机器要重配 |
| `data/sessions.json` | 登录态 | 不重要，全员重登 |

### 4.2 备份

```bash
# 一次
CONFIG_FILE=$PWD/config.json KEEP=14 ./scripts/backup.sh
# → backups/sr-20261029-100744.tgz（约 92MB，含媒体）

# 定时
crontab -e
30 3 * * * CONFIG_FILE=/opt/star-river/config.json KEEP=14 /opt/star-river/scripts/backup.sh >> /var/log/sr-backup.log 2>&1
```

脚本自带三件事：`chmod 600`、按 `KEEP` 清理超期、`tar tzf` 自检包完整性。

### 4.3 恢复

```bash
sudo systemctl stop star-river

# 留个现场
sudo mv /opt/star-river/data /opt/star-river/data.broken-$(date +%s)

# 解包（包内是 data/ 与 config.json）
sudo tar xzf backups/sr-20261029-100744.tgz -C /opt/star-river
sudo chown -R starriver:starriver /opt/star-river/data
sudo chmod 700 /opt/star-river/data && sudo chmod 600 /opt/star-river/config.json

sudo systemctl start star-river
curl -s localhost:7777/api/ping
```

恢复后**必须**验一次对账（`/api/billing/audit` 的 `balanced` 应为 true）。

### 4.4 只恢复一部分

```bash
# 只看包里有什么
tar tzf backups/sr-*.tgz | head -20

# 只取 db.json
tar xzf backups/sr-20261029-100744.tgz -O data/db.json > /tmp/db.json
```

## 5. 日常巡检（每周 5 分钟）

```bash
# ① 服务与端口
curl -s localhost:7777/api/ping && lsof -nP -iTCP:7777 -sTCP:LISTEN | tail -1

# ② 磁盘（媒体会持续增长）
df -h /opt && du -sh /opt/star-river/data/* | sort -h

# ③ 库大小与备份是否新鲜
ls -lh /opt/star-river/data/db.json
ls -lht /opt/star-river/backups | head -3

# ④ 对账
curl -s -b /tmp/c.txt localhost:7777/api/billing/audit | \
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('余额',j.balance,'应',j.expectBalance,'自洽',j.balanced,'token差',j.tokenGap,'漂移',j.rateDrift)})"

# ⑤ 上游健康（最近的错误）
sudo journalctl -u star-river --since "-7 days" | grep -cE "上游 (401|429|5[0-9][0-9])"
```

判定标准：

| 指标 | 健康 | 要处理 |
|---|---|---|
| `balanced` | true | false → 立刻查账 |
| `tokenGap` | \|x\| < 1 | 超过 → 查 `usage` 是否缺失 |
| 磁盘使用 | < 70% | > 85% → 清媒体/加盘 |
| 备份最新 | 24 小时内 | 超过 → 查 cron |
| 上游 401/429 次数 | 个位数/周 | 持续增长 → 换 Key 或降频 |

## 6. 数据操作（谨慎）

### 6.1 停用某人

```bash
# 先查 ID
curl -s -b /tmp/c.txt localhost:7777/api/users | node -e "…"

# 停用（立即生效，不影响历史台账）
curl -s -b /tmp/c.txt -X POST localhost:7777/api/users/u-xxxx/status \
  -H 'content-type: application/json' -d '{"status":"disabled"}'
```

### 6.2 清空某个人的会话（他离职了）

```bash
sudo systemctl stop star-river
cp data/db.json data/db.json.bak-$(date +%s)
node -e "
const fs=require('fs'); const p='data/db.json';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
const uid='u-xxxx';
const before=d.conversations.length;
d.conversations=d.conversations.filter(c=>c.ownerId!==uid);
console.log('删除会话', before-d.conversations.length, '条');
fs.writeFileSync(p+'.tmp', JSON.stringify(d)); fs.renameSync(p+'.tmp', p);
"
sudo systemctl start star-river
```

### 6.3 重置某人密码（他自己忘了）

界面「账号与权限 → 重置密码」最稳（返回一次性明文给你转达）。
命令行方式：

```bash
node -e "
const path=require('path');
const identity=require('./lib/identity');
const {Store}=require('./store');
const s=new Store(path.join(__dirname,'data'));
const u=s.findUserByName('xiaochen');
const h=identity.hashPassword('Temp1234');
u.salt=h.salt; u.passHash=h.passHash;
s.save(); console.log('已重置为 Temp1234');
"
```

### 6.4 调账（补/退）

```bash
# 退 500（负数）
curl -s -b /tmp/c.txt -X POST localhost:7777/api/org/adjust \
  -H 'content-type: application/json' -d '{"credits":-500,"note":"误记修正 2026-10-29"}'
```

永远用调账，**不要手改 `org.balance`**（下次启动会被 reconcile 纠正）。

## 7. 故障处置

### 7.1 起不来

```bash
sudo systemctl status star-river --no-pager     # 看退出码
sudo journalctl -u star-river -n 50 --no-pager  # 看堆栈
node server.js                                   # 前台跑，直接看报错
```

| 报错 | 原因 | 修法 |
|---|---|---|
| `EADDRINUSE` | 端口被占 | `lsof -iTCP:7777` 杀掉，或换 `PORT` |
| `Cannot find module './store'` | 目录不完整 | 重新 `git pull` |
| `Unexpected token } in JSON` | `db.json` 被手改坏 | 用 `db.json.bak-*` 回滚 |
| `EACCES` | 权限 | `chown -R starriver:starriver` |

### 7.2 能开页面但发不出消息

按顺序查：

```bash
# ① 余额/额度（402）
curl -s -b /tmp/c.txt localhost:7777/api/org | head -c 200

# ② 上游 Key（401/429）
sudo journalctl -u star-river -n 30 | grep 上游

# ③ 反代缓冲（前端表现为一直转圈）
curl -N -b /tmp/c.txt -X POST localhost:7777/api/chat \
  -H 'content-type: application/json' -d '{"content":"ping","model":"claude-haiku-4-5-20251001"}'
# 直连是逐帧返回、走反代是一坨 → 反代没关缓冲
```

### 7.3 图片/视频打不开

```bash
# 文件在不在
ls -l data/images | tail -3

# 归属对不对（不是自己的一定 404）
curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/c.txt localhost:7777/img/xxx.png

# 未登录应该 401，不是 200
curl -s -o /dev/null -w "%{http_code}\n" localhost:7777/img/xxx.png
```

### 7.4 余额不对

```bash
curl -s -b /tmp/c.txt localhost:7777/api/billing/audit
```

- `balanced: false` → 有人手改了 `balance`，重启即可纠正；
- `tokenGap` 大 → 有笔没记 usage（看 `ledger` 里 `estimated: true` 的比例）；
- `backfillCredits` 非 0 是正常的（历史补记，单列）。

### 7.5 磁盘写满

```bash
du -sh data/* | sort -h
# 清最老的图片（示例：删 30 天前的）
find data/images -type f -mtime +30 -print | head -50
find data/images -type f -mtime +30 -delete
# 导出件也可以清（原件在资产库里，可重新导出）
find data/exports -type f -mtime +30 -delete
```

⚠️ 删媒体文件后，资产记录还在（点开是 404）。要干净就同时把对应 `assets` 标 `deleted`。

## 8. 变更窗口建议

- 改配置/升级：选没人用的时间（晚上/周末），先备份；
- 改代码：先在自己机器跑全套 306 项断言，再上服务器；
- 改数据结构：必须写迁移（`store.js` 的 `migrate()`），不要手工改库；
- 任何改动后：`curl /api/ping` + 发一条真消息 + 看对账，三件事都过才算完成。
