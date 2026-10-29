# 03 · 接口参考

> 所有接口前缀 `/api`，请求与响应都是 JSON（`/api/chat` 例外，返回 SSE）。
> 认证靠 Cookie：登录成功后服务端 `Set-Cookie: sid=…`（HttpOnly、SameSite=Lax），
> 之后的请求浏览器自动带上。命令行测试用 `curl -c cookies.txt` / `-b cookies.txt`。

## 0. 通用约定

### 0.1 状态码

| 码 | 含义 | 前端处理 |
|---|---|---|
| 200 | 成功 | — |
| 400 | 参数不合法（附 `error` 说明） | 红字提示 |
| 401 | 未登录 / 会话过期 / 账号被停用 | 跳登录页 |
| 402 | 余额或额度不足 | 提示"去找管理员充值" |
| 403 | 已登录但没权限（管理类接口） | 提示无权限 |
| 404 | 资源不存在 **或不属于你**（越权统一 404，不泄露存在性） | 提示不存在 |
| 409 | 冲突（用户名占用、Agent 已挂起等） | 提示原因 |
| 410 | 接口已废弃（`/api/member/switch`） | — |
| 500 | 服务端异常（附 `error`） | 提示重试 |
| 502 | 上游异常（附 `error`） | 提示稍后重试 |

错误响应统一形状：

```json
{ "error": "余额不足，请联系管理员充值" }
```

### 0.2 鉴权白名单

不需要登录的接口只有：`GET /api/ping`、`POST /api/auth/login`、`POST /api/auth/register`、`GET /api/auth/state`。
其余全部先过 `auth()`，失败 401。

---

## 1. 认证

### POST `/api/auth/login`

```json
// 请求
{ "username": "qiufeng", "password": "********" }
// 200
{ "ok": true, "user": { "id": "u-xxx", "username": "qiufeng", "name": "秋峰",
  "role": "owner", "roleLabel": "所有者", "admin": true, "status": "active",
  "memberId": "mb-xxx", "quota": 0, "used": 0 } }
// 401（账号不存在与密码错误返回同一句，防枚举）
{ "error": "用户名或密码不对" }
// 429
{ "error": "尝试次数过多，请 5 分钟后再试" }
```

失败计数按「用户名 + 来源 IP」累计，**5 次锁 5 分钟**。

### POST `/api/auth/logout`

清 Cookie。返回 `{ "ok": true }`。

### GET `/api/auth/state`

给前端探登录态用，**永远 200**，不会在控制台留红色 401。

```json
{ "loggedIn": true, "user": { ... } }
```

### GET `/api/auth/me`

```json
{ "user": { "id": "u-xxx", "username": "…", "role": "admin", "quota": 5000, "used": 123.4, … } }
```

### POST `/api/auth/password`

```json
// 请求
{ "old": "旧密码", "next": "新密码" }
// 200 → { "ok": true, "relogin": true }   （改密后旧会话失效，需要重新登录）
```

### POST `/api/auth/register`

```json
// 请求（需管理员先开邀请码）
{ "invite": "ABCD1234", "username": "xiaochen", "name": "小陈", "password": "abc12345" }
// 200 → { "ok": true, "user": {...} }
// 403 → { "error": "注册未开放" } 或 { "error": "邀请码无效" }
```

---

## 2. 账号管理（管理员）

### GET `/api/users`

```json
{ "list": [ { "id": "u-1", "username": "qiufeng", "name": "秋峰", "role": "owner",
  "roleLabel": "所有者", "status": "active", "memberId": "mb-1",
  "quota": 0, "used": 50381.89, "lastLoginAt": 1793239256600 } ] }
```

### POST `/api/users`

建号。不传 `memberId` 时会自动建一个同名成员（记账主体）。

```json
// 请求
{ "username": "xiaozhou", "name": "小周", "password": "zhou12345",
  "role": "member", "quota": 5000 }
// 200 → { "user": { ... } }
// 400 → { "error": "密码至少 8 位" }
// 409 → { "error": "登录名已被占用" }
// 403 → { "error": "只有所有者可以授予管理员" }
```

