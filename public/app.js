'use strict';
/* 春科 · 星河 StarRiver · 前端 SPA（零依赖） */

/* ---------- 主题外观（星空蓝/青竹绿/玫瑰粉/薄雾紫/蜜桃粉） ---------- */
const THEMES = ['starblue', 'bamboo', 'rose', 'peri', 'peach'];
function setTheme(t) {
  if (!THEMES.includes(t)) return;
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('st-theme', t); } catch (e) { }
  refreshThemeDots();
}
function refreshThemeDots() {
  const cur = document.documentElement.dataset.theme || 'starblue';
  document.querySelectorAll('[data-theme-set]').forEach(el => el.classList.toggle('active', el.dataset.themeSet === cur));
}
(function bootTheme() {
  try {
    const t = localStorage.getItem('st-theme');
    if (t && THEMES.includes(t)) document.documentElement.dataset.theme = t;
  } catch (e) { }
})();

const S = { boot: null, route: '', composer: { files: [], refs: [] }, chat: { agentId: null, convId: null, model: null, sending: false, msgs: [] }, tasksTimer: null };
// 调试/自测可观测钩子（只读引用，不影响业务）
window.__S = S;

/* ---------- 基础工具 ---------- */
const $ = sel => document.querySelector(sel);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(msg, isErr) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), isErr ? 5200 : 2400);
}
async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
  if (r.status === 401) { S.boot = null; renderLogin(); throw new Error('unauthorized'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
const fmtTime = ts => {
  const d = new Date(ts); const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const num = n => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n || 0));
const fmtK = n => n >= 10000 ? (n / 10000).toFixed(2) + ' 万' : String(n || 0);
const fmtFull = n => Math.round(Number(n) || 0).toLocaleString('zh-CN');

/* 品牌标：一颗星落进一条河 —— 上半是四角星（公域曝光），下半是水波（内容汇聚奔流） */
const MARK = (cls = '') => `<svg class="lm${cls ? ' lm-' + cls : ''}" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10.1 1.6l1.66 3.97 3.97 1.66-3.97 1.66-1.66 3.97-1.66-3.97L4.47 7.23l3.97-1.66z" fill="currentColor"/>
      <path d="M2.3 15.05c2-1.5 3.6-1.5 5.6 0s3.6 1.5 5.6 0c1.2-.9 2.2-1.32 3.3-1.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    </svg>`;

/* ---------- 登录 / 注册 ---------- */
function renderLogin(mode) {
  const isReg = mode === 'register';
  document.getElementById('app').innerHTML = `
  <div class="login-wrap"><div class="login-card">
    <div class="lg-brand">
      ${MARK('lg')}
      <h1>春科 · 星河</h1>
    </div>
    <div class="sub"><b>StarRiver</b> · 全域营销内容 AI 工场</div>
    ${isReg ? `
    <div class="field"><label>邀请码</label><input id="rc" placeholder="向管理员要" autocomplete="off"></div>
    <div class="field"><label>你的名字</label><input id="rn" placeholder="显示在对话与账单里" autocomplete="name"></div>
    <div class="field"><label>登录名</label><input id="ru" placeholder="字母数字，3–24 位" autocomplete="username"></div>
    <div class="field"><label>密码</label><input id="rp" type="password" placeholder="至少 8 位，含字母和数字" autocomplete="new-password"></div>
    <button class="btn primary wfull" id="regBtn">注 册</button>
    <div class="lg-alt"><a id="toLogin">已有账号，去登录</a></div>
    ` : `
    <div class="field"><label>用户名</label><input id="u" placeholder="请输入用户名" autocomplete="username"></div>
    <div class="field"><label>密码</label><input id="p" type="password" placeholder="请输入密码" autocomplete="current-password"></div>
    <button class="btn primary wfull" id="loginBtn">登 录</button>
    <div class="lg-alt"><a id="toReg">有邀请码？注册一个账号</a></div>
    <div class="lg-hint">账号由管理员开通 · 每个人的会话与账单互相独立</div>
    `}
  </div></div>`;

  const afterAuth = async () => {
    await boot(); location.hash = '#/chat';
    if (!localStorage.getItem('sbGuideSeen')) { localStorage.setItem('sbGuideSeen', '1'); setTimeout(showGuide, 500); }
  };

  if (isReg) {
    const go = async () => {
      const btn = $('#regBtn'); btn.disabled = true; btn.textContent = '注册中…';
      try {
        await api('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ invite: $('#rc').value.trim(), name: $('#rn').value.trim(), username: $('#ru').value.trim(), password: $('#rp').value })
        });
        await afterAuth();
      } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = '注 册'; }
    };
    $('#regBtn').onclick = go;
    $('#rp').onkeydown = e => { if (e.key === 'Enter') go(); };
    $('#toLogin').onclick = () => renderLogin();
    ($('#rc').value ? $('#rn') : $('#rc')).focus();
    return;
  }

  const go = async () => {
    const btn = $('#loginBtn'); btn.disabled = true; btn.textContent = '登录中…';
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: $('#u').value.trim(), password: $('#p').value }) });
      await afterAuth();
    } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = '登 录'; }
  };
  $('#loginBtn').onclick = go;
  $('#u').onkeydown = e => { if (e.key === 'Enter') $('#p').focus(); };
  $('#p').onkeydown = e => { if (e.key === 'Enter') go(); };
  $('#toReg').onclick = () => renderLogin('register');
  ($('#u').value ? $('#p') : $('#u')).focus();
}

