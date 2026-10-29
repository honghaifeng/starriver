# 01 · 架构

> 目标读者：第一次接手这个仓库的开发者。读完应该能回答三个问题：
> 代码为什么这么分、一次请求会经过哪些地方、我要改的东西该放哪。

## 1. 全貌

```text
                        ┌──────────────────────────────┐
  浏览器 ──HTTP/SSE──▶  │  server.js（单进程，零依赖）  │
                        │                              │
                        │  ① 静态托管 public/          │
                        │  ② 路由 + Cookie 鉴权 + 限流  │
                        │  ③ SSE 流式转发               │
                        │  ④ 媒体服务（带归属校验）      │
                        │  ⑤ 上游调用（对话/图/视频）    │
                        └───────┬──────────────┬───────┘
                                │              │
                    ┌───────────▼──┐   ┌───────▼────────┐
                    │  store.js    │   │  lib/identity   │
                    │  唯一写库处   │   │  唯一权限判定    │
                    └───────┬──────┘   └────────────────┘
                            │
                    ┌───────▼──────────────┐
                    │ data/db.json + 媒体目录 │
                    └──────────────────────┘
```

**没有框架、没有 ORM、没有构建工具。** 这不是"偷懒"，而是三条明确取舍：

1. 部署成本 = 拷代码 + 一个 node 进程。给客户演示时不用装 Docker、不用配数据库。
2. 十年后还能跑。零依赖的代码不会因为某个包里弃维护而废掉。
3. 调试路径短。出问题直接看 `server.js` 第 N 行，不用穿透三层框架。

## 2. 分层与边界

| 层 | 文件 | 只做这些 | 绝对不做 |
|---|---|---|---|
| 传输 | `server.js` | 解析请求、鉴权、SSE 帧、媒体流、调上游 | 不直接 `fs.writeFileSync` 业务数据 |
| 领域 | `store.js` | 数据结构、迁移、记账、对账、唯一落盘 | 不碰 `req` / `res` |
| 权限 | `lib/identity.js` | 哈希、校验、角色、`canRead/canWrite` | 不碰业务字段 |
| 抽取 | `lib/text-extract.js` | 附件 → 文本 | 不落库 |
| 视图 | `public/app.js` | 视图函数、hash 路由、DOM 渲染 | 不做权限判断（只隐藏入口） |
| 渲染 | `public/md.js` | Markdown → HTML（先转义再解析） | 不碰业务 |
| 样式 | `public/style.css` | 设计令牌 + 组件样式 | 组件内硬编码颜色 |

### 2.1 为什么权限只写一处

早期代码里散落着 `if (role === 'admin')`，加第三种角色时漏改了两处，
导致普通成员能进企业控制台。现在所有判断走：

```js
identity.canRead(me, ownerId)    // 能看吗
identity.canWrite(me, ownerId)   // 能改/删吗
identity.canManageUsers(me)      // 能管账号吗
```

新增角色只需要改 `lib/identity.js` 里的 `ROLES` 与三个函数。

### 2.2 为什么写库只写一处

`store.js` 提供 `store.save()`，内部是「先写临时文件再 rename」，避免写一半断电把库写坏。

```js
save() {
  const tmp = this.file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(this.data));
  fs.renameSync(tmp, this.file);   // 原子替换
}
```

任何业务代码想落盘都必须调它，否则迁移/对账时会漏掉那份数据。

## 3. 一次请求的路径

### 3.1 普通 API（以 `GET /api/assets` 为例）

```text
1. http.createServer 回调
2. 路径不以 /img /vid /file /export 开头 → 走 route()
3. route() 里：
   a. 读 cookie → whoami() → 用户或 null
   b. 白名单（/api/ping、/api/auth/*）放行；其余 me = auth()，失败 401
   c. 停用账号每次请求回查（不靠 cookie 过期）
   d. 匹配路由 → 业务函数
4. 业务函数里第一件事是归属过滤：
   store.data.assets.filter(a => canSeeAsset(me, a))
5. json(res, 200, {...})
```

### 3.2 静态资源

```text
/            → 已登录 302 /index.html；未登录 → home.html（介绍页）
/index.html  → 工作台 SPA
/app.js 等   → public/ 下的静态文件（带 MIME 表）
其余路径      → SPA fallback 到 index.html（支持 #/xxx 直接打开）
```

### 3.3 媒体（`/img/xxx.png`）

```text
1. 命中路径前缀 → 先 auth()，未登录 401
2. mediaOwner(path) 反查归属：
     /file/  → uploads 里按 file 名找
     /export/→ exports 里按 file 名找（无记录 = 只有管理员能拿）
     /img/   → assets 里按 imageUrl 找
     /vid/   → assets 里按 videoUrl 找
3. 归属校验：自己的 / 管理员 / 资产标了 visibility=team → 放行；否则 404
4. serveMedia() 支持 Range（视频拖动进度条必需）
```