> 用户名规则：3–24 位，只能字母数字与 `. _ -`，统一转小写。
> 密码规则：≥8 位，含字母与数字。

### POST `/api/users/:id/status`

```json
{ "status": "disabled" }   // 或 "active"
```

停用**立即生效**：每次请求都回查状态，不等 Cookie 过期。不能停用所有者。

### POST `/api/users/:id/password`

```json
{ "password": "新的临时密码" }   // → { "ok": true }
```

### PATCH `/api/users/:id`

```json
{ "name": "小陈", "quota": 8000, "role": "admin" }
```

`role` 仅所有者可改；`quota` 实际写在关联的 `member` 上。

### POST `/api/org/invite`

```json
// 请求 { "open": true }  → 开启注册并返回当前邀请码
{ "ok": true, "open": true, "invite": "K7M2P9QX" }
```

---

## 3. 首屏与基础数据

### GET `/api/bootstrap`

一次拿全工作台需要的东西（省 6 次请求）。

```json
{
  "user": { ... },
  "member": { "id": "mb-1", "name": "秋峰", "role": "owner", "quota": 0, "used": 50381.89 },
  "members": [ ... ],
  "org": { "name": "春科 · 星河 StarRiver", "balance": 159618.11, "used": 50381.89,
           "opening": 200000, "recharged": 10000, "todayCredits": 0, "todayCalls": 0,
           "lowBalance": 20000, "unit": "积分" },
  "models": [ { "id": "claude-sonnet-4-6", "label": "…", "provider": "claude" } ],
  "defaultModel": "claude-sonnet-4-6",
  "media": { "image": 20, "videoPerSecond": { "doubao-seedance-2-0-mini-260615": 12 } },
  "boxes": [ { "id": "box-1", "name": "内容工场", "desc": "…",
               "agents": [ { "id": "a-1", "name": "选题策划", "category": "策略",
                             "model": "claude-sonnet-4-6", "suspended": false,
                             "quickQuestions": [ ... ] } ] } ],
  "dims": [ ... ],           // 选题筛选维度（56 个）
  "counts": { "conversations": 39, "assets": 146, "topics": 1144 },
  "usage": { "tokens": 10201091, "calls": 437 }
}
```

> 普通成员拿到的 `boxes/agents` 是全量（Agent 是团队资产），
> 但 `counts` 与 `usage` 只算自己的。

### GET `/api/ping`

```json
{ "ok": true }
```

---

## 4. 对话

### POST `/api/chat` → `text/event-stream`

```json
// 请求
{
  "content": "写一条秋季新品的小红书文案",
  "model": "claude-sonnet-4-6",
  "agentId": "a-1",
  "conversationId": "c-xxx",        // 可选，不传则新建
  "uploads": ["up-1", "up-2"],      // 可选，附件 ID
  "refs": ["as-1"]                  // 可选，参考图（资产或上传图 ID）
}
```

响应是 SSE，每帧 `data: {...}\n\n`：

```text
data: {"meta":{"conversationId":"c-1","model":"claude-sonnet-4-6","agent":{"id":"a-1","name":"选题策划"},"member":"秋峰"}}
data: {"think":"先确认受众…"}
data: {"tool":{"name":"generate_image","status":"start","prompt":"秋天 银杏","label":"正在出图"}}
data: {"tool":{"name":"generate_image","status":"done","asset":{"id":"as-9","type":"image","url":"/img/x.png","title":"…","refCount":1}}}
data: {"delta":"## 秋日的第一杯\n\n"}
data: {"delta":"…"}
data: {"done":true}
```

错误帧：`data: {"error":"上游 429"}`。

**可能的前置失败**（在开流之前返回普通 JSON）：

| 码 | 场景 |
|---|---|
| 402 | 组织余额 ≤ 0，或该成员额度已用满 |
| 409 | 该 Agent 已挂起 |
| 404 | `conversationId` 不属于你 |
| 400 | 内容为空 / 模型不支持 |

