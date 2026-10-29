# 02 · 配置

> `config.json` 是唯一的配置文件。它含密钥，已在 `.gitignore` 里 —— **永远不要提交**。
> 模板见仓库根目录的 `config.example.json`。

## 1. 最小可用配置

能跑起来、能对话，只需要这几项：

```json
{
  "baseUrl": "https://tokenspace.io",
  "providers": [
    { "id": "claude", "label": "Claude 分组", "apiKey": "sk-你的Key",
      "models": ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"] }
  ],
  "defaultModel": "claude-sonnet-4-6",
  "maxTokens": "4096",
  "auth": { "username": "admin", "password": "换成你的密码8位含字母数字" },
  "port": 7777,
  "billing": {
    "unit": "积分", "room": "春科 · 星河 StarRiver",
    "balance": 200000, "lowBalance": 20000, "defaultRate": 2,
    "modelRate": { "claude-sonnet-4-6": 4 }
  }
}
```

生图/生视频再加 `ark` 段；不加则这两个功能报"未配置"，其他正常。

## 2. 字段全表

### 2.1 上游与模型

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `baseUrl` | string | — | OpenAI 兼容网关，如 `https://tokenspace.io` |
| `providers[]` | object[] | — | 上游分组；不同分组可用不同 Key（便于分账/分流） |
| `providers[].id` | string | — | 内部标识，用于挑 Key |
| `providers[].label` | string | — | 界面展示名 |
| `providers[].apiKey` | string | — | 该组的 Key。**前端永远拿不到** |
| `providers[].models[]` | string[] | — | 该组可用模型 ID；前端模型下拉的数据源 |
| `defaultModel` | string | — | 新会话默认模型 |
| `maxTokens` | string | `"4096"` | 单次生成 token 上限，原样透传上游（注意是字符串） |
| `imageModels[]` | string[] | — | 生图型号候选（方舟侧） |
| `imageSize` | string | `1024x1024` | 默认出图尺寸 |

### 2.2 服务

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `port` | number | `7777` | 监听端口；`PORT` 环境变量优先 |
| `auth.username` / `auth.password` | string | — | **仅首次建库**用于创建 owner，之后明文失效 |
| `kbTotalLimit` | number | `100000` | 单 Agent 知识库总字数上限 |
| `historyLimit` | number | `10` | 带入上下文的历史轮数 |
| `historyMsgCap` | number | `24000` | 上下文总字符硬上限（防超长） |
| `subAgentLimit` | number | `3` | 一次对话内 `call_subagent` 次数上限 |
| `subAgentDepth` | number | `1` | 子智能体嵌套深度 |
| `attachInlineLimit` | number | `6000` | 附件内联阈值；超过改走 `read_file` |

### 2.3 计费

| 字段 | 类型 | 说明 |
|---|---|---|
| `billing.unit` | string | 积分单位名，界面展示用 |
| `billing.room` | string | 组织默认名（首次建库写入 `org.name`） |
| `billing.balance` | number | 期初额度（写入 `org.opening`） |
| `billing.lowBalance` | number | 低额度告警阈值 |
| `billing.defaultRate` | number | 未配置单价的模型按此计 |
| `billing.modelRate` | object | `{模型ID: 每千 token 积分}` |
| `billing.modelRate2` | object | `{模型ID: {in, out}}`，**配了优先于 modelRate** |
| `billing.media.image` | number | 每张图积分 |
| `billing.media.videoPerSecond` | object | `{视频模型ID: 每秒积分}` |

公式与标定方法见 [05-billing.md](05-billing.md)。

### 2.4 生图 / 生视频（火山方舟）

| 字段 | 说明 |
|---|---|
| `ark.baseUrl` | `https://ark.cn-beijing.volces.com/api/v3` |
| `ark.apiKey` | 方舟 Key |
| `ark.imageModel` | 默认生图型号（如 `doubao-seedream-5-0-pro-260628`） |
| `ark.imageSize` | 默认尺寸 |
| `ark.videoDefault` | 用户主动生成视频的默认型号 |
| `ark.videoToolDefault` | 对话内 `generate_video` 工具用的型号（通常选便宜的 Mini） |
| `ark.videoModels[]` | 型号能力表：`{id,label,note,resolutions[],durations[],ratios[],audio}` |

