# 04 · 数据模型

> 数据库就是 **一个 JSON 文件**：`data/db.json`。启动时全量载入内存，改动后整体写回。
> 这一节把每个集合、每个字段、以及"为什么这么设计"讲清楚 —— 改结构前必须读。

## 1. 为什么是 JSON

| 需求 | JSON 文件 | SQLite |
|---|---|---|
| 备份 | 拷一个文件 | 拷一个文件（同样简单） |
| 部署 | 不用装任何东西 | 要装原生扩展 |
| 人工查看 | `cat` 就能看 | 要工具 |
| 并发写 | 弱 | 强 |
| 数据量 | 单文件 <20MB 舒服 | 无上限 |

当前规模（约 4MB / 39 会话 / 146 资产 / 500 台账）远没到 JSON 的天花板。
**换库的触发条件**：并发写冲突真的发生了，或 `db.json` 超过 50MB。

## 2. 集合总览

```text
db.json
├── boxes[]           团队空间（Agent 的分组）
├── agents[]          专职 AI 员工（提示词 + 知识库 + 模型）
├── topics[]          选题库（1144 条）
├── conversations[]   会话（含 messages[]）
├── tasks[]           批量任务队列
├── assets[]          资产（图/视频/文档）
├── uploads[]         上传的附件
├── exports[]         导出的 docx 归属表
├── ledger[]          台账（滚动保留 500 条）
├── members[]         成员（记账主体）
├── users[]           登录账号
├── usage{}           累计用量（token 总数、调用次数）
├── org{}             组织（余额、期初、充值）
└── seededAt          种子导入时间
```

## 3. 逐表字段

### 3.1 `org`（单对象）

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 组织名，前端顶栏与台账页展示 |
| `opening` | number | 期初额度，建库时从 `billing.balance` 写入，之后只读 |
| `recharged` | number | 累计充值（只增不减，调账走负数记账） |
| `balance` | number | **派生值**：`opening + recharged − Σ ledger.credits` |
| `lowBalance` | number | 低额度告警阈值 |

> `balance` 是派生值但仍然落盘，目的是让 `/api/org` 不必每次求和。
> 任何写 `balance` 的地方都不允许 —— 只有 `reconcile()` 重算时才写。

### 3.2 `users[]`（登录账号）

| 字段 | 说明 |
|---|---|
| `id` | `u-` + 8 位 |
| `username` | 小写，唯一 |
| `name` | 展示名 |
| `salt` / `passHash` | scrypt 加盐哈希（**库里没有明文**） |
| `role` | `owner` / `admin` / `member` |
| `status` | `active` / `disabled` |
| `memberId` | 关联记账主体；用于把历史台账接到这个人身上 |
| `createdAt` / `lastLoginAt` / `pwdChangedAt` | 时间戳（ms） |
| `migratedFrom` | 从 `config.auth` 迁移来时的标记 |

### 3.3 `members[]`（记账主体）

| 字段 | 说明 |
|---|---|
| `id` | `mb-` + 8 位 |
| `name` / `role` | 展示名与角色（`owner` / `editor`） |
| `quota` | 额度上限，`0` = 不限 |
| `used` | 已用（由台账累计） |
| `active` | 是否启用 |

**为什么账号和成员分开**：台账要记"谁花的钱"，这是一个长期存在的主体；
账号只是"谁能登录"。员工离职时账号停用，但历史台账仍然挂在成员上，
财务口径不断层。多个账号理论上也可共用一个成员（目前 1:1）。

### 3.4 `boxes[]` / `agents[]`

```json
// box
{ "id": "box-1", "name": "内容工场", "desc": "…", "createdAt": 1793… }

// agent
{ "id": "a-1", "name": "选题策划", "category": "策略",
  "description": "一句话介绍", "model": "claude-sonnet-4-6",
  "temperature": 0.8, "topP": null, "enableThinking": false,
  "supportsAutoflow": true, "autoflowInstruction": "…",
  "quickQuestions": ["帮我拆解这篇爆款", "…"],
  "instruction": "（系统提示词，最长 50 万字级）",
  "knowledgeBases": [ { "name": "品牌手册", "text": "…" } ],
  "boxId": "box-1", "suspended": false }
```

