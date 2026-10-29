# 05 · 计费与对账

> 这一节回答四个问题：**怎么算的、算得准不准、跟上游对不对得上、该卖多少钱。**
> 所有数字都来自真实库与真实上游账单，不是估算。

## 1. 积分是什么

积分是**本系统自建的核算单位**，与实际货币的锚定关系由你定价决定。
当前锚：**1 积分 = ¥0.01**（便于心算：1 万积分 = ¥100）。

它和上游的关系：

```text
用户消耗积分  ←（按 config.billing 的单价）←  token 数
token 数     ←（上游真实计费）←  上游账单（美元）
```

中间那层单价是自己定的，所以"积分准不准"和"定价合不合理"是两个独立问题。

## 2. 计价公式

### 2.1 对话（token）

```text
单一价（默认）：
    credits = (in + out) / 1000 × modelRate[model]
              └─ 未配置该模型 → defaultRate

分价（配了 modelRate2 才生效）：
    credits = in/1000 × modelRate2[model].in + out/1000 × modelRate2[model].out
```

`in` / `out` **直接取上游返回的 `usage.prompt_tokens` / `usage.completion_tokens`**，
不做任何本地重算 —— 这是"跟上游一致"的前提。

### 2.2 媒体

```text
图片：credits = billing.media.image × 张数
视频：credits = billing.media.videoPerSecond[model] × 秒数
```

### 2.3 兜底

上游没回 `usage`（超时、被截断）时：

```text
credits ≈ (估算入字 + 估算出字) / 1000 × rate    // 粗略按字符折算
ledger.estimated = true                          // 打标记，便于事后核
```

标了 `estimated` 的笔数应该极少；如果很多，说明上游在持续不回 usage，要查。

## 3. 余额的唯一真相源

```text
balance = org.opening（期初） + org.recharged（累计充值） − Σ ledger.credits
```

- 只有两条路能改余额：`POST /api/org/recharge`（充值）、`POST /api/org/adjust`（调账，负数就是减）。
- 两者都会落一条台账，所以"余额变动"永远有据可查。
- `store.reconcile()` 每次启动重算一遍，手改 `balance` 会被纠正。

## 4. 对账：三件事，缺一不可

### 4.1 库内自洽 —— `GET /api/billing/audit`

```json
{ "opening": 200000, "recharged": 10000,
  "balance": 159618.11, "expectBalance": 159618.11, "balanced": true,
  "shouldCredits": 40660.15, "chargedCredits": 49141.89,
  "tokenChargedCredits": 40660.19, "backfillCredits": 8481.7,
  "ledgerTokenCredits": 40660.19,
  "tokenGap": -0.04, "tokenGapOk": true,
  "rateDrift": false, "totalCredits": 50381.89, "tokens": 10201091 }
```

| 字段 | 含义 | 健康值 |
|---|---|---|
| `balanced` | `balance === expectBalance` | `true` |
| `shouldCredits` | 按 usage 与单价算出来"应该扣多少" | — |
| `tokenChargedCredits` | token 类实际扣了多少 | 与 `shouldCredits` 差 < 1 |
| `tokenGap` | 上面两者之差 | 逐笔四舍五入，绝对值 < 1 |
| `backfillCredits` | **补记**：早期没有逐笔明细的汇总（8,481.70） | 单列，不参与 token 对账 |
| `rateDrift` | 是否有笔的单价与当前配置不一致 | `false`（不一致说明历史账用了别的价，正常但要知道） |

> `tokenGap` 曾出现过一个假差额：早期 39 次调用没有逐笔明细（合计 8,481.70 积分），
> 重算 usage 后错位，看起来像"少扣了"。修法是把这部分单列成 `backfillCredits`，
> 不再混进 token 对账。

### 4.2 与上游账单对照 —— `scripts/audit-credit-upstream.mjs`

```bash
node scripts/audit-credit-upstream.mjs
```

它拿本地 token 累计与上游 `GET /v1/dashboard/billing/usage` 的累计消费对比。
**token 数必须完全一致**（我们用上游的 usage，理论上零误差）；
金额会因为单价结构不同而有差异 —— 那个差异是"定价问题"，不是"记账问题"。

实测结论（2026-10-27）：

```text
本地 token 数 vs 上游：累计差 0.02 积分（逐笔四舍五入）
金额：30,597 积分 对应上游 $23.36  →  1 积分成本 ¥0.0055
按 ¥0.01 卖 → 毛利约 45%，隐含加成 1.85×（偏薄）
```

### 4.3 单价标定 —— `scripts/calibrate-upstream-price.mjs`

不知道上游真实单价时，用它反解：

```bash
node scripts/calibrate-upstream-price.mjs
```