**为什么视频要分两个默认值**：主动生成是"我要一条片子"，可以选贵型号；
对话内工具是"顺手加个动图"，用 Mini 更划算（实测 Mini 90 秒出 1.7MB mp4）。

### 2.5 期初成员

```json
"members": [
  { "name": "秋峰", "role": "owner",  "quota": 0 },
  { "name": "小陈", "role": "editor", "quota": 5000 },
  { "name": "小周", "role": "editor", "quota": 5000 }
]
```

`quota: 0` = 不限。仅首次建库时写入，之后在界面里管。

## 3. 环境变量

| 变量 | 默认 | 作用 | 典型用法 |
|---|---|---|---|
| `PORT` | `config.port` | 端口 | 同机跑多实例 |
| `SB_HOST` | `127.0.0.1` | 监听地址 | `0.0.0.0` 给局域网/公网 |
| `SB_DATA` | `./data` | 数据目录 | `./data-demo` 做体验库 |
| `SB_USER` | `config.auth.username` | 空库首次建 owner 的用户名 | 体验库用 `demo` |
| `SB_PASS` | `config.auth.password` | 同上，密码 | 体验库用它避免外发主密码 |
| `CB_PYTHON` | 自动探测 | 附件抽取的 Python | CI 里指 venv |
| `NODE_BIN` | 自动探测 | `start*.sh` 用哪个 node | 多版本机器 |

> `SB_USER` / `SB_PASS` 只在**目标库为空**（还没有 `users` 记录）时生效。
> 已经有账号的库再改这两个变量没有任何效果 —— 这是为了避免"改环境变量就能改密码"。

## 4. 常见配置组合

### 4.1 本机开发

```bash
node server.js        # 127.0.0.1:7777
```

### 4.2 局域网演示

```bash
SB_HOST=0.0.0.0 ./start.sh
```

### 4.3 体验环境（外人用）

```bash
SB_DATA=$PWD/data-demo PORT=7788 SB_HOST=0.0.0.0 \
SB_USER=demo SB_PASS=star-river-2026 node server.js
```

或直接 `LAN=1 ./start-demo.sh`。

### 4.4 一台机器跑两套（正式 + 体验）

```bash
# 两个端口、两个数据目录，互不干扰
SB_DATA=$PWD/data      PORT=7777 node server.js &
SB_DATA=$PWD/data-demo PORT=7788 SB_HOST=0.0.0.0 node server.js &
```

反代时把 `/` 指向 7777、`/demo` 指向 7788（或各绑一个域名）。

## 5. 改配置的正确姿势

| 改什么 | 怎么做 | 要不要重启 |
|---|---|---|
| 端口 / 数据目录 | 改环境变量或 `config.json` | 要 |
| 模型列表 / Key | 改 `config.json` | 要（启动时读入内存） |
| 单价 | 改 `billing.modelRate*` | 要；**历史账不变**（逐笔存了 rate） |
| 组织余额 | **不要改配置**，用 `/api/org/recharge` 或 `/api/org/adjust` | 不用 |
| 期初额度 | 只在空库时有意义（写 `org.opening`） | 要 |
| 账号密码 | 界面「账号与权限」或 `/api/auth/password` | 不用 |

## 6. 安全清单（配置层面）

- [ ] `config.json` 权限 `600`，所在目录 `700`
- [ ] `git status` 里看不到 `config.json`
- [ ] `auth.password` 不是示例里的占位串
- [ ] 公网部署时 `SB_HOST` 只绑 `127.0.0.1`，由反代对外
- [ ] 体验环境用独立的 `SB_DATA`，不要共用正式库
- [ ] 备份包含 `config.json`（否则换机器要重配 Key）
