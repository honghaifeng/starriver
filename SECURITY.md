# 安全策略

## 报告漏洞

本产品处理的是客户的营销素材、账号与账单，安全问题优先级高于新功能。

- **不要**在公开 issue 里贴可复现的攻击步骤、密钥或客户数据。
- 请直接联系产品负责人（或在内部工单系统开「安全」类工单），附上：
  1. 复现步骤（curl 或浏览器操作序列）；
  2. 影响范围（能否拿到他人数据 / 能否消耗他人额度 / 能否提权）；
  3. 你的环境（版本、部署方式、是否公网可访问）。

我们会在 24 小时内确认收到，并在修复后告知结论。

## 本项目的安全模型（摘要）

| 层 | 机制 | 位置 |
|---|---|---|
| 身份 | 用户名 + 密码，scrypt 加盐哈希（`N=16384` 默认参数），恒定时间比对 | `lib/identity.js` |
| 会话 | 服务端 `sid` Cookie（HttpOnly、SameSite=Lax），落盘 7 天，重启不掉线 | `server.js` `whoami()` |
| 限流 | 同一「用户名 + 来源 IP」连续失败 5 次锁 5 分钟；账号不存在与密码错误同提示同计次 | `server.js` `failHit()` |
| 授权 | 三角色（owner / admin / member），判断集中在 `identity.canRead/canWrite/canManageUsers` | `lib/identity.js` |
| 数据隔离 | 会话 / 资产 / 上传 / 导出件 / 台账全部带 `ownerId`，按 ID 越权一律 **404**（不泄露存在性） | `server.js` |
| 媒体 | `/img` `/vid` `/file` `/export` 未登录 401，跨人 404；资产可显式「团队可见」 | `server.js` `mediaOwner()` |
| 额度 | 组织余额 ≤ 0 → 402；成员额度用满 → 402；身份只来自登录态，不允许前端指定 | `server.js` `handleChat()` |
| 密钥 | 上游 Key 只在 `config.json`（已 gitignore），前端拿不到 | `config.json` |

## 部署者必须做的四件事

1. `config.json` 里的 `auth.password` 改成强密码后**再**启动一次（首次启动会把明文迁移成哈希，之后明文即失效）。
2. 公网部署必须加 HTTPS 反代（Caddy / Nginx），不要直接暴露 `server.js` 的明文端口。
3. `config.json`、`data/` 目录权限收紧到 `600 / 700`，并纳入每日备份。
4. 对外试用前把体验库独立出来（`SB_DATA=data-demo`），别让外人写进正式库。

详见 [docs/05-security.md](docs/05-security.md) 与 [docs/06-deployment.md](docs/06-deployment.md)。
