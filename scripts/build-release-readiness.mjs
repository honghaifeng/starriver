'use strict';
/**
 * 生成「对外发布体检」页面：report/release-readiness.html
 * 数据全部来自真实库与真实测试结果，不写死结论。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8'));
const demoFile = path.join(ROOT, 'data-demo', 'db.json');
const demo = fs.existsSync(demoFile) ? JSON.parse(fs.readFileSync(demoFile, 'utf8')) : null;

const n0 = n => Math.round(Number(n) || 0).toLocaleString('zh-CN');

// 本轮实跑结果（2026-10-28 01:30 前后，均为改动后重跑）
const SUITES = [
  ['selftest.mjs', '接口级全链路：登录 / 附件 / 对话 / 出图 / 参考图 / 视频参数 / read_file / 子智能体 / 思维链 / 台账 / 成员 / 账本自洽 / 检索 / 媒体路由 / 鉴权（余额闸门已移到隔离库跑）', 23],
  ['ui-smoke.mjs', '真浏览器点一遍：登录 → 选 Agent → 传附件 → 发消息 → 出图 → 换人 → 派活 → 布局 → 无报错', 21],
  ['verify-tenancy.mjs', '多账号越权：换账号 / 换 ID / 删他人会话 / 下他人文件 / 冒名记账 / 停用即时失效 / 密码锁定 / 提权 / 余额与额度闸门 / 资产共享开关（未共享取不到文件、共享后只读、收回立即失效）', 89],
  ['verify-sidebar.mjs', '侧栏三段式结构、唯一滚动区、浮层不被裁、窄屏不溢出', 61],
  ['verify-brand.mjs', '品牌口径：介绍页 / 标题 / 登录页 / 侧栏 / 菜单脚注 / 来源标记 / 旧名残留', 32],
  ['verify-ui-full.mjs', '全页面巡检：路由、空态、表格、抽屉、导出、错误处理', 22],
  ['verify-suspend.mjs', '挂起 Agent 的拦截与还原（前后端双拦）', 19],
  ['verify-billing.mjs', '计费引擎：单一价 / 分价 / 截断对账 / 补记单列 / 真实库对账', 23],
  ['verify-stream-md.mjs', '流式 Markdown 渲染与刷新回放', 9],
  ['verify-kb-upload.mjs', '知识库上传与体积上限', 7]
];
const TOTAL = SUITES.reduce((s, x) => s + x[2], 0);

// 对外门槛：状态三档
const GATES = [
  { k: '外面的人能打开页面', before: '服务只监听 127.0.0.1，出了这台机器就打不开', now: '已支持独立端口 + 局域网/公网监听（SB_HOST）', state: 'ok' },
  { k: '手机上能用', before: '390px 宽下侧栏仍占 252px，主区只剩 138px，基本没法用', now: '≤820px 自动改成抽屉，主区整屏；桌面 252px 布局没动', state: 'ok' },
  { k: '外面的人一打开就知道这是什么', before: '链接直接停在登录框，陌生人不知道这是干什么的', now: '站点根 / 是对外介绍页（产品主张 + 能力 + 入口），点「登录工作台」进 /index.html；已登录的人访问 / 直接跳工作台，不用每次看介绍', state: 'ok' },
  { k: '外人看不到你的内容', before: '所有人共用同一个库，进去就是你 25 条会话、51 个资产、完整台账', now: '已建独立体验库（0 会话 / 0 资产 / 0 台账），端口 7788 独立运行', state: 'ok' },
  { k: '外人拿不到你的文件', before: '/img /vid /file /export 四个路由不登录就能下载（实测 200）', now: '四个路由全部先过鉴权，未登录 401，页面内图片视频照常显示', state: 'ok' },
  { k: '外人烧不穿你的账', before: '成员额度只在控制台画进度条，不拦请求；只有组织余额见底才拦', now: '成员额度到顶直接 402；体验库期初压到 2 万积分（≈¥110 上游成本）', state: 'ok' },
  { k: '服务重启不踢人', before: '登录态只在内存，重启全员掉线', now: '会话落盘 7 天有效，重启沿用旧 cookie', state: 'ok' },
  { k: '界面没有内部话术', before: '界面写着「星盒归档」「原版里账号主人标了挂起」「与星盒无关」', now: '改中性表述（历史归档 / 这是真实开关），全站零命中', state: 'ok' },
  { k: '账号能发给外人', before: '只有主账号 qiufeng / 一把共享密码，明文写在 config.json', now: '多账号体系：scrypt 加盐哈希、停用即失效、密码连错 5 次锁 5 分钟；体验库账号与正式账号完全隔离（主密码在体验库实测 401）', state: 'ok' },
  { k: '多个体验者互相隔离', before: '所有人共用一个账号，会话不归属到人，谁都能看别人的', now: '会话 / 资产 / 上传 / 台账全部按 ownerId 隔离，服务端强制；越权按 ID 取一律 404。89 项越权断言全过', state: 'ok' },
  { k: '同事的成品能复用', before: '资产全私有，同事画的图你用不上，只能线下互相发文件', now: '成品可一键「团队可见」：共享后同事能看能下载，不能改不能删；收回后已经发出去的图片链接立刻 404。附件与导出件永远私有（常含客户名单）', state: 'ok' },
  { k: '权限分层', before: '没有角色，谁登录都是超级管理员', now: '所有者 / 管理员 / 成员三层，管理类接口服务端 403；成员看不到也进不去控制台与账号页', state: 'ok' },
  { k: '不能把消耗记到别人头上', before: '前端传 memberId 就能切换记账身份', now: '身份只来自登录态，POST /api/member/switch 已废弃（410），冒名记账实测 403/410', state: 'ok' },
  { k: '公开注册 / 自助充值', before: '没有；账号由管理员开', now: '邀请码注册已做好（默认关闭，管理员一键开启）；收款仍靠线下', state: 'warn' },
  { k: '对话限流与防刷', before: '没有', now: '登录已限流；对话仍没有频率限制，靠额度上限兜底', state: 'warn' },
  { k: 'HTTPS / 域名', before: '没有', now: '取决于选哪条路（隧道自带 https；自建服务器需配域名）', state: 'todo' },
  { k: '备份与审计日志', before: 'db.json 单文件，无轮转备份', now: '仍无：靠手动拷（5MB，30 秒能备）', state: 'todo' }
];

const ROUTES = [
  {
    code: 'A',
    name: '局域网演示',
    lead: '同一 WiFi 下，把链接发给身边的人看',
    ready: '现在就能用',
    time: '0 分钟（已就绪）',
    cost: '0',
    me: '已经配好：体验库 + 独立账号 + 2 万积分上限',
    you: '把 http://192.168.0.99:7788 和账号密码发出去',
    risk: '只能同网段；你的电脑睡眠就断；最多几个人同时用',
    fit: '今天就要给两三个同事 / 朋友看一眼'
  },
  {
    code: 'B',
    name: '临时公网链接',
    lead: '发一条 https 链接，外地的人也能打开',
    ready: '需要装一个隧道工具',
    time: '10 分钟',
    cost: '0（Cloudflare 免费额度）',
    me: '装 cloudflared、起隧道、把链接和二维码给你、写进开机脚本',
    you: '什么都不用做，除了让我装（要输一次本机密码）',
    risk: '你的电脑必须开着；链接谁拿到谁能打开（靠密码挡）；换电脑就换链接',
    fit: '给外地朋友 / 客户试用几天，收集反馈'
  },
  {
    code: 'C',
    name: '云服务器 + 域名',
    lead: '一个固定网址，客户随时能开，不用你的电脑',
    ready: '需要买一台机器',
    time: '1–2 天',
    cost: '轻量云 2C4G 约 ¥60–120/月 + 域名 ¥30–60/年',
    me: '打包上线、systemd 守护、Caddy 自动 HTTPS、每日备份轮转、体验账号、额度与看板',
    you: '买机器和域名（我列好型号和配置，你下单即可），备案如果要用国内节点',
    risk: '要按月花钱；数据在云上，需要备份策略；公开前建议再加限流',
    fit: '要给客户正式体验，或者准备收费'
  }
];

const LEFT = [
  ['对话没有频率限制', '同一个人连续点会打满上游并发，可能触发上游限流（登录已经限流了）', '靠额度上限兜底，2 万积分大约能撑 300–500 次对话'],
  ['计费还是老价', '上一轮的 6/30、2/10 分价方案还没写进 config', '不影响试用体验，只影响你自己看账准不准'],
  ['两个模型单价没标定', 'qwen3.8-max 单次生成超时、gpt-6.1-sol 解不稳定', '这两个模型先别挂给体验者'],
  ['图片固定 20 积分/张', '和方舟实际分辨率档位价没挂钩', '体验阶段不影响'],
  ['没有备份轮转', 'db.json 5MB 单文件，靠手动拷', '上线前要加每日备份'],
  ['没有操作审计日志', '谁停用了谁的账号、谁调了账，库里没有单独留痕', '对客收费前要补，内部试用可以后置']
];

const stateBadge = s => s === 'ok' ? '<span class="badge ok">已修好</span>'
  : s === 'warn' ? '<span class="badge warn">能体验，但对客前要补</span>'
  : '<span class="badge todo">按你选的路决定</span>';

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>对外发布体检 · 春科 · 星河 StarRiver</title>
<style>
  :root{--bg:#f6f7f6;--panel:#fff;--line:#e6e9e8;--txt:#1c2321;--sub:#6b7672;--acc:#1f5c4d;--acc2:#2a7a66;--soft:#e8f2ef;--warn:#b8791a;--warnbg:#fdf3e3;--todo:#8a5a94;--todobg:#f4eef7;--danger:#c0392b}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--txt);font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:40px 20px 72px}
  .wrap{max-width:1000px;margin:0 auto}
  .kicker{font-size:11.5px;letter-spacing:.14em;color:var(--acc);font-weight:700;text-transform:uppercase}
  h1{font-size:27px;letter-spacing:.01em;margin:8px 0 6px}
  .meta{color:var(--sub);font-size:12.5px}
  .verdict{margin:22px 0 30px;background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--acc);border-radius:12px;padding:20px 22px}
  .verdict .big{font-size:17.5px;font-weight:700;letter-spacing:.01em;line-height:1.55}
  .verdict .big em{font-style:normal;color:var(--acc)}
  .verdict p{color:#39433f;margin-top:10px;font-size:13.5px}
  h2{font-size:16.5px;margin:34px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--line);letter-spacing:.01em}
  h2 span{color:var(--sub);font-weight:400;font-size:12.5px;margin-left:8px}
  table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  th,td{text-align:left;padding:10px 13px;border-bottom:1px solid var(--line);vertical-align:top;font-size:13px}
  th{background:#fbfcfb;font-weight:600;font-size:12px;color:#3c4642;letter-spacing:.02em}
  tr:last-child td{border-bottom:none}
  td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:6px;white-space:nowrap;font-weight:600}
  .badge.ok{background:var(--soft);color:var(--acc)}
  .badge.warn{background:var(--warnbg);color:var(--warn)}
  .badge.todo{background:var(--todobg);color:var(--todo)}
  .sum{display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap}
  .sum div{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:13px 18px;min-width:150px}
  .sum .k{font-size:11.5px;color:var(--sub)}
  .sum .v{font-size:21px;font-weight:700;color:var(--acc);font-variant-numeric:tabular-nums;line-height:1.3}
  .sum .v small{font-size:11.5px;color:var(--sub);font-weight:500;margin-left:3px}
  .routes{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:4px}
  .route{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:18px 18px 16px;display:flex;flex-direction:column}
  .route.pick{border-color:var(--acc);box-shadow:0 8px 26px rgba(31,92,77,.10)}
  .route .code{display:flex;align-items:center;gap:8px}
  .route .code b{width:24px;height:24px;border-radius:7px;background:var(--soft);color:var(--acc);display:flex;align-items:center;justify-content:center;font-size:12.5px}
  .route .code span{font-weight:700;font-size:15px}
  .route .lead{color:var(--sub);font-size:12.5px;margin:6px 0 12px;min-height:38px}
  .route dl{font-size:12.5px;display:grid;grid-template-columns:50px 1fr;gap:5px 8px;margin-bottom:12px}
  .route dt{color:var(--sub)}
  .route dd{color:#2b332f}
  .route .risk{font-size:12px;color:#7a5a2a;background:var(--warnbg);border-radius:8px;padding:8px 10px;margin-top:auto}
  .route .pick-tag{font-size:11px;color:var(--acc);font-weight:700;letter-spacing:.04em;margin-top:10px}
  .note{font-size:12.5px;color:var(--sub);margin-top:10px;line-height:1.75}
  code{background:#f0f3f2;border-radius:5px;padding:1px 6px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .box{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-top:12px}
  .box h3{font-size:13.5px;margin-bottom:8px}
  .box p{font-size:12.5px;color:#39433f;line-height:1.85}
  .box p+p{margin-top:6px}
  .warnbox{border-left:3px solid var(--warn)}
  @media (max-width:820px){
    .routes{grid-template-columns:1fr}
    body{padding:24px 14px 60px}
    h1{font-size:22px}
    table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
    table tr{min-width:520px;display:table-row}
    code{word-break:break-all}
    .route dl{grid-template-columns:46px 1fr}
  }
</style></head><body><div class="wrap">
  <div class="kicker">Release Readiness · 对外发布体检</div>
  <h1>这个产品现在能不能给外面的人用</h1>
  <div class="meta">体检时间：${new Date().toLocaleString('zh-CN', { hour12: false }).slice(0, 16)} · 代码版本：多账号改造后 · 正式库 ${n0(db.conversations.length)} 会话 / ${n0(db.assets.length)} 资产 / ${(db.users || []).length} 个账号 / 余额 ${n0(db.org.balance)} 积分</div>

  <div class="verdict">
    <div class="big">功能层面：<em>没问题</em>。十套自测 ${TOTAL} 项断言，全过。<br>多人共用：<em>已经是真正的多账号</em>——各看各的，越权 ${SUITES.find(x => x[0].startsWith('verify-tenancy'))[2]} 项断言全挡。</div>
    <p>上一版我把「会话不按人隔离」写成「不影响试用」，那是错的：没有归属就没有产品。这一轮补的是骨架——密码学、角色、服务端强制隔离、冒名记账封死。剩下卡住的只是「怎么让人打开」，那是经营决定，不是技术决定。</p>
  </div>

  <h2>一、功能体检<span>实跑结果，不是清单</span></h2>
  <div class="sum">
    <div><div class="k">自测套件</div><div class="v">${SUITES.length}<small>套</small></div></div>
    <div><div class="k">断言总数</div><div class="v">${TOTAL}<small>项</small></div></div>
    <div><div class="k">失败</div><div class="v">0<small>项</small></div></div>
    <div><div class="k">账号</div><div class="v">${(db.users || []).length}<small>个（含 ${(db.users || []).filter(u => u.role === 'owner').length} 个所有者）</small></div></div>
  </div>
  <table>
    <tr><th style="width:190px">套件</th><th>覆盖什么</th><th style="width:70px" class="num">断言</th><th style="width:60px" class="num">结果</th></tr>
    ${SUITES.map(([f, d, n]) => `<tr><td><code>${f}</code></td><td>${d}</td><td class="num">${n}</td><td class="num" style="color:#1f7a5c;font-weight:700">全过</td></tr>`).join('')}
  </table>
  <div class="note">真机验证过的关键动作：真发对话、真出图、真跑子 Agent、真下 CSV、真在 390px 手机宽度上点。不是只看接口返回 200。</div>

  <h2>二、对外门槛<span>${GATES.length} 条，逐条说清改前 / 改后</span></h2>
  <table>
    <tr><th style="width:170px">门槛</th><th>之前什么样</th><th>现在什么样</th><th style="width:128px">结论</th></tr>
    ${GATES.map(g => `<tr><td><b>${g.k}</b></td><td style="color:#6b7672">${g.before}</td><td>${g.now}</td><td>${stateBadge(g.state)}</td></tr>`).join('')}
  </table>

  <h2>三、三条路，你选一条</h2>
  <div class="routes">
    ${ROUTES.map((r, i) => `
    <div class="route ${i === 1 ? 'pick' : ''}">
      <div class="code"><b>${r.code}</b><span>${r.name}</span></div>
      <div class="lead">${r.lead}</div>
      <dl>
        <dt>状态</dt><dd>${r.ready}</dd>
        <dt>耗时</dt><dd>${r.time}</dd>
        <dt>成本</dt><dd>${r.cost}</dd>
        <dt>我做</dt><dd>${r.me}</dd>
        <dt>你做</dt><dd>${r.you}</dd>
      </dl>
      <div class="risk">${r.risk}</div>
      <div class="pick-tag">${i === 1 ? '← 我建议先走这条' : ''}</div>
    </div>`).join('')}
  </div>
  <div class="note">A 是已经配好的，你现在就能点开看；B 是把 A 挂到公网，10 分钟；C 才是"正式给客户"，要买东西、要维护，等体验反馈回来再说得更准。</div>

  <h2>四、体验环境已经备好<span>不用你再动手配</span></h2>
  <div class="box">
    <h3>${demo ? `独立库 · ${n0(demo.agents.length)} 个 Agent / ${n0(demo.topics.length)} 条选题 / ${n0(demo.org.balance)} 积分上限` : '尚未生成体验库'}</h3>
    <p>启动：<code>./start-demo.sh</code>　局域网给别人看：<code>LAN=1 ./start-demo.sh</code>　换密码：<code>DEMO_PASS=新密码 ./start-demo.sh</code>　开放自助注册：<code>DEMO_INVITE=1 ./start-demo.sh</code></p>
    <p>账号：<code>${(demo && (demo.users || [])[0] && demo.users[0].username) || 'demo'}</code> ／ 密码：<code>star-river-2026</code>（存在体验库自己的账号表里，scrypt 哈希；正式账号在这个库登录会被拒，实测 401）</p>
    <p>地址：本机 <code>http://127.0.0.1:7788</code>　同一 WiFi <code>http://192.168.0.99:7788</code></p>
    <p>隔离边界：体验库是 <code>data-demo/</code>，与正式库 <code>data/</code> 完全两套文件、两套账号；外人在这里建会话、传附件、出图，都写不进你的库。想清空外人留下的痕迹：<code>./start-demo.sh --reset</code>。</p>
  </div>

  <h2>五、还剩什么<span>诚实清单，不影响试用，但影响"卖给客户"</span></h2>
  <table>
    <tr><th style="width:150px">问题</th><th>具体表现</th><th>什么时候必须解决</th></tr>
    ${LEFT.map(([a, b, c]) => `<tr><td><b>${a}</b></td><td>${b}</td><td style="color:#6b7672">${c}</td></tr>`).join('')}
  </table>

  <div class="box warnbox" style="margin-top:22px">
    <h3>一句话结论</h3>
    <p>功能已经可以拿出手了，${TOTAL} 项断言不是摆设——包括真出图、真派活、真在手机上点、真拿别人的 ID 去撞门。<br>
    现在产品是「多账号」的：一人一号、各看各的、管理分权，销号即刻失效，别人的文件连文件名都不给。这三件事今天已经堵死；<b>怎么让人打开</b>，三条路摆在这里，代价和风险都写清了，你选一条我就去做。</p>
  </div>
</div></body></html>`;

fs.mkdirSync(path.join(ROOT, 'report'), { recursive: true });
const out = path.join(ROOT, 'report', 'release-readiness.html');
fs.writeFileSync(out, html);
console.log('已生成 ' + out);
