// 计费引擎自测：单一价 / 入出分开价 / 无 usage 兜底 / 台账截断 / 真实库对账
// 全部在临时目录里跑，不碰 data/db.json
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const { Store } = require(path.join(root, 'store.js'));
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? ' → ' + extra : '')); }
};
const near = (a, b, eps = 0.011) => Math.abs(a - b) < eps;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bill-'));

console.log('\n[1] 单一价（老口径，必须与改前完全一致）');
{
  const dir = tmp();
  const s = new Store(dir, cfg.billing);
  const r = s.recordUsage('claude-sonnet-4-6', { prompt_tokens: 1000, completion_tokens: 1000 }, { kind: 'chat' });
  ok(near(r.credits, 8), '1000 入 + 1000 出 @4/1k = 8 积分', r.credits);
  const r2 = s.recordUsage('claude-haiku-4-5-20251001', { prompt_tokens: 100000, completion_tokens: 0 }, { kind: 'chat' });
  ok(near(r2.credits, 100), '10 万入 @1/1k = 100 积分', r2.credits);
  ok(s.data.ledger[0].rateIn === 1 && s.data.ledger[0].rateOut === 1, '台账记下入出单价');
  s.saveNow();
}

console.log('\n[2] 入出分开价');
{
  const dir = tmp();
  const billing = JSON.parse(JSON.stringify(cfg.billing));
  billing.modelRate2 = { 'claude-sonnet-4-6': { in: 4, out: 20 } };
  const s = new Store(dir, billing);
  const r = s.recordUsage('claude-sonnet-4-6', { prompt_tokens: 1000, completion_tokens: 1000 }, { kind: 'chat' });
  ok(near(r.credits, 24), '1000 入 @4 + 1000 出 @20 = 24 积分', r.credits);
  const onlyOut = s.recordUsage('claude-sonnet-4-6', { prompt_tokens: 0, completion_tokens: 1000 }, { kind: 'chat' });
  ok(near(onlyOut.credits, 20), '纯输出 1000 = 20 积分', onlyOut.credits);
  const unknown = s.recordUsage('未配置的模型', { prompt_tokens: 1000, completion_tokens: 0 }, { kind: 'chat' });
  ok(near(unknown.credits, cfg.billing.defaultRate), '未配 modelRate2 的模型退回单一价', unknown.credits);
  s.saveNow();
}

console.log('\n[3] 上游没回 usage 时兜底估算（不能静默记 0）');
{
  const dir = tmp();
  const s = new Store(dir, cfg.billing);
  const r = s.recordUsage('claude-sonnet-4-6', null, { kind: 'chat', estInChars: 1600, estOutChars: 800 });
  ok(r.estimated === true, '标记 estimated');
  ok(r.in === 1000 && r.out === 500, '按 1.6 字符/token 折算', r.in + '/' + r.out);
  ok(r.credits > 0, '不会白送', r.credits);
  const z = s.recordUsage('claude-sonnet-4-6', null, { kind: 'chat' });
  ok(z.credits === 0 && z.estimated === false, '连字符都没有才记 0（可查）');
  s.saveNow();
}

console.log('\n[4] 对账：应扣 = 已扣');
{
  const dir = tmp();
  const s = new Store(dir, cfg.billing);
  s.recordUsage('claude-sonnet-4-6', { prompt_tokens: 5000, completion_tokens: 500 }, {});
  s.recordUsage('claude-sonnet-4-6', { prompt_tokens: 7000, completion_tokens: 900 }, {});
  const a = s.audit();
  ok(a.tokenGapOk && Math.abs(a.tokenGap) < 0.02, 'tokenGap ≈ 0', a.tokenGap);
  ok(a.balanced, '余额 = opening + 充值 - 消耗');
  // 模拟历史场景：39 次调用的 token 进了 usage.perModel，但当时没写台账
  const u = s.data.usage;
  u.perModel['claude-sonnet-4-6'].in += 25000;
  u.totalIn += 25000;
  const gapBefore = s.audit().tokenGap;
  ok(gapBefore > 99, '缺账时能算出差额', gapBefore);
  // 补记只把钱补上，不伪造 token 明细：所以它必须「单列」，且不能用来把 token 差额抹平
  s.adjust(gapBefore, '补记：只进 usage 未入台账的调用', 'adjust', true);
  const b = s.audit();
  ok(Math.abs(b.backfillCredits - gapBefore) < 0.02, '补记额单列出来', b.backfillCredits);
  ok(Math.abs(b.chargedCredits - (b.tokenChargedCredits + b.backfillCredits)) < 0.02, '已扣 = token 记账 + 历史补记');
  ok(b.balanced, '补记后余额仍然 = opening + 充值 − 台帐合计');
  ok(Math.abs(b.tokenGap - gapBefore) < 0.02, '补记不伪装成 token 明细（差额仍在，只是有了说明）', b.tokenGap);
  s.saveNow();
}

console.log('\n[5] 台账截断不影响累计计费额');
{
  const dir = tmp();
  const s = new Store(dir, cfg.billing);
  s.data.ledger = [];
  s.data.usage = { calls: 0, totalIn: 0, totalOut: 0, perModel: {}, perDay: {}, tokenCredits: 0 };
  for (let i = 0; i < 5100; i++) {
    s.recordUsage('claude-haiku-4-5-20251001', { prompt_tokens: 100, completion_tokens: 0 }, {});
  }
  s.saveNow();
  const a = s.audit();
  ok(s.data.ledger.length === 5000, '台账保留 5000 条', s.data.ledger.length);
  ok(near(a.chargedCredits, 510, 0.5), '累计计费额仍是全部 5100 次', a.chargedCredits);
  ok(a.tokenGapOk, '截断后对账不假报警', a.tokenGap);
}

console.log('\n[6] 真实库对账（只读副本）');
{
  const dir = tmp();
  fs.copyFileSync(path.join(root, 'data/db.json'), path.join(dir, 'db.json'));
  const s = new Store(dir, cfg.billing);
  const a = s.audit();
  ok(a.balanced, '余额闭环');
  ok(a.tokenGapOk, '应扣 vs 已扣 差额 < 1 积分', a.tokenGap);
  ok(a.usageCalls > 0 && a.tokens > 0, '累计用量可读', `${a.usageCalls} 次 / ${a.tokens} tokens`);
  console.log(`     应扣 ${a.shouldCredits}｜已扣 ${a.chargedCredits}｜台账可见 ${a.ledgerTokenCredits}｜差额 ${a.tokenGap}`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
