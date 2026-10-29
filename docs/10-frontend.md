# 10 · 前端

> 一句话：**一个 HTML + 一个 app.js + 一个 style.css**，无框架、无构建、无 npm。
> 改完刷新就生效 —— 这是有意的，不是"还没上脚手架"。

## 1. 文件职责

| 文件 | 行数 | 职责 |
|---|---|---|
| `public/home.html` | ~430 | 对外介绍页（站点根 `/`）。自包含，无外部依赖 |
| `public/index.html` | ~40 | 工作台外壳，只放 `<div id="app">` 与脚本引用 |
| `public/app.js` | ~2000 | 全部视图、路由、API 调用、状态 |
| `public/md.js` | ~150 | 零依赖 Markdown 渲染（先转义再解析，流式安全） |
| `public/style.css` | ~700 | 设计令牌 + 组件样式 + 五套主题 |

## 2. 状态与启动

```js
// app.js 顶部：唯一的全局状态
const S = {
  boot: null,                       // /api/bootstrap 的响应
  route: '',
  composer: { files: [], refs: [] },// 输入区：附件与参考图
  chat: { agentId, convId, model, sending, msgs },
  tasksTimer: null
};
window.__S = S;                     // 调试/自测可读（只读约定）
```

启动顺序：

```text
① api('/api/auth/state')   探登录态（不会 401，避免控制台红字）
② 已登录 → api('/api/bootstrap') → renderShell() → route()
   未登录 → renderLogin()
③ hashchange → route()     只换 #view 里的内容，侧栏与顶栏不动
```

**为什么先探 state 再拉 bootstrap**：直接打 bootstrap 会 401，
浏览器控制台留一条红色错误，外行一看就以为坏了。

## 3. 路由

hash 路由，没有 history API（部署在子路径下也不会 404）。

| hash | 视图函数 | 谁能进 |
|---|---|---|
| `#/chat`（默认） | `viewChat(v, convId?)` | 全部 |
| `#/agents` | `viewAgents(v)` | 全部 |
| `#/agent/:id` | `viewAgentChat(v, agentId)` | 全部 |
| `#/automate` | `viewAutomate(v)` | 全部 |
| `#/assets` / `#/assets/:tab` | `viewAssets(v, tab)` | 全部 |
| `#/records` | `viewRecords(v)` | 全部 |
| `#/ledger` | `viewLedger(v, arg)` | 全部（数据按人过滤） |
| `#/org` | `viewOrg(v)` | **仅管理员** |
| `#/accounts` | `viewAccounts(v)` | **仅管理员** |

路由守卫在 `route()` 里：非管理员手敲 `#/org` 会被弹回 `#/chat` 并提示
（否则会看到一个 403 空壳页）。

## 4. 视图的写法

每个视图是一个函数，接收容器元素，整个 `innerHTML` 重绘：

```js
function viewAssets(v, tab) {
  v.innerHTML = `
    <div class="page-head"><h2>数字资产库</h2><p class="sub">…</p></div>
    <div class="tabs">${tabs.map(t => `<button data-tab="${t[0]}">${t[1]}</button>`).join('')}</div>
    <div id="assetBox"></div>`;
  // 事件在挂载后绑，不用事件委托（视图小，够用）
  v.querySelectorAll('.tabs button').forEach(b => b.onclick = () => loadAssets(b.dataset.tab));
  loadAssets(tab || 'all');
}
```

约定：

- **`esc()` 转义一切外部字符串**（标题、正文、文件名）。`md.js` 内部也先转义再解析。
- 视图只做渲染，不做权限判断（权限在服务端；前端隐藏入口只是体验）。
- 列表数据用 `await api(...)` 拉，空态必须写文案（`<div class="empty">`）。

## 5. 样式系统

### 5.1 设计令牌

```css
:root {
  --bg:#0B1020;      /* 页面底 */
  --panel:#121A30;   /* 卡片/面板 */
  --line:rgba(255,255,255,.09);
  --txt:rgba(240,244,255,.88);
  --sub:rgba(196,207,230,.6);
  --acc:#7FA8FF;     /* 主色：品牌标、按钮、强调 */
  --acc2:#9A8CFF;    /* 次色：渐变 */
  --acc-soft:rgba(127,168,255,.13);
  --danger:#FF8375;
  --r:12px;          /* 圆角基准 */
}
```

**规则：组件里不写颜色值，只用 `var(--x)`。** 这样换主题只改令牌。

### 5.2 五套主题