/* ---------- 启动 ---------- */
async function boot() {
  S.boot = await api('/api/bootstrap');
  renderShell();
  route();
}
function renderShell() {
  const b = S.boot;
  const meU = (b && b.user) || { name: '未登录', role: 'member', roleLabel: '成员', admin: false };
  const isAdmin = !!meU.admin;
  /* 余额进度条：已用 / (期初+充值)，最低给 2% 否则看起来像没预算 */
  const budget = (b.org.opening || 0) + (b.org.recharged || 0);
  const pct = budget > 0 ? Math.min(100, Math.max(2, Math.round((b.org.used || 0) / budget * 100))) : 0;
  const lowBal = b.org.balance <= (b.org.lowBalance || 0);
  document.getElementById('app').innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      <!-- ① 品牌行：侧栏顶只放品牌；积分与管理搬到窗口最右上角 -->
      <div class="sb-top">
        <div class="logo" title="春科 · 星河 StarRiver｜全域营销内容 AI 工场">
          ${MARK()}<span class="logo-cn">春科 · 星河</span><span class="logo-en">StarRiver</span>
        </div>
      </div>
      <!-- ② 固定区：新建对话 + 工作区 -->
      <div class="sb-fixed">
        <button class="new-chat" data-nav="#/chat"><span class="nc-ico">＋</span>新建对话</button>
        <nav class="sb-nav">
          <div class="sb-sec">
            <div class="sb-sec-head"><span>工作区</span></div>
            <div class="nav-item" data-nav="#/agents"><span class="ico">◫</span>Box 团队空间<span class="cnt">${b.boxes.length}</span></div>
            <div class="nav-item" data-nav="#/agents"><span class="ico">◉</span>Agent 专职AI员工<span class="cnt">${b.counts.agents}</span></div>
            <div class="nav-item" data-nav="#/automate"><span class="ico">⚙</span>Automate 任务自动化<span class="cnt">${b.counts.topics}</span></div>
            <div class="nav-item" data-nav="#/assets"><span class="ico">▤</span>Asset 数字资产<span class="cnt">${b.counts.assets}</span></div>
          </div>
        </nav>
      </div>
      <!-- ③ 动态区：最近对话，占满剩余高度，只有它滚 -->
      <div class="sb-conv">
        <div class="sb-sec-head"><span>最近对话</span><a id="convAll">全部 ${b.counts.conversations}</a></div>
        <div class="conv-list" id="convList"></div>
      </div>
    </aside>
    <div class="main">
      <div class="topbar"><button class="tb-burger" id="tbBurger" aria-label="打开导航" aria-expanded="false">☰</button><div class="title" id="tbTitle">新建对话</div><div class="spacer"></div>
        <!-- 当前账号：点开是改密码 / 退出，不占侧栏空间、不挤压右侧积分位 -->
        <button class="tb-user" id="userToggle" aria-expanded="false" aria-controls="userPop" title="${esc(meU.name)} · ${esc(meU.roleLabel)}">
          <span class="tu-avt">${esc(String(meU.name || '?').slice(0, 1))}</span><span class="tu-name">${esc(meU.name || '')}</span>
        </button>
        <div class="sb-pop user-pop" id="userPop" role="menu" aria-label="账号">
          <div class="up-head">
            <div class="up-avt">${esc(String(meU.name || '?').slice(0, 1))}</div>
            <div>
              <div class="up-name">${esc(meU.name || '')}</div>
              <div class="up-sub">${esc(meU.username || '')} · ${esc(meU.roleLabel || '成员')}</div>
            </div>
          </div>
          <div class="up-body">
            <div class="up-row"><span>额度</span><b>${meU.quota ? fmtFull(meU.used || 0) + ' / ' + fmtFull(meU.quota) : '不限（随组织余额）'}</b></div>
            <div class="up-row"><span>上次登录</span><b>${meU.lastLoginAt ? new Date(meU.lastLoginAt).toLocaleString('zh-CN', { hour12: false }).slice(5, 16) : '首次'}</b></div>
          </div>
          <div class="nav-item" id="upPwd" role="menuitem"><span class="ico">⌘</span>修改密码</div>
          ${isAdmin ? '<div class="nav-item" data-nav="#/accounts" role="menuitem"><span class="ico">☰</span>账号与权限</div>' : ''}
          <div class="nav-item" id="upOut" role="menuitem"><span class="ico">⇥</span>退出登录</div>
        </div>
        <span class="badge" id="tbCredits" title="今日已消耗积分（本地台账汇总，刷新不归零）">今日 <b id="tbCost">${fmtFull(b.org.todayCredits || 0)}</b> ${esc(b.org.unit || '积分')}</span>
        <span class="badge" id="tbUsage" title="历史累计 token（本地统计，对话全部走 TokenSpace，生图生视频走火山方舟）">累计 <b>${fmtK(b.usage.totalIn + b.usage.totalOut)}</b> tokens</span>
        <!-- 窗口最右上角：积分（点开明细）/ 管理（⋯）——不再挤在左侧栏里 -->
        <div class="bar-pops">
          <button class="sb-cred ${lowBal ? 'low' : ''}" id="balToggle" title="积分明细" aria-expanded="false" aria-controls="balPop">
            <b id="sbBalance">${fmtFull(b.org.balance)}</b><span class="bs-unit">${esc(b.org.unit || '积分')}</span>
          </button>
          <button class="sb-ico" id="cfgToggle" title="管理" aria-expanded="false" aria-controls="cfgPop">⋯</button>
          <div class="sb-pop bal-pop" id="balPop" role="dialog" aria-label="积分明细">
            <div class="bp-label">剩余额度</div>
            <div class="bp-num"><b id="balBig">${fmtFull(b.org.balance)}</b><span>${esc(b.org.unit || '积分')}</span></div>
            <div class="bal-bar" title="已用 ${pct}%"><i style="width:${pct}%"></i></div>
            <div class="bp-pct">已用 ${pct}% · 预算 ${fmtFull(budget)}</div>
            <div class="bal-grid">
              <div><span>期初</span><b>${fmtFull(b.org.opening || 0)}</b></div>
              <div><span>充值</span><b id="sbRecharged">${fmtFull(b.org.recharged || 0)}</b></div>
              <div><span>已用</span><b id="sbUsed">${fmtFull(b.org.used || 0)}</b></div>
            </div>
            <div class="side-usage">
              <span><b id="sbCalls">${b.usage.calls}</b> 次</span><i>·</i>
              <span><b id="sbTok">${fmtK(b.usage.totalIn + b.usage.totalOut)}</b> tokens</span><i>·</i>
              <span><b>${b.counts.conversations}</b> 对话</span>
            </div>
            <a class="bp-link" data-go="#/ledger">查看使用台账 →</a>
            <div class="side-note">积分按 token 本地折算 · 真实扣费在 TokenSpace / 火山方舟</div>
          </div>
          <div class="sb-pop cfg-pop" id="cfgPop" role="menu" aria-label="管理">
            <div class="cf-head">管理</div>
            <div class="nav-item" data-nav="#/ledger" role="menuitem"><span class="ico">▦</span>使用台账<span class="cnt" id="navCredits">${fmtFull(b.org.used || 0)}</span></div>
            ${isAdmin ? `<div class="nav-item" data-nav="#/org" role="menuitem"><span class="ico">⌂</span>企业控制台<span class="cnt">${b.members.length}</span></div>
            <div class="nav-item" data-nav="#/accounts" role="menuitem"><span class="ico">☰</span>账号与权限<span class="cnt">${b.members.length}</span></div>` : ''}
            <div class="nav-item" data-nav="#/records" role="menuitem"><span class="ico">⌕</span>搜索记录</div>
            <div class="nav-item" id="guideNav" role="menuitem"><span class="ico">?</span>使用说明</div>
            <div class="theme-sec"><div class="theme-head">主题外观</div><div class="theme-dots">
              <button class="t-dot" data-theme-set="starblue" style="background:linear-gradient(135deg,#7FA8FF,#9A8CFF)" title="星空蓝" aria-label="星空蓝"></button>
              <button class="t-dot" data-theme-set="bamboo" style="background:#1f5c4d" title="青竹绿" aria-label="青竹绿"></button>
              <button class="t-dot" data-theme-set="rose" style="background:#B3325B" title="玫瑰粉" aria-label="玫瑰粉"></button>
              <button class="t-dot" data-theme-set="peri" style="background:#6667AB" title="薄雾紫" aria-label="薄雾紫"></button>
              <button class="t-dot" data-theme-set="peach" style="background:#D96C4F" title="蜜桃粉" aria-label="蜜桃粉"></button>
            </div></div>
            <div class="cf-foot"><div class="cf-foot-brand">${esc(b.org.name || '春科 · 星河 StarRiver')}</div><div>内容中台 · 本地版</div></div>
          </div>
        </div>
      </div>
      <div class="content" id="view"></div>
    </div>
    <!-- 手机端抽屉遮罩：点空白收起侧栏 -->
    <div class="sb-mask" id="sbMask"></div>
  </div>`;
  document.querySelectorAll('[data-nav]').forEach(el => el.onclick = () => { closePops(); closeDrawer(); location.hash = el.dataset.nav; });
  document.querySelectorAll('[data-theme-set]').forEach(el => el.onclick = () => setTheme(el.dataset.themeSet));
  refreshThemeDots();
  document.querySelectorAll('[data-go]').forEach(el => el.onclick = () => { closePops(); closeDrawer(); location.hash = el.dataset.go; });
  const convAll = $('#convAll'); if (convAll) convAll.onclick = () => { location.hash = '#/records'; };
  const gn = $('#guideNav'); if (gn) gn.onclick = () => { closePops(); showGuide(); };
  bindSidePops();
  bindDrawer();
  loadConvList();
}

/* ---------- 顶栏两个浮层：积分明细（点余额）/ 管理菜单（点 ⋯） ---------- */
function closePops() {
  document.querySelectorAll('.sb-pop').forEach(p => p.classList.remove('open'));
  ['#balToggle', '#cfgToggle'].forEach(s => { const b = $(s); if (b) b.setAttribute('aria-expanded', 'false'); });
}
/* ---------- 手机端侧栏抽屉：≤820px 才出现，桌面端按钮本身是隐藏的 ---------- */
function closeDrawer() {
  const l = document.querySelector('.layout');
  if (l) l.classList.remove('sb-open');
  const b = $('#tbBurger'); if (b) b.setAttribute('aria-expanded', 'false');
}
function bindDrawer() {
  const btn = $('#tbBurger'), mask = $('#sbMask');
  if (btn) btn.onclick = () => {
    const l = document.querySelector('.layout');
    const open = l.classList.toggle('sb-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  if (mask) mask.onclick = closeDrawer;
}
function bindSidePops() {
  [['#balToggle', '#balPop'], ['#cfgToggle', '#cfgPop'], ['#userToggle', '#userPop']].forEach(([btnSel, popSel]) => {
    const btn = $(btnSel), pop = $(popSel);
    if (!btn || !pop) return;
    btn.onclick = e => {
      e.stopPropagation();
      const wasOpen = pop.classList.contains('open');
      closePops();                       // 三个面板互斥，开一个必关另一个
      if (!wasOpen) { pop.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
    };
  });
  // 账号菜单里的两个动作（DOM 每次 renderShell 重建，所以要重挂）
  const pwd = $('#upPwd');
  if (pwd) pwd.onclick = () => { closePops(); showChangePassword(); };
  const out = $('#upOut');
  if (out) out.onclick = async () => {
    closePops();
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { }
    location.reload();
  };
  // document 上只绑一次；renderShell 会重复执行，绑多次会互相打脸
  if (window.__sidePopsBound) return;
  window.__sidePopsBound = true;
  document.addEventListener('click', e => { if (!e.target.closest('.bar-pops') && !e.target.closest('.tb-user')) closePops(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePops(); });
}

/* ---------- 最近对话（改名 / 删除 / 全部记录入口） ---------- */
const SIDEBAR_N = 12;
async function loadConvList() {
  const box = $('#convList'); if (!box) return;
  let j;
  try { j = await api('/api/conversations'); } catch (e) { return; }
  const cur = S.chat.convId;
  const rows = j.list.slice(0, SIDEBAR_N);
  box.innerHTML = rows.map(c => `
    <div class="conv-item ${c.id === cur ? 'active' : ''}" data-cid="${c.id}">
      <span class="cv-title" title="${esc(c.title)}">${c.imported ? '<em class="cv-src" title="来自历史归档，非本地新建">归档</em>' : ''}${esc(c.title)}</span>
      <span class="cv-tools">
        <button class="cv-btn" data-act="rename" title="改标题">✎</button>
        <button class="cv-btn" data-act="del" title="删除">✕</button>
      </span>
    </div>`).join('') + ((j.total || j.list.length) > rows.length
      ? `<div class="conv-more" id="convMore">查看全部 ${j.total || j.list.length} 条记录 →</div>` : '');
  const more = $('#convMore');
  if (more) more.onclick = () => { location.hash = '#/records'; };
  box.querySelectorAll('.conv-item').forEach(el => {
    const cid = el.dataset.cid;
    el.onclick = e => {
      if (e.target.dataset.act) return;
      location.hash = '#/chat/' + cid;
    };
    el.querySelectorAll('.cv-btn').forEach(b => b.onclick = async ev => {
      ev.stopPropagation();
      const item = j.list.find(x => x.id === cid);
      if (b.dataset.act === 'rename') {
        const t = window.prompt('改个标题', item ? item.title : '');
        if (!t || !t.trim()) return;
        await api('/api/conversation/' + cid, { method: 'PATCH', body: JSON.stringify({ title: t.trim() }) });
        toast('标题已更新');
        if (S.chat.convId === cid) $('#tbTitle').textContent = t.trim();
      } else {
        if (!window.confirm('确定删除此对话？删除后不可恢复（Asset 里的产出不受影响）')) return;
        await api('/api/conversation/' + cid, { method: 'DELETE' });
        toast('对话已删除');
        if (S.chat.convId === cid) location.hash = '#/chat';
      }
      loadConvList();
    });
  });
}

/* ---------- 使用说明 ---------- */
async function showGuide() {
  let g;
  try { g = await api('/api/guide'); } catch (e) { return; }
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal" style="width:560px">
    <div class="m-title">新用户使用说明</div>
    <div style="max-height:60vh;overflow:auto">
      ${g.steps.map((s, i) => `<div class="guide-step"><div class="gs-no">${i + 1}</div>
        <div><div class="gs-t">${esc(s.t)}</div><div class="gs-d">${esc(s.d)}</div></div></div>`).join('')}
    </div>
    <div class="m-foot"><button class="btn primary" id="guideOk">知道了</button></div>
  </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.onclick = e => { if (e.target === mask) close(); };
  mask.querySelector('#guideOk').onclick = close;
}
/* ---------- 账号：改密码 ---------- */
function showChangePassword() {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal" style="width:400px">
    <div class="m-title">修改密码</div>
    <div class="m-sub">改完只保留当前设备的登录，其它设备需要重新登录。</div>
    <div class="field"><label>当前密码</label><input id="cpOld" type="password" autocomplete="current-password"></div>
    <div class="field"><label>新密码</label><input id="cpNew" type="password" autocomplete="new-password" placeholder="至少 8 位，含字母和数字"></div>
    <div class="field"><label>确认新密码</label><input id="cpNew2" type="password" autocomplete="new-password"></div>
    <div class="m-err" id="cpErr" style="display:none"></div>
    <div class="m-foot">
      <button class="btn ghost" id="cpCancel">取消</button>
      <button class="btn primary" id="cpOk">保存</button>
    </div>
  </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.onclick = e => { if (e.target === mask) close(); };
  mask.querySelector('#cpCancel').onclick = close;
  const err = mask.querySelector('#cpErr');
  const showErr = t => { err.textContent = t; err.style.display = 'block'; };
  mask.querySelector('#cpOk').onclick = async () => {
    const oldP = mask.querySelector('#cpOld').value;
    const newP = mask.querySelector('#cpNew').value;
    const newP2 = mask.querySelector('#cpNew2').value;
    if (newP !== newP2) return showErr('两次输入的新密码不一致');
    if (newP.length < 8) return showErr('新密码至少 8 位');
    const btn = mask.querySelector('#cpOk'); btn.disabled = true; btn.textContent = '保存中…';
    try {
      await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ oldPassword: oldP, newPassword: newP }) });
      close(); toast('密码已更新');
    } catch (e) {
      showErr(e.message); btn.disabled = false; btn.textContent = '保存';
    }
  };
  mask.querySelector('#cpOld').focus();
}

function setActiveNav(hash) {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === hash);
  });
}

/* ---------- 路由 ---------- */
function route() {
  if (!S.boot) return;
  const h = location.hash || '#/chat';
  const [path, arg] = [h.split('/')[1], h.split('/')[2]];
  setActiveNav('#/' + path);
  const v = $('#view');
  v.className = 'content';
  if (path === 'agents') return viewAgents(v);
  if (path === 'agent') return viewAgentChat(v, arg);
  if (path === 'automate') return viewAutomate(v);
  if (path === 'assets') return viewAssets(v, arg);
  if (path === 'ledger') return viewLedger(v, arg);
  // 管理页只给管理员：普通成员就算手敲 hash 也不能进，否则页面会是一个 403 空壳
  if (path === 'org' || path === 'accounts') {
    if (!(S.boot.user && S.boot.user.admin)) {
      toast('这个页面只有管理员能进', true);
      location.hash = '#/chat';
      return;
    }
  }
  if (path === 'org') return viewOrg(v);
  if (path === 'accounts') return viewAccounts(v);
  if (path === 'records') return viewRecords(v);
  return viewChat(v, arg);
}
window.addEventListener('hashchange', route);

/* ---------- 输入区：附件 / 参考图 / @ 换人 ---------- */
function resetComposer() { S.composer = { files: [], refs: [] }; }
function composerHTML(opts) {
  const o = opts || {};
  return `
  <div class="ci-chips" id="ciChips"></div>
  <div class="ci-box">
    <div class="ci-tools">
      <button class="tool-btn" id="attachBtn" title="附件：pdf / docx / txt / md，最多 5 个">＋ 附件</button>
      <button class="tool-btn" id="refBtn" title="参考图：生成图片时带上，最多 9 张">◫ 参考图 <b id="refCount">0</b></button>
      <button class="tool-btn" id="atAgentBtn" title="换同 Box 的另一个 Agent，上下文保留">@ <span id="atAgentName">${esc(S.chat.agentName || '选择 Agent')}</span></button>
      ${o.model ? `<select class="model-select" id="modelSel">${modelOptions(S.chat.model)}</select>` : ''}
    </div>
    <textarea id="chatInput" placeholder="输入消息，可拖入文件或粘贴截图…（Enter 发送，Shift+Enter 换行）"></textarea>
    <button class="btn primary" id="sendBtn">发送</button>
  </div>
  <input type="file" id="filePick" multiple hidden>`;
}
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
async function uploadFiles(files) {
  const room = 5 - S.composer.files.length;
  if (room <= 0) return toast('最多 5 个附件', true);
  for (const f of files.slice(0, room)) {
    if (f.size > 12 * 1024 * 1024) { toast(f.name + ' 超过 12MB，已跳过', true); continue; }
    S.composer.uploading = (S.composer.uploading || 0) + 1;
    S.composer.pending = (S.composer.pending || []).concat([f.name]);
    paintChips();
    try {
      const data = await fileToBase64(f);
      const r = await api('/api/upload', { method: 'POST', body: JSON.stringify({ name: f.name, mime: f.type, data }) });
      S.composer.files.push(r.upload);
      if (r.upload.warn) toast(r.upload.name + '：' + r.upload.warn, true);
    } catch (e) { toast('上传失败：' + e.message, true); }
    finally {
      S.composer.uploading--;
      S.composer.pending = S.composer.pending.filter(n => n !== f.name);
      paintChips();
    }
  }
}
function paintChips() {
  const box = $('#ciChips'); if (!box) return;
  const rc = $('#refCount'); if (rc) rc.textContent = S.composer.refs.length;
  box.innerHTML = [
    ...(S.composer.pending || []).map(n => `<span class="chip pending">⏳ ${esc(n)}<em>上传中</em></span>`),
    ...S.composer.files.map((f, i) => `<span class="chip" data-k="f" data-i="${i}">
      <b>📎</b>${esc(f.name)}<em>${f.chars ? f.chars + ' 字' : '未抽取'}</em><i class="chip-x">✕</i></span>`),
    ...S.composer.refs.map((r, i) => `<span class="chip ref" data-k="r" data-i="${i}">
      <img src="${esc(r.url)}">${esc(String(r.title || '').slice(0, 10))}<i class="chip-x">✕</i></span>`)
  ].join('');
  box.querySelectorAll('.chip-x').forEach(x => x.onclick = () => {
    const c = x.closest('.chip');
    const i = +c.dataset.i;
    if (c.dataset.k === 'f') S.composer.files.splice(i, 1); else S.composer.refs.splice(i, 1);
    paintChips();
  });
}
async function openRefPicker() {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal" style="width:680px">
    <div class="m-title">选参考图（生成图片时带上，最多 9 张）</div>
    <div class="search-row" style="margin:8px 0"><input type="text" id="refSearch" placeholder="搜索图片标题"></div>
    <div class="ref-grid" id="refGrid"><div class="empty">加载中…</div></div>
    <div class="m-foot"><span id="refPickInfo" style="margin-right:auto;font-size:12px;color:var(--sub)"></span>
      <button class="btn ghost" id="refCancel">取消</button><button class="btn primary" id="refOk">确定</button></div>
  </div>`;
  document.body.appendChild(mask);
  const picked = new Map(S.composer.refs.map(r => [r.id, r]));
  const close = () => mask.remove();
  mask.onclick = e => { if (e.target === mask) close(); };
  mask.querySelector('#refCancel').onclick = close;
  const info = () => { mask.querySelector('#refPickInfo').textContent = `已选 ${picked.size} / 9`; };
  const load = async () => {
    const q = mask.querySelector('#refSearch').value.trim();
    const j = await api('/api/reference-images?pageSize=60&search=' + encodeURIComponent(q));
    const grid = mask.querySelector('#refGrid');
    grid.innerHTML = j.list.length ? j.list.map(x => `<div class="ref-cell ${picked.has(x.id) ? 'on' : ''}" data-id="${x.id}">
      <img src="${esc(x.url)}" loading="lazy"><span>${esc(String(x.title || '').slice(0, 12))}</span></div>`).join('')
      : '<div class="empty">还没有图片，先去 Asset 生成一张，或上传图片</div>';
    grid.querySelectorAll('.ref-cell').forEach(el => el.onclick = () => {
      const id = el.dataset.id;
      const item = j.list.find(x => x.id === id);
      if (picked.has(id)) { picked.delete(id); el.classList.remove('on'); }
      else {
        if (picked.size >= 9) return toast('最多 9 张参考图', true);
        picked.set(id, item); el.classList.add('on');
      }
      info();
    });
    info();
  };
  mask.querySelector('#refSearch').oninput = debounce(load, 300);
  mask.querySelector('#refOk').onclick = () => { S.composer.refs = [...picked.values()]; paintChips(); close(); };
  load();
}
async function openAgentPicker() {
  // 打开前先拉一次最新状态：Agent 的启停可能刚在别处改过，别拿旧缓存骗人
  try { S.boot = await api('/api/bootstrap'); } catch (e) { /* 拉不到就用缓存 */ }
  const boxes = S.boot.boxes;
  const cur = S.chat.agentId;
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal" style="width:520px">
    <div class="m-title">切换 Agent（当前对话的上下文会保留）</div>
    <div style="max-height:56vh;overflow:auto;margin-top:8px">
      ${boxes.map(b => `<div class="ap-box"><div class="ap-boxname">${esc(b.name)}</div>
        ${b.agents.map(a => `<div class="ap-item ${a.id === cur ? 'on' : ''} ${a.suspended ? 'susp' : ''}" data-id="${a.id}" data-name="${esc(a.name)}" data-susp="${a.suspended ? 1 : 0}">
          <span class="ap-ico">🤖</span><span class="ap-name">${esc(a.name)}</span>
          <span class="ap-cat">${a.suspended ? '已挂起' : esc(a.category || '')}</span>
          ${a.suspended ? `<button class="ap-enable" data-enable="${a.id}">取消挂起</button>` : ''}
        </div>`).join('')}
      </div>`).join('')}
    </div>
    <div class="m-foot"><button class="btn ghost" id="apCancel">关闭</button></div>
  </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.onclick = e => { if (e.target === mask) close(); };
  mask.querySelector('#apCancel').onclick = close;
  mask.querySelectorAll('.ap-item').forEach(el => el.onclick = async () => {
    const id = el.dataset.id, name = el.dataset.name;
    if (el.dataset.susp === '1') return toast('「' + name + '」是挂起状态。点右边的「取消挂起」可以先启用它', true);
    if (id === S.chat.agentId) return close();
    try {
      if (S.chat.convId) await api(`/api/conversation/${S.chat.convId}/agent`, { method: 'POST', body: JSON.stringify({ agentId: id }) });
      S.chat.agentId = id; S.chat.agentName = name;
      const b = S.boot.boxes.flatMap(x => x.agents).find(x => x.id === id);
      S.chat.suspended = !!(b && b.suspended);
      const nm = $('#atAgentName'); if (nm) nm.textContent = name;
      $('#tbTitle').textContent = name;
      toast('已切换到 ' + name + '（上下文保留）');
    } catch (e) { toast(e.message, true); }
    close();
  });
  /* 挂起只是标记：原平台没开关，靠改名。这里给一个真正的开关，不必改名字 */
  mask.querySelectorAll('[data-enable]').forEach(btn => btn.onclick = async e => {
    e.stopPropagation();
    const id = btn.dataset.enable;
    btn.disabled = true; btn.textContent = '启用中…';
    try {
      await api('/api/agent/' + id, { method: 'PATCH', body: JSON.stringify({ suspended: false }) });
      await boot();
      toast('已取消挂起，可以正常使用了');
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = '取消挂起'; }
  });
}
function bindComposer() {
  const ta = $('#chatInput'), btn = $('#sendBtn');
  if (!ta) return;
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } };
  btn.onclick = sendChat;
  $('#attachBtn').onclick = () => $('#filePick').click();
  $('#filePick').onchange = e => { uploadFiles([...e.target.files]); e.target.value = ''; };
  ta.addEventListener('paste', e => {
    const items = [...((e.clipboardData && e.clipboardData.items) || [])].filter(i => i.type.startsWith('image/'));
    if (!items.length) return;
    e.preventDefault();
    uploadFiles(items.map(i => i.getAsFile()).filter(Boolean));
  });
  const wrap = document.querySelector('.chat-wrap');
  if (wrap) {
    wrap.ondragover = e => { e.preventDefault(); wrap.classList.add('dragging'); };
    wrap.ondragleave = () => wrap.classList.remove('dragging');
    wrap.ondrop = e => {
      e.preventDefault(); wrap.classList.remove('dragging');
      const fs = [...((e.dataTransfer && e.dataTransfer.files) || [])];
      if (fs.length) uploadFiles(fs);
    };
  }
  $('#refBtn').onclick = openRefPicker;
  $('#atAgentBtn').onclick = openAgentPicker;
  const sel = $('#modelSel'); if (sel) sel.onchange = e => { S.chat.model = e.target.value; };
  paintChips();
  ta.focus();
}

