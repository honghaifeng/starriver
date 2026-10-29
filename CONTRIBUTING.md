# 参与开发

这个仓库的规则只有一条最重要：**改动必须有断言，绿灯才算完成**。
产品已经在给外部用户体验，任何"我觉得没问题"的改动都不接受。

## 1. 环境

```bash
git clone <repo> && cd starbox-clone
cp config.example.json config.json     # 填上游 Key 与初始密码
node -v                                # 需要 18+，推荐 22
./start.sh                             # http://127.0.0.1:7777
```

零运行时依赖，不需要 `npm install`。只有跑浏览器验收时才需要 Playwright：

```bash
npm i -D playwright && npx playwright install chrome
```

## 2. 目录职责（改代码前先认门）

| 路径 | 职责 | 不要放什么 |
|---|---|---|
| `server.js` | 唯一 HTTP 入口：路由、鉴权、SSE、上游调用 | 不要写业务数据计算 |
| `store.js` | 唯一写库处：JSON 读写、迁移、对账 | 不要写 HTTP 相关逻辑 |
| `lib/identity.js` | 唯一权限判定处 | 不要在业务里写 `role === 'admin'` |
| `lib/text-extract.js` | 附件文本抽取 | — |
| `public/app.js` | 单文件 SPA（约 2000 行，按视图函数分段） | 不要引入框架 |
| `public/md.js` | 零依赖 Markdown 渲染 | — |
| `public/style.css` | 设计令牌 + 组件样式 | 不要硬编码颜色，用 `var(--acc)` 等 |
| `scripts/verify-*.mjs` | 验收脚本 = 需求的可执行版本 | 不要写"看起来对"的断言 |

## 3. 硬性约定

1. **零运行时依赖**。想加包先说服维护者，并给出"不加包怎么实现"的对比。
2. **判断权限只走 `identity.*`**。新增数据表必须带 `ownerId`，并在读、写、删三处都校验。
3. **越权一律 404**，不要用 403 —— 403 等于告诉对方"这条存在，只是不给你"。
4. **写库只发生在 `store.js`**，且必须 `store.save()`；幂等键用业务主键，不要用时间戳。
5. **前端不硬编码颜色**，主题令牌在 `:root` 里，五套主题靠 `[data-theme=…]` 切换。
6. **不提交 `config.json`、`data/`、`report/`**。提交前 `git status` 自查一遍。
7. **中文注释写"为什么"**，不写"这行在干什么"。踩过的坑写进注释，避免第二次踩。

## 4. 加一个接口的完整流程

```text
① server.js 里加路由（注意：先 auth，再 requireAdmin，最后业务）
② 若是新数据表：store.js 建集合 + 迁移 + 归属字段
③ public/app.js 里加调用与空态
④ scripts/selftest.mjs 加接口断言（含未登录 401、越权 404）
⑤ 若涉及归属：scripts/verify-tenancy.mjs 加两条——"别人读不到""别人改不了"
⑥ node scripts/selftest.mjs && node scripts/verify-tenancy.mjs
```

## 5. 提交信息

```
<类型>: <一句话说清改了什么>

类型：feat / fix / test / docs / refactor / chore
正文：说清"原来错在哪、为什么这么改"，附验收命令
```

示例：

```
fix: 共享出去的资产同事能删 —— DELETE 用了读权限判定

原来 DELETE /api/asset/:id 走 assetFor()（读权限），
开了「团队可见」之后同事能删别人的图。
改为 canWrite 判定，并补两条越权断言。

验收：node scripts/verify-tenancy.mjs（89/89）
```

## 6. 提交前自检清单

- [ ] `node --check server.js`、`node --check public/app.js` 通过
- [ ] `node scripts/selftest.mjs` 全绿
- [ ] 涉及归属/权限 → `node scripts/verify-tenancy.mjs` 全绿
- [ ] 涉及界面 → `node scripts/verify-ui-full.mjs` + `verify-sidebar.mjs` 全绿
- [ ] `git status` 里没有 `config.json`、`data/`、任何 Key
- [ ] 文档同步更新（改接口改 `docs/03-api.md`，改行为改 README）

## 7. 分支与发布

- `main` 始终可运行、可部署；不合并红灯分支。
- 功能分支 `feat/<短名>`，修复分支 `fix/<短名>`。
- 发布即打 tag `v<主>.<次>.<修>`，并在 `CHANGELOG.md` 记一条（含验收数字）。