- `suspended` 是**字段**，不是名字里的"（挂起）"后缀 —— 早期按名字正则判断，
  改名就会误判，已修。
- `instruction` + `knowledgeBases` 在每次请求时拼成系统提示词，受 `kbTotalLimit` 限制。

### 3.5 `conversations[]`

```json
{ "id": "c-1", "agentId": "a-1", "title": "秋季新品文案",
  "ownerId": "u-1", "createdAt": 1793…, "updatedAt": 1793…,
  "messages": [
    { "role": "user", "content": "…", "ts": 1793…,
      "uploads": [ { "id": "up-1", "name": "brief.pdf", "chars": 3210 } ],
      "refCount": 1 },
    { "role": "assistant", "content": "…", "ts": 1793…,
      "think": "（最近一轮的思考摘要，不回灌上下文）",
      "tools": [ { "name": "generate_image", "status": "done",
                   "asset": { "id": "as-9", "url": "/img/x.png" } } ],
      "usage": { "in": 813, "out": 220, "credits": 4.13 } }
  ] }
```

- `ownerId` 是隔离的关键；老数据没有这个字段时**只有 owner 能看**（迁移期兜底，
  避免"无主数据人人可见"）。
- 消息在流结束后整体写回，中途断流不留半截。

### 3.6 `assets[]`

| 字段 | 说明 |
|---|---|
| `id` | `as-` + 8 位 |
| `type` | `doc` / `image` / `video` |
| `title` | 标题（≤80 字） |
| `content` | 文档正文；图片/视频为空 |
| `imageUrl` | `/img/xxx.png` |
| `videoUrl` / `videoStatus` / `videoError` | 视频专用；`queued/running/succeeded/failed` |
| `model` / `modelLabel` / `provider` | 生成来源 |
| `size` / `resolution` / `duration` | 媒体参数 |
| `refCount` | 用了多少张参考图（证据：出图确实用了参考图） |
| `agentId` / `agentName` / `conversationId` | 溯源 |
| `usage` | 这一条产物背后的 token 消耗 |
| `fav` / `deleted` | 收藏 / 回收站（软删除） |
| `exportedAt` | 最近一次导出 docx 的时间 |
| `ownerId` | 归属 |
| **`visibility`** | `private`（默认）/ `team`（团队可见） |
| `sharedAt` | 共享时间（收回时置 null） |

### 3.7 `uploads[]`

```json
{ "id": "up-1", "name": "brief.pdf", "file": "up-xxxx.pdf",
  "mime": "application/pdf", "bytes": 248310, "chars": 3210,
  "text": "（抽取的正文，仅内存/库内，不对外）",
  "warn": null, "ownerId": "u-1", "createdAt": 1793… }
```

`warn` 非空表示"文件存下来了但正文没抽出来"（比如扫描件 PDF），
上传不报错，只提示。

### 3.8 `exports[]`

```json
{ "file": "doc-xxx.docx", "title": "报告标题", "ownerId": "u-1", "createdAt": 1793… }
```

**为什么要这张表**：导出件的文件名可被猜出来，只靠"登录了"放行等于所有人共用一个柜子。
没有记录的旧导出件 → 只有管理员能拿。

### 3.9 `ledger[]`（台账）

| 字段 | 说明 |
|---|---|
| `id` | uuid |
| `ts` / `day` | 时间戳 / `YYYY-MM-DD`（本地时区） |
| `kind` | `chat` / `image` / `video` / `subagent` |
| `model` | 模型 ID |
| `in` / `out` | 输入 / 输出 token |
| `rate` / `rateIn` / `rateOut` | 当笔单价（**逐笔存**，改配置不影响历史账） |
| `credits` | 本笔积分 |
| `agentId` / `agentName` / `boxId` | 业务溯源 |
| `memberId` / `memberName` | 记账主体 |
| `ownerId` | 归属账号（隔离用） |
| `conversationId` / `note` | 溯源 |
| `estimated` | 上游没回 usage 时按字符估算（标记出来） |
| `over` | 补记标记（早期无逐笔明细的汇总） |

