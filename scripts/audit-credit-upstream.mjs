// 对账：本系统「积分消耗」是否与上游（tokenspace / New API）真实计费一致
// 用法：node scripts/audit-credit-upstream.mjs [--credit=0.01] [--fx=7.2]
// 数据源：
//   data/db.json            本地账本 + 累计 usage
//   data/price-calib.json   上游单价标定结果（scripts/calibrate-upstream-price.mjs 产出）
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const db = JSON.parse(fs.readFileSync(path.join(root, 'data/db.json'), 'utf8'));
const calibFile = path.join(root, 'data/price-calib.json');
const calib = fs.existsSync(calibFile) ? JSON.parse(fs.readFileSync(calibFile, 'utf8')) : {};

const arg = (k, d) => {
  const hit = process.argv.find(a => a.startsWith('--' + k + '='));
  return hit ? +hit.split('=')[1] : d;
};
const CREDIT_CNY = arg('credit', 0.01);   // 1 积分对外卖多少钱
const FX = arg('fx', 7.2);                // 美元兑人民币

// 兜底单价（已实测标定的写在这里，标定文件优先）
const KNOWN = {
  'claude-sonnet-4-6': { inPerM: 3, outPerM: 15 },
  'claude-haiku-4-5-20251001': { inPerM: 1, outPerM: 5 },
  'claude-opus-5-5': { inPerM: 4, outPerM: 20 }
};
const priceOf = m => {
  const c = calib[m];
  // 合理性闸门：入出价比落在 1.5–10 倍之间才算标定成功（标定噪声会解出离谱的值）
  if (c && !c.error && c.inPerM > 0 && c.outPerM / c.inPerM >= 1.5 && c.outPerM / c.inPerM <= 10) {
    return { ...c, src: 'calib' };
  }
  if (KNOWN[m]) return { ...KNOWN[m], ratio: KNOWN[m].outPerM / KNOWN[m].inPerM, src: 'known' };
  return null;
};

const r2 = n => Math.round(n * 100) / 100;
const r4 = n => Math.round(n * 10000) / 10000;

// ---------- 1. 口径核验：账本 vs 累计 usage ----------
const tokRows = db.ledger.filter(e => ['chat', 'subagent', 'automate'].includes(e.kind));
const backfill = db.ledger.filter(e => e.kind === 'adjust' && e.backfill);
const ledIn = tokRows.reduce((s, e) => s + (e.in || 0), 0);
const ledOut = tokRows.reduce((s, e) => s + (e.out || 0), 0);
const ledCredits = r2(tokRows.reduce((s, e) => s + (e.credits || 0), 0));
const fillCredits = r2(backfill.reduce((s, e) => s + (e.credits || 0), 0));

const u = db.usage;
let should = 0;
for (const [m, v] of Object.entries(u.perModel || {})) should += ((v.in || 0) + (v.out || 0)) / 1000 * (cfg.billing.modelRate[m] ?? cfg.billing.defaultRate);
should = r2(should);

const recon = {
  usageCalls: u.calls,
  ledgerTokenRows: tokRows.length,
  backfillRows: backfill.length,
  usageIn: u.totalIn, usageOut: u.totalOut,
  ledgerIn: ledIn, ledgerOut: ledOut,
  backfillInMissing: u.totalIn - ledIn,
  shouldCredits: should,
  ledgerTokenCredits: ledCredits,
  backfillCredits: fillCredits,
  tokenGap: r2(should - ledCredits - fillCredits),
  org: db.org
};
recon.tokenGapOk = Math.abs(recon.tokenGap) < 1;
recon.balanceOk = Math.abs((db.org.opening + db.org.recharged - db.ledger.reduce((s, e) => s + (e.credits || 0), 0)) - db.org.balance) < 0.01;

// ---------- 2. 成本核算：每个模型我们收了多少积分 vs 上游扣了多少钱 ----------
const perModel = [];
for (const [m, v] of Object.entries(u.perModel || {})) {
  const rate = cfg.billing.modelRate[m] ?? cfg.billing.defaultRate;
  const creditsCharged = r2(((v.in || 0) + (v.out || 0)) / 1000 * rate);
  const p = priceOf(m);
  const usd = p ? ((v.in || 0) / 1e6 * p.inPerM + (v.out || 0) / 1e6 * p.outPerM) : null;
  const outShare = (v.out || 0) / Math.max(1, (v.in || 0) + (v.out || 0));
  const tokens = (v.in || 0) + (v.out || 0);
  perModel.push({
    model: m, calls: v.calls, in: v.in, out: v.out, outShare: r4(outShare),
    ratePer1k: rate, creditsCharged, tokens,
    upIn: p ? p.inPerM : null, upOut: p ? p.outPerM : null,
    usd: usd == null ? null : r4(usd),
    // 我们按当前积分价收到的钱（折算成美元），与上游成本比就是这一档模型的毛利
    revenueUsd: r4(creditsCharged * CREDIT_CNY / FX),
    margin: usd ? r4(1 - usd / Math.max(1e-9, creditsCharged * CREDIT_CNY / FX)) : null,
    priceSrc: p ? p.src : 'missing'
  });
}
perModel.sort((a, b) => b.creditsCharged - a.creditsCharged);
const totalUsd = r2(perModel.reduce((s, x) => s + (x.usd || 0), 0));

