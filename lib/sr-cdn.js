/**
 * 星河私有素材的七牛签名地址（零依赖）
 *
 * 为什么要有这一层：
 *   星河的图/视频/附件是客户私有素材。以前靠「登录 cookie + 本地文件」保护，
 *   但服务器要背 88MB 媒体、没法走 CDN、多机部署还要同步文件。
 *   改成：文件放七牛【私有空间】，页面地址仍是我们自己的 /img/xxx，
 *   由这里现签一个带有效期的地址 302 过去。鉴权还是 server.js 说了算，
 *   七牛那边还有签名兜底 —— 双保险，且直连七牛裸地址一律 401。
 *
 * 设计取舍：
 *   · e（过期时间）按整点对齐 —— 同一小时内同一文件签出来的 URL 完全一致，
 *     七牛 CDN 才能命中缓存。否则每个请求都是新 URL，等于把 CDN 当源站用。
 *   · 签不出来 / 配置缺失 → 返回 null，调用方回落到本地文件，绝不因七牛挂了而白屏。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONF = process.env.SR_CDN_CONF || '';
let cfg = null;
let confPath = '';
let loadedAt = 0;

function load(force) {
  if (!force && cfg && Date.now() - loadedAt < 60000) return cfg;
  loadedAt = Date.now();
  const candidates = [CONF, path.join(__dirname, '..', 'data', 'sr-cdn.json')].filter(Boolean);
  for (const p of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!raw || !raw.ak || !raw.sk || !raw.host || !raw.map) continue;
      cfg = raw;
      confPath = p;
      return cfg;
    } catch (e) { /* 没有配置就走本地 */ }
  }
  cfg = null;
  return null;
}

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * 七牛私有下载签名（新版时间戳签名）：
 *   token = AK:urlsafe_b64(hmac_sha1(SK, "http://host/key?e=xxx"))
 *   签名内容就是【完整 URL】，不带尾部换行 —— 这点和老的 "path?e=xxx\n" 不一样，
 *   用老格式会稳定报 401 download token auth failed（踩过，别改回去）。
 */
function sign(key, ttl, windowSec) {
  const c = load();
  if (!c) return null;
  const w = windowSec || c.window || 3600;
  const now = Math.floor(Date.now() / 1000);
  const e = (Math.floor(now / w) + 1) * w + (ttl || c.ttl || 7200);
  const base = c.host.replace(/\/+$/, '') + '/' + encodeURI(key) + '?e=' + e;
  const digest = crypto.createHmac('sha1', c.sk).update(base).digest();
  return base + '&token=' + c.ak + ':' + b64u(digest);
}

/**
 * /img/xxx → 七牛签名地址
 * map 里没有这条（新上传、还没跑同步脚本）就按规则现拼，仍然走签名，
 * 只是可能在七牛侧 404 —— 比悄悄退回本地更难发现，所以返回 null 让调用方回落。
 */
function urlFor(pathname) {
  const c = load();
  if (!c) return null;
  const key = c.map[pathname];
  if (!key) return null;
  try {
    return sign(key);
  } catch (e) {
    return null;
  }
}

function stat() {
  const c = load();
  if (!c) return { ready: false };
  return {
    ready: true,
    bucket: c.bucket,
    host: c.host,
    keys: Object.keys(c.map).length,
    conf: confPath
  };
}

module.exports = { urlFor, sign, stat, load };
