# 09 · 测试

> 原则：**验收脚本就是需求的可执行版本。** 没有断言的改动等于没做完。

## 1. 总览

10 套脚本，**373 项断言**，当前 0 失败。

```bash
# 一把梭（约 10 分钟）
for s in ui-smoke selftest verify-billing verify-sidebar verify-brand \
         verify-ui-full verify-suspend verify-stream-md verify-kb-upload verify-tenancy \
         verify-compliance verify-compliance-ui; do
  echo "=== $s"; node scripts/$s.mjs 2>&1 | tail -3
done
```

| 脚本 | 断言 | 类型 | 耗时 | 打哪个服务 |
|---|---|---|---|---|
| `selftest.mjs` | 23 | 接口全链路（含真实出图） | ~2 min | 7777 |
| `verify-tenancy.mjs` | 89 | 越权（自起临时空库） | ~20 s | 自建 |
| `verify-sidebar.mjs` | 61 | 布局（浏览器） | ~30 s | 7777 |
| `verify-compliance.mjs` | 46 | 违禁词引擎（纯函数 + HTTP） | ~2 s | 可选 |
| `verify-brand.mjs` | 32 | 品牌与介绍页（浏览器） | ~15 s | 7777 |
| `verify-billing.mjs` | 23 | 计费引擎 | ~10 s | 7777 + 库 |
| `verify-ui-full.mjs` | 22 | 全页面巡检（浏览器） | ~40 s | 7777 |
| `ui-smoke.mjs` | 21 | 真浏览器冒烟 | ~3 min | 7777 |
| `verify-compliance-ui.mjs` | 21 | 体检条渲染与交互（浏览器） | ~15 s | 7777 |
| `verify-suspend.mjs` | 19 | 挂起拦截（接口 + 浏览器） | ~30 s | 7777 |
| `verify-stream-md.mjs` | 9 | 流式 Markdown | ~30 s | 7777 |
| `verify-kb-upload.mjs` | 7 | 知识库上传 | ~20 s | 7777 |

浏览器类需要 Playwright：`npm i -D playwright && npx playwright install chrome`。

## 2. 跑之前的铁律

1. **改了服务端代码先重启服务**，否则测的是旧进程（本项目踩得最狠的坑）。
2. **`verify-tenancy.mjs` 不要指到正式库**：它自起临时空库 + 随机端口，跑完即毁；
   显式传 baseUrl 才会打外部服务（打 7777/7788 会告警）。
3. 浏览器脚本会**新建并删除会话**，正常；但如果中途挂掉，可能留下测试会话，界面删掉即可。
4. `selftest.mjs` 会产生真实上游消耗（几十积分），介意就指到体验库：

```bash
SB_DATA=/tmp/sb-test PORT=7790 node server.js > /tmp/t.log 2>&1 &
BASE=http://127.0.0.1:7790 node scripts/selftest.mjs
```

5. **指到别的库时，两个环境变量必须一起给**：`SB_DATA`（脚本据此判断文件落在哪个目录）
   和 `BASE`。只给 `BASE` 会让「文件没落盘」这类断言去错的目录里找东西，假红。
6. **PDF 抽取要 pypdf**：系统自带的 `python3` 往往没装，`selftest` 的 PDF 用例会红。
   装好之后用 `CB_PYTHON` 指过去（不要改代码）：

```bash
CB_PYTHON=/path/to/venv/bin/python node server.js
```

## 3. 各脚本在验什么

### 3.1 `selftest.mjs`（23）

接口层全链路，每条都不是"看 200"：

- 附件正文真的进上下文（让模型复述随机标记，回复必须包含）；
- `read_file` 真的按需读（11,454 字只喂开头，标记在第 7,219 字，模型自己取到）；
- 子 Agent 真被派活（工具序列 `call_subagent → __summary`）；
- 思维链不污染正文（`think` 通道 > 10 字，正文无思考原文）；
- 工具协议不泄漏（可见文本不能出现 `<tool>`）；
- 图片真的落盘（> 20KB，`refCount ≥ 1`）；
- 视频参数裁剪（Mini 传 1080p/15s → 720p/5s）；
- docx 真能解析（`textutil -convert txt` 读得出标题）；
- 台账对得上（`余额 = 期初 + 充值 − 合计`，`token 应扣 == 已扣`）；
- 未登录 401。

### 3.2 `verify-tenancy.mjs`（89）

模拟真实攻击动作：

| 组 | 验什么 |
|---|---|
| 0–2 | 账号准备、未登录 401、各建一条会话 |
| 3–6 | 用别人 ID 读/删/改会话 → 404 |
| 7–9 | 附件、导出件、媒体跨人 → 404 |
| 10–12 | 冒名记账、切身份（410）、停用即时失效 |
| 13–14 | 密码连错 5 次锁定、管理员越权（不能动 owner、不能建 admin） |
| 15–17 | 管理员视角标归属、余额闸门、成员额度闸门 |
| **18** | **资产共享**：未共享取不到文件、共享后只读、收回立即 404、同事不能删/不能改共享状态/不能收藏 |

### 3.3 `verify-brand.mjs`（32）

