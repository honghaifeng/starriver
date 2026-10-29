# 变更记录

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

数字口径：断言数 = 该次发布时全部验收脚本的通过项之和。

---

## [1.1.0] — 2026-10-29

主题：**稿子能不能发，不用等客户打回来才知道。**

### 新增

- **合规体检**：239 条客户违禁词 + 35 条广告法绝对化用语，稿子写完当场逐词扫一遍。
  - 消息气泡下渲染体检条：`pass` 只占一行，命中才展开成明细（词 / 踩了哪条线 / 建议改成什么 / 原文片段高亮）。
  - 命中位置是**原文下标**，能直接指回正文，不是模糊的「在文中出现」。
  - 「让它按建议改写」把改写要求填进输入框，不自动发送——违禁词替换成建议词经常改出病句，得人看一眼。
  - `POST /api/compliance/check`、`GET /api/compliance/dict` 两个出口，外部稿子也能先查一遍。
- **词表可复现**：`scripts/build-compliance-dict.py` 从客户 PDF 生成 `lib/compliance-dict.json`。
  客户补词时重跑 + `git diff` 就能看出新增了哪些，不再靠手抄。
  PDF 文字流断在词中间（「HPV 感 / 染」）、相邻两行串在一起（「高血压/三高乳糖不耐乳糖不耐受」）
  的 10 处 OCR 串行已按规则修正，带斜杠/括号的条目拆成独立可搜词。
- **七个提示字兜底**：科/诊/疗/病/痛/毒/菌 做 warn 级提示（清单词表覆盖不到的新词也能拦住），
  且「科普/科学/科技」明确放行——客户确认文档事项 1 说这七个字是类别特征，不是带这个字就禁。
- **自测**：`verify-compliance.mjs`（46，一半断言在验「不该报的不能报」）、
  `verify-compliance-ui.mjs`（21，真浏览器渲染与交互）。

### 修复

- 暗色主题下 `--danger-bg` / `--danger-line` / `--green-bg` / `--amber-line` 等变量是
  **自引用**（`--danger-bg:var(--danger-bg)`），解析无效，所有告警底色实际透明。补齐真实值。
- `lib/text-extract.js` 的 Python 候选缺项目内 venv 路径，服务器上「系统 python3 没装 pypdf」
  就静默降级成「附件抽不出正文」。补 `.venv/bin/python`、`venv/bin/python` 两个惯例位置，
  报错信息也改成能照做的命令（`CB_PYTHON` 指定解释器）。
- `selftest.mjs` 硬编码 `data/uploads|images|exports`，指向体验库（`SB_DATA=data-demo`）时
  「文件没落盘」等 5 项假红。改为跟随 `SB_DATA`。
- 8 个验收脚本硬编码 `127.0.0.1:7777`，无法对体验库验收（会往正式库塞测试内容）。支持 `BASE`。

### 测试

373 项断言 0 失败：selftest 23 · verify-tenancy 89 · verify-sidebar 61 · verify-compliance 46 ·
verify-brand 32 · verify-billing 23 · verify-ui-full 22 · ui-smoke 21 · verify-compliance-ui 21 ·
verify-suspend 19 · verify-stream-md 9 · verify-kb-upload 7。

---

## [1.0.0] — 2026-10-29

首个可对外交付的版本：能发账号给外部用户体验，能被多人同时使用而互不干扰。

### 新增

- **多账号体系**：`users` 表 + scrypt 加盐哈希 + 三角色（所有者 / 管理员 / 成员）。
  `config.auth` 仅用于首次迁移，之后不再读取明文。
- **数据隔离**：会话 / 资产 / 上传 / 导出件 / 台账全部按 `ownerId` 归属，服务端强制；
  越权按 ID 取一律 404。成员只看自己的台账，管理员看全组织。
- **资产「团队可见」**：成品可一键共享给团队，共享后同事能看能下载、不能改不能删；
  收回后已发出的 `/img` 链接立刻 404。附件与导出件永不共享。
- **对外介绍页**：站点根 `/` 是产品介绍页，工作台在 `/index.html`；已登录访问 `/` 直接 302。
- **体验环境**：`start-demo.sh` 一键起独立库（`data-demo/`）、独立端口、独立账号、2 万积分上限。
- **账号接口**：`/api/auth/{login,logout,me,password,register,state}`、`/api/users` 全套管理。
- **登录限流**：同用户名 + IP 连错 5 次锁 5 分钟。
- **计费分价**：`billing.modelRate2 = {in, out}` 支持输入/输出分开计价（不配则仍走单一价）。
- **对账能力**：`/api/billing/audit` 输出应扣 / 已扣 / 补记 / 差额。
- **文档**：`README.md` + `docs/` 九篇分册，含接口全表、数据模型、部署与排障。

### 修复

- `/img` `/vid` `/file` `/export` 四个路由未登录即可下载 → 先鉴权，跨人 404。
- 成员额度只在控制台画进度条、不拦请求 → 加 402 闸门，且闸门前移到建会话之前。
- 登录态只在内存、重启全员掉线 → 落盘 `sessions.json`，7 天有效。
- 共享资产可见后 `DELETE /api/asset/:id` 仍用读权限判定（同事能删别人的图）→ 改为写权限。
- 400 行三处 `temperature` 与 `top_p` 同时发送导致 Claude 网关 400 → 两者都配时只发 `temperature`。
- 390px 宽下侧栏仍占 252px、主区只剩 138px → ≤820px 改为抽屉。
- 界面残留内部话术（原平台名、内部开关描述）→ 全部改中性表述。

### 破坏性变更

- `POST /api/member/switch` 废弃，返回 **410**。消耗只能记在登录人名下。
- `config.auth` 不再是"唯一登录凭据"，首次启动会迁移成 `users` 表里的 owner。
- 站点根 `/` 由工作台改为介绍页；工作台迁到 `/index.html`（旧链接请更新）。

### 验收

10 套脚本 **306 项断言，0 失败**：selftest 23、tenancy 89、sidebar 61、brand 32、
billing 23、ui-full 22、ui-smoke 21、suspend 19、stream-md 9、kb-upload 7。

---

## [0.9.0] — 2026-10-27

### 新增

- 从原平台导入 38 个 Agent（提示词 50.8 万字）+ 1144 条选题 + 15 段历史会话归档。
- 流式对话 + Markdown 实时渲染（`public/md.js`，零依赖、先转义再解析）。
- 子智能体编排（`call_subagent`）、思维链独立通道、`read_file` 按需读长附件。
- 生图（方舟 Seedream）与生视频（Seedance 四型号），对话内可调用。
- 知识库上传（pdf / docx / txt / md / csv）→ 抽正文 → 注入系统提示词。
- 使用台账：按天 / 类型 / 模型 / 成员 / Box 五维汇总 + CSV 导出 + 账本自洽对账。
- docx 导出（自写 ZIP + WordprocessingML，不依赖第三方库）。

### 验收

82 项断言，全绿。