// ---------- 3. 全站口径 ----------
const allCredits = r2(db.ledger.reduce((s, e) => s + (e.credits || 0), 0));
const tokenCredits = r2(tokRows.reduce((s, e) => s + (e.credits || 0), 0) + fillCredits);
const mediaCredits = r2(db.ledger.filter(e => ['image', 'video'].includes(e.kind)).reduce((s, e) => s + (e.credits || 0), 0));
const costPerCreditUsd = totalUsd / Math.max(1, tokenCredits);   // 只按 token 部分摊
const revenueUsd = tokenCredits * CREDIT_CNY / FX;
const margin = 1 - totalUsd / Math.max(1e-9, revenueUsd);

// ---------- 4. 输出占比敏感性：现行「单一价」下毛利率随输出占比怎么塌 ----------
const sono = perModel.find(x => x.model === (cfg.defaultModel || 'claude-sonnet-4-6'));
const rate1k = sono ? sono.ratePer1k : cfg.billing.defaultRate;
const up = priceOf(sono ? sono.model : 'claude-sonnet-4-6') || { inPerM: 3, outPerM: 15 };
const sens = [0, 0.01, 0.05, 0.2, 0.5, 0.9].map(s => {
  const costPerM = (1 - s) * up.inPerM + s * up.outPerM;          // $/M
  const revenuePerM = 1000 * rate1k * CREDIT_CNY / FX;            // $/M
  return {
    outShare: s, costPerM: r2(costPerM), revenuePerM: r2(revenuePerM),
    margin: r4(1 - costPerM / Math.max(1e-9, revenuePerM))
  };
});

// ---------- 5. 建议定价表（成本加成） ----------
const K = arg('k', 2.8);   // 目标加成倍数
const snap = x => Math.round(x * 2) / 2;   // 取整到 0.5，价目表要好记
const propose = perModel.filter(x => x.upIn).map(x => {
  const inRaw = x.upIn * FX / CREDIT_CNY / 1e6 * 1000 * K;   // 积分/1k
  const ratio = x.upOut / x.upIn;
  const newIn = snap(inRaw);
  return {
    model: x.model,
    nowIn: x.ratePer1k, nowOut: x.ratePer1k,
    newIn, newOut: snap(newIn * ratio),
    ratio: r2(ratio)
  };
});

const out = {
  params: { creditCNY: CREDIT_CNY, fx: FX, markup: K },
  recon, perModel,
  totals: {
    allCredits, tokenCredits, mediaCredits,
    upstreamUsd: totalUsd,
    usdPerCredit: r4(costPerCreditUsd),
    cnyPerCredit: r4(costPerCreditUsd * FX),
    revenueUsdAtList: r2(revenueUsd),
    grossMargin: r4(margin)
  },
  sens, propose,
  auditGapOk: Math.abs(recon.tokenGap) < 1
};

const pct = x => (x * 100).toFixed(1) + '%';
console.log('\n=== 1. 账本 vs 累计 usage ===');
console.log(`调用次数：usage ${recon.usageCalls} 次 / 台账 token 行 ${recon.ledgerTokenRows} 条 + 补记 ${recon.backfillRows} 条`);
console.log(`token：usage 入 ${recon.usageIn} 出 ${recon.usageOut}｜台账 入 ${recon.ledgerIn} 出 ${recon.ledgerOut}（缺口 ${recon.backfillInMissing}，已由补记覆盖）`);
console.log(`应扣积分 ${recon.shouldCredits}｜台账已扣 ${recon.ledgerTokenCredits} + 补记 ${recon.backfillCredits}｜差额 ${recon.tokenGap}（${recon.tokenGapOk ? '口径一致' : '不一致'}）`);
console.log(`余额：opening ${recon.org.opening} + 充值 ${recon.org.recharged} - 消耗 ${r2(allCredits)} = ${recon.org.balance}｜闭环 ${recon.balanceOk ? 'OK' : '不平'}`);

console.log('\n=== 2. 每个模型：我们收 vs 上游扣 ===');
console.log(['模型', 'tokens', '输出占比', '现行积分/1k', '收积分', '上游$/M in/out', '上游成本$', '收入$', '毛利'].join(' | '));
for (const x of perModel) {
  console.log([x.model, x.tokens, pct(x.outShare), x.ratePer1k, x.creditsCharged,
  x.upIn == null ? '未标定' : `${x.upIn}/${x.upOut}`, x.usd ?? '-',
  x.revenueUsd, x.margin == null ? '-' : pct(x.margin)].join(' | '));
}

console.log('\n=== 3. 全站 ===');
console.log(`总消耗 ${allCredits} 积分（token ${tokenCredits} + 媒体 ${mediaCredits} + 调账净额）`);
console.log(`上游真实成本 ≈ $${totalUsd}（token 部分），折合 1 积分成本 $${r4(costPerCreditUsd)} ≈ ¥${r4(costPerCreditUsd * FX)}`);
console.log(`若按 1 积分 = ¥${CREDIT_CNY} 收费：收入 $${r2(revenueUsd)}，毛利 ${pct(margin)}`);

console.log('\n=== 4. 现行「入出同价」的敏感性（' + (sono ? sono.model : '') + '） ===');
for (const s of sens) console.log(`输出占比 ${pct(s.outShare).padStart(6)} → 成本 $${s.costPerM}/M，收入 $${s.revenuePerM}/M，毛利 ${pct(s.margin)}`);

console.log('\n=== 5. 建议定价（成本 ×' + K + '，1 积分 = ¥' + CREDIT_CNY + '） ===');
for (const x of propose) console.log(`${x.model}: 现在 ${x.nowIn}/${x.nowOut} → 建议 ${x.newIn}/${x.newOut} 积分/1k（入/出，比 ${x.ratio}×）`);

fs.writeFileSync(path.join(root, 'data/billing-audit.json'), JSON.stringify(out, null, 1));
console.log('\nJSON -> data/billing-audit.json');