/* ---------- 新建对话 ---------- */
function modelOptions(sel) {
  const groups = {};
  for (const m of S.boot.models) (groups[m.label] = groups[m.label] || []).push(m);
  return Object.entries(groups).map(([label, list]) =>
    `<optgroup label="${esc(label)}">` + list.map(m =>
      `<option value="${esc(m.id)}" ${m.id === sel ? 'selected' : ''}>${esc(m.id)}</option>`).join('') + '</optgroup>').join('');
}
function viewChat(v, convId) {
  $('#tbTitle').textContent = '新建对话';
  S.chat.agentId = null; S.chat.convId = null; S.chat.msgs = [];
  S.chat.model = S.boot.defaultModel;
  S.chat.agentName = '助手'; S.chat.canAutoflow = false;
  resetComposer();
  v.className = 'content nopad';
  v.innerHTML = `
  <div class="chat-wrap">
    <div class="chat-scroll" id="chatScroll">
      <div class="empty"><div class="big">✎</div>选个模型，直接开聊<br>
        <span style="font-size:13px">要写品牌内容，去 <a href="#/agents" style="color:var(--acc)">Agent 专职AI员工</a> 选一个专职 Agent<br>
        要图要片直接说，Agent 会自己调工具生成</span></div>
    </div>
    <div class="chat-input">${composerHTML({ model: true })}</div>
  </div>`;
  bindComposer();
  if (convId) loadConversation(convId);
}

async function loadConversation(id) {
  const j = await api('/api/conversation/' + id);
  const c = j.conversation;
  S.chat.convId = c.id;
  S.chat.agentId = j.agent ? j.agent.id : null;
  S.chat.agentName = j.agent ? j.agent.name : '助手';
  S.chat.suspended = !!(j.agent && j.agent.suspended);
  S.chat.model = (c.messages.find(m => m.model) || {}).model || S.boot.defaultModel;
  const scroll = $('#chatScroll');
  scroll.innerHTML = '';
  $('#tbTitle').textContent = c.title || (j.agent ? j.agent.name : '历史对话');
  /* 归档来的会话：标明来源，给出原站链接，随时可回源核对 */
  if (c.imported) {
    const im = c.imported;
    const head = document.createElement('div');
    head.className = 'src-banner';
    head.innerHTML = `<span class="sb-tag">历史归档</span>
      <span>本会话由历史归档导入，共 ${(c.messages || []).length} 条消息${im.boxName ? ' · ' + esc(im.boxName) : ''}${im.agentName ? ' / ' + esc(im.agentName) : ''}</span>
      ${im.url ? `<a href="${esc(im.url)}" target="_blank" rel="noopener">查看原站原文 ↗</a>` : ''}`;
    scroll.appendChild(head);
    if (im.url) head.querySelector('a')?.addEventListener('click', e => e.stopPropagation());
  }
  const sel = $('#modelSel'); if (sel) sel.value = S.chat.model;
  const at = $('#atAgentName'); if (at) at.textContent = S.chat.agentName;
  for (const m of c.messages) {
    const { body } = appendMsg(m.role, m.content, m);
  }
  scroll.scrollTop = scroll.scrollHeight;
  loadConvList();
}

/* 思考过程：可折叠，默认收起 */
function thinkHTML(text, open) {
  if (!text || !String(text).trim()) return '';
  return `<details class="think-box"${open ? ' open' : ''}>
    <summary><span class="tk-ico">✦</span>思考过程<em>${String(text).length} 字</em></summary>
    <div class="tk-body"></div></details>`;
}
/* 子 Agent 产出：折叠卡，展开看全文 */
function subHTML(s) {
  return `<details class="sub-card${s.status === 'running' ? ' running' : ''}">
    <summary>
      <span class="sub-ico">◈</span>
      <span class="sub-name">${esc(s.agentName || '子 Agent')}</span>
      <span class="sub-meta">${s.status === 'running' ? '正在工作…' : (s.chars || 0) + ' 字'}</span>
      <span class="sub-task">${esc(String(s.task || '').slice(0, 40))}</span>
    </summary>
    <div class="sub-body"></div>
  </details>`;
}

/* 渲染一条消息（含附件、思考过程、工具产出、子 Agent） */
function appendMsg(role, text, meta) {
  const scroll = $('#chatScroll');
  scroll.querySelector('.empty')?.remove();
  const d = document.createElement('div');
  d.className = 'msg ' + (role === 'user' ? 'user' : 'ai');
  d.innerHTML = `<div class="m-avatar">${role === 'user' ? '我' : '◉'}</div>
    <div class="m-body"><div class="m-name">${role === 'user' ? '你' : esc((meta && meta.agentName) || S.chat.agentName || '助手')}</div>
    <div class="m-think"></div><div class="m-text"></div><div class="m-tools"></div></div>`;
  const body = d.querySelector('.m-text');
  if (text) body.innerHTML = md(text);
  const thinkBox = d.querySelector('.m-think');
  if (meta && meta.think) {
    thinkBox.innerHTML = thinkHTML(meta.think);
    thinkBox.querySelector('.tk-body').textContent = meta.think;
  }
  if (meta && Array.isArray(meta.uploads) && meta.uploads.length) {
    const box = d.querySelector('.m-tools');
    box.innerHTML = meta.uploads.map(u => `<span class="chip static">📎${esc(u.name)}<em>${u.chars || 0} 字</em></span>`).join('');
  }
  const tools = d.querySelector('.m-tools');
  if (meta && Array.isArray(meta.subAgents) && meta.subAgents.length) {
    tools.insertAdjacentHTML('beforeend', meta.subAgents.map(s => subHTML(s)).join(''));
    meta.subAgents.forEach((s, i) => {
      const el = tools.querySelectorAll('.sub-card')[i];
      if (el) el.querySelector('.sub-body').textContent = s.text || '';
    });
  }
  if (meta && Array.isArray(meta.toolAssets) && meta.toolAssets.length) {
    tools.innerHTML += meta.toolAssets.map(t => t.type === 'image'
      ? `<div class="tool-card done"><a href="${esc(t.url)}" target="_blank"><img src="${esc(t.url)}" alt=""></a>
         <span>配图 · ${esc((t.prompt || '').slice(0, 40))}${t.refCount ? ' · 参考图 ' + t.refCount : ''}</span></div>`
      : `<div class="tool-card done"><span>🎬 视频任务已提交 · ${esc(t.status || '')}</span></div>`).join('');
  }
  scroll.appendChild(d);
  scroll.scrollTop = scroll.scrollHeight;
  return { el: d, body, tools, think: thinkBox };
}

/* ---------- Agent 列表 ---------- */
function viewAgents(v) {
  const boxes = S.boot.boxes;
  const cur = S.agentBox || boxes[0].id;
  const box = boxes.find(b => b.id === cur) || boxes[0];
  $('#tbTitle').textContent = 'Agent 专职AI员工';
  const cats = [...new Set(S.boot.boxes.flatMap(b => b.agents.map(a => a.category)))];
  v.innerHTML = `
  <p style="color:var(--sub);margin-bottom:14px;font-size:13px">所有专职 Agent 均为某一类具体任务定制而成，自带行业专属的提示词、工作流和知识库，请勿用于完成其他非预设任务。</p>
  <div class="box-tabs">${boxes.map(b => `
    <div class="box-tab ${b.id === box.id ? 'active' : ''}" data-box="${b.id}">
      <div class="bt-name">${esc(b.name)}</div>
      <div class="bt-meta">${b.agents.length} 个 Agent · ${new Set(b.agents.map(a => a.category)).size} 类</div>
    </div>`).join('')}
    <div class="box-tab" id="newBoxTab" style="display:flex;align-items:center;justify-content:center;color:var(--sub);border-style:dashed">
      <div class="bt-name" style="font-weight:400">+ New Box</div>
    </div>
  </div>
  <div class="search-row">
    <input type="text" id="agentSearch" placeholder="搜索你的专职 Agent">
    <select id="catSel"><option value="">全部类型</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select>
    <button class="btn ghost small" id="newAgentBtn">+ 新建 Agent</button>
    <span class="badge" id="agentCount">${box.agents.length} 个</span>
  </div>
  <div class="agent-list" id="agentList"></div>`;
  document.querySelectorAll('[data-box]').forEach(el => el.onclick = () => { S.agentBox = el.dataset.box; viewAgents(v); });
  $('#newBoxTab').onclick = async () => {
    const name = window.prompt('新 Box 名称');
    if (!name) return;
    await api('/api/boxes', { method: 'POST', body: JSON.stringify({ name }) });
    toast('已创建 Box：' + name); viewAgents(v);
  };
  const paint = () => {
    const q = ($('#agentSearch').value || '').toLowerCase();
    const cat = $('#catSel').value;
    let list = box.agents.filter(a => (!cat || a.category === cat) && (!q || (a.name + a.description).toLowerCase().includes(q)));
    $('#agentCount').textContent = list.length + ' 个';
    $('#agentList').innerHTML = list.map(a => `
      <div class="agent-card" data-aid="${a.id}">
        <div class="avatar">◉</div>
        <div class="ac-main">
          <div class="ac-name">${esc(a.name)}<span class="cat-chip">${esc(a.category)}</span>${a.suspended ? '<span class="cat-chip susp-chip">已挂起</span>' : ''}</div>
          <div class="ac-desc">${esc(a.description)}</div>
        </div>
        <div class="ac-meta">${esc(a.model)}</div>
        <button class="btn ghost small" data-edit="${a.id}" title="编辑">⚙</button>
      </div>`).join('') || '<div class="empty">没有匹配的 Agent</div>';
    document.querySelectorAll('[data-aid]').forEach(el => el.onclick = () => { location.hash = '#/agent/' + el.dataset.aid; });
    document.querySelectorAll('[data-edit]').forEach(el => el.onclick = e => { e.stopPropagation(); openAgentEditor(el.dataset.edit); });
  };
  $('#agentSearch').oninput = paint; $('#catSel').onchange = paint;
  $('#newAgentBtn').onclick = () => openAgentEditor(null, box.id);
  paint();
}