> 用户上传的附件与导出的 docx **永远私有**，即使资产共享也覆盖不到它们 ——
> 这两类文件里常见客户名单与未公开文案。

## 4. SSE 通道

`POST /api/chat` 不是普通 JSON 接口，它返回 `text/event-stream`。
服务端只有一个 `send(o)` 函数往 `res.write` 里塞 `data: {...}\n\n`：

| 帧 | 含义 | 前端处理 |
|---|---|---|
| `{meta:{conversationId,model,agent,member}}` | 首帧，确定会话 ID | 立刻入侧栏（避免"发出去了但列表没这条"） |
| `{think:"…"}` | 思维链增量 | 进独立折叠块，不进正文 |
| `{tool:{name,status,...}}` | 工具过程 | 渲染过程卡（running → done/err） |
| `{delta:"…"}` | 正文增量 | 追加到气泡，60ms 节流后重新渲染 Markdown |
| `{error:"…"}` | 出错 | 红字提示，保留已生成的部分 |
| `{done:true}` | 结束 | 关闭流，刷新台账 |

**为什么思维链要单独走通道**：上游把 `reasoning_content` 混在正文里时，
用户会看到一大段"让我想想…"，而且这段会进下一轮上下文浪费 token。
分开后既不显示也不回灌（只保留最近一轮的思考摘要）。

## 5. 工具协议（ToolTap）

上游模型通过特殊标记请求工具，`ToolTap` 在流式文本里识别这些标记并拦截：

| 工具 | 参数 | 效果 |
|---|---|---|
| `generate_image` | `prompt`, `refs[]`, `ratio` | 调方舟 Seedream → 落 assets → 回填一张图 |
| `generate_video` | `prompt`, `model`, `resolution`, `duration` | 调 Seedance（异步）→ 轮询 → 落 assets |
| `read_file` | `file`, `query` / `offset` | 从上传附件里按关键词或位置取原文 |
| `call_subagent` | `agent`, `task` | 让子 Agent 用自己的提示词独立跑一轮 |

约束：

- 单次对话工具调用次数上限 = `config.subAgentLimit`；
- 嵌套深度 = `config.subAgentDepth`（目前 1，防递归烧钱）；
- 工具协议文本不会泄漏到用户可见正文里（验收脚本专门断言这一点）。

## 6. 数据流：从输入到落库

```text
用户输入
  ├─ 文本   → buildMessages() 拼上下文
  ├─ 附件   → uploads[] → text-extract → 内联或用 read_file
  └─ 参考图 → 压缩到 768px JPEG → data URI → 方舟
        │
        ▼
  上游 stream ──▶ 边流边显示 ──▶ 结束后整体写回 conv.messages
        │
        ├─ usage → store.recordUsage() → ledger（记 money）
        └─ 产物  → store.newAsset()     → assets（记东西）
```

**为什么消息在流结束后才写回**：中途断流时，如果已写入半截消息，
刷新页面会看到残缺内容且无法重试。现在断流只丢显示层，不留脏数据。

## 7. 并发与一致性

单进程 + 单 JSON 文件的真实约束：

| 场景 | 行为 | 风险 |
|---|---|---|
| 两个人同时发消息 | 事件循环串行处理，各自内存里改对象 | 若两次 `save()` 交叠，后写覆盖前写 |
| 批量任务跑 100 条 | 串行队列，一条一条来 | 慢，但不会打爆上游 |
| 进程被 kill | 未 `save()` 的改动丢失 | 每次业务结束都 `save()`，窗口极小 |

**当前缓解**：所有写操作都在同一个同步函数里完成，`save()` 紧跟其后，
Node 单线程保证不会出现两个 `save()` 真正并发。

**扩容路径**：换 SQLite（`better-sqlite3` 同步 API 与现有代码形状最接近），
或把 `store.save()` 改成带版本号的乐观锁。见 `docs/01` 的路线图部分。

## 8. 关键取舍一览

| 决策 | 选了什么 | 代价 | 什么时候该改 |
|---|---|---|---|
| 存储 | JSON 单文件 | 并发写弱 | 团队 >10 人 或 会话 >5 万条 |
| 前端 | 原生 JS 单文件 | 无组件复用 | 视图 >30 个 或 需要多人并行改前端 |
| 鉴权 | 自建 Cookie | 无 SSO | 要接企业微信/飞书 |
| 计费 | 应用层记账 | 依赖上游回 usage | 上游改计费口径时要重标定 |
| 部署 | 单进程 | 无水平扩展 | 单机 CPU 打满 |
