'use strict';
/**
 * 身份与权限的唯一实现处。
 *
 * 设计取舍：
 * - 密码用 scrypt 加盐哈希，永不落明文；校验走 timingSafeEqual，防计时侧信道。
 * - 角色只有三档：owner（组织所有者，唯一）/ admin（管理员）/ member（普通成员）。
 *   两档"能管"的分开后，将来加"审计员"这类只读角色不用改数据结构。
 * - 判断权限永远用这里的函数，不在业务代码里写 `role === 'admin'`，
 *   否则将来角色一多必然漏改某一处。
 */
const crypto = require('crypto');

const KEYLEN = 32;
const ROLES = { owner: 3, admin: 2, member: 1 };
const ROLE_LABEL = { owner: '所有者', admin: '管理员', member: '成员' };

/** 加盐哈希。salt 可传入以复现（迁移/测试用） */
function hashPassword(plain, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(plain == null ? '' : plain), s, KEYLEN).toString('hex');
  return { salt: s, passHash: h };
}

/** 恒定时间校验：密码错、账号不存在、账号没设密码，一律 false */
function verifyPassword(plain, user) {
  if (!user || !user.passHash || !user.salt) return false;
  const a = crypto.scryptSync(String(plain == null ? '' : plain), user.salt, KEYLEN);
  const b = Buffer.from(user.passHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// 去掉了 0/O/1/l/I 这些念给同事听会出错的字符
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function tempPassword(len = 12) {
  const buf = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  return out;
}

/** 用户名规则：3–24 位，字母数字与 . _ -，不区分大小写（统一存小写） */
function normalizeUsername(raw) {
  const u = String(raw || '').trim().toLowerCase();
  if (!u) return { error: '用户名不能为空' };
  if (!/^[a-z0-9._-]{3,24}$/.test(u)) return { error: '用户名 3–24 位，只能用字母、数字、点、下划线、短横线' };
  return { value: u };
}

/** 密码规则：≥8 位，至少含字母与数字各一。够用且不折腾人，不强制符号 */
function passwordProblem(pw) {
  const s = String(pw == null ? '' : pw);
  if (s.length < 8) return '密码至少 8 位';
  if (s.length > 128) return '密码过长';
  if (!/[a-zA-Z]/.test(s)) return '密码需包含字母';
  if (!/[0-9]/.test(s)) return '密码需包含数字';
  return null;
}

function level(user) {
  if (!user) return 0;
  return ROLES[user.role] || 0;
}
/** 能进入管理区、能改 Agent/Box、能看全组织数据 */
function isAdmin(user) {
  return !!user && (user.role === 'owner' || user.role === 'admin');
}
/** 只有 owner 能授予/撤销 admin，防管理员互相提权 */
function isOwner(user) {
  return !!user && user.role === 'owner';
}
/** 账号是否可用 */
function isActive(user) {
  return !!user && user.status === 'active';
}

/**
 * 归属判定：能看这条数据吗？
 * 管理员放行；普通成员只认自己的 ownerId。
 * 老数据没有 ownerId 时，只有 owner 能看（迁移期兜底，避免"无主数据人人可见"）。
 */
function canRead(user, ownerId) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (!ownerId) return false;
  return ownerId === user.id;
}
/** 能改/删吗？管理员可改自己的与他人会话（管理用途），成员只能碰自己的 */
function canWrite(user, ownerId) {
  if (!user) return false;
  if (!ownerId) return isOwner(user);
  if (ownerId === user.id) return true;
  return isAdmin(user);
}
/** 能管账号吗？ */
function canManageUsers(user) {
  return isAdmin(user);
}

module.exports = {
  ROLES, ROLE_LABEL,
  hashPassword, verifyPassword, tempPassword,
  normalizeUsername, passwordProblem,
  level, isAdmin, isOwner, isActive,
  canRead, canWrite, canManageUsers
};