/* ---------- Agent 编辑器（新建 / 编辑） ---------- */
async function openAgentEditor(agentId, boxId) {
  let a = { name: '', category: '自定义', description: '', model: S.boot.defaultModel, temperature: 0.8, instruction: '', quickQuestions: [], knowledgeBases: [], supportsAutoflow: false, autoflowInstruction: '' };
  if (agentId) a = (await api('/api/agent/' + agentId)).agent;
  const kbs = JSON.parse(JSON.stringify(a.knowledgeBases || []));
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const boxOpts = S.boot.boxes.map(b => `<option value="${b.id}" ${b.id === (a.boxId || boxId) ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  const kbHtml = () => kbs.map((k, i) => `
    <div class="kb-row">
      <div class="kb-row-head">
        <input class="kb-name" data-i="${i}" value="${esc(k.title || '')}" placeholder="给这份知识库起个名字（可选）">
        <span class="kb-len">${(k.content || '').length.toLocaleString()} 字</span>
        <button class="btn ghost small" data-delkb="${i}">删</button>
      </div>
      <textarea class="kb-text" data-i="${i}" rows="3" placeholder="粘贴正文，或点下面的「上传文件」自动填入（支持 md / txt / pdf / docx / csv）">${esc(k.content)}</textarea>
    </div>`).join('');
  mask.innerHTML = `<div class="modal" style="width:720px">
    <h3>${agentId ? '编辑 Agent' : '新建 Agent'}</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>名称</label><input id="eName" value="${esc(a.name)}"></div>
      <div class="field"><label>分类</label><input id="eCat" value="${esc(a.category)}"></div>
    </div>
    <div class="field"><label>描述（列表里显示）</label><input id="eDesc" value="${esc(a.description)}"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div class="field"><label>所属 Box</label><select id="eBox">${boxOpts}</select></div>
      <div class="field"><label>模型</label><select id="eModel">${modelOptions(a.model)}</select></div>
      <div class="field"><label>温度</label><input id="eTemp" type="number" step="0.1" min="0" max="1" value="${a.temperature}"></div>
    </div>
    <div class="field"><label>快捷指令（逗号分隔）</label><input id="eQQ" value="${esc((a.quickQuestions || []).join('，'))}"></div>
    <div class="field"><label>系统提示词（Agent 的灵魂）</label>
      <textarea id="ePrompt" rows="8" style="width:100%;border:1px solid var(--line);border-radius:9px;padding:10px;font-size:13px;line-height:1.6">${esc(a.instruction)}</textarea></div>
    <div class="field"><label>知识库（<span id="kbCount">${kbs.length}</span> 份，总字数 <span id="kbChars">${kbs.reduce((s, k) => s + (k.content || '').length, 0).toLocaleString()}</span>）</label>
      <div id="kbList">${kbHtml()}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
        <button class="btn ghost small" id="addKb">+ 手动添加</button>
        <button class="btn ghost small" id="upKb">↑ 上传文件</button>
        <span style="font-size:12px;color:var(--sub)">支持 md / txt / pdf / docx / csv，单份 ≤ 12MB</span>
        <input type="file" id="kbFile" multiple accept=".md,.markdown,.txt,.csv,.json,.pdf,.docx,.doc,.rtf,.html" style="display:none">
      </div></div>
    <div class="field"><label><input type="checkbox" id="eAuto" ${a.supportsAutoflow ? 'checked' : ''} style="width:auto"> 支持任务自动化（Automate 批量生成可选到它）</label></div>
    <div class="field"><label><input type="checkbox" id="eSusp" ${a.suspended ? 'checked' : ''} style="width:auto"> 挂起（暂停使用：列表标「已挂起」，不可 @、不可发送。这是真实的开关，保存后立即生效）</label></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
      ${agentId ? '<button class="btn danger" id="delAgent">删除</button>' : ''}
      <button class="btn ghost" id="cancelEdit">取消</button>
      <button class="btn primary" id="saveAgent">保存</button>
    </div></div>`;
  document.body.appendChild(mask);
  const syncKb = () => {
    const names = [...mask.querySelectorAll('.kb-name')].map(x => x.value.trim());
    const bodies = [...mask.querySelectorAll('.kb-text')].map(x => x.value);
    kbs.length = 0;
    bodies.forEach((c, i) => kbs.push({ type: 'text', title: names[i] || '', content: c }));
  };
  const repaintKb = () => {
    mask.querySelector('#kbList').innerHTML = kbHtml();
    bindKb();
    mask.querySelector('#kbCount').textContent = kbs.length;
    mask.querySelector('#kbChars').textContent = kbs.reduce((s, k) => s + (k.content || '').length, 0).toLocaleString();
  };
  const bindKb = () => mask.querySelectorAll('[data-delkb]').forEach(b => b.onclick = () => {
    syncKb(); kbs.splice(+b.dataset.delkb, 1); repaintKb();
  });
  bindKb();
  mask.querySelector('#addKb').onclick = () => { syncKb(); kbs.push({ type: 'text', title: '', content: '' }); repaintKb(); };
  /* 上传文件当知识库：复用 /api/upload（服务端已做 pdf/docx 文本提取） */
  mask.querySelector('#upKb').onclick = () => mask.querySelector('#kbFile').click();
  mask.querySelector('#kbFile').onchange = async e => {
    const files = [...e.target.files];
    if (!files.length) return;
    syncKb();
    const btn = mask.querySelector('#upKb');
    btn.disabled = true;
    for (const f of files) {
      btn.textContent = '读取中 ' + f.name.slice(0, 14);
      try {
        const data = await fileToBase64(f);
        const r = await api('/api/upload', { method: 'POST', body: JSON.stringify({ name: f.name, mime: f.type, data }) });
        const u = r.upload;
        if (!u.chars) { toast(f.name + '：没读到文字（可能是扫描件或纯图片）', true); continue; }
        kbs.push({ type: 'text', title: u.name.replace(/\.[^.]+$/, ''), content: u.text || '' });
        if (u.warn) toast(f.name + '：' + u.warn, true);
      } catch (err) {
        toast(f.name + ' 上传失败：' + err.message, true);
      }
    }
    btn.disabled = false;
    btn.textContent = '↑ 上传文件';
    repaintKb();
    e.target.value = '';
  };
  mask.querySelector('#cancelEdit').onclick = () => mask.remove();
  const delBtn = mask.querySelector('#delAgent');
  if (delBtn) delBtn.onclick = async () => {
    if (!window.confirm('删除这个 Agent？')) return;
    await api('/api/agent/' + agentId, { method: 'DELETE' });
    toast('已删除'); mask.remove(); viewAgents($('#view'));
  };
  mask.querySelector('#saveAgent').onclick = async () => {
    syncKb();
    const payload = {
      name: mask.querySelector('#eName').value.trim(),
      category: mask.querySelector('#eCat').value.trim() || '自定义',
      description: mask.querySelector('#eDesc').value.trim(),
      boxId: mask.querySelector('#eBox').value,
      model: mask.querySelector('#eModel').value,
      temperature: +mask.querySelector('#eTemp').value,
      quickQuestions: mask.querySelector('#eQQ').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      instruction: mask.querySelector('#ePrompt').value,
      supportsAutoflow: mask.querySelector('#eAuto').checked,
      suspended: mask.querySelector('#eSusp').checked,
      knowledgeBases: kbs.filter(k => (k.content || '').trim())
    };
    if (!payload.name || !payload.instruction) return toast('名称和提示词必填', true);
    try {
      if (agentId) await api('/api/agent/' + agentId, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/api/agents', { method: 'POST', body: JSON.stringify(payload) });
      toast('已保存'); mask.remove(); location.reload();
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------- Agent 对话 ---------- */
async function viewAgentChat(v, agentId) {
  let ag;
  try { ag = (await api('/api/agent/' + agentId)).agent; } catch (e) { toast(e.message, true); return; }
  $('#tbTitle').textContent = ag.name;
  S.chat.agentId = ag.id; S.chat.convId = null; S.chat.msgs = []; S.chat.model = ag.model;
  S.chat.agentName = ag.name; S.chat.canAutoflow = !!ag.supportsAutoflow;
  S.chat.suspended = !!ag.suspended;
  resetComposer();
  v.className = 'content nopad';
  const kbCount = (ag.knowledgeBases || []).length;
  const peers = S.boot.boxes.flatMap(b => b.agents).filter(a => a.id !== ag.id && !a.suspended);
  const peerNames = peers.slice(0, 5).map(a => a.name).join('、');
  v.innerHTML = `
  <div class="chat-wrap">
    <div class="chat-scroll" id="chatScroll">
      <div class="msg ai"><div class="m-avatar">◉</div><div class="m-body">
        <div class="m-name">${esc(ag.name)} · ${esc(ag.model)} · temp ${ag.temperature}</div>
        <div class="m-text">${esc(ag.description || '已就绪')}\n\n已加载提示词 ${ag.instruction.length.toLocaleString()} 字 + 知识库 ${kbCount} 份${ag.supportsAutoflow ? ' · 支持任务自动化' : ''}。${peerNames ? `\n需要别的专长时，它会把子任务派给同团队的 Agent（比如 ${esc(peerNames)}），产出以折叠卡回到这里。` : ''}</div>
      </div></div>
    </div>
    ${S.chat.suspended ? `<div class="susp-bar"><span>⚠️ 这个 Agent 处于「挂起」状态。原平台没有停用开关，账号主人是直接在名字后面加了「（挂起）」来标记停用，所以它在原站同样不能用，发送会被拦下。</span><button class="btn small" id="btnUnSusp">取消挂起，启用它</button></div>` : ''}
    <div class="qq-row" id="qqRow">${(ag.quickQuestions || []).map(q => `<button class="qq-chip">${esc(q)}</button>`).join('')}</div>
    <div class="chat-input">${composerHTML({ model: false })}</div>
  </div>`;
  bindComposer();
  const unSusp = $('#btnUnSusp');
  if (unSusp) unSusp.onclick = async () => {
    unSusp.disabled = true; unSusp.textContent = '启用中…';
    try {
      await api('/api/agent/' + ag.id, { method: 'PATCH', body: JSON.stringify({ suspended: false }) });
      await boot();
      toast('已取消挂起，可以直接用了');
    } catch (e) {
      toast(e.message, true);
      unSusp.disabled = false; unSusp.textContent = '取消挂起，启用它';
    }
  };
  document.querySelectorAll('.qq-chip').forEach(el => el.onclick = async () => {
    const q = el.textContent.trim();
    // 「随机生成一套内容」：从选题库随机抽一条真实选题，带上选题上下文再发
    if (/随机生成/.test(q) && S.chat.canAutoflow) {
      try {
        const j = await api('/api/topics?page=1&pageSize=200&search=&dim=');
        const pool = j.list.filter(t => !t.used && !t.placeholder);
        const t = (pool.length ? pool : j.list)[Math.floor(Math.random() * (pool.length || j.list.length))];
        if (t) {
          $('#chatInput').value = q + '\n\n【选题】' + t.title + (t.content ? '\n【选题说明】' + t.content : '');
          toast('已随机选题：' + t.title);
          sendChat();
          return;
        }
      } catch (e) { /* 落到普通发送 */ }
    }
    $('#chatInput').value = q;
    sendChat();
  });
}

/* ---------- 对话发送（SSE，含工具过程） ---------- */
/* 流式 markdown 渲染节流：60ms 一帧，避免每个 delta 都重排整段（长文时肉眼可见卡顿） */
function makeMdPainter(el) {
  let last = 0, timer = null, pending = null, live = true;
  const paint = txt => {
    el.innerHTML = md(txt) + (live ? '<span class="cursor-blink"></span>' : '');
  };
  const fn = txt => {
    pending = txt;
    const now = Date.now();
    if (now - last >= 60) { last = now; paint(txt); return; }
    if (!timer) {
      timer = setTimeout(() => {
        timer = null; last = Date.now();
        if (pending != null) paint(pending);
      }, 60);
    }
  };
  fn.stop = txt => {
    live = false;
    if (timer) { clearTimeout(timer); timer = null; }
    pending = null;
    el.innerHTML = md(txt);
  };
  return fn;
}

async function sendChat() {
  const ta = $('#chatInput'), btn = $('#sendBtn');
  if (!ta || !btn) return;
  const content = (ta.value || '').trim();
  const files = S.composer.files.slice(), refs = S.composer.refs.slice();
  if (S.composer.uploading > 0) return toast('附件还在上传，稍等一下再发', true);
  if (S.chat.suspended) return toast('这个 Agent 已挂起，先用 @ 换一个', true);
  if ((!content && !files.length) || S.chat.sending) return;
  S.chat.sending = true; btn.disabled = true; ta.value = '';

  appendMsg('user', content || '（已发送附件）', { uploads: files.map(f => ({ name: f.name, chars: f.chars })) });
  resetComposer(); paintChips();
  const a = appendMsg('assistant', '');
  a.body.innerHTML = '<span class="cursor-blink"></span>';
  const paintBody = makeMdPainter(a.body);

  let full = '', err = null, thinkText = '';
  const pendingTools = [];
  const subCards = [];
  const scroll = $('#chatScroll');
  const ensureThink = () => {
    let box = a.think.querySelector('.think-box');
    if (!box) {
      a.think.innerHTML = `<details class="think-box" open><summary><span class="tk-ico">✦</span>思考过程<em class="tk-n">0 字</em></summary><div class="tk-body"></div></details>`;
      box = a.think.querySelector('.think-box');
    }
    return box;
  };
  try {
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: S.chat.agentId || null, conversationId: S.chat.convId,
        content, model: S.chat.model,
        uploadIds: files.map(f => f.id), refImageIds: refs.map(r => r.id)
      })
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || ('HTTP ' + res.status));
    }
    const reader = res.body.getReader(); const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n'); buf = parts.pop();
      for (const part of parts) {
        const line = part.trim(); if (!line.startsWith('data:')) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
        if (ev.meta) {
          S.chat.convId = ev.meta.conversationId;
          if (ev.meta.agent) { S.chat.agentId = ev.meta.agent.id; S.chat.agentName = ev.meta.agent.name; }
        }
        if (ev.think) {
          thinkText += ev.think;
          // 首个增量常常只是换行/空白，等有实质内容再建卡片，避免闪一个空块
          if (thinkText.trim()) {
            const box = ensureThink();
            box.querySelector('.tk-body').textContent = thinkText;
            box.querySelector('.tk-n').textContent = thinkText.trim().length + ' 字';
          }
          scroll.scrollTop = scroll.scrollHeight;
        }
        if (ev.delta) {
          full += ev.delta;
          paintBody(full);
          scroll.scrollTop = scroll.scrollHeight;
        }
        if (ev.sub) {
          const s = ev.sub;
          if (s.status === 'start') {
            a.tools.insertAdjacentHTML('beforeend', subHTML({ ...s, status: 'running' }));
            const all = a.tools.querySelectorAll('.sub-card');
            subCards.push(all[all.length - 1]);
          } else if (s.status === 'done') {
            const el = subCards.pop();
            if (el) {
              el.classList.remove('running');
              el.querySelector('.sub-meta').textContent = (s.chars || 0) + ' 字';
              el.querySelector('.sub-body').textContent = s.text || '';
            }
          }
          scroll.scrollTop = scroll.scrollHeight;
        }
        if (ev.tool) {
          const t = ev.tool;
          if (t.status === 'start' && t.name !== '__summary' && t.name !== 'call_subagent') {
            const verb = t.name === 'generate_image' ? '正在生成配图…'
              : t.name === 'generate_video' ? '正在生成视频…'
                : t.name === 'read_file' ? '正在读取文件…' : '正在处理…';
            const el = document.createElement('div');
            el.className = 'tool-card running';
            el.innerHTML = `<span class="tc-dot"></span><span>${verb}</span>
              <span class="tc-prompt">${esc(String(t.prompt || '').slice(0, 46))}</span>`;
            a.tools.appendChild(el);
            pendingTools.push({ name: t.name, el });
            scroll.scrollTop = scroll.scrollHeight;
          } else if (t.status === 'done') {
            if (t.name === 'call_subagent') { /* 由 sub 事件渲染，这里不重复建卡 */ }
            else {
              const idx = pendingTools.findIndex(p => p.name === t.name);
              const p = idx >= 0 ? pendingTools.splice(idx, 1)[0] : pendingTools.shift();
              if (p && p.el) {
                if (t.asset && t.asset.type === 'image') {
                  p.el.className = 'tool-card done';
                  p.el.innerHTML = `<a href="${esc(t.asset.url)}" target="_blank"><img src="${esc(t.asset.url)}" alt=""></a>
                    <span>配图已生成${t.asset.refCount ? ' · 参考图 ' + t.asset.refCount : ''} · 已存入 Asset</span>`;
                } else if (t.asset) {
                  p.el.className = 'tool-card done';
                  p.el.innerHTML = `<span>🎬 视频任务已提交（${esc(t.asset.modelLabel || '')}），约 3–6 分钟出片，去 Asset 等</span>`;
                } else if (t.read) {
                  p.el.className = 'tool-card done';
                  p.el.innerHTML = `<span>📖 已读取 ${esc(t.read.file || '')}${t.read.query ? '（检索：' + esc(t.read.query) + '）' : ''} · ${t.read.chars} 字</span>`;
                } else {
                  p.el.className = 'tool-card done';
                  p.el.innerHTML = '<span>完成</span>';
                }
              }
            }
            scroll.scrollTop = scroll.scrollHeight;
          } else if (t.status === 'error') {
            const idx = pendingTools.findIndex(p => p.name === t.name);
            const p = idx >= 0 ? pendingTools.splice(idx, 1)[0] : pendingTools.shift();
            if (p && p.el) { p.el.className = 'tool-card err'; p.el.innerHTML = `<span>生成失败：${esc(t.error || '')}</span>`; }
          }
        }
        if (ev.error) err = ev.error;
        if (ev.done) {
          S.boot.usage = {
            ...S.boot.usage,
            totalIn: S.boot.usage.totalIn + ((ev.usage && ev.usage.in) || 0),
            totalOut: S.boot.usage.totalOut + ((ev.usage && ev.usage.out) || 0),
            calls: (S.boot.usage.calls || 0) + 1
          };
          if (ev.credits != null) {
            S.boot.org.used = Math.round(((S.boot.org.used || 0) + ev.credits) * 100) / 100;
            S.boot.org.todayCredits = Math.round(((S.boot.org.todayCredits || 0) + ev.credits) * 100) / 100;
            if (ev.balance != null) S.boot.org.balance = ev.balance;
            else S.boot.org.balance = Math.round((S.boot.org.balance - ev.credits) * 100) / 100;
            S.tbCost = (S.tbCost || 0) + ev.credits;
            paintMoney();
          }
          if (ev.assetId) toast('正文已自动存入 Asset');
          if (ev.toolCount) toast('本次生成 ' + ev.toolCount + ' 个素材，已存入 Asset');
          if (ev.subCount) toast('本次调用了 ' + ev.subCount + ' 个子 Agent');
          loadConvList();
        }
      }
    }
    // 收尾：思考块收起，保留可展开
    if (thinkText) {
      const box = a.think.querySelector('.think-box');
      if (box) box.removeAttribute('open');
    }
    if (err) a.body.innerHTML = `<span style="color:var(--danger)">${esc(err)}</span>`;
    else if (!full) a.body.textContent = '(空响应)';
    else paintBody.stop(full);
  } catch (e) {
    a.body.innerHTML = `<span style="color:var(--danger)">请求失败：${esc(e.message)}</span>`;
  } finally {
    S.chat.sending = false; btn.disabled = false;
    paintMoney();
    scroll.scrollTop = scroll.scrollHeight;
  }
}

function paintMoney() {
  const b = S.boot; if (!b) return;
  const tb = $('#tbUsage');
  if (tb) tb.innerHTML = '累计 <b>' + fmtK(b.usage.totalIn + b.usage.totalOut) + '</b> tokens';
  const cost = $('#tbCost'); if (cost) cost.textContent = fmtFull(b.org.todayCredits || 0);
  const bal = $('#sbBalance'); if (bal) bal.textContent = fmtFull(b.org.balance);
  const big = $('#balBig'); if (big) big.textContent = fmtFull(b.org.balance);
  const used = $('#sbUsed'); if (used) used.textContent = fmtFull(b.org.used || 0);
  const rc = $('#sbRecharged'); if (rc) rc.textContent = fmtFull(b.org.recharged || 0);
  const calls = $('#sbCalls'); if (calls) calls.textContent = b.usage.calls || 0;
  const tok = $('#sbTok'); if (tok) tok.textContent = fmtK(b.usage.totalIn + b.usage.totalOut);
  const nc = $('#navCredits'); if (nc) nc.textContent = fmtFull(b.org.used || 0);
  const line = document.querySelector('.sb-cred');
  if (line) line.classList.toggle('low', b.org.balance <= (b.org.lowBalance || 0));
}

/* ---------- Automate ---------- */
function viewAutomate(v) {
  $('#tbTitle').textContent = 'Automate 任务自动化';
  const dims = Object.entries(S.boot.dims).sort((a, b) => b[1] - a[1]);
  v.innerHTML = `
  <div class="search-row">
    <input type="text" id="topicSearch" placeholder="搜索选题标题或说明">
    <select id="dimSel"><option value="">全部维度（${dims.length}）</option>${dims.map(([d, c]) => `<option value="${esc(d)}">${esc(d)}（${c}）</option>`).join('')}</select>
    <span class="spacer" style="flex:1"></span>
    <button class="btn ghost small" id="randomBtn">🎲 随机生成一套内容</button>
  </div>
  <div id="batchBar"></div>
  <div id="topicBox"></div>
  <div id="taskBox"></div>`;
  let page = 1, selected = new Set();
  const load = async () => {
    const q = $('#topicSearch').value.trim(), dim = $('#dimSel').value;
    const j = await api(`/api/topics?page=${page}&pageSize=40&search=${encodeURIComponent(q)}&dim=${encodeURIComponent(dim)}`);
    const pages = Math.max(1, Math.ceil(j.total / j.pageSize));
    $('#topicBox').innerHTML = `
    <table class="topic-table"><thead><tr>
      <th style="width:36px"><input type="checkbox" id="chkAll"></th><th>选题</th><th style="width:120px">维度</th><th style="width:80px">状态</th>
    </tr></thead><tbody>
    ${j.list.map(t => `<tr data-tid="${t.id}">
      <td><input type="checkbox" class="chk" data-tid="${t.id}" ${selected.has(t.id) ? 'checked' : ''}></td>
      <td><div class="t-title">${esc(t.title)}</div><div class="t-content">${esc(t.content || '—')}</div></td>
      <td><span class="dim-chip">${esc(t.dimension)}</span></td>
      <td style="color:var(--sub);font-size:12px">${t.used ? '已用' : '待用'}${t.placeholder ? ' · 占位' : ''}</td>
    </tr>`).join('')}
    </tbody></table>
    <div class="pager">
      <button id="prevPg" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>第 ${page} / ${pages} 页 · 共 ${j.total} 条</span>
      <button id="nextPg" ${page >= pages ? 'disabled' : ''}>下一页</button>
    </div>`;
    $('#chkAll').onchange = e => {
      j.list.forEach(t => e.target.checked ? selected.add(t.id) : selected.delete(t.id));
      document.querySelectorAll('.chk').forEach(c => c.checked = e.target.checked);
      paintBar();
    };
    document.querySelectorAll('.chk').forEach(c => c.onchange = () => {
      c.checked ? selected.add(c.dataset.tid) : selected.delete(c.dataset.tid); paintBar();
    });
    $('#prevPg').onclick = () => { page--; load(); };
    $('#nextPg').onclick = () => { page++; load(); };
  };
  const paintBar = () => {
    $('#batchBar').innerHTML = selected.size ? `<div class="batch-bar">
      <b>已选 ${selected.size} 条选题</b>
      <button class="btn primary small" id="genBtn">生成内容</button>
      <button class="btn ghost small" id="clearBtn">清空选择</button>
      <span style="font-size:12px;color:var(--sub)">选一个专职 Agent，逐条自动生成并入库 Asset</span>
    </div>` : '';
    if (selected.size) {
      $('#genBtn').onclick = () => pickAgent([...selected]);
      $('#clearBtn').onclick = () => { selected.clear(); paintBar(); document.querySelectorAll('.chk').forEach(c => c.checked = false); };
    }
  };
  $('#dimSel').onchange = () => { page = 1; load(); };
  $('#topicSearch').oninput = debounce(() => { page = 1; load(); }, 350);
  $('#randomBtn').onclick = async () => {
    const j = await api('/api/topics?page=1&pageSize=200&search=&dim=');
    const pool = j.list.filter(t => !t.used && !t.placeholder);
    const rand = (pool.length ? pool : j.list)[Math.floor(Math.random() * (pool.length || j.list.length))];
    if (!rand) return toast('选题库为空', true);
    pickAgent([rand.id], true);
  };
  load(); paintTasks();
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function pickAgent(topicIds, auto) {
  const agents = S.boot.boxes.flatMap(b => b.agents.map(a => ({ ...a, box: b.name }))).filter(a => !a.suspended);
  const factory = agents.filter(a => a.box === '内容工厂');
  const others = agents.filter(a => a.box !== '内容工厂');
  const list = [...factory, ...others];
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal">
    <h3>选择执行 Agent（${topicIds.length} 条选题）</h3>
    <div class="pick-list">${list.map(a => `
      <div class="pick-item" data-aid="${a.id}">
        <div style="flex:1;min-width:0"><div style="font-weight:600">${esc(a.name)}</div>
        <div style="font-size:12px;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.box)} · ${esc(a.model)}</div></div>
      </div>`).join('')}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn ghost" id="cancelPick">取消</button>
    </div></div>`;
  document.body.appendChild(mask);
  mask.querySelector('#cancelPick').onclick = () => mask.remove();
  mask.querySelectorAll('.pick-item').forEach(el => el.onclick = async () => {
    el.classList.add('sel');
    try {
      const j = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ agentId: el.dataset.aid, topicIds }) });
      toast('已创建 ' + j.created + ' 个生成任务，正在排队执行');
      mask.remove();
      paintTasks(true);
    } catch (e) { toast(e.message, true); }
  });
}