原理：同一把 Key 发两组"入/出配比差异明显"的请求，
用 `Δ消费 = Δin × p_in + Δout × p_out` 解二元一次方程。
带 75s 超时与合理性闸门（`ratio ∈ [1.5, 10]`）。

实测标定结果（美元/百万 token）：

| 模型 | 输入 | 输出 | 输出/输入 |
|---|---|---|---|
| claude-sonnet-4-6 | 3.00 | 15.00 | 5.0 |
| claude-haiku-4-5 | 1.00 | 5.00 | 5.0 |
| claude-opus-4-6 | 5.00 | 25.00 | 5.0 |
| claude-opus-5 | 5.01 | 25.00 | 5.0 |
| claude-opus-5-5 | 4.00 | 20.00 | 5.0 |
| qwen3.8-flash | 0.39 | 1.35 | 3.46 |

**结论：上游是"输出 = 输入 × 5"的结构，我们默认的单一价把这个结构拉平了。**

## 5. 单一价的问题

单一价 `(in+out)/1000 × rate` 意味着输入输出同价。而上游输出贵 5 倍。

```text
输出占比 f  →  我们收的钱 / 上游成本 ∝ (1 + f) / (1 + 5f)
```

| 场景 | 输出占比 | 单一价下的毛利 |
|---|---|---|
| 典型长文生成 | 0.4% | 约 +45%（没爆） |
| haiku 短问答 | 15.3% | **−16.2%（亏）** |

所以：**当前总额没跑偏，但"输出多的用法"在亏钱。** 一旦客户拿 haiku 做批量短文案，
卖得越多亏得越多。

## 6. 分价方案（已备好，未启用）

配置文件在 `report/pricing-proposal.json`，机制已实现（`billing.modelRate2`），
**只需把它合并进 `config.json` 就生效**，历史账不受影响（逐笔存了 rate）。

锚：1 积分 = ¥0.01，单价 = 上游成本 × **2.8**（毛利约 64%），输出价按上游真实倍数。

| 模型 | 现在（单一价） | 建议 in | 建议 out |
|---|---|---|---|
| claude-sonnet-4-6 | 4 | **6** | **30** |
| claude-haiku-4-5 | 1 | **2** | **10** |
| claude-opus-4-6 | 9 | **10** | **50** |
| claude-opus-5 | 12 | **10** | **50** |
| qwen3.8-flash | 0.6 | **1** | **3.5** |

合并方式：

```json
"billing": {
  "modelRate2": {
    "claude-sonnet-4-6": { "in": 6, "out": 30 },
    "claude-haiku-4-5-20251001": { "in": 2, "out": 10 },
    "claude-opus-4-6": { "in": 10, "out": 50 },
    "claude-opus-5": { "in": 10, "out": 50 },
    "qwen3.8-flash": { "in": 1, "out": 3.5 }
  }
}
```

> 没列出的模型继续走 `modelRate`（单一价），不会因为漏配而免费。

## 7. 套餐建议（未落地）

按 1 积分 = ¥0.01、成本 ¥0.0055 测算：

| 套餐 | 积分 | 售价 | 折合单价 | 上游成本 | 毛利 |
|---|---|---|---|---|---|
| 试用 | 20,000 | ¥199 | ¥0.00995 | ¥110 | 45% |
| 团队 | 200,000 | ¥1,800 | ¥0.0090 | ¥1,100 | 39% |
| 企业 | 1,000,000 | ¥8,000 | ¥0.0080 | ¥5,500 | 31% |

> 这三个数尚未写进任何配置，只是测算。真收费前建议先跑一个月真实用量再定。

## 8. 常见问题

**Q：为什么用户扣了 100 积分，我上游账单是 $0.55？**
按 ¥0.0055/积分 算，100 积分 ≈ ¥0.55 ≈ $0.076。差得远说明单价配错了，
跑 `calibrate-upstream-price.mjs` 重新标定。

**Q：`rateDrift: true` 要紧吗？**
表示"有些历史笔的单价与当前配置不同"。改过价就会有，属正常。
要紧的是 `tokenGap`（应扣 vs 实扣）不为 0 且超过 1。

**Q：为什么 `ledger` 只有 500 条但 `usageCalls` 是 437？**
`ledger` 滚动保留最近 500 条；`usageCalls` 是累计调用次数（不截断）。
对账用 `usage.tokenCredits`（单调累计），不用 `Σ ledger.credits`。

**Q：想给某个客户单独定价怎么办？**
当前是全局单价。要按客户定价，需要给 `org` 加 `priceMultiplier`，
在 `recordUsage()` 里乘上去 —— 这属于未实现功能，改动点已标在 `store.creditsFor()`。