**滚动保留 500 条**：出于体积考虑，`ledger` 只留最近 500 条。
为了让"总量"不因截断而失真，`store.usage.tokenCredits` 单调累计所有扣费
（含被截断的部分）。对账因此用 `usage.tokenCredits`，而不是 `Σ ledger.credits`。

### 3.10 `topics[]` / `tasks[]`

```json
// topic
{ "id": "cmv…", "title": "秋季新品种草", "content": "…",
  "dimension": "小红书", "placeholder": false, "used": false }

// task
{ "id": "t-1", "title": "…", "status": "queued", "agentId": "a-1",
  "boxId": "box-1", "ownerId": "u-1", "conversationId": null,
  "createdAt": 1793…, "error": null }
```

`tasks` 串行执行（`runQueue()`），一次一条，避免打爆上游并发。

## 4. 迁移规则

`store.js` 的 `migrate()` 在每次启动时跑，规则必须满足两条：
**幂等**（跑两次结果一样）、**只增不删**（老字段保留，方便回滚）。

| 迁移 | 触发条件 | 动作 |
|---|---|---|
| 建 `users` 表 | `users` 不存在 | 用 `config.auth`（或 `SB_USER/SB_PASS`）建 owner，`memberId` 接第一个成员 |
| 补 `suspended` | agent 有名字但无该字段 | 按名字里的"（挂起）"一次性固化，之后不再看名字 |
| 补 `ownerId` | 记录无该字段 | 会话/资产/上传/导出件统一归给 owner |
| 补 `sessions.json` | 文件不存在 | 创建空对象（老版本登录态在内存，重启即失效） |
| 补 `exports` 表 | 不存在 | 建空数组 |

**新增迁移的写法**：

```js
// store.js
if (!Array.isArray(this.data.exports)) {
  this.data.exports = [];
  this.save();
}
```

要求：判断条件用"数据形状"，不要用版本号（版本号会被手工改库搞乱）。

## 5. 不变量（改代码时不能破）

1. `org.balance === org.opening + org.recharged − Σ(ledger.credits)`（含 `over` 补记）。
2. 任何带归属的记录（会话/资产/上传/导出/台账）必须有 `ownerId`，除了：
   - `ledger` 允许 `memberId` 命中（老账只有成员没有账号）；
   - 老数据缺 `ownerId` 时，视为"只有 owner 可见"。
3. `users[].memberId` 指向存在的 `members[].id`。
4. `agents[].boxId` 指向存在的 `boxes[].id`（删 Box 时必须回落）。
5. `assets[].imageUrl` 以 `/img/` 开头，`videoUrl` 以 `/vid/` 开头 —— 媒体路由靠前缀分流。

## 6. 备份与恢复

```bash
# 备份（db.json + 媒体 + 配置）
tar czf sr-$(date +%F).tgz data/ config.json

# 恢复
systemctl stop star-river
rm -rf data && tar xzf sr-2026-10-29.tgz
chmod -R 700 data && chmod 600 config.json
systemctl start star-river
```

**只恢复 db.json 不恢复媒体**会导致：资产记录在、图片 404。
媒体目录与 db.json 必须成对备份。

## 7. 直接改库的正确姿势

```bash
# 1) 停服务（避免内存里的旧数据覆盖你的修改）
systemctl stop star-river

# 2) 备份
cp data/db.json data/db.json.bak-$(date +%s)

# 3) 用 node 改（不要用 vim 手改 JSON，容易落语法错误）
node -e "
const fs=require('fs'); const p='data/db.json';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
// 例：把某条资产的标题改掉
const a=d.assets.find(x=>x.id==='as-xxxx'); a.title='新标题';
fs.writeFileSync(p+'.tmp', JSON.stringify(d)); fs.renameSync(p+'.tmp', p);
console.log('ok');
"

# 4) 起服务（reconcile 会重算余额）
systemctl start star-river
```

> **永远不要**手改 `org.balance`。要改就记账（`/api/org/adjust`），
> 否则下次启动会被 `reconcile()` 纠正回去。