async function paintTasks(kick) {
  const box = $('#taskBox'); if (!box) return;
  const j = await api('/api/tasks');
  const running = j.list.filter(t => t.status === 'queued' || t.status === 'running').length;
  if (!j.list.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div style="margin-top:22px;display:flex;align-items:center;gap:10px">
      <b style="font-size:14px">生成任务</b>
      <span class="badge">${running ? running + ' 个进行中' : '全部完成'}</span>
      <button class="btn ghost small" id="refreshTasks">刷新</button>
    </div>
    <div class="task-list">${j.list.slice(0, 20).map(t => `
      <div class="task-row">
        <span class="st ${t.status}">${t.status === 'running' ? '<span class="spin"></span> 生成中' : t.status === 'queued' ? '排队中' : t.status === 'done' ? '已完成' : '失败'}</span>
        <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.topicTitle || '')}</span>
        <span style="font-size:12px;color:var(--sub)">${esc(t.agentName || '')}</span>
        ${t.assetId ? `<a href="#/assets" style="font-size:12px;color:var(--acc)">看产出</a>` : ''}
        ${t.error ? `<span title="${esc(t.error)}" style="color:var(--danger);font-size:12px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.error)}</span>` : ''}
      </div>`).join('')}</div>`;
  $('#refreshTasks').onclick = () => paintTasks();
  clearTimeout(S.tasksTimer);
  if (running) S.tasksTimer = setTimeout(() => paintTasks(), 2000);
  if (running && kick) { /* 已在轮询 */ }
}

/* ---------- Asset ---------- */
async function viewAssets(v, tab) {
  $('#tbTitle').textContent = 'Asset 数字资产';
  const t = tab || 'all';
  const tabs = [['all', '全部'], ['doc', '文档'], ['image', '图片'], ['video', '视频'], ['fav', '收藏'], ['trash', '回收站']];
  v.innerHTML = `
  <div class="asset-tabs">${tabs.map(([k, n]) => `<div class="a-tab ${k === t ? 'active' : ''}" data-tab="${k}">${n}</div>`).join('')}</div>
  <div class="gen-panel">
    <div class="gp-row">
      <input type="text" id="genPrompt" placeholder="直接描述要生成什么，例如：抗衰补剂瓶身在晨光里的极简产品图">
      <button class="btn primary" id="genImgBtn">生成图片</button>
      <button class="btn" id="genVidBtn">生成视频</button>
    </div>
    <div class="gp-row gp-sub">
      <label>图片模型 <select id="genImgModel"><option value="">${esc(S.boot.media.imageModel)}</option></select></label>
      <label>视频模型 <select id="genVidModel">${S.boot.media.videoModels.map(vm => `<option value="${vm.id}" ${vm.id === S.boot.media.videoDefault ? 'selected' : ''}>${esc(vm.label)}</option>`).join('')}</select></label>
      <label>分辨率 <select id="genRes"></select></label>
      <label>比例 <select id="genRatio"></select></label>
      <label>时长 <select id="genDur"></select></label>
      <span class="gp-hint" id="genHint">火山引擎方舟 · Seedream / Seedance</span>
    </div>
  </div>
  <div id="assetBox"><div class="empty">加载中…</div></div>`;
  v.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => { location.hash = '#/assets/' + el.dataset.tab; });

  const vmLib = {};
  (S.boot.media.videoModels || []).forEach(vm => vmLib[vm.id] = vm);
  const fillSel = (sel, vals, labels, def) => {
    const el = $(sel); if (!el) return;
    el.innerHTML = (vals || []).map((x, i) => `<option value="${x}">${esc(labels ? labels[i] : x)}</option>`).join('');
    if (def && (vals || []).includes(def)) el.value = def;
  };
  const syncVidOpts = () => {
    const meta = vmLib[$('#genVidModel').value] || {};
    const res = meta.resolutions || ['720p'];
    fillSel('#genRes', res, res.map(x => x + (x === '1080p' ? ' HD' : '')), res.includes('720p') ? '720p' : res[0]);
    fillSel('#genRatio', meta.ratios || ['16:9']);
    const durs = meta.durations || ['5'];
    fillSel('#genDur', durs, durs.map(d => d + 's'), durs[0]);
    $('#genHint').textContent = `${meta.label || ''} · ${meta.note || ''}${meta.audio ? ' · 原生音频' : ''}`;
  };
  $('#genVidModel').onchange = syncVidOpts;
  syncVidOpts();
  const gp = $('#genPrompt');
  const doGen = async kind => {
    const prompt = (gp.value || '').trim();
    if (!prompt) { toast('先写一句要生成什么', true); return; }
    const btn = kind === 'image' ? $('#genImgBtn') : $('#genVidBtn');
    btn.disabled = true; const label = btn.textContent; btn.textContent = kind === 'image' ? '生成中…' : '已提交，排队中…';
    try {
      if (kind === 'image') {
        const r = await api('/api/image', { method: 'POST', body: JSON.stringify({ prompt }) });
        toast('图片已生成：' + r.asset.title);
        gp.value = ''; await loadAssets(t);
      } else {
        const r = await api('/api/video', {
          method: 'POST',
          body: JSON.stringify({
            prompt, model: $('#genVidModel').value,
            resolution: $('#genRes').value, ratio: $('#genRatio').value, duration: $('#genDur').value
          })
        });
        toast(`${(r.asset && r.asset.modelLabel) || '视频'} ${(r.asset && r.asset.resolution) || ''} 已提交，约 3–6 分钟出片`);
        gp.value = ''; await loadAssets(t);
        pollAsset(r.asset.id, t);
      }
    } catch (e) { toast(e.message, true); }
    btn.disabled = false; btn.textContent = label;
  };
  $('#genImgBtn').onclick = () => doGen('image');
  $('#genVidBtn').onclick = () => doGen('video');
  gp.onkeydown = e => { if (e.key === 'Enter') doGen('image'); };

  await loadAssets(t);
}

async function loadAssets(t) {
  const qs = t === 'fav' ? '?fav=1' : t === 'trash' ? '?deleted=1' : t === 'all' ? '' : '?type=' + t;
  const j = await api('/api/assets' + qs);
  const icon = a => a.type === 'image' ? '🖼' : a.type === 'video' ? '🎬' : '📄';
  const media = a => {
    if (a.type === 'video') {
      if (a.videoUrl) return `<video src="${esc(a.videoUrl)}" muted playsinline preload="metadata"></video><span class="v-dur">▶</span>`;
      const st = a.videoStatus === 'failed' ? '生成失败' : '生成中…';
      return `<div class="a-snippet v-pending">${st}<br><span style="font-size:12px;color:var(--sub)">${esc((a.modelLabel || a.model || '') + (a.resolution ? ' · ' + a.resolution : ''))}</span></div>`;
    }
    if (a.imageUrl) return `<img src="${esc(a.imageUrl)}" alt="">`;
    return `<div class="a-snippet">${esc(String(a.content || '').slice(0, 150))}</div>`;
  };
  $('#assetBox').innerHTML = j.total ? `<div class="asset-grid">${j.list.map(a => `
    <div class="asset-card" data-id="${a.id}">
      <div class="head"><span class="t-ico">${icon(a)}</span><span class="a-title">${esc(a.title)}</span>
        ${a.visibility === 'team' ? '<span class="shared" title="团队可见">共享</span>' : ''}
        ${a.fav ? '<span class="fav">★</span>' : ''}</div>
      ${media(a)}
      <div class="a-foot"><span>${a.agentName ? esc(a.agentName) : (a.model ? esc(a.model) : '手创')}${a.mine === false ? ' · 同事产出' : ''}</span>
        <span style="margin-left:auto">${fmtTime(a.createdAt)}</span></div>
    </div>`).join('')}</div>`
    : `<div class="empty"><div class="big">▤</div>${t === 'trash' ? '回收站是空的' : '还没有生成物<br><span style="font-size:13px">上面直接生成，或去 Automate 批量产出</span>'}</div>`;
  document.querySelectorAll('.asset-card').forEach(el => el.onclick = () => openAsset(el.dataset.id, t));
}

// 视频任务：轮询到出片就刷新列表
async function pollAsset(id, tab) {
  for (let i = 0; i < 150; i++) {
    await new Promise(s => setTimeout(s, 6000));
    let a;
    try { a = (await api('/api/video/' + id)).asset; } catch (e) { return; }
    if (!a) return;
    if (a.videoStatus === 'succeeded') { toast('视频已出片：' + a.title); loadAssets(tab); return; }
    if (a.videoStatus === 'failed') { toast('视频生成失败：' + (a.videoError || ''), true); loadAssets(tab); return; }
    if (i % 5 === 4) loadAssets(tab);
  }
}

async function openAsset(id, tab) {
  const j = await api('/api/asset/' + id);
  const a = j.asset; if (!a) return;
  const mask = document.createElement('div');
  mask.className = 'drawer-mask';
  const drawer = document.createElement('div');
  drawer.className = 'drawer';
  const meId = ((S.boot && S.boot.user) || {}).id;
  const mineA = !!meId && a.ownerId === meId;
  drawer.innerHTML = `
    <div class="d-head">
      <div class="d-title">${esc(a.title)}${mineA ? '' : ' <span class="shared">同事共享</span>'}</div>
      <button class="btn ghost small" id="closeD">关闭</button>
    </div>
    <div class="d-body">${a.type === 'video'
      ? (a.videoUrl ? `<video class="d-vid" src="${esc(a.videoUrl)}" controls playsinline></video>`
        : `<div class="empty">${a.videoStatus === 'failed' ? '生成失败：' + esc(a.videoError || '') : '视频生成中，通常 3–6 分钟…'}<br><span style="font-size:13px">${esc((a.modelLabel || a.model || '') + (a.resolution ? ' · ' + a.resolution : '') + (a.duration ? ' · ' + a.duration + 's' : ''))}</span></div>`)
      : a.imageUrl ? `<img class="d-img" src="${esc(a.imageUrl)}">` : esc(a.content || '')}</div>
    <div class="d-foot">
      ${mineA ? `<button class="btn ghost small" id="favD">${a.fav ? '取消收藏' : '收藏'}</button>` : ''}
      ${mineA ? `<button class="btn ghost small" id="shD">${a.visibility === 'team' ? '取消团队共享' : '共享给团队'}</button>` : ''}
      ${mineA ? '' : '<span style="font-size:12px;color:var(--sub)">同事共享的成品，可下载/参考，不能改</span>'}
      <button class="btn ghost small" id="dlD">${a.type === 'video' ? '打开原视频' : '下载 .md'}</button>
      ${a.type === 'doc' ? '<button class="btn ghost small" id="docxD">导出 .docx</button><button class="btn ghost small" id="imgD">生成配图</button><button class="btn ghost small" id="vidD">生成视频</button>' : ''}
      <button class="btn ghost small" id="cpD">复制正文</button>
      ${!mineA ? '' : (a.deleted ? '<button class="btn ghost small" id="rsD">恢复</button><button class="btn danger small" id="hdD">彻底删除</button>'
      : '<button class="btn danger small" id="delD">移入回收站</button>')}
      <span style="margin-left:auto;font-size:12px;color:var(--sub)">${esc(a.agentName || '')} ${fmtTime(a.createdAt)}</span>
    </div>`;
  document.body.appendChild(mask); document.body.appendChild(drawer);
  const close = () => { mask.remove(); drawer.remove(); };
  mask.onclick = close; drawer.querySelector('#closeD').onclick = close;
  const favBtn = drawer.querySelector('#favD');
  if (favBtn) favBtn.onclick = async () => { await api(`/api/asset/${a.id}/fav`, { method: 'POST' }); toast('已更新收藏'); close(); loadAssets(tab); };
  const shBtn = drawer.querySelector('#shD');
  if (shBtn) shBtn.onclick = async () => {
    const toTeam = a.visibility !== 'team';
    await api(`/api/asset/${a.id}/share`, { method: 'POST', body: JSON.stringify({ team: toTeam }) });
    toast(toTeam ? '已共享给团队，同事能在资产库看到' : '已收回，只有你自己可见');
    close(); loadAssets(tab);
  };
  drawer.querySelector('#dlD').onclick = () => {
    if (a.type === 'video' && a.videoUrl) { window.open(a.videoUrl, '_blank'); return; }
    if (a.type === 'image' && a.imageUrl) { window.open(a.imageUrl, '_blank'); return; }
    const blob = new Blob([`# ${a.title}\n\n${a.content || ''}`], { type: 'text/markdown;charset=utf-8' });
    const u = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = u; link.download = a.title.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 60) + '.md'; link.click(); URL.revokeObjectURL(u);
  };
  const cpBtn = drawer.querySelector('#cpD');
  cpBtn.onclick = async () => { await navigator.clipboard.writeText(a.content || ''); toast('正文已复制'); };
  const docxBtn = drawer.querySelector('#docxD');
  if (docxBtn) docxBtn.onclick = async () => {
    docxBtn.disabled = true; docxBtn.textContent = '导出中…';
    try {
      const r = await api('/api/docx', { method: 'POST', body: JSON.stringify({ assetId: a.id }) });
      toast('已导出 ' + r.name);
      window.open(r.url, '_blank');
    } catch (e) { toast('导出失败：' + e.message, true); }
    docxBtn.disabled = false; docxBtn.textContent = '导出 .docx';
  };
  const delBtn = drawer.querySelector('#delD');
  if (delBtn) delBtn.onclick = async () => { await api('/api/asset/' + a.id, { method: 'DELETE' }); toast('已移入回收站'); close(); loadAssets(tab); };
  const rsBtn = drawer.querySelector('#rsD');
  if (rsBtn) rsBtn.onclick = async () => { await api(`/api/asset/${a.id}/restore`, { method: 'POST' }); toast('已恢复'); close(); loadAssets(tab); };
  const hdBtn = drawer.querySelector('#hdD');
  if (hdBtn) hdBtn.onclick = async () => { await api('/api/asset/' + a.id + '?hard=1', { method: 'DELETE' }); toast('已彻底删除'); close(); loadAssets(tab); };
  const imgBtn = drawer.querySelector('#imgD');
  if (imgBtn) imgBtn.onclick = async () => {
    const prompt = window.prompt('配图 Prompt（可粘贴 Agent 给出的配图规划）', a.title);
    if (!prompt) return;
    imgBtn.disabled = true; imgBtn.textContent = '生成中…';
    try {
      const r = await api('/api/image', { method: 'POST', body: JSON.stringify({ prompt, title: a.title }) });
      // 成功后保存为图片资产
      toast('配图已生成：' + (r.asset ? r.asset.title : ''));
      close(); loadAssets(tab);
    } catch (e) {
      // 失败：Prompt 存档，不丢工作
      await api('/api/assets', { method: 'POST', body: JSON.stringify({ type: 'image', title: '配图Prompt · ' + a.title, content: prompt, pending: true, sourceAssetId: a.id }) });
      toast('生图失败：' + e.message + '（Prompt 已存档）', true);
      close(); loadAssets(tab);
    }
  };
  const vidBtn = drawer.querySelector('#vidD');
  if (vidBtn) vidBtn.onclick = async () => {
    const prompt = window.prompt('视频 Prompt（建议写清镜头、动作、节奏）', a.title);
    if (!prompt) return;
    vidBtn.disabled = true; vidBtn.textContent = '提交中…';
    try {
      const r = await api('/api/video', { method: 'POST', body: JSON.stringify({ prompt, title: a.title }) });
      toast('视频任务已提交，约 3–6 分钟出片');
      close(); loadAssets(tab); pollAsset(r.asset.id, tab);
    } catch (e) { toast('建任务失败：' + e.message, true); vidBtn.disabled = false; vidBtn.textContent = '生成视频'; }
  };
}

/* ---------- 使用台账 ---------- */
const KIND_CN = { chat: '对话', subagent: '子 Agent', automate: '批量生成', image: '生图', video: '视频' };
async function viewLedger(v, arg) {
  $('#tbTitle').textContent = '使用台账';
  const days = +(arg || S.ledgerDays || 30);
  S.ledgerDays = days;
  let j;
  try { j = await api('/api/ledger?days=' + days + '&pageSize=80'); }
  catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const s = j.summary, org = j.org;
  const unit = (S.boot.org && S.boot.org.unit) || '积分';
  const maxDay = Math.max(1, ...s.byDay.map(d => d.credits));
  const maxAny = Math.max(1, ...s.byModel.map(d => d.credits), ...s.byMember.map(d => d.credits), ...s.byKind.map(d => d.credits));
  const bar = (val, max, cls) => `<div class="lb-track ${cls || ''}"><i style="width:${Math.max(2, Math.min(100, (val / max) * 100))}%"></i></div>`;
  const rows = (arr, mk) => arr.length ? arr.slice(0, 12).map(mk).join('') : '<div class="lb-none">暂无数据</div>';

  v.innerHTML = `
  <div class="lg-hero">
    <div class="lg-card">
      <div class="lg-k">账上余额</div>
      <div class="lg-v">${fmtFull(org.balance)}<span>${esc(unit)}</span></div>
      <div class="lg-sub">累计消耗 ${fmtFull(org.used || 0)} · 历史全部 ${fmtFull(j.allTime.credits)}</div>
    </div>
    <div class="lg-card">
      <div class="lg-k">近 ${days} 天消耗</div>
      <div class="lg-v">${fmtFull(s.credits)}<span>${esc(unit)}</span></div>
      <div class="lg-sub">${s.calls} 次调用 · ${fmtK(s.tokens)} tokens</div>
    </div>
    <div class="lg-card">
      <div class="lg-k">单次平均</div>
      <div class="lg-v">${s.calls ? (s.credits / s.calls).toFixed(1) : '0'}<span>${esc(unit)}</span></div>
      <div class="lg-sub">按模型单价 × token 折算</div>
    </div>
  </div>

  <div class="lg-toolbar">
    <div class="lg-seg">${[7, 30, 90].map(d => `<button class="lg-seg-btn ${d === days ? 'on' : ''}" data-days="${d}">近 ${d} 天</button>`).join('')}</div>
    <span style="flex:1"></span>
    <a class="btn ghost small" href="/api/ledger.csv?days=${days}" download>导出 CSV</a>
  </div>

  ${(() => {
    const a = j.audit || {};
    const drift = a.rateDrift && !a.tokenGapOk;
    const ok = a.balanced && (a.tokenGapOk || drift);
    return `<div class="lg-audit ${ok ? 'ok' : 'bad'}">
      <div class="la-head">${ok ? '✓ 账本自洽' : '! 账本有差额'} <span>余额 = 期初 + 充值 − 台账合计</span></div>
      <div class="la-row">
        <span>期初 <b>${fmtFull(a.opening)}</b></span>
        <span>充值 <b>${fmtFull(a.recharged)}</b></span>
        <span>已扣 <b>${fmtFull(a.totalCredits)}</b></span>
        <span>余额 <b>${fmtFull(a.balance)}</b></span>
        <span>按台账应为 <b>${fmtFull(a.expectBalance)}</b></span>
        <span>token 应扣 <b>${fmtFull(a.shouldCredits)}</b> / 实扣 <b>${fmtFull(a.tokenChargedCredits != null ? a.tokenChargedCredits : a.chargedCredits)}</b></span>
        ${a.backfillCredits ? `<span>历史补记 <b>${fmtFull(a.backfillCredits)}</b></span>` : ''}
      </div>
      <div class="la-note">${drift ? '价目已变更：差额来自历史费率，不是错账。' : ''}${a.backfillCredits ? `另有 <b>${fmtFull(a.backfillCredits)}</b> 是早期调用的补记（当时只有用量汇总、没留逐笔明细），已从余额里扣，但不参与 token 对账——所以它单列，不算差额。` : ''}积分按 token 单价折算（config.billing.modelRate，或 modelRate2 入/出分开价），<b>不是</b>任何外部平台返回的余额。真实扣费发生在 TokenSpace（对话）与火山方舟（生图/生视频）账户。</div>
    </div>`;
  })()}

  <div class="lg-grid">
    <div class="lg-panel">
      <div class="lg-ph">按天</div>
      <div class="lg-days">${s.byDay.length ? s.byDay.slice(0, 14).map(d => `
        <div class="lg-day">
          <span class="lg-dl">${esc(String(d.key).slice(5))}</span>
          ${bar(d.credits, maxDay)}
          <span class="lg-dv">${Math.round(d.credits)}</span>
        </div>`).join('') : '<div class="lb-none">暂无数据</div>'}</div>
    </div>
    <div class="lg-panel">
      <div class="lg-ph">按类型</div>
      ${rows(s.byKind, d => `<div class="lg-line"><span class="lg-n">${esc(KIND_CN[d.key] || d.key)}</span>
        ${bar(d.credits, maxAny)}<span class="lg-vv">${Math.round(d.credits)}</span></div>`)}
    </div>
    <div class="lg-panel">
      <div class="lg-ph">按模型</div>
      ${rows(s.byModel, d => `<div class="lg-line"><span class="lg-n mono">${esc(d.key)}</span>
        ${bar(d.credits, maxAny)}<span class="lg-vv">${Math.round(d.credits)}</span></div>`)}
    </div>
    <div class="lg-panel">
      <div class="lg-ph">按成员</div>
      ${rows(s.byMember, d => `<div class="lg-line"><span class="lg-n">${esc(d.key)}</span>
        ${bar(d.credits, maxAny)}<span class="lg-vv">${Math.round(d.credits)}</span></div>`)}
    </div>
    <div class="lg-panel">
      <div class="lg-ph">按 Box</div>
      ${rows(s.byBox, d => `<div class="lg-line"><span class="lg-n">${esc(d.key)}</span>
        ${bar(d.credits, maxAny)}<span class="lg-vv">${Math.round(d.credits)}</span></div>`)}
    </div>
  </div>

  <div class="lg-panel" style="margin-top:14px">
    <div class="lg-ph">明细分录 <span class="badge">最近 ${j.total} 条</span></div>
    <table class="topic-table lg-table"><thead><tr>
      <th style="width:132px">时间</th><th style="width:82px">类型</th><th>模型 / 说明</th>
      <th style="width:96px">成员</th><th style="width:104px">token</th><th style="width:76px">积分</th>
    </tr></thead><tbody>
    ${j.list.length ? j.list.map(e => `<tr>
      <td style="color:var(--sub);font-size:12px">${fmtTime(e.ts)}</td>
      <td><span class="dim-chip k-${esc(e.kind)}">${esc(KIND_CN[e.kind] || e.kind)}</span></td>
      <td><div class="mono" style="font-size:12px">${esc(e.model || '—')}</div>
        <div class="t-content">${esc(e.note || e.agentName || '')}</div></td>
      <td style="font-size:12px">${esc(e.memberName || '—')}</td>
      <td style="font-size:12px;color:var(--sub)">${e.in || e.out ? num(e.in || 0) + ' / ' + num(e.out || 0) : '—'}</td>
      <td style="font-weight:600">${e.credits}</td>
    </tr>`).join('') : '<tr><td colspan="6" style="color:var(--sub);padding:18px">还没有消耗记录，去对话或批量生成几篇就有了</td></tr>'}
    </tbody></table>
  </div>`;

  v.querySelectorAll('[data-days]').forEach(el => el.onclick = () => { location.hash = '#/ledger/' + el.dataset.days; });
}

/* ---------- 企业控制台 ---------- */
async function viewOrg(v) {
  $('#tbTitle').textContent = '企业控制台';
  let j;
  try { j = await api('/api/org'); } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const unit = j.org.unit || '积分';
  const mem = S.boot.member || {};
  const roleCn = { owner: '所有者', editor: '编辑', viewer: '只读' };
  const pct = m => m.quota ? Math.min(100, Math.round((m.used || 0) / m.quota * 100)) : 0;

  v.innerHTML = `
  <div class="org-head">
    <div>
      <div class="org-name">${esc(j.org.name)}</div>
      <div class="org-sub">${j.members.length} 名成员 · 当前身份 <b>${esc(mem.name || '')}</b></div>
    </div>
    <span style="flex:1"></span>
    <button class="btn ghost small" id="renameOrg">改组织名</button>
  </div>

  <div class="lg-hero" style="margin-bottom:14px">
    <div class="lg-card">
      <div class="lg-k">可用余额</div>
      <div class="lg-v">${fmtFull(j.org.balance)}<span>${esc(unit)}</span></div>
      <div class="lg-sub">期初 ${fmtFull(j.org.opening || 0)} + 充值 ${fmtFull(j.org.recharged || 0)} − 已用 ${fmtFull(j.org.used || 0)}</div>
    </div>
    <div class="lg-card" style="grid-column:span 2">
      <div class="lg-k">充值</div>
      <div class="org-recharge">
        <input type="number" id="rcAmount" placeholder="输入积分数量" min="1" step="1000">
        ${[10000, 50000, 100000].map(n => `<button class="btn ghost small" data-quick="${n}">+${num(n)}</button>`).join('')}
        <button class="btn primary small" id="rcBtn">充值</button>
      </div>
      <div class="lg-sub">余额 ≤ 0 时对话会被拦下（原型里的充值，不接真实支付）</div>
    </div>
  </div>

  ${(() => {
    const a = j.audit || {};
    const drift = a.rateDrift && !a.tokenGapOk;
    const ok = a.balanced && (a.tokenGapOk || drift);
    return `<div class="lg-audit ${ok ? 'ok' : 'bad'}">
      <div class="la-head">${ok ? '✓ 账本自洽' : '! 账本有差额'} <span>余额 = 期初 + 充值 − 台账合计（不可手改余额，只能记账或调账）</span></div>
      <div class="la-row">
        <span>期初 <b>${fmtFull(a.opening)}</b></span>
        <span>充值 <b>${fmtFull(a.recharged)}</b></span>
        <span>台账合计 <b>${fmtFull(a.totalCredits)}</b></span>
        <span>余额 <b>${fmtFull(a.balance)}</b></span>
        <span>按台账应为 <b>${fmtFull(a.expectBalance)}</b></span>
        <span>token 应扣 <b>${fmtFull(a.shouldCredits)}</b> / 实扣 <b>${fmtFull(a.tokenChargedCredits != null ? a.tokenChargedCredits : a.chargedCredits)}</b></span>
        ${a.backfillCredits ? `<span>历史补记 <b>${fmtFull(a.backfillCredits)}</b></span>` : ''}
      </div>
      <div class="la-note">${drift ? '价目已变更：差额来自历史费率，不是错账。' : ''}${a.backfillCredits ? `另有 <b>${fmtFull(a.backfillCredits)}</b> 是早期调用的补记（当时只有用量汇总、没留逐笔明细），已从余额扣出，但不参与 token 对账。` : ''}积分为本系统内部核算单位：token 用量 × 单价（config.billing.modelRate，或 modelRate2 入/出分开价，每 1k token 折算），生图按张、视频按秒；真实扣费发生在 TokenSpace（对话）与火山方舟（生图/生视频）账户。</div>
    </div>`;
  })()}

  <div class="lg-panel">
    <div class="lg-ph">成员与额度
      <span style="flex:1"></span>
      <button class="btn ghost small" id="addMember">+ 添加成员</button>
    </div>
    <table class="topic-table"><thead><tr>
      <th>成员</th><th style="width:90px">角色</th><th style="width:120px">登录账号</th>
      <th style="width:190px">额度使用</th><th style="width:100px">已用</th><th style="width:110px">操作</th>
    </tr></thead><tbody>
    ${j.members.map(m => `<tr data-mid="${m.id}">
      <td><b>${esc(m.name)}</b>${m.role === 'owner' ? '<span class="dim-chip" style="margin-left:6px">主账号</span>' : ''}</td>
      <td style="font-size:12px">${roleCn[m.role] || m.role}</td>
      <td>${m.id === mem.id ? '<span class="cur-tag">当前</span>' : '<span style="font-size:12px;color:var(--sub)">—</span>'}</td>
      <td>${m.quota ? `<div class="lb-track org-q"><i style="width:${pct(m)}%"></i></div>
        <div style="font-size:11px;color:var(--sub)">${Math.round(m.used || 0)} / ${num(m.quota)}（${pct(m)}%）</div>`
      : '<span style="font-size:12px;color:var(--sub)">不限额度</span>'}</td>
      <td style="font-weight:600">${Math.round(m.used || 0)}</td>
      <td>
        <button class="btn ghost small" data-edit="${m.id}">改额度</button>
        ${m.role === 'owner' ? '' : `<button class="btn danger small" data-del="${m.id}">删</button>`}
      </td>
    </tr>`).join('')}
    </tbody></table>
    <div class="rate-note">这里是「记账主体」，决定花谁的额度。谁能登录、什么角色，去 <a href="#/accounts" style="color:var(--brand)">账号与权限</a> 管。</div>
  </div>

  <div class="lg-panel" style="margin-top:14px">
    <div class="lg-ph">计费口径（config.json → billing）</div>
    <div class="rate-grid">
      ${Object.entries(j.rates2 || {}).length
      ? Object.entries(j.rates2).map(([m, r]) => `<div class="rate-item"><span class="mono">${esc(m)}</span><b>${r.in} / ${r.out}</b><em>${esc(unit)}/千token（入 / 出）</em></div>`).join('')
      : Object.entries(j.rates).map(([m, r]) => `<div class="rate-item"><span class="mono">${esc(m)}</span><b>${r}</b><em>${esc(unit)}/千token</em></div>`).join('')}
    </div>
    <div class="rate-note">${Object.entries(j.rates2 || {}).length ? '入 / 出 分开计价（modelRate2）。' : '入出同价（modelRate）。'}<br>
      媒体：生图 ${j.media.image} ${esc(unit)}/张 · 视频按秒计价
      ${Object.entries(j.media.videoPerSecond || {}).map(([k, v]) => `<br><span class="mono">${esc(k)}</span> → ${v} ${esc(unit)}/秒`).join('')}</div>
  </div>`;

  const refresh = () => api('/api/bootstrap').then(b => { S.boot = b; renderShell(); viewOrg($('#view')); });
  $('#renameOrg').onclick = async () => {
    const n = window.prompt('组织名称', j.org.name);
    if (!n || !n.trim()) return;
    await api('/api/org', { method: 'PATCH', body: JSON.stringify({ name: n.trim() }) });
    toast('已改名'); refresh();
  };
  $('#rcBtn').onclick = async () => {
    const c = +$('#rcAmount').value;
    if (!c || c <= 0) return toast('填个正数', true);
    const r = await api('/api/org/recharge', { method: 'POST', body: JSON.stringify({ credits: c }) });
    toast('已充值 ' + c + '，当前余额 ' + Math.round(r.balance));
    refresh();
  };
  v.querySelectorAll('[data-quick]').forEach(b => b.onclick = () => { $('#rcAmount').value = b.dataset.quick; });
  $('#addMember').onclick = async () => {
    const name = window.prompt('成员名字');
    if (!name || !name.trim()) return;
    const q = window.prompt('月度额度（积分，留空表示不限）', '60000');
    try {
      await api('/api/members', { method: 'POST', body: JSON.stringify({ name: name.trim(), role: 'editor', quota: q ? +q : 0 }) });
      toast('已添加成员'); refresh();
    } catch (e) { toast(e.message, true); }
  };
  v.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
    const m = j.members.find(x => x.id === b.dataset.edit);
    const q = window.prompt('额度（0 = 不限）', String(m.quota || 0));
    if (q == null) return;
    await api('/api/member/' + m.id, { method: 'PATCH', body: JSON.stringify({ quota: +q || 0 }) });
    toast('已更新'); refresh();
  });
  v.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!window.confirm('删除这个成员？（历史台账保留）')) return;
    try {
      await api('/api/member/' + b.dataset.del, { method: 'DELETE' });
      toast('已删除'); refresh();
    } catch (e) { toast(e.message, true); }
  });
}