### GET `/api/conversations`

```
?limit=50&q=关键词&before=<ts>
```

```json
{ "total": 39, "list": [ { "id": "c-1", "title": "秋季新品文案", "agentId": "a-1",
  "agentName": "选题策划", "msgCount": 6, "createdAt": 1793…, "updatedAt": 1793…,
  "owner": "秋峰", "mine": true } ] }
```

成员只看到自己的；管理员看到全部并带 `owner` 字段。

### GET `/api/conversation/:id`

```json
{ "conversation": { "id": "c-1", "title": "…", "agentId": "a-1",
  "messages": [ { "role": "user", "content": "…", "ts": 1793…, "uploads": [ { "id": "up-1", "name": "brief.pdf", "chars": 3200 } ] },
                { "role": "assistant", "content": "…", "ts": 1793…, "think": "…",
                  "tools": [ { "name": "generate_image", "status": "done", "asset": { ... } } ] } ] } }
```

越权（不是自己的、也不是管理员）→ **404**。

### PATCH `/api/conversation/:id`

```json
{ "title": "新标题" }
```

### DELETE `/api/conversation/:id`

删除会话（连带消息）。返回 `{ "ok": true }`。

### POST `/api/conversation/:id/agent`

```json
{ "agentId": "a-2" }
```

就地换 Agent，**历史保留**（原平台是跳页新开，这里改成保留上下文）。

---

## 5. 输入侧

### POST `/api/upload`

`multipart/form-data`，字段名 `file`。

```json
{ "upload": { "id": "up-1", "name": "brief.pdf", "file": "up-xxx.pdf",
  "mime": "application/pdf", "bytes": 248310, "chars": 3210, "warn": null,
  "createdAt": 1793… } }
```

抽不出正文时不报错，返回 `chars: 0` 且 `warn` 说明原因（保住文件本身）。

### GET `/api/uploads`

```json
{ "list": [ { "id": "up-1", "name": "brief.pdf", "chars": 3210, "bytes": 248310,
  "warn": null, "createdAt": 1793… } ] }
```

只列自己的（附件里可能有客户名单，绝不跨人）。

### GET `/api/reference-images`

```
?page=1&pageSize=36&search=咖啡
```

```json
{ "total": 42, "page": 1, "pageSize": 36,
  "list": [ { "id": "as-1", "title": "…", "url": "/img/x.png", "src": "asset", "createdAt": 1793… },
            { "id": "up-9", "title": "ref.jpg", "url": "/file/up-9.jpg", "src": "upload", "createdAt": 1793… } ] }
```

包含自己的资产图、上传图，以及别人**标了团队可见**的资产图。

---

## 6. 生成

### POST `/api/image`

```json
// 请求
{ "prompt": "秋日银杏，暖色调，留白构图", "title": "秋日配图",
  "refs": ["as-1"], "ratio": "1:1" }
// 200
{ "asset": { "id": "as-9", "type": "image", "title": "秋日配图",
  "imageUrl": "/img/1793xxxx.png", "model": "doubao-seedream-5-0-pro-260628",
  "size": "1024x1024", "refCount": 1 } }
```

`ratio` 支持 `1:1 / 3:4 / 4:3 / 16:9 / 9:16 / 21:9`（超出范围会 400，服务端只给这几档）。

### POST `/api/video`

```json
// 请求
{ "prompt": "咖啡杯特写，缓慢推近", "model": "doubao-seedance-2-0-mini-260615",
  "resolution": "720p", "duration": 5, "ratio": "16:9" }
// 200（异步任务）
{ "asset": { "id": "as-10", "type": "video", "title": "…", "videoStatus": "queued",
  "model": "doubao-seedance-2-0-mini-260615", "modelLabel": "Seedance 2.0 Mini",
  "resolution": "720p", "duration": 5 } }
```

参数会被裁剪到合法档位（例如 Mini 传 1080p/15s → 自动落回 720p/5s），不报错。

### GET `/api/video/:id`

