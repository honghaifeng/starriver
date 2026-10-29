// 验证：产品图转成的 data URI 能不能被方舟生图接口接受（图生图）
// 这一步如果过不了，前面所有「自动带参考图」的改动都是白搭。
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { refToDataUri } = require('../lib/ref-media.js');
const cfg = require('../config.json');

const IMG = '/Users/v/Desktop/2026/秋峰/Demo/CosmoBounty/knowledge/media/COSMOBOUNTY/ref/white-800/bottle-02.jpg';
if (!fs.existsSync(IMG)) { console.error('找不到测试图:', IMG); process.exit(1); }

const dataUri = refToDataUri(IMG);
console.log('参考图 →', dataUri ? dataUri.slice(0, 32) + '… ' + (dataUri.length / 1024).toFixed(0) + 'KB' : 'null');
if (!dataUri) { console.error('转换失败'); process.exit(1); }

const body = {
  model: cfg.ark.imageModel,
  prompt: '两只补充剂瓶并排放在浅灰色石材台面上，一只是银色瓶盖配银白标签，另一只是金色瓶盖配黑底金字标签，两只瓶身等高等粗、瓶盖等径；清晨左侧柔和斜射光，产品摄影，极简，高清细节',
  size: cfg.ark.imageSize,
  response_format: 'url',
  watermark: false,
  image: [dataUri],
};

const t0 = Date.now();
const r = await fetch(cfg.ark.baseUrl + '/images/generations', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.ark.apiKey },
  body: JSON.stringify(body),
});
const j = await r.json().catch(() => null);
console.log('HTTP', r.status, '| 耗时', ((Date.now() - t0) / 1000).toFixed(1) + 's');
if (!r.ok) {
  console.log('❌ 带参考图生图被拒:', JSON.stringify(j).slice(0, 400));
  process.exit(2);
}
const item = (j.data || [])[0];
console.log('✓ 带参考图生图成功 | size:', item && item.size);
console.log('图片 URL:', item && item.url ? item.url.slice(0, 90) + '…' : '(无)');
if (item && item.url) {
  const out = '/tmp/ref-test.png';
  const buf = Buffer.from(await (await fetch(item.url)).arrayBuffer());
  fs.writeFileSync(out, buf);
  console.log('已存到', out, (buf.length / 1024).toFixed(0) + 'KB');
}