/* ---------- 搜索记录 ---------- */
function viewRecords(v) {
  $('#tbTitle').textContent = '全部记录';
  v.innerHTML = `
  <div class="search-row"><input type="text" id="recSearch" placeholder="搜索对话内容 / 资产标题与正文（留空显示全部会话）" style="max-width:none"></div>
  <div class="lg-toolbar" id="recFilter">
    <div class="lg-seg">
      <button class="lg-seg-btn on" data-src="all">全部</button>
      <button class="lg-seg-btn" data-src="local">本地新建</button>
      <button class="lg-seg-btn" data-src="imported">历史归档</button>
    </div>
  </div>
  <div id="recBox"><div class="empty">加载中…</div></div>`;

  let src = 'all';

  const paintList = async () => {
    const j = await api('/api/conversations?limit=1000');
    let rows = j.list || [];
    if (src === 'local') rows = rows.filter(c => !c.imported);
    if (src === 'imported') rows = rows.filter(c => c.imported);
    const imp = rows.filter(c => c.imported).length;
    $('#recBox').innerHTML = `
      <div class="rec-head">
        <span>共 <b>${rows.length}</b> 条会话 · 历史归档 <b>${imp}</b> · 本地新建 <b>${rows.length - imp}</b></span>
        <span class="rec-hint">点任意一条打开；历史归档标「归档」，原文链接在对话顶部</span>
      </div>
      <div class="rec-list">
      ${rows.map(c => `
        <div class="rec-row" data-cid="${c.id}">
          <div class="rec-main">
            <div class="rec-title">${c.imported ? '<em class="cv-src" title="来自历史归档">归档</em>' : ''}${esc(c.title || '(无标题)')}</div>
            <div class="rec-meta">
              ${c.agentName ? '<span class="rec-tag">' + esc(c.agentName) + '</span>' : ''}
              ${c.imported && c.imported.boxName ? '<span class="rec-tag ghost">' + esc(c.imported.boxName) + '</span>' : ''}
              <span>${c.turns} 条消息</span>
              <span>${fmtTime(c.updatedAt || c.created)}</span>
            </div>
          </div>
          <span class="rec-go">→</span>
        </div>`).join('') || '<div class="empty">这个筛选下没有会话</div>'}
      </div>`;
    $('#recBox').querySelectorAll('.rec-row').forEach(el => {
      el.onclick = () => { location.hash = '#/chat/' + el.dataset.cid; };
    });
  };

  v.querySelectorAll('#recFilter .lg-seg-btn').forEach(b => b.onclick = () => {
    v.querySelectorAll('#recFilter .lg-seg-btn').forEach(x => x.classList.toggle('on', x === b));
    src = b.dataset.src;
    paintList();
  });

  const runSearch = debounce(async () => {
    const q = $('#recSearch').value.trim();
    if (!q) { paintList(); return; }
    const j = await api('/api/search?q=' + encodeURIComponent(q));
    $('#recBox').innerHTML = `
      <div class="rec-head"><span>命中对话 ${j.conversations.length} · 资产 ${j.assets.length}</span>
        <span class="rec-hint">清空搜索框回到全部会话</span></div>
      <div class="agent-list">
      ${j.conversations.map(c => `<div class="agent-card" onclick="location.hash='#/chat/${c.id}'">
        <div class="avatar">💬</div><div class="ac-main"><div class="ac-name">${esc(c.title)}</div>
        <div class="ac-desc">${esc(c.snippet)}</div></div></div>`).join('')}
      ${j.assets.map(a => `<div class="agent-card" onclick="location.hash='#/assets'">
        <div class="avatar">${a.type === 'image' ? '🖼' : a.type === 'video' ? '🎬' : '📄'}</div>
        <div class="ac-main"><div class="ac-name">${esc(a.title)}</div>
        <div class="ac-desc">${esc(a.snippet)}</div></div></div>`).join('')}
      </div>${(j.conversations.length + j.assets.length) ? '' : '<div class="empty">没有命中</div>'}`;
  }, 300);
  $('#recSearch').oninput = runSearch;
  paintList();
}

