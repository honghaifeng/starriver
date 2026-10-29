// 参考图工具：把本地图片转成上游能吃的 data URI，并按提示词挑选该挂哪张产品图。
// 单独成文件是为了能直接单测——这两个函数以前埋在 server.js 里，改错了没人发现。
//
// 背景（2026-10-29）：原来只用 macOS 的 /usr/bin/sips 做压缩，
// Linux 服务器上没有这个命令，于是每次都静默返回 null、悄悄退化成纯文生图。
// 线上 139 张生成图里没有一张真正用上参考图，就是这么来的。

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function mimeOfFile(f) {
  const e = path.extname(String(f || '')).toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.webp') return 'image/webp';
  if (e === '.gif') return 'image/gif';
  return 'image/jpeg';
}

/**
 * 图片文件 → data URI。三级兜底，任何一级成功就返回：
 *   ① sips（macOS 自带，能压到 768px）
 *   ② ffmpeg（Linux 常见，能压到 768px）
 *   ③ 原图直传（读原文件，≤6MB 就发；800×800 白底图约 130–220KB，完全够用）
 * 全部失败返回 null，调用方必须据此判断"这次其实没带参考图"。
 */
function refToDataUri(file) {
  const tmp = path.join(os.tmpdir(), 'cb-ref-' + crypto.randomBytes(4).toString('hex') + '.jpg');
  const cleanup = () => { try { fs.unlinkSync(tmp); } catch (e) { } };

  // ① macOS
  try {
    execFileSync('/usr/bin/sips', ['-Z', '768', '-s', 'format', 'jpeg', file, '--out', tmp], { stdio: 'ignore', timeout: 15000 });
    const buf = fs.readFileSync(tmp); cleanup();
    if (buf.length) return 'data:image/jpeg;base64,' + buf.toString('base64');
  } catch (e) { cleanup(); }

  // ② Linux
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', 'scale=768:-1', '-q:v', '3', tmp], { stdio: 'ignore', timeout: 20000 });
    const buf = fs.readFileSync(tmp); cleanup();
    if (buf.length) return 'data:image/jpeg;base64,' + buf.toString('base64');
  } catch (e) { cleanup(); }

  // ③ 原图直传
  try {
    const buf = fs.readFileSync(file);
    if (buf.length && buf.length <= 6 * 1024 * 1024) {
      return 'data:' + mimeOfFile(file) + ';base64,' + buf.toString('base64');
    }
    if (buf.length) console.error('[ref] 参考图超过 6MB 且无法压缩，已跳过:', file, (buf.length / 1048576).toFixed(1) + 'MB');
  } catch (e) {
    console.error('[ref] 参考图读取失败:', file, e.message);
  }
  return null;
}

/**
 * 按提示词挑一张产品参考图的名字（纯逻辑，可单测）。
 * 目的：锁住两瓶的比例与配色——模型最容易在这里画错，错了最丢人。
 * 只挑 1 张：挂多了会过度约束构图（想拍场景反被白底图带跑）。
 *
 * @param {string} prompt 生成提示词
 * @param {string[]} names 可用的参考图名称列表（应为「产品图·…」前缀）
 * @returns {string|null} 应使用的名称
 */
function pickProductRefName(prompt, names) {
  const p = String(prompt || '');
  const list = (names || []).filter(n => typeof n === 'string' && n);
  if (!p || !list.length) return null;
  // 不是产品图就别插手
  if (!/瓶|礼盒|套装|包装|胶囊|产品|CytoVigor|CytoRenova|COSMO/i.test(p)) return null;

  const find = kw => list.find(n => n.includes(kw)) || null;
  const white = /白瓶|CytoVigor|日活|日间|早上|白天/i.test(p);
  const black = /黑瓶|CytoRenova|夜修|夜间|睡前|晚/i.test(p);
  const boxFirst = /礼盒|开箱|盒装|送人|送礼|外盒/;
  const both = /双瓶|两瓶|两件|一套|同框|两个瓶|合照|并排/.test(p);
  const giftSet = /套装|礼盒|特写对比/.test(p);

  // 礼盒/开箱 优先级最高：这种场景拿瓶图会把盒子画丢
  if (boxFirst.test(p)) return find('礼盒开盖') || find('礼盒') || find('双瓶并排');
  if (both || (white && black)) return find('双瓶并排') || find('双瓶');
  if (white) return find('白瓶正面') || find('白瓶');
  if (black) return find('黑瓶正面') || find('黑瓶');
  if (giftSet) return find('礼盒开盖') || find('双瓶并排');
  return find('双瓶并排') || find('双瓶');
}

module.exports = { refToDataUri, mimeOfFile, pickProductRefName };
