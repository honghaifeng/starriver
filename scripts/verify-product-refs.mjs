// 产品参考图自动匹配的单测：验证「什么提示词该挂哪张产品图」
// 这些名字就是生产环境里上传时的命名，改了命名这条测试会立刻红。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { pickProductRefName } = require('../lib/ref-media');

const NAMES = [
  '产品图·白瓶正面 CytoVigor 60粒.jpg',
  '产品图·双瓶并排合照（证明同高等粗）.jpg',
  '产品图·黑瓶正面微仰 CytoRenova 30粒.jpg',
  '产品图·白瓶微仰 CytoVigor.jpg',
  '产品图·黑瓶俯侧 CytoRenova.jpg',
  '产品图·白瓶俯侧 CytoVigor.jpg',
  '产品图·黑瓶背面（服用方法_警示_条码）.jpg',
  '产品图·白瓶背面（服用方法_警示_条码）.jpg',
  '产品图·黑瓶正面 CytoRenova.jpg',
  '产品图·礼盒开盖内置双瓶.jpg',
  '产品图·礼盒带瓶合影 白底.jpg',
  '产品图·礼盒带瓶 场景底（可直接发社媒）.png',
  '产品图·礼盒合盖正面.jpg',
];

const cases = [
  ['白瓶和黑瓶并排放在早晨的木桌上，两只瓶身等高等粗', '双瓶并排'],
  ['黑瓶特写，夜间暖光，金盖黑标', '黑瓶'],
  ['白瓶特写，清晨侧光，银盖银标', '白瓶'],
  ['礼盒开箱瞬间，黑色哑光硬盒，内衬双瓶', '礼盒开盖'],
  ['送人的礼盒放在餐桌上', '礼盒'],
  ['CytoVigor 摆在办公桌一角', '白瓶'],
  ['CytoRenova 床头柜，睡前氛围', '黑瓶'],
  ['一黑一白两个瓶子同框对比', '双瓶并排'],
  ['清晨的餐桌、一杯温水、打开的窗', null],      // 没有产品词 → 不插手
  ['极简抽象光斑背景', null],
];

let pass = 0, fail = 0;
console.log('【产品参考图自动匹配】');
for (const [prompt, want] of cases) {
  const got = pickProductRefName(prompt, NAMES);
  const ok = want === null ? got === null : (got || '').includes(want);
  if (ok) { pass++; console.log('  ✓', prompt.slice(0, 22), '→', got || '（不挂）'); }
  else { fail++; console.log('  ✗', prompt.slice(0, 22), '→', got || '（不挂）', '| 期望含', want); }
}

// 边界
console.log('\n【边界】');
const edges = [
  ['', null, '空提示词 → 不挂'],
];
for (const [p, want, label] of edges) {
  const got = pickProductRefName(p, NAMES);
  if (got === want) { pass++; console.log('  ✓', label); } else { fail++; console.log('  ✗', label, '→', got); }
}
// 只说「白瓶」两个字也要能挂对
const short = pickProductRefName('白瓶', NAMES);
if (short && short.includes('白瓶')) { pass++; console.log('  ✓ 只说「白瓶」也能挂对'); } else { fail++; console.log('  ✗ 只说「白瓶」→', short); }
const empty = pickProductRefName('白瓶特写', []);
if (empty === null) { pass++; console.log('  ✓ 图库为空时返回 null'); } else { fail++; console.log('  ✗ 图库为空时返回 null'); }

console.log('\n' + '─'.repeat(46));
console.log((fail ? '✗ ' : '✓ ') + '产品参考图匹配：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
