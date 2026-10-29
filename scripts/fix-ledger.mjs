'use strict';
/**
 * 账本修复（一次性，可重复执行且幂等）
 *
 * 修的是什么：
 * 1. 旧库把「配置初始额度」也算进了 recharged，导致期初和充值混在一起 → 拆成 opening / recharged
 * 2. v1 时期 usage 汇总先于台账存在，有 39 次调用的 token 计了数但没扣积分 → 补一条 adjust 台账
 * 3. 余额曾被直接改写（PATCH /api/org），导致 balance ≠ opening + recharged - used → 由账本推导
 *
 * 幂等保证：补记只在 tokenGap >= 1 时执行，重复跑不会重复补。
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const cfg = require(path.join(ROOT, 'config.json'));
const { Store } = require(path.join(ROOT, 'store.js'));

const dbFile = path.join(ROOT, 'data', 'db.json');
if (fs.existsSync(dbFile)) {
  const bak = dbFile + '.bak-' + Date.now();
  fs.copyFileSync(dbFile, bak);
  console.log('已备份 →', path.basename(bak));
}

const store = new Store(path.join(ROOT, 'data'), cfg.billing);
const fmt = a => ({
  期初: a.opening, 充值: a.recharged, 余额: a.balance,
  应扣: a.shouldCredits, 已扣: a.ledgerTokenCredits, token缺口: a.tokenGap,
  账本合计: a.totalCredits, 按账本应为: a.expectBalance, 平账: a.balanced
});

console.log('\n--- 修复前 ---');
console.log(fmt(store.audit(m => store.rateOf(m))));

const before = store.audit(m => store.rateOf(m));
if (Math.abs(before.tokenGap) >= 1) {
  const missingCalls = Math.max(0, before.usageCalls - before.ledgerTokenCalls);
  store.adjust(
    before.tokenGap,
    'v1 早期调用补记：' + missingCalls + ' 次调用的 token 已计入 usage 但未入台账',
    'adjust',
    true
  );
  console.log('已补记', before.tokenGap, '积分（' + missingCalls + ' 次调用）');
} else {
  console.log('token 台账无缺口，跳过补记');
}

store.reconcile();
store.saveNow();

console.log('\n--- 修复后 ---');
const after = store.audit(m => store.rateOf(m));
console.log(fmt(after));
console.log('\n余额 =', after.expectBalance, '| 平账:', after.balanced ? '✅ 是' : '❌ 否');