- 介绍页（站点根 `/`）：标题、主标题、`登录工作台` 指向 `/index.html`、无旧名；
- 登录页：品牌名、Slogan、品牌标 30×30 两笔、颜色与 `--acc` 一致、favicon 内联 SVG；
- 侧栏：logo 不被裁、顶栏三件不打架；
- 菜单脚注：品牌行 + 形态说明；
- 来源标记：归档 15 条仍在、文案统一；
- 旧名残留：全站零命中。

### 3.4 其余

- `verify-sidebar`：三段式结构、唯一滚动区、浮层不被裁、560px 高仍可用、无横向溢出；
- `verify-ui-full`：每个 hash 路由都能开、空态有话说、表格/抽屉/导出/错误提示；
- `verify-billing`：单一价 / 分价 / 截断对账 / 补记单列 / 真实库对账；
- `verify-suspend`：挂起字段、发送 409、UI 灰显与一键解除、改名不改状态；
- `verify-stream-md`：流式过程中 Markdown 逐段成型、刷新回放仍是结构；
- `verify-kb-upload`：文件 → 正文 → 字数 → 删除闭环。

### 3.5 `verify-compliance.mjs`（46）

违禁词引擎的断言，**一半在验「不该报的不能报」**——这类检查器最大的风险是误报，
一旦把「第一步」「科普」标红，用户就学会无视它，词表等于白做。

- 该报的：抗炎 / 激素 / 医嘱（不只是「医生」）/ 痛经 / 三甲 + 临床；
- 位置准：`samples[].start/end` 切回原文必须正好等于命中词；
- 绕过手法：空格隔开、零宽字符、间隔点、全角数字都要能识别；
- 不该报的：空文本、干净文案、科普/科学/科技、第一步/最后（绝对化误伤）、
  重叠区间只报最长的一条（「妇科疾病」不再额外报「妇科」）；
- 统计口径：同词多次合并、`count` 准确、样例最多 3 个、block 排在 warn 前面；
- 开关：`absolute:false` / `hint:false` 各自生效；
- 性能：2 万字 < 500ms（实测 4ms）；
- HTTP（`--http <base>`）：未登录 401、空文本 400、返回 summary、词表条数一致。

`verify-compliance-ui.mjs`（21）验界面：pass 只占一行、block 默认收起、点开有明细、
高亮的是真违禁词、给的是替换建议、盒子有实际尺寸（防「渲染了但高度 0」）、
点「让它按建议改写」会填进输入框但**不自动发送**、页面无 JS 报错。

## 4. 写新断言

### 4.1 接口断言（`selftest.mjs` 风格）

```js
const r = await api('/api/assets?type=doc');
ok(r.status === 200, '资产列表 200');
ok(Array.isArray(r.body.list), '返回 list 数组');
ok(r.body.list.every(a => a.ownerId === me.id), '列表里没有别人的资产');
```

### 4.2 越权断言（`verify-tenancy.mjs` 风格）

```js
// 别人读不到
const peek = await call(B.username, '/api/asset/' + assetId);
ok(peek.body.asset === null, '乙按 ID 读不到甲的资产');

// 别人改不动
const del = await call(B.username, '/api/asset/' + assetId, { method: 'DELETE' });
ok(del.status === 404, '乙不能删甲的资产');
```

### 4.3 浏览器断言

```js
const j = await p.evaluate(() => ({
  title: document.title,
  cards: document.querySelectorAll('.asset-card').length
}));
ok(j.cards > 0, '资产卡片渲染出来了（' + j.cards + ' 张）');
```

### 4.4 三条规矩

1. **断言要能失败**：写完故意改坏一处，确认它真的红 —— 否则可能是"永远为真"的空断言。
2. **断言带信息**：`ok(c, '金额对得上（实际 ' + n + '）')`，红了能直接看出差多少。
3. **一条断言只验一件事**：`a && b && c` 挂了不知道是哪一件。

## 5. 断言数量对不上时

```bash
node scripts/verify-brand.mjs | grep -c "✓"    # 通过数
node scripts/verify-brand.mjs | grep "✗"       # 失败项
```

数字变了通常是两种情况：

- **加/删了断言** → 同步更新 README 第十三节与 `CHANGELOG.md`；
- **某条断言被条件跳过** → 查脚本里的 `if`，别让断言"悄悄不跑"。

## 6. CI 建议

仓库当前没有 CI（本地跑）。要接 GitHub Actions：

```yaml
name: ci
on: [push, pull_request]
jobs:
  api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: cp config.example.json config.json
      - run: node -e "const f='config.json',c=require('./'+f);c.auth.password='ci12345678';require('fs').writeFileSync(f,JSON.stringify(c,null,2))"
      - run: node server.js & sleep 2
      - run: node scripts/verify-tenancy.mjs
```

注意事项：

- 不要在有真实 Key 的仓库里跑需要上游的断言（`selftest` 会真花钱）；
- 越权那套（`verify-tenancy`）不需要上游，适合进 CI；
- 浏览器那套要装 Chrome，用 `npx playwright install --with-deps chrome`。