```css
:root[data-theme="bamboo"] { /* 青竹绿：原浅色版复原 */ }
:root[data-theme="rose"]   { /* 玫瑰粉 */ }
:root[data-theme="peri"]   { /* 薄雾紫 */ }
:root[data-theme="peach"]  { /* 蜜桃粉 */ }
/* 不设 data-theme → 默认星空蓝（暗） */
```

切换在 ⋯ 管理菜单「主题外观」里，`localStorage['st-theme']` 持久化。
`index.html` 头部有内联脚本先读 localStorage 设好 `data-theme`，
避免刷新时先闪一下默认色。

### 5.3 布局要点

| 断点 | 行为 |
|---|---|
| > 1180px | 侧栏 252px 固定；顶栏显示「累计 tokens」「今日」 |
| 980–1180px | 收起「累计 tokens」 |
| 820–980px | 收起「今日」 |
| ≤ 820px | 侧栏变抽屉（`#tbBurger` 打开、`#sbMask` 遮罩、导航后自动收） |

侧栏是三段式：品牌行 → 新建对话 + 工作区导航 → 最近对话列表（**唯一滚动区**）。
积分与「⋯」固定在主区顶栏最右（窗口右上角），不在侧栏。

## 6. 输入区（composer）

```js
S.composer = {
  files: [],   // [{id, name, chars}]  附件
  refs: []     // [{id, url, src}]     参考图，≤9
};
```

- 拖拽/粘贴截图 → 自动上传 → 进 `files`；
- 「参考图」按钮 → 打开图库（资产图 + 上传图）→ 进 `refs`；
- 上传中禁止发送（防止附件没传完就漏料）；
- 发送成功后清空 `files` 与 `refs`，但保留在消息里（气泡上显示附件名）。

## 7. 流式渲染

```js
// 伪代码，实际在 viewChat 的发送逻辑里
const res = await fetch('/api/chat', {method:'POST', headers, body});
const reader = res.body.getReader();          // 逐块读
let buf = '', visible = '', think = '';
while (true) {
  const {done, value} = await reader.read();
  if (done) break;
  buf += dec.decode(value, {stream:true});
  // 按 \n\n 切帧，每条 "data: {...}"
  for (const frame of takeFrames(buf)) {
    const o = JSON.parse(frame);
    if (o.meta)  { S.chat.convId = o.meta.conversationId; refreshSidebar(); }
    if (o.think) { think += o.think; scheduleThinkRender(); }
    if (o.tool)  { upsertToolCard(o.tool); }
    if (o.delta) { visible += o.delta; scheduleRender(); }   // 60ms 节流
    if (o.error) { toast(o.error, true); }
  }
}
```

**为什么要节流**：每来一个字就 `innerHTML` 重排，长文会卡；
60ms 合并一次，视觉上仍是"一段一段冒出来"。

**Markdown 渲染**：`md.js` 把累积的 `visible` 整体渲染一次（不是增量拼接），
所以流式过程中表格/列表会"逐步成型"，不会出现半截标签。

## 8. 资产抽屉

`openAsset(id, tab)` 拉单条资产，弹右侧抽屉：

- 图/视频：直接预览；
- 文档：正文（markdown 渲染）+ 导出 docx + 生成配图/视频；
- 底部按钮按身份显示：
  - 自己的：收藏、共享给团队、下载、删除；
  - **同事共享的**：只显示下载/复制，标注「同事共享的成品，可下载/参考，不能改」。

## 9. 加一个页面的步骤

```text
① app.js 写 viewXxx(v) 函数
② route() 里加分支（记得判断权限）
③ renderShell() 的菜单里加入口（data-nav="#/xxx"）
④ style.css 加样式（只用 var 令牌）
⑤ scripts/verify-ui-full.mjs 加断言：能打开、空态有话说、无 JS 报错
⑥ scripts/verify-sidebar.mjs 跑一遍，确认窄屏不溢出
```

## 10. 前端禁忌

| 不要 | 因为 |
|---|---|
| 引入 Vue/React/jQuery | 零构建是刻意选择；引入即需要 npm + 打包 |
| 在组件里写 `#7FA8FF` | 换主题会漏改；用 `var(--acc)` |
| 用 `innerHTML` 拼未转义的字符串 | XSS；一律 `esc()` |
| 在前端做权限判断 | 权限在服务端；前端只隐藏入口，不做安全边界 |
| 直接 `fetch` 裸调 | 统一用 `api()`（它处理 401 跳登录、错误抛出） |
| 改 `index.html` 的内联主题脚本 | 那是防刷新闪烁的关键 |
