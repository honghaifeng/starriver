/* 品牌验收：春科 · 星河 StarRiver
   要点：
   · 产品名只有一处口径——登录页、侧栏 logo、菜单脚注、页面标题，不许再出现「复刻版 / STARBOX」；
   · 品牌标是 SVG（星 + 水波），随文字色，尺寸由 class 控制；
   · 252px 顶栏里 logo + 积分胶囊 + ⋯ 三者不打架；
   · 历史会话的「归档」标记仍在（不能因为改名把来源证据搞丢）。 */
import { chromium } from './_pw.mjs';
import { USER, PASS } from './_cred.mjs';

const BASE = 'http://127.0.0.1:7777';
// 站点根 / 是对外介绍页；工作台（登录入口）在 /index.html
const APP = BASE + '/index.html';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1360, height: 880 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);

  console.log('\n【〇】对外介绍页（站点根 /）');
  const home = await p.evaluate(() => {
    const q = s => document.querySelector(s);
    const ctas = [...document.querySelectorAll('a')].filter(a => /登录工作台|直接登录工作台/.test(a.textContent));
    return {
      title: document.title,
      h1: (q('h1') || {}).textContent || '',
      cta: ctas.length,
      ctaHref: ctas[0] ? ctas[0].getAttribute('href') : '',
      old: /复刻版|STARBOX Clone/.test(document.body.innerText)
    };
  });
  ok(/春科 · 星河 StarRiver/.test(home.title), '介绍页标题带品牌：' + home.title);
  ok(/AI 内容团队/.test(home.h1), '介绍页主标题是产品主张');
  ok(home.cta > 0 && home.ctaHref === '/index.html', `有「登录工作台」入口指向工作台（${home.cta} 处 / ${home.ctaHref}）`);
  ok(!home.old, '介绍页没有内部旧名');

  await p.goto(APP, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);

  console.log('\n【一】登录页品牌');
  const lg = await p.evaluate(() => {
    const q = s => document.querySelector(s), box = e => e.getBoundingClientRect();
    const mark = q('.lg-brand .lm');
    // 主色以设计令牌 --acc 为准，探针元素把令牌换算成浏览器实际算出的 rgb
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim();
    document.body.appendChild(probe);
    const acc = getComputedStyle(probe).color;
    probe.remove();
    return {
      acc,
      title: document.title,
      h1: q('.login-card h1').textContent.trim(),
      sub: q('.login-card .sub').textContent.replace(/\s+/g, ' ').trim(),
      mark: !!mark,
      markSize: mark ? [Math.round(box(mark).width), Math.round(box(mark).height)] : null,
      markColor: mark ? getComputedStyle(mark).color : '',
      markPaths: mark ? mark.querySelectorAll('path').length : 0,
      cardOverflow: q('.login-card').scrollWidth - q('.login-card').clientWidth,
      favicon: (document.querySelector('link[rel="icon"]') || {}).href || ''
    };
  });
  ok(lg.title === '春科 · 星河 StarRiver · 全域营销内容 AI 工场', '页面标题：' + lg.title);
  ok(lg.h1 === '春科 · 星河', '登录页中文名：' + lg.h1);
  ok(/StarRiver/.test(lg.sub) && /全域营销内容 AI 工场/.test(lg.sub), '英文名 + Slogan：' + lg.sub);
  ok(lg.mark && lg.markSize[0] === 30 && lg.markSize[1] === 30, `品牌标 30×30（实际 ${lg.markSize}）`);
  ok(lg.markPaths === 2, '品牌标两笔：星 + 水波');
  ok(lg.markColor === lg.acc, `品牌标取主色，与 --acc 一致（标 ${lg.markColor} / 令牌 ${lg.acc}）`);
  ok(lg.cardOverflow === 0, '登录卡无横向溢出');
  ok(/^data:image\/svg\+xml/.test(lg.favicon), 'favicon 是内联 SVG');

  console.log('\n【二】侧栏 logo 与顶栏');
  await p.fill('#u', USER);
  await p.fill('#p', PASS);
  await p.click('#loginBtn');
  await p.waitForSelector('.sidebar', { timeout: 15000 }); { const _g = await p.waitForSelector('#guideOk', { timeout: 2500 }).catch(() => null); if (_g) await _g.click(); }
  await p.waitForTimeout(1400);

  const sb = await p.evaluate(() => {
    const q = s => document.querySelector(s), box = e => e.getBoundingClientRect();
    const top = q('.sb-top'), logo = q('.logo');
    const mark = q('.logo .lm');
    return {
      logoText: logo.textContent.replace(/\s+/g, ' ').trim(),
      logoTitle: logo.getAttribute('title') || '',
      markSize: mark ? Math.round(box(mark).width) : null,
      logoClipped: logo.scrollWidth > logo.clientWidth + 1,
      brandRight: Math.round(box(logo).right), sideRight: Math.round(box(q('.sidebar')).right),
      topFits: top.scrollWidth <= top.clientWidth + 1,
      brandInSidebar: !!q('.sidebar .logo'),
      pillsInSidebar: !!q('.sidebar #balToggle') || !!q('.sidebar #cfgToggle'),
      pillsInTopbar: !!q('.topbar #balToggle') && !!q('.topbar #cfgToggle'),
      icoNearRight: Math.round(innerWidth - box(q('#cfgToggle')).right),
      sideOverflowX: q('.sidebar').scrollWidth - q('.sidebar').clientWidth,
      docOverflowX: document.documentElement.scrollWidth - innerWidth
    };
  });
  ok(/春科 · 星河/.test(sb.logoText) && /StarRiver/.test(sb.logoText), '侧栏品牌全名：' + sb.logoText);
  ok(/春科 · 星河 StarRiver/.test(sb.logoTitle), 'logo 悬停给全名：' + sb.logoTitle);
  ok(sb.markSize === 17, `侧栏标 17px（实际 ${sb.markSize}）`);
  ok(!sb.logoClipped, `品牌名没被裁（右边界 ${sb.brandRight}px / 侧栏 ${sb.sideRight}px）`);
  ok(sb.topFits, '侧栏品牌行放得下');
  ok(sb.brandInSidebar && !sb.pillsInSidebar, '品牌在左侧栏顶，积分/管理已不在左侧栏');
  ok(sb.pillsInTopbar, '积分/管理在主区顶栏（窗口最右上角）');
  ok(sb.icoNearRight <= 20, `「⋯」距窗口右边缘 ${sb.icoNearRight}px`);
  ok(sb.sideOverflowX === 0 && sb.docOverflowX === 0, '无横向溢出');

  console.log('\n【三】管理菜单脚注');
  await p.click('#cfgToggle');
  await p.waitForTimeout(360);
  const fp = await p.evaluate(() => {
    const q = s => document.querySelector(s), box = e => e.getBoundingClientRect();
    const f = q('.cf-foot'), pop = q('#cfgPop');
    return {
      brand: (q('.cf-foot-brand') || {}).textContent || '',
      lines: [...f.children].map(e => e.textContent.trim()),
      fits: f.scrollWidth <= f.clientWidth + 1,
      popFits: pop.scrollWidth <= pop.clientWidth + 1,
      inView: box(pop).bottom <= innerHeight + 1 && box(pop).top >= 0
    };
  });
  ok(fp.brand === '春科 · 星河 StarRiver', '菜单脚注品牌行：' + fp.brand);
  ok(fp.lines[1] === '内容中台 · 本地版', '第二行仍是形态说明：' + fp.lines[1]);
  ok(fp.fits && fp.popFits, '脚注与菜单不横向溢出');
  ok(fp.inView, '菜单整体在视口内');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);

  console.log('\n【四】来源标记（改名不能丢证据）');
  await p.evaluate(() => location.hash = '#/records');
  await p.waitForTimeout(1500);
  const rec = await p.evaluate(() => ({
    total: document.querySelectorAll('.rec-row').length,
    tags: [...document.querySelectorAll('.rec-title .cv-src')].map(e => e.textContent.trim()),
    hint: (document.querySelector('.rec-hint') || {}).textContent || ''
  }));
  ok(rec.total > 0, `记录页 ${rec.total} 条`);
  ok(rec.tags.length === 15, `15 条带归档标记（实际 ${rec.tags.length}）`);
  ok(rec.tags.every(t => t === '归档'), '标记文字统一是「归档」：' + [...new Set(rec.tags)].join('/'));
  ok(/标「归档」/.test(rec.hint), '提示文案同步：' + rec.hint.trim());

  console.log('\n【五】旧名残留');
  const stale = await p.evaluate(() => {
    const txt = document.body.innerText;
    const hits = [];
    for (const w of ['星盒复刻版', '复刻版', 'STARBOX Clone']) if (txt.includes(w)) hits.push(w);
    return { hits, title: document.title };
  });
  ok(stale.hits.length === 0, '界面上没有「复刻版 / STARBOX Clone」字样' + (stale.hits.length ? '：' + stale.hits.join('、') : ''));
  ok(!/STARBOX/i.test(stale.title), '标题里没有 STARBOX');
  ok(errs.length === 0, '无 JS 报错' + (errs.length ? '：' + errs.slice(0, 3).join(' | ') : ''));

  await b.close();
  console.log(`\n品牌验收：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