```json
{ "asset": { "id": "as-10", "videoStatus": "succeeded", "videoUrl": "/vid/x.mp4", … } }
```

`videoStatus`：`queued / running / succeeded / failed`。

---

## 7. 选题与批量任务

### GET `/api/topics`

```
?page=1&pageSize=50&dim=<维度>&q=关键词&used=0
```

```json
{ "total": 1144, "page": 1, "pageSize": 50,
  "list": [ { "id": "cmv…", "title": "秋季新品种草", "content": "…",
  "dimension": "小红书", "placeholder": false, "used": false } ] }
```

### POST `/api/tasks`

批量派活。

```json
// 请求
{ "topicIds": ["cmv1", "cmv2"], "agentId": "a-1", "boxId": "box-1" }
// 200
{ "created": 2 }
```

### GET `/api/tasks`

```json
{ "list": [ { "id": "t-1", "title": "秋季新品种草", "status": "done",
  "agentId": "a-1", "conversationId": "c-9", "ownerId": "u-1", "createdAt": 1793… } ] }
```

`status`：`queued / running / done / failed`。串行执行，一次一条。

---

## 8. 资产

### GET `/api/assets`

```
?type=all|doc|image|video&fav=1&deleted=1&search=关键词
```

```json
{ "total": 146, "scope": "self",
  "list": [ { "id": "as-1", "type": "doc", "title": "秋季文案", "content": "（前 4000 字）",
  "fav": false, "deleted": false, "createdAt": 1793…, "agentName": "…",
  "visibility": "team", "ownerId": "u-1", "mine": true } ] }
```

`scope`：管理员是 `org`（全组织），成员是 `self`。
`visibility`：`private`（默认）/ `team`。

### GET `/api/asset/:id`

```json
{ "asset": { "id": "as-1", "type": "image", "title": "…", "content": null,
  "imageUrl": "/img/x.png", "ownerId": "u-2", "visibility": "team" } }
```

读得到共享资产，但读到不等于改得动。

### POST `/api/assets`

```json
{ "type": "doc", "title": "标题", "content": "正文", "imageUrl": null,
  "pending": false, "sourceAssetId": null }
```

### POST `/api/asset/:id/share`

**团队可见开关**。只有产出者本人（或管理员）能拨。

```json
// 请求
{ "team": true }
// 200 → { "ok": true, "visibility": "team" }
// 404 → 不是你的
```

收回（`{"team": false}`）之后，之前发出去的 `/img/xxx.png` 链接**立刻 404**。

### POST `/api/asset/:id/fav` / `/api/asset/:id/restore`

```json
{ "ok": true, "fav": true }
```

仅产出者本人（或管理员）可调用；共享给同事的资产只能看不能收藏。

### DELETE `/api/asset/:id`

软删除（进回收站）。`?hard=1` 彻底删除（连文件一起不再可访问）。

```json
{ "ok": true }
```

越权 → 404。

### POST `/api/docx`

```json
// 请求：任选其一
{ "assetId": "as-1" }
{ "title": "报告标题", "content": "# 正文…" }
// 200
{ "url": "/export/doc-xxx.docx", "bytes": 12345, "name": "报告标题.docx" }
```

导出件按人归属，别人拿到 URL 也 404。

---

## 9. 计费与组织

### GET `/api/ledger`

```
?days=30&page=1&pageSize=50&kind=chat&model=…&memberId=…
```

```json
{ "days": 30, "total": 500, "page": 1, "pageSize": 50,
  "list": [ { "id": "…", "ts": 1793167899927, "day": "2026-10-28", "kind": "chat",
    "model": "claude-sonnet-4-6", "in": 813, "out": 220,
    "rate": 4, "rateIn": 4, "rateOut": 4, "credits": 4.13,
    "memberId": "mb-1", "memberName": "秋峰", "agentName": null,
    "conversationId": "c-1", "note": "写一条秋季文案" } ],
  "summary": { "byDay": [ ... ], "byKind": [ ... ], "byModel": [ ... ], "byMember": [ ... ] } }
```