/* ---------- 账号与权限（管理员） ---------- */
const ROLE_CN = { owner: '所有者', admin: '管理员', member: '成员' };
function statusChip(s) {
  if (s === 'active') return '<span class="st-chip on">已启用</span>';
  if (s === 'disabled') return '<span class="st-chip off">已停用</span>';
  return '<span class="st-chip none">未开通</span>';
}
async function viewAccounts(v) {
  let j;
  try { j = await api('/api/users'); }
  catch (e) {
    v.innerHTML = `<div class="empty">${e.message === '需要管理员权限' ? '这个页面只有管理员能进' : esc(e.message)}</div>`;
    return;
  }
  const meU = S.boot.user || {};
  const invite = j.invite || {};
  const rows = j.list.slice().sort((a, b) => {
    const rank = r => (r === 'owner' ? 0 : r === 'admin' ? 1 : 2);
    return rank(a.role) - rank(b.role) || String(a.name).localeCompare(String(b.name), 'zh');
  });
  v.innerHTML = `
  <div class="lg-wrap">
    <div class="lg-title-row">
      <div>
        <div class="lg-h1">账号与权限</div>
        <div class="org-sub">${rows.length} 个身份 · ${rows.filter(r => r.status === 'active').length} 个可登录 · 每个人的会话、资产、账单只有自己看得见</div>
      </div>
      <span style="flex:1"></span>
      <button class="btn primary small" id="newAcc">+ 开通账号</button>
    </div>

    <div class="lg-panel" style="margin-bottom:14px">
      <div class="lg-ph">邀请码注册
        <span style="flex:1"></span>
        <label class="sw-wrap"><input type="checkbox" id="invOpen" ${invite.open ? 'checked' : ''}><span>开放自助注册</span></label>
      </div>
      <div class="inv-row">
        <input id="invCode" class="inv-code" value="${esc(invite.code || '')}" readonly placeholder="还没生成">
        <button class="btn ghost small" id="invCopy">复制</button>
        <button class="btn ghost small" id="invReset">重新生成</button>
      </div>
      <div class="rate-note">关掉开关后，拿着旧码也注册不了；已经注册的账号不受影响。不想让陌生人进来就保持关闭，用「开通账号」逐个给。</div>
    </div>

    <div class="lg-panel">
      <div class="lg-ph">身份清单</div>
      <table class="topic-table acc-table"><thead><tr>
        <th>姓名 / 账号</th><th style="width:96px">角色</th><th style="width:88px">状态</th>
        <th style="width:170px">额度使用</th><th style="width:110px">操作</th>
      </tr></thead><tbody>
      ${rows.map(u => {
    const quota = u.quota || 0;
    const used = u.used || 0;
    const p = quota > 0 ? Math.min(100, Math.round(used / quota * 100)) : 0;
    const self = u.id && u.id === meU.id;
    return `<tr data-uid="${u.id || ''}" data-mid="${u.memberId || ''}">
          <td>
            <div class="acc-name">${esc(u.name)}${self ? '<span class="cur-tag" style="margin-left:6px">你</span>' : ''}</div>
            <div class="acc-sub">${u.username ? '@' + esc(u.username) : '还没有登录账号'}</div>
          </td>
          <td><span class="role-chip ${u.role}">${ROLE_CN[u.role] || u.role}</span></td>
          <td>${statusChip(u.status)}</td>
          <td>${quota ? `<div class="lb-track org-q"><i style="width:${p}%"></i></div>
              <div class="acc-sub">${fmtFull(used)} / ${fmtFull(quota)}</div>`
        : `<span class="acc-sub">不限（随组织余额）</span>`}</td>
          <td>
            ${u.id ? `<button class="btn ghost small" data-act="pwd" ${u.role === 'owner' && !meU.admin ? 'disabled' : ''}>重置密码</button>
              ${self || u.role === 'owner' ? '<span class="acc-sub" style="margin-left:6px">—</span>'
        : `<button class="btn ghost small" data-act="toggle">${u.status === 'active' ? '停用' : '启用'}</button>`}`
        : `<button class="btn ghost small" data-act="open">开通</button>`}
          </td>
        </tr>`;
  }).join('')}
      </tbody></table>
      <div class="rate-note">停用会立刻把这个人踢下线（不用等 cookie 过期）。只有所有者能设管理员、能停用管理员。</div>
    </div>
  </div>`;

  const reload = () => { S.boot = null; boot(); };
  $('#newAcc').onclick = () => openAccountDialog();
  $('#invOpen').onchange = async e => {
    try { await api('/api/org/invite', { method: 'POST', body: JSON.stringify({ open: e.target.checked }) }); toast(e.target.checked ? '已开放自助注册' : '已关闭自助注册'); }
    catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
  };
  $('#invReset').onclick = async () => {
    try { const r = await api('/api/org/invite', { method: 'POST', body: JSON.stringify({ reset: true }) }); $('#invCode').value = r.invite.code; toast('已换成新邀请码'); }
    catch (err) { toast(err.message, true); }
  };
  $('#invCopy').onclick = () => {
    const el = $('#invCode');
    if (!el.value) return toast('还没有邀请码，先点「重新生成」', true);
    el.select(); document.execCommand && document.execCommand('copy'); toast('已复制');
  };

  v.querySelectorAll('button[data-act]').forEach(btn => {
    btn.onclick = async () => {
      const tr = btn.closest('tr');
      const uid = tr.dataset.uid, mid = tr.dataset.mid;
      const act = btn.dataset.act;
      if (act === 'open') return openAccountDialog({ memberId: mid });
      if (act === 'pwd') {
        try {
          const r = await api('/api/users/' + uid + '/password', { method: 'POST', body: JSON.stringify({}) });
          showTempPassword(r.tempPassword);
        } catch (e) { toast(e.message, true); }
        return;
      }
      if (act === 'toggle') {
        const turningOff = btn.textContent.trim() === '停用';
        if (turningOff && !confirm('停用后这个人立刻被踢下线，确定？')) return;
        try {
          await api('/api/users/' + uid + '/status', { method: 'POST', body: JSON.stringify({ status: turningOff ? 'disabled' : 'active' }) });
          toast(turningOff ? '已停用' : '已启用');
          reload();
        } catch (e) { toast(e.message, true); }
      }
    };
  });
}
function showTempPassword(pw) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal" style="width:400px">
    <div class="m-title">临时密码</div>
    <div class="m-sub">只显示这一次。发给对方后，让他登录后自己改掉。</div>
    <div class="tmp-pw">${esc(pw)}</div>
    <div class="m-foot"><button class="btn primary" id="tpOk">我记住了</button></div>
  </div>`;
  document.body.appendChild(mask);
  mask.querySelector('#tpOk').onclick = () => mask.remove();
}
function openAccountDialog(pre) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal" style="width:440px">
    <div class="m-title">开通账号</div>
    <div class="m-sub">账号就是身份：这个人登录后看到的会话、资产、账单都只属于他。</div>
    <div class="field"><label>显示名</label><input id="naName" placeholder="例如：内容组 · 小陈"></div>
    <div class="field"><label>登录名</label><input id="naUser" placeholder="字母数字，3–24 位" autocomplete="off"></div>
    <div class="field"><label>初始密码</label><input id="naPass" placeholder="至少 8 位，含字母和数字" autocomplete="new-password"></div>
    <div class="field"><label>角色</label>
      <select id="naRole"><option value="member">成员（只能用，不能管）</option><option value="admin">管理员（能管 Agent 与人）</option></select>
    </div>
    <div class="field"><label>额度（积分，0 = 不限额）</label><input id="naQuota" type="number" min="0" step="1000" value="20000"></div>
    <div class="m-err" id="naErr" style="display:none"></div>
    <div class="m-foot"><button class="btn ghost" id="naCancel">取消</button><button class="btn primary" id="naOk">开通</button></div>
  </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.onclick = e => { if (e.target === mask) close(); };
  mask.querySelector('#naCancel').onclick = close;
  const err = mask.querySelector('#naErr');
  mask.querySelector('#naOk').onclick = async () => {
    const body = {
      name: mask.querySelector('#naName').value.trim(),
      username: mask.querySelector('#naUser').value.trim(),
      password: mask.querySelector('#naPass').value,
      role: mask.querySelector('#naRole').value,
      quota: Number(mask.querySelector('#naQuota').value) || 0
    };
    if (pre && pre.memberId) body.memberId = pre.memberId;
    if (!body.name || !body.username) { err.textContent = '显示名和登录名都要填'; err.style.display = 'block'; return; }
    const btn = mask.querySelector('#naOk'); btn.disabled = true; btn.textContent = '开通中…';
    try {
      await api('/api/users', { method: 'POST', body: JSON.stringify(body) });
      close(); toast('账号已开通');
      S.boot = null; boot();
    } catch (e) {
      err.textContent = e.message; err.style.display = 'block';
      btn.disabled = false; btn.textContent = '开通';
    }
  };
  mask.querySelector('#naName').focus();
}

/* ---------- 入口 ---------- */
(async function start() {
  try {
    // 先探登录态：未登录直接出登录页，不打 /api/bootstrap（否则控制台一条 401 红字，外行以为坏了）
    const st = await fetch('/api/auth/state').then(r => r.json()).catch(() => ({ authed: false }));
    if (!st || !st.authed) return renderLogin();
    await boot();
    location.hash = location.hash || '#/chat';
    if (!localStorage.getItem('sbGuideSeen')) {
      localStorage.setItem('sbGuideSeen', '1');
      setTimeout(showGuide, 500);
    }
  }
  catch (e) { renderLogin(); }
})();
