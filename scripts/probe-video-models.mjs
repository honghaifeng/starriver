// 探测 Seedance 各型号可用参数：提交最小规格任务，记录建单结果与最终状态
const BASE = 'https://ark.cn-beijing.volces.com/api/v3';
const KEY = 'ca52afc0-2a87-4555-bff5-e2c1585d393f';
const H = { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

const MODELS = process.argv.slice(2).length ? process.argv.slice(2) : [
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128',
  'doubao-seedance-2-0-mini-260615',
];

const cases = [
  '--resolution 720p --ratio 16:9 --duration 5',
];

const tasks = [];
for (const model of MODELS) {
  for (const extra of cases) {
    const text = 'A calm sunrise over a still lake, slow camera push in, cinematic' + ' ' + extra;
    let r, j;
    try {
      r = await fetch(BASE + '/contents/generations/tasks', {
        method: 'POST', headers: H,
        body: JSON.stringify({ model, content: [{ type: 'text', text }] }),
      });
      j = await r.json().catch(() => null);
    } catch (e) {
      console.log(`[${model}] 网络错误 ${e.message}`);
      continue;
    }
    if (!r.ok) {
      console.log(`[${model}] ✗ 建单失败 ${r.status} :: ${JSON.stringify(j).slice(0, 300)}`);
      continue;
    }
    console.log(`[${model}] ✓ 建单成功 id=${j.id}`);
    tasks.push({ model, id: j.id, extra });
  }
}

if (!tasks.length) process.exit(0);
console.log('\n--- 轮询 ---');
const done = new Set();
for (let i = 0; i < 200 && done.size < tasks.length; i++) {
  for (const t of tasks) {
    if (done.has(t.id)) continue;
    let j;
    try {
      const r = await fetch(BASE + '/contents/generations/tasks/' + t.id, { headers: H });
      j = await r.json().catch(() => null);
    } catch { continue; }
    if (!j) continue;
    if (j.status === 'succeeded') {
      done.add(t.id);
      console.log(`[${t.model}] ✓ 出片 ${t.id} -> ${(j.content && j.content.video_url || '').slice(0, 90)} usage=${JSON.stringify(j.usage)}`);
    } else if (j.status === 'failed' || j.status === 'expired') {
      done.add(t.id);
      console.log(`[${t.model}] ✗ ${j.status} ${JSON.stringify(j.error || {}).slice(0, 300)}`);
    }
  }
  if (done.size < tasks.length) await new Promise(s => setTimeout(s, 6000));
}
console.log('\n未完成：' + tasks.filter(t => !done.has(t.id)).map(t => t.model + '/' + t.id).join(', ') || '无');