`kind`：`chat / image / video / subagent`。
成员只看到自己的（`ownerId` 或 `memberId` 命中）。

### GET `/api/ledger.csv`

`text/csv`，列：时间 / 类型 / 模型 / 入 / 出 / 单价（入/出）/ 积分 / 成员 / Agent / 备注。
行数 = 台账条数（验收脚本断言）。

### GET `/api/org`

```json
{ "org": { "name": "春科 · 星河 StarRiver", "balance": 159618.11, "used": 50381.89,
  "opening": 200000, "recharged": 10000, "unit": "积分",
  "pricing": { "base": "…", "media": "…", "note": "…" } } }
```

### PATCH `/api/org`

```json
{ "name": "新组织名" }
```

### POST `/api/org/recharge`

```json
// 请求
{ "credits": 10000, "note": "对公转账 2026-10" }
// 200 → { "balance": 169618.11 }
```

### POST `/api/org/adjust`

```json
{ "credits": -500, "note": "修正误记" }   // 正数加、负数减
```

### GET `/api/billing/audit`

对账。字段含义见 [05-billing.md](05-billing.md)。

```json
{ "opening": 200000, "recharged": 10000, "balance": 159618.11,
  "expectBalance": 159618.11, "balanced": true,
  "usageCalls": 437, "ledgerTokenCalls": 437,
  "shouldCredits": 40660.15, "chargedCredits": 49141.89,
  "tokenChargedCredits": 40660.19, "backfillCredits": 8481.7,
  "ledgerTokenCredits": 40660.19, "tokenGap": -0.04, "tokenGapOk": true,
  "rateDrift": false, "totalCredits": 50381.89, "tokens": 10201091 }
```

### POST `/api/member/switch`

**已废弃**，返回 410。消耗只能记在登录人名下。

### GET/POST `/api/members`，PATCH/DELETE `/api/member/:id`

```json
// POST 请求
{ "name": "小陈", "role": "editor", "quota": 5000 }
// PATCH 请求
{ "name": "小陈", "quota": 8000, "active": true }
```

成员是**记账主体**（台账挂在成员上），账号是"谁能登录"。一个成员可对应一个账号。

---

## 10. 其它

### GET `/api/guide`

新用户 7 步使用说明（JSON），侧栏可重开。

### GET `/api/search?q=关键词`

```json
{ "conversations": [ { "id": "c-1", "title": "…", "snippet": "…" } ],
  "assets": [ { "id": "as-1", "title": "…", "type": "doc" } ] }
```

只搜自己可见的范围。

### GET/POST/PATCH/DELETE `/api/boxes`、`/api/box/:id`

Box 是团队空间，Agent 挂在 Box 下。删 Box 时 Agent 自动回落到其他 Box（不会孤儿）。

### GET/POST/PATCH/DELETE `/api/agents`、`/api/agent/:id`

```json
// PATCH 请求（可只传要改的）
{ "name": "选题策划", "model": "claude-sonnet-4-6", "suspended": false,
  "temperature": 0.8, "instruction": "…", "knowledgeBases": [ { "name": "品牌手册", "text": "…" } ] }
```

> `suspended: true` 后：@ 弹窗灰显、发送前后端双拦（409）、Automate 过滤。

---

## 11. 用 curl 走一遍完整流程

```bash
BASE=http://127.0.0.1:7777
J=/tmp/sr-cookie.txt

# 登录
curl -s -c $J -X POST $BASE/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"你的密码"}'

# 看首屏
curl -s -b $J $BASE/api/bootstrap | head -c 300

# 发一条消息（SSE，-N 关闭缓冲）
curl -sN -b $J -X POST $BASE/api/chat \
  -H 'content-type: application/json' \
  -d '{"content":"只回两个字：收到","model":"claude-haiku-4-5-20251001"}'

# 看台账
curl -s -b $J "$BASE/api/ledger?limit=3"

# 对账
curl -s -b $J $BASE/api/billing/audit
```
