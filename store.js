'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const uid = () => crypto.randomUUID();
const identity = require('./lib/identity');

// 走 token 计费的台账类型（adjust+backfill 是历史补记，也算 token 计费）
const TOKEN_KINDS = ['chat', 'subagent', 'automate'];

class Store {
  constructor(dir, billing) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    this.billing = billing || {};
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(this.file)) {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } else {
      this.data = {
        boxes: [], agents: [], topics: [], conversations: [],
        tasks: [], assets: [],
        usage: { calls: 0, totalIn: 0, totalOut: 0, perModel: {}, perDay: {} },
        seededAt: null
      };
    }
    // 兼容旧库：增量补字段（不重写已有数据）
    if (!Array.isArray(this.data.ledger)) this.data.ledger = [];
    if (!Array.isArray(this.data.members)) this.data.members = [];
    if (!this.data.org) {
      this.data.org = {
        name: (this.billing && this.billing.room) || '内容中台',
        opening: (this.billing && this.billing.balance) || 0,
        recharged: 0,
        balance: (this.billing && this.billing.balance) || 0,
        used: 0,
        createdAt: Date.now()
      };
    }
    // 期初额度与充值必须分开：opening 是配置里的初始额度，recharged 只记真实充值
    if (this.data.org.opening == null) {
      this.data.org.opening = (this.billing && this.billing.balance) || 0;
      // 旧库把初始额度也算进了 recharged，这里剔掉，避免重复计入
      const seed = this.data.org.opening;
      if (this.data.org.recharged >= seed) this.data.org.recharged = this.data.org.recharged - seed;
      else this.data.org.recharged = 0;
    }
    if (!Array.isArray(this.data.users)) this.data.users = [];
    if (!this.data.uploads) this.data.uploads = [];
    // 累计计费额：台账只保留最近 5000 条，光靠台账求和会在长跑后对不上账。
    // 这里单独维护一个单调递增的累计数，首次启动从现有台账回填。
    // 口径只说 token 类：历史补记（adjust+backfill）是人工按积分补的，没有对应的 token 数，
    // 混进来会让「token 应扣 vs 已扣」凭空差几千分，看起来像错账。
    if (this.data.usage && this.data.usage.tokenCredits == null) {
      this.data.usage.tokenCredits = Math.round(this.data.ledger
        .filter(e => TOKEN_KINDS.includes(e.kind))
        .reduce((s, e) => s + (e.credits || 0), 0) * 100) / 100;
    }
    // Agent「挂起」：原平台没有启停开关，账号主人靠改名加「（挂起）」来标记停用。
    // 这里把命名约定一次性固化成独立字段，之后改名不会意外改变启停状态。
    let suspMigrated = false;
    for (const a of this.data.agents || []) {
      if (typeof a.suspended !== 'boolean') {
        a.suspended = /挂起/.test(a.name || '');
        suspMigrated = true;
      }
    }
    // 启动即对账：余额永远由账本推导，杜绝「手改余额」留下的不平账
    this.reconcile();
    if (suspMigrated) this.saveNow();
    this._t = null;
  }
  save() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.saveNow(), 250);
  }
  saveNow() {
    clearTimeout(this._t);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  // 单价：每 1k token 折算多少积分（单一价，老口径，保留兼容）
  rateOf(model) {
    const b = this.billing || {};
    const map = b.modelRate || {};
    return map[model] != null ? map[model] : (b.defaultRate || 1);
  }

  /**
   * 输入/输出分开的单价（积分 / 1k token）。
   * 上游按「输入一个价、输出 5 倍价」计费，单一价会在长文场景系统性少收，
   * 所以支持 modelRate2 = { 模型: { in, out } }；没配就退回单一价，行为与旧版完全一致。
   */
  ratesOf(model) {
    const b = this.billing || {};
    const two = (b.modelRate2 || {})[model];
    if (two && (two.in != null || two.out != null)) {
      const base = this.rateOf(model);
      return {
        in: two.in != null ? Number(two.in) : base,
        out: two.out != null ? Number(two.out) : base,
        split: true
      };
    }
    const flat = this.rateOf(model);
    return { in: flat, out: flat, split: false };
  }

  /** 一个模型、一组 token 数 → 应扣积分。全系统只有这一处算法 */
  creditsFor(model, inTok, outTok) {
    const r = this.ratesOf(model);
    return Math.round(((inTok || 0) / 1000 * r.in + (outTok || 0) / 1000 * r.out) * 100) / 100;
  }

  /** token 用量记账：既进 usage 汇总，也进 ledger 明细 + 扣余额 */
  recordUsage(model, usage, ctx) {
    const c = ctx || {};
    const u = this.data.usage;
    u.calls++;
    let inTok = (usage && (usage.prompt_tokens || (usage.input_tokens || 0))) || 0;
    let outTok = (usage && (usage.completion_tokens || (usage.output_tokens || 0))) || 0;
    // 上游没回 usage（网关异常/流被截断）时不能静默记 0，否则这一轮白送。
    // 用字符数兜底估算，并在台账上打 estimated 标记，事后可查。
    let estimated = false;
    if (!inTok && !outTok && (c.estInChars || c.estOutChars)) {
      inTok = Math.round((c.estInChars || 0) / 1.6);
      outTok = Math.round((c.estOutChars || 0) / 1.6);
      estimated = true;
    }
    u.totalIn += inTok; u.totalOut += outTok;
    const pm = u.perModel[model] = u.perModel[model] || { calls: 0, in: 0, out: 0 };
    pm.calls++; pm.in += inTok; pm.out += outTok;
    const day = new Date().toISOString().slice(0, 10);
    const pd = u.perDay[day] = u.perDay[day] || { calls: 0, in: 0, out: 0 };
    pd.calls++; pd.in += inTok; pd.out += outTok;

    const rate = this.rateOf(model);
    const rates = this.ratesOf(model);
    const credits = this.creditsFor(model, inTok, outTok);
    this.charge({
      kind: c.kind || 'chat', model, in: inTok, out: outTok, rate,
      rateIn: rates.in, rateOut: rates.out, estimated: estimated || undefined,
      credits,
      agentId: c.agentId || null, agentName: c.agentName || null,
      boxId: c.boxId || null, memberId: c.memberId || null, memberName: c.memberName || null,
      ownerId: c.ownerId || null,
      conversationId: c.conversationId || null, note: c.note || ''
    });
    this.save();
    return { in: inTok, out: outTok, credits, estimated };
  }

  /** 媒体计费（图片按张、视频按秒）；按模型/尺寸分档优先于统一价 */
  recordMedia(kind, meta) {
    const b = this.billing || {};
    const media = b.media || {};
    let credits = 0;
    if (kind === 'image') {
      const byModel = (media.imageByModel || {})[meta.model];
      const bySize = (media.imageBySize || {})[meta.size];
      credits = bySize != null ? bySize : (byModel != null ? byModel : (media.image || 20));
    } else if (kind === 'video') {
      const per = (media.videoPerSecond || {})[meta.model] != null ? media.videoPerSecond[meta.model] : 20;
      credits = per * (Number(meta.duration) || 5);
    } else credits = media[kind] || 0;
    return this.charge({
      kind, model: meta.model || '', in: 0, out: 0, rate: 0, credits,
      agentId: meta.agentId || null, agentName: meta.agentName || null,
      boxId: meta.boxId || null, memberId: meta.memberId || null, memberName: meta.memberName || null,
      ownerId: meta.ownerId || null,
      note: String(meta.note || '').slice(0, 120)
    });
  }

  /**
   * 余额只有一个真相源：opening + recharged - sum(ledger.credits)
   * 任何地方都不再「顺手改 balance」，改账只能写台账，余额由账本推导。
   */
  reconcile() {
    const org = this.data.org;
    const used = Math.round(this.data.ledger.reduce((s, e) => s + (e.credits || 0), 0) * 100) / 100;
    org.used = used;
    org.balance = Math.round(((org.opening || 0) + (org.recharged || 0) - used) * 100) / 100;
    // 成员用量同样从台账推导，避免两套账
    for (const m of this.data.members) {
      m.used = Math.round(this.data.ledger.filter(e => e.memberId === m.id)
        .reduce((s, e) => s + (e.credits || 0), 0) * 100) / 100;
    }
    return org;
  }

  /** 写一条台账并重算余额；余额不足时 credits 照记但标记 over */
  charge(e) {
    const item = Object.assign({ id: uid(), ts: Date.now(), day: new Date().toISOString().slice(0, 10) }, e);
    if (!item.memberName) {
      const m = this.data.members.find(x => x.id === item.memberId) || this.data.members[0];
      if (m) { item.memberId = item.memberId || m.id; item.memberName = item.memberName || m.name; }
    }
    const org = this.data.org;
    item.over = Math.round(((org.opening || 0) + (org.recharged || 0) - (org.used || 0) - item.credits) * 100) / 100 < 0;
    this.data.ledger.unshift(item);
    // 累计计费额（不受台账截断影响）
    if (TOKEN_KINDS.includes(item.kind) || (item.kind === 'adjust' && item.backfill)) {
      const u = this.data.usage;
      u.tokenCredits = Math.round(((u.tokenCredits || 0) + (item.credits || 0)) * 100) / 100;
    }
    if (this.data.ledger.length > 5000) this.data.ledger.length = 5000;
    this.reconcile();
    this.save();
    return item;
  }

  /** 人工调账 / 历史补记：差额写成一条台账，保证 balance 恒等于账本结果 */
  adjust(credits, note, kind, backfill) {
    return this.charge({
      kind: kind || 'adjust', model: '', in: 0, out: 0, rate: 0,
      credits: Math.round(credits * 100) / 100, note: note || '', backfill: !!backfill
    });
  }

  /**
   * 余额增减（正数加余额、负数减余额）——这是人对账的思维，和「消耗额」相反。
   * 内部换算成消耗额记账，避免每次调用方都要自己取负号（之前就是这里写反了）。
   */
  adjustBalance(delta, note, kind) {
    return this.adjust(-Number(delta || 0), note, kind || 'adjust');
  }

  /**
   * 对账：把「按 token 全量应扣」与「实际已扣」比对。
   * 已扣额取 usage.tokenCredits（单调累计，不受台账 5000 条截断影响），
   * 台账可见部分只作为参考，避免长跑后历史被截断导致假报警。
   */
  audit(rateOf) {
    const org = this.data.org;
    const u = this.data.usage;
    const priceOf = m => {
      if (!rateOf) return this.ratesOf(m);
      const r = rateOf(m);
      return (r && typeof r === 'object') ? r : { in: r, out: r };
    };
    let should = 0;
    for (const [model, v] of Object.entries(u.perModel || {})) {
      const r = priceOf(model);
      should += (v.in || 0) / 1000 * (r.in || 0) + (v.out || 0) / 1000 * (r.out || 0);
    }
    should = Math.round(should * 100) / 100;
    // 台账里的 token 记账行（不含历史补记，补记没有 token 依据，不能拿去对 token）
    const ledgerTokens = this.data.ledger.filter(e => TOKEN_KINDS.includes(e.kind) && !e.voided);
    const ledgerCredits = Math.round(ledgerTokens.reduce((s, e) => s + (e.credits || 0), 0) * 100) / 100;
    // 历史补记：早期只有 usage 汇总、没有逐笔台账的那部分调用，单独列出来，
    // 否则「应扣」看不见它、「已扣」又算了它，对账会平白多出一笔假差额。
    const backfillCredits = Math.round(this.data.ledger
      .filter(e => e.kind === 'adjust' && e.backfill && !e.voided)
      .reduce((s, e) => s + (e.credits || 0), 0) * 100) / 100;
    const charged = Math.round((u.tokenCredits != null ? u.tokenCredits : ledgerCredits + backfillCredits) * 100) / 100;
    const tokenCharged = Math.round((charged - backfillCredits) * 100) / 100;
    const tokenGap = Math.round((should - tokenCharged) * 100) / 100;
    // 价目漂移：历史台账记的单价与当前价目不同（改过价就会漂移，属正常，需单独说明）
    const driftRows = ledgerTokens.filter(e => {
      if (e.kind === 'adjust' || !e.model) return false;
      const r = this.ratesOf(e.model);
      const ri = e.rateIn != null ? e.rateIn : e.rate;
      const ro = e.rateOut != null ? e.rateOut : e.rate;
      return Math.abs(ri - r.in) > 1e-9 || Math.abs(ro - r.out) > 1e-9;
    }).length;
    const totalCredits = Math.round(this.data.ledger.reduce((s, e) => s + (e.credits || 0), 0) * 100) / 100;
    const expectBalance = Math.round(((org.opening || 0) + (org.recharged || 0) - totalCredits) * 100) / 100;
    return {
      opening: org.opening || 0,
      recharged: org.recharged || 0,
      balance: org.balance,
      expectBalance,
      balanced: Math.abs(expectBalance - org.balance) < 0.01,
      usageCalls: u.calls || 0,
      ledgerTokenCalls: ledgerTokens.length,
      shouldCredits: should,
      chargedCredits: charged,
      tokenChargedCredits: tokenCharged,
      backfillCredits,
      ledgerTokenCredits: ledgerCredits,
      tokenGap,
      // 价目没变时，差额必须为 0；价目变过则差额来自历史费率，不算错账
      tokenGapOk: Math.abs(tokenGap) < 1,
      rateDrift: driftRows > 0,
      rateDriftRows: driftRows,
      totalCredits,
      tokens: (u.totalIn || 0) + (u.totalOut || 0)
    };
  }

  // ---------- 成员 ----------
  ensureMembers(seed) {
    if (this.data.members.length) return this.data.members;
    for (const m of (seed || [])) {
      this.data.members.push({
        id: 'mb-' + uid().slice(0, 8), name: m.name, role: m.role || 'editor',
        quota: m.quota || 0, used: 0, active: true, createdAt: Date.now()
      });
    }
    this.save();
    return this.data.members;
  }

  // ---------- 账号 ----------
  findUser(id) { return this.data.users.find(u => u.id === id) || null; }
  findUserByName(username) {
    const u = String(username || '').trim().toLowerCase();
    return this.data.users.find(x => x.username === u) || null;
  }
  owner() { return this.data.users.find(u => u.role === 'owner') || this.data.users[0] || null; }

  /**
   * 首次启动把「单账号 + 成员标签」升级成真实账号体系：
   * config.auth 那一个账号 → owner；其余成员保持「未开通账号」，由管理员在界面开通。
   * 同时把没有归属的历史数据判给 owner —— 不判给 owner 的话，这些数据会变成
   * 「谁都看不见」或者更糟「谁都看得见」，两种都不可接受。
   *
   * 幂等：users 非空就直���返回，不会重复迁移、也不会把新数据乱改归属。
   */
  ensureUsers(authCfg) {
    const d = this.data;
    const out = { created: 0, adopted: {} };
    if (d.users.length) return out;

    const username = String((authCfg && authCfg.username) || 'admin').toLowerCase();
    const pass = String((authCfg && authCfg.password) || '');
    const mem = d.members.find(m => m.name === username) || d.members[0] || null;
    const { salt, passHash } = identity.hashPassword(pass || identity.tempPassword(16));
    const boss = {
      id: 'u-' + uid().slice(0, 8),
      username,
      name: mem ? mem.name : username,
      salt, passHash,
      role: 'owner',
      status: 'active',
      memberId: mem ? mem.id : null,
      createdAt: Date.now(),
      lastLoginAt: null,
      migratedFrom: 'config.auth'
    };
    d.users.push(boss);
    out.created = d.users.length;

    // 历史数据归属：只有第一次迁移、且只补没有 ownerId 的
    for (const [coll, label] of [['conversations', '会话'], ['assets', '资产'], ['uploads', '上传'], ['ledger', '台账']]) {
      let n = 0;
      for (const it of (d[coll] || [])) {
        if (!it.ownerId) { it.ownerId = boss.id; n++; }
      }
      if (n) out.adopted[label] = n;
    }
    this.saveNow();
    return out;
  }

  /** 建账号。username 唯一性、密码强度由上层校验后传入 */
  createUser({ username, name, password, role, memberId }) {
    const u = String(username).trim().toLowerCase();
    if (this.findUserByName(u)) return { error: '用户名已存在' };
    const { salt, passHash } = identity.hashPassword(password);
    const user = {
      id: 'u-' + uid().slice(0, 8),
      username: u,
      name: String(name || u).trim().slice(0, 24),
      salt, passHash,
      role: ['owner', 'admin', 'member'].includes(role) ? role : 'member',
      status: 'active',
      memberId: memberId || null,
      createdAt: Date.now(),
      lastLoginAt: null
    };
    this.data.users.push(user);
    this.save();
    return { user };
  }

  setPassword(id, plain) {
    const u = this.findUser(id);
    if (!u) return { error: '账号不存在' };
    const { salt, passHash } = identity.hashPassword(plain);
    u.salt = salt; u.passHash = passHash;
    u.pwdChangedAt = Date.now();
    delete u.mustChangePassword;
    this.save();
    return { user: u };
  }

  setStatus(id, status) {
    const u = this.findUser(id);
    if (!u) return { error: '账号不存在' };
    if (u.role === 'owner') return { error: '所有者账号不可停用' };
    u.status = status === 'disabled' ? 'disabled' : 'active';
    this.save();
    return { user: u };
  }

  setRole(id, role) {
    const u = this.findUser(id);
    if (!u) return { error: '账号不存在' };
    if (u.role === 'owner') return { error: '所有者角色不可变更' };
    if (!['admin', 'member'].includes(role)) return { error: '角色不合法' };
    u.role = role;
    this.save();
    return { user: u };
  }

  touchLogin(id) {
    const u = this.findUser(id);
    if (u) { u.lastLoginAt = Date.now(); this.save(); }
  }
}
module.exports = { Store };
