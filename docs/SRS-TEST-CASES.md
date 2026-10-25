# SRS 算法断言用例集（T06 验收依据）

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 编写日期 | 2026-10-24 |
| 编写人 | 许清楚（产品经理） |
| 对应 PRD | `docs/PRD.md` 第 5.1 / 5.2 / 5.3 / 5.4 节 |
| 用途 | 批次 2「T06 SRS 纯函数」的单元测试 fixture 与验收依据 |
| 用例总数 | **44 组主用例**（`L∈[0,10]` × `rating∈[1,4]` 全矩阵）+ **6 组边界用例** = **50 组** |
| 数据形式 | 第 2、4 节 Markdown 表格（人读）+ 第 6 节 JSON 数组（机读，camelCase） |

---

## 0. 阅读须知（含一处 PRD 修订）

> **⚠️ PRD 5.3 的「认识」公式已修订，请以本文档为准。**
> 原写法 `min(L + 1, 8)` 在 `L = 9` 时得 8、`L = 10` 时得 8，会把已进入 60/120 天长间隔池的词**降级**回 30 天档，属规格缺陷。
> 已改为 **`max(L, min(L + 1, 8))`**，并在 PRD 补了「注 5」。修订后语义为：**任何评分都不会降低等级，降低等级的唯一途径是「不认识」归零。**
> 受此影响的两条必测用例：`TC-L09-R3`（期望 9，不是 8）、`TC-L10-R3`（期望 10，不是 8）。

**评分枚举**

| 值 | 名称 | 语义 |
|---|---|---|
| 1 | 不认识 FORGOT | 完全想不起来 |
| 2 | 模糊 VAGUE | 有印象但不确定 |
| 3 | 认识 KNOWN | 能回忆出主要释义 |
| 4 | 熟识 MASTERED | 秒反应，无迟疑 |

**间隔阶梯 `IDX[L]`**

| L | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `IDX[L]` | 5min | 30min | 12h | 1d | 2d | 4d | 7d | 15d | 30d | 60d | 120d |

---

## 1. 被测函数契约

> 签名与 `ARCHITECTURE.md` 的 T06 任务卡**完全一致**，直接照此实现即可，无需二次适配。

```ts
// lib/srs/studyDay.ts
export function studyDayOf(ts: Timestamp, dayStartHour: number): StudyDayKey;   // 'YYYY-MM-DD'
export function studyDayStart(day: StudyDayKey, dayStartHour: number): Timestamp;
export function nextStudyDay0400(now: Timestamp, dayStartHour: number): Timestamp;

// lib/srs/transition.ts
export interface SrsConfig {
  maxLevel: number;         // 10
  masterLevel: number;      // 8
  intervalLadder: number[]; // 11 档毫秒：[5min,30min,12h,1d,2d,4d,7d,15d,30d,60d,120d]
  dayStartHour: number;     // 4
  maxRetry: number;         // 5
}

export function transition(
  state: WordState,
  rating: Rating,           // 1 | 2 | 3 | 4
  now: Timestamp,
  cfg: SrsConfig,
): { next: WordState; enqueue: boolean; gap: number };
```

**返回值约定**

| 字段 | 含义 | 与本文档的对应 |
|---|---|---|
| `next.level` | 转移后的熟练度等级 | 对应表格列 **期望 L'** |
| `next.dueAt` | 转移后的到期时刻（ms） | 对应表格列 **期望 dueAt 相对时间**（需按第 7 节方法折算成时刻再比对） |
| `next.lapseCount` | 累计「不认识」次数 | 对应 JSON 的 `expectedLapseCount`（第 5 节 D1） |
| `enqueue` | 是否需重新入队 | `expectedQueueAction = "requeue"` → `true`；`"dequeue"` → `false` |
| `gap` | 重现间隔（卡位数） | `enqueue = true` 时须落在 `[3,5]`；`enqueue = false` 时须为 `0` |

**三条测试环境要求**

1. **`now` 与随机数必须注入**：`transition` 内禁止调用 `Date.now()` / `Math.random()`，否则用例不可复现（`gap` 的随机性通过外部注入或调试模式下固定为 3）。
2. `cfg` 由测试显式传入，不得依赖全局单例，否则并行跑测会互相污染。
3. **时区固定**（建议 `Asia/Shanghai`，或在测试启动时设 `process.env.TZ='Asia/Shanghai'`），避免 `nextStudyDay0400` 的断言在 CI 上因时区漂移而挂。

**常量（测试需可注入/覆盖）**

| 常量 | 值 | 对应 `SrsConfig` 字段 |
|---|---|---|
| `L_MAX` | 10 | `maxLevel` |
| `MASTER_L` | 8 | `masterLevel` |
| `DAY_START_HOUR` | 4 | `dayStartHour` |
| `MAX_RETRY` | 5 | `maxRetry` |
| `RETRY_GAP_MIN / MAX` | 3 / 5 | 由 `gap` 返回值约束 |
| `QUEUE_BUFFER` | 3 | 队列层，不在 `SrsConfig` 内 |

---

## 2. 44 组主用例（全矩阵）

> 每行独立断言 `expectedLevel` 与 `expectedDueAt` 两个值。`expectedDueAt` 中 `nextStudyDay0400` 为绝对时刻（由 `now` 折算），`now + X` 为相对时刻。
> 所有用例统一取 `初始 lapseCount = 2`，用于同时验证「仅 `不认识` 递增」这一不变式（期望 `lapseCount` 见第 5 节）。

| 用例ID | 初始 L | 初始 lapseCount | 评分 | 期望 L' | 期望 dueAt 相对时间 | 期望队列动作 | 备注 |
|---|---|---|---|---|---|---|---|
| `TC-L00-R1` | 0 | 2 | 1 不认识 | **0** | `nextStudyDay0400` | **重新入队**（插到 `pos + k`，k∈3~5） | 原本就是 0，归零后仍为 0；但 lapseCount 必须 +1，且当日循环照常重入队——「归零」不等于「无变化」 |
| `TC-L00-R2` | 0 | 2 | 2 模糊 | **0** | `nextStudyDay0400` | 出队（本会话不再出现） | 模糊不涨不降：停在 0，直接推到次日；不进当日循环 |
| `TC-L00-R3` | 0 | 2 | 3 认识 | **1** | `now + 30min` | 出队（本会话不再出现） | 0→1 对应 30min，是同日内的第一次巩固（不是 5min；5min 是 L=0 的初始档，由新词引入时设定） |
| `TC-L00-R4` | 0 | 2 | 4 熟识 | **9** | `now + 60d` | 出队（本会话不再出现） | 熟识保底：max(0+2,9)=9，直接跳进 60 天池，跳过 1~8 全部中间档。因是新词首现，交互层按钮显示「已掌握」并二次确认（不改变本断言） |
| `TC-L01-R1` | 1 | 2 | 1 不认识 | **0** | `nextStudyDay0400` | **重新入队**（插到 `pos + k`，k∈3~5） | 已到 30min 档仍答「不认识」，严格归零重来 |
| `TC-L01-R2` | 1 | 2 | 2 模糊 | **1** | `nextStudyDay0400` | 出队（本会话不再出现） | 停在 30min 档，推到次日（次日重考但间隔不跳级） |
| `TC-L01-R3` | 1 | 2 | 3 认识 | **2** | `now + 12h` | 出队（本会话不再出现） | 1→2 对应 12h，同日最后一次巩固；L≥3 才开始跨日 |
| `TC-L01-R4` | 1 | 2 | 4 熟识 | **9** | `now + 60d` | 出队（本会话不再出现） | max(3,9)=9，+2 被保底规则覆盖 |
| `TC-L02-R1` | 2 | 2 | 1 不认识 | **0** | `nextStudyDay0400` | **重新入队**（插到 `pos + k`，k∈3~5） | 12h 档遗忘，严格归零 |
| `TC-L02-R2` | 2 | 2 | 2 模糊 | **2** | `nextStudyDay0400` | 出队（本会话不再出现） | 停在 12h 档，推到次日 |
| `TC-L02-R3` | 2 | 2 | 3 认识 | **3** | `now + 1d` | 出队（本会话不再出现） | 2→3：首次跨出同日区间，12h→1d，L=3 是「1~30 天区间」的起点 |
| `TC-L02-R4` | 2 | 2 | 4 熟识 | **9** | `now + 60d` | 出队（本会话不再出现） | max(4,9)=9，保底生效 |
| `TC-L03-R1` | 3 | 2 | 1 不认识 | **0** | `nextStudyDay0400` | **重新入队**（插到 `pos + k`，k∈3~5） | **为什么归零而非降到 2**：产品规则为严格归零（PRD 注 3），一条「不认识」即视为未掌握，不保留残余等级；降档会掩盖遗忘强度 |
| `TC-L03-R2` | 3 | 2 | 2 模糊 | **3** | `nextStudyDay0400` | 出队（本会话不再出现） | 停在 1d 档，推到次日 |
| `TC-L03-R3` | 3 | 2 | 3 认识 | **4** | `now + 2d` | 出队（本会话不再出现） | 3→4 对应 2d |
| `TC-L03-R4` | 3 | 2 | 4 熟识 | **9** | `now + 60d` | 出队（本会话不再出现） | max(5,9)=9 |
| `TC-L04-R1` | 4 | 2 | 1 不认识 | **0** | `nextStudyDay0400` | **重新入队**（插到 `pos + k`，k∈3~5） | 严格归零（4d 档遗忘同样归零） |
| `TC-L04-R2` | 4 | 2 | 2 模糊 | **4** | `nextStudyDay0400` | 出队（本会话不再出现） | 停在 2d 档 |
| `TC-L04-R3` | 4 | 2 | 3 认识 | **5** | `now + 4d` | 出队（本会话不再出现） | 4→5 对应 4d |
| `TC-L04-R4` | 4 | 2 | 4 熟识 | **9** | `now + 60d` | 出队（本会话不再出现） | max(6,9)=9 |
| `TC-L05-R1` | 5 | 2 | 1 不认识 | **0** | `nextStudyDay0400` | **重新入队**（插到 `pos + k`，k∈3~5） | 严格归零 |
| `TC-L05-R2` | 5 | 2 | 2 模糊 | **5** | `nextStudyDay0400` | 出队（本会话不再出现） | 停在 4d 档 |
| `TC-L05-R3` | 5 | 2 | 3 认识 | **6** | `now + 7d` | 出队（本会话不再出现） | 5→6 对应 7d |
| `TC-L05-R4` | 5 | 2 | 4 熟识 | **9** | `now + 60d` | 出队（本会话不再出现） | max(7,9)=9 |
| `TC-L06-R1` | 6 | 2 | 1 不认识 | **0** | `nextStudyDay0400` | **重新入队**（插到 `pos + k`，k∈3~5） | 严格归零 |
| `TC-L06-R2` | 6 | 2 | 2 模糊 | **6** | `nextStudyDay0400` | 出队（本会话不再出现） | 停在 7d 档 |
| `TC-L06-R3` | 6 | 2 | 3 认识 | **7** | `now + 15d` | 出队（本会话不再出现） | 6→7 对应 15d |
| `TC-L06-R4` | 6 | 2 | 4 熟识 | **9** | `now + 60d` | 出队（本会话不再出现） | max(8,9)=9 |
| `TC-L07-R1` | 7 | 2 | 1 不认识 | **0** | `nextStudyDay0400` | **重新入队**（插到 `pos + k`，k∈3~5） | 严格归零（15d 档遗忘同样归零） |
| `TC-L07-R2` | 7 | 2 | 2 模糊 | **7** | `nextStudyDay0400` | 出队（本会话不再出现） | 停在 15d 档 |
| `TC-L07-R3` | 7 | 2 | 3 认识 | **8** | `now + 30d` | 出队（本会话不再出现） | 7→8 对应 30d，到达「1~30 天区间」顶端 |
| `TC-L07-R4` | 7 | 2 | 4 熟识 | **9** | `now + 60d` | 出队（本会话不再出现） | 「熟识=等级+2」与「保底进 9」在此恰好重合：max(7+2,9)=9，是 +2 与保底规则的锚点用例 |
| `TC-L08-R1` | 8 | 2 | 1 不认识 | **0** | `nextStudyDay0400` | **重新入队**（插到 `pos + k`，k∈3~5） | 严格归零：已达到「已掌握」阈值（MASTER_L=8）的词遗忘，同样不保留等级 |
| `TC-L08-R2` | 8 | 2 | 2 模糊 | **8** | `nextStudyDay0400` | 出队（本会话不再出现） | 停在 30d 档 |
| `TC-L08-R3` | 8 | 2 | 3 认识 | **8** | `now + 30d` | 出队（本会话不再出现） | **为什么还是 8**：min(8+1,8)=8 触发 30 天封顶。认识最多把词推到 1~30 天区间顶端，进 60 天池必须显式点「熟识」 |
| `TC-L08-R4` | 8 | 2 | 4 熟识 | **10** | `now + 120d` | 出队（本会话不再出现） | max(10,9)=10 → 落到 120 天档（不是 60 天档，因 +2 后已越过 9） |
| `TC-L09-R1` | 9 | 2 | 1 不认识 | **0** | `nextStudyDay0400` | **重新入队**（插到 `pos + k`，k∈3~5） | 已掌握词（60d 池）遗忘，同样严格归零到 0，不保留等级 |
| `TC-L09-R2` | 9 | 2 | 2 模糊 | **9** | `nextStudyDay0400` | 出队（本会话不再出现） | 停在 60d 档，推到次日 |
| `TC-L09-R3` | 9 | 2 | 3 认识 | **9** | `now + 60d` | 出队（本会话不再出现） | **为什么还是 9**：max(9, min(10,8)) = max(9,8) = 9。外层 max 必须有——只写 min(L+1,8) 会把 60 天档错误降级成 30 天档。「认识」只代表回忆得出，不构成遗忘证据 |
| `TC-L09-R4` | 9 | 2 | 4 熟识 | **10** | `now + 120d` | 出队（本会话不再出现） | max(11,9)=11 → 截到 10，进入 120 天档 |
| `TC-L10-R1` | 10 | 2 | 1 不认识 | **0** | `nextStudyDay0400` | **重新入队**（插到 `pos + k`，k∈3~5） | 120 天档遗忘也严格归零 |
| `TC-L10-R2` | 10 | 2 | 2 模糊 | **10** | `nextStudyDay0400` | 出队（本会话不再出现） | 停在 120d 档（最高档，模糊不降级） |
| `TC-L10-R3` | 10 | 2 | 3 认识 | **10** | `now + 120d` | 出队（本会话不再出现） | **为什么还是 10**：max(10, min(11,8)) = 10。最高档不再变化，也绝不被降级 |
| `TC-L10-R4` | 10 | 2 | 4 熟识 | **10** | `now + 120d` | 出队（本会话不再出现） | max(12,9)=12 → 截到 10，已封顶，无实际变化 |

---

## 3. 覆盖矩阵自检

| 检查项 | 结果 |
|---|---|
| `L` 取值覆盖 | 0,1,2,3,4,5,6,7,8,9,10 → **11 个全覆盖** |
| `rating` 取值覆盖 | 1,2,3,4 → **4 个全覆盖** |
| 笛卡尔积 | 11 × 4 = **44**，与用例数一致（脚本断言 `count == 44` 且 `distinct == 44`） |
| `不认识` 分支必测点 | L=0（归零无变化但 lapseCount+1）、L=3（归零而非降档）、L=8/9/10（已掌握词也归零） |
| `模糊` 分支必测点 | L=0（停在 0）、L=10（最高档不降级） |
| `认识` 分支必测点 | L=7（进到 8）、**L=8（封顶仍 8）**、**L=9（保持 9）**、**L=10（保持 10）** |
| `熟识` 分支必测点 | L=0（跳到 9）、L=7（+2 与保底重合）、L=8（跳 10）、L=10（封顶） |

---

## 4. 6 组边界用例

| 用例ID | 被测函数 | 输入 | 期望输出 | 备注 |
|---|---|---|---|---|
| `TC-B01` | `nextStudyDay0400` | ``{"now": "2026-10-24T03:59:00"}`` | ``{"nextStudyDay0400": "2026-10-24T04:00"}`` | 03:59 属于「学习日 2026-10-23」（因未过 04:00 边界），该学习日的次日是 10-24，次日 04:00 即 2026-10-24T04:00。**注意返回值可能落在同一个自然日**，不要写成 now+1day |
| `TC-B02` | `nextStudyDay0400` | ``{"now": "2026-10-24T04:00:00"}`` | ``{"nextStudyDay0400": "2026-10-25T04:00"}`` | 04:00 整点属于「学习日 2026-10-24」（边界取闭区间左侧归属当天），故次日为 10-25。B01 与 B02 相差 1 分钟，返回值相差 1 整天，是本函数最容易写错的边界 |
| `TC-B03` | `insertRetry` | ``{"queue": ["C", "D", "E"], "pos": 0, "k": 3}`` | ``{"queue": ["C", "D", "E", "B"]}`` | 插入位置 = min(pos + k, queue.length) = min(3, 3) = 3 → 追加到尾部，**不是**插到 E 之前（不能用 pos+k-1） |
| `TC-B04` | `insertRetry` | ``{"queue": [], "pos": 0, "k": 3}`` | ``{"queue": ["B"]}`` | min(3, 0) = 0 → 插到首位。空队列必须正常返回单元素队列，不得抛异常或丢词（会话最后一张卡答「不认识」时会出现此场景） |
| `TC-B05` | `insertRetry` | ``{"queue": ["C", "D"], "pos": 0, "k": 3, "retryCountBefore": 4, "maxRetry": 5}`` | ``{"queue": ["C", "D"], "requeued": false, "retryCountAfter": 5, "dueAt": "nextStudyDay0400", "unstable": true}`` | retryCount 由 4 增至 5 达到 MAX_RETRY，**不再入队**（队列保持原样），仅设置 dueAt=nextStudyDay0400 并置 unstable=true，供次日首页提示「N 个词不稳定」 |
| `TC-B06` | `refillQueue` | ``{"queue": ["X", "Y"], "buffer": 3, "dueReviews": [{"id": "R1", "dueAt": 1000}, {"id": "R2", "dueAt": 500}], "newWords": ["N1"]}`` | ``{"queue": ["X", "Y", "R2"]}`` | 剩余 2 张 < QUEUE_BUFFER(3) → 补 1 张至 3 张。取词优先级：到期复习（按 dueAt **升序**，故 R2 先于 R1）→ 新词。**R2 必须先于 R1**，这是排序断言的真正考点 |

---

## 5. 派生断言（统一规则，不需逐条重复）

除主断言外，每次 `transition` 还必须满足以下不变式：

| # | 断言对象 | 规则 |
|---|---|---|
| D1 | `lapseCount` | `rating == 1` 时 `+1`；`rating ∈ {2,3,4}` 时**不变**（44 组用例已按此填 `expectedLapseCount`） |
| D2 | `updatedAt` | 恒等于 `now`（每次转移都刷新，供同步冲突判定） |
| D3 | `reviewCount` | 恒 `+1` |
| D4 | `ReviewLog` | 每次成功转移**必写一条**，含 `prevLevel` / `newLevel` / `prevDueAt` / `newDueAt` / `rating` / `answeredAt = now` |
| D5 | `retryCountToday` | `rating == 1` 且未达 `MAX_RETRY` 时 `+1`；达上限后不再自增（固定为 5） |
| D6 | `unstable` | 仅当 `rating == 1` 且 `retryCountToday` 达到 `MAX_RETRY` 时置 `true`；次日首次答对后清零 |
| D7 | `masteredAt` | 仅当 `newLevel >= MASTER_L(8)` 且原 `masteredAt` 为空时写入 `now`，不覆盖已有值 |
| D8 | 取消行为 | 新词首现点「已掌握」后**取消**：不产生任何字段变更、不写 `ReviewLog`、`queue` 不变（这是「未作答」而非一次转移） |
| D9 | 纯函数性 | 同一 `(state, rating, now)` 输入调用两次，输出必须完全一致（无随机、无副作用）；`randInt(3,5)` 的随机性只存在于队列层，不进入 `transition` |

---

## 6. JSON Fixture

> 直接 `JSON.parse` 后传给 `describe.each` / `test.each`。字段名 camelCase。
> `expectedDueAt` 为字符串契约：`"nextStudyDay0400"` 或 `"now + <interval>"`，建议在测试里先解析成「期望时刻」再与返回值比对。

```json
[
  {
    "id": "TC-L00-R1",
    "initialLevel": 0,
    "initialLapseCount": 2,
    "rating": 1,
    "expectedLevel": 0,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "requeue",
    "expectedLapseCount": 3,
    "note": "原本就是 0，归零后仍为 0；但 lapseCount 必须 +1，且当日循环照常重入队——「归零」不等于「无变化」"
  },
  {
    "id": "TC-L00-R2",
    "initialLevel": 0,
    "initialLapseCount": 2,
    "rating": 2,
    "expectedLevel": 0,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "模糊不涨不降：停在 0，直接推到次日；不进当日循环"
  },
  {
    "id": "TC-L00-R3",
    "initialLevel": 0,
    "initialLapseCount": 2,
    "rating": 3,
    "expectedLevel": 1,
    "expectedDueAt": "now + 30min",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "0→1 对应 30min，是同日内的第一次巩固（不是 5min；5min 是 L=0 的初始档，由新词引入时设定）"
  },
  {
    "id": "TC-L00-R4",
    "initialLevel": 0,
    "initialLapseCount": 2,
    "rating": 4,
    "expectedLevel": 9,
    "expectedDueAt": "now + 60d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "熟识保底：max(0+2,9)=9，直接跳进 60 天池，跳过 1~8 全部中间档。因是新词首现，交互层按钮显示「已掌握」并二次确认（不改变本断言）"
  },
  {
    "id": "TC-L01-R1",
    "initialLevel": 1,
    "initialLapseCount": 2,
    "rating": 1,
    "expectedLevel": 0,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "requeue",
    "expectedLapseCount": 3,
    "note": "已到 30min 档仍答「不认识」，严格归零重来"
  },
  {
    "id": "TC-L01-R2",
    "initialLevel": 1,
    "initialLapseCount": 2,
    "rating": 2,
    "expectedLevel": 1,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "停在 30min 档，推到次日（次日重考但间隔不跳级）"
  },
  {
    "id": "TC-L01-R3",
    "initialLevel": 1,
    "initialLapseCount": 2,
    "rating": 3,
    "expectedLevel": 2,
    "expectedDueAt": "now + 12h",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "1→2 对应 12h，同日最后一次巩固；L≥3 才开始跨日"
  },
  {
    "id": "TC-L01-R4",
    "initialLevel": 1,
    "initialLapseCount": 2,
    "rating": 4,
    "expectedLevel": 9,
    "expectedDueAt": "now + 60d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "max(3,9)=9，+2 被保底规则覆盖"
  },
  {
    "id": "TC-L02-R1",
    "initialLevel": 2,
    "initialLapseCount": 2,
    "rating": 1,
    "expectedLevel": 0,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "requeue",
    "expectedLapseCount": 3,
    "note": "12h 档遗忘，严格归零"
  },
  {
    "id": "TC-L02-R2",
    "initialLevel": 2,
    "initialLapseCount": 2,
    "rating": 2,
    "expectedLevel": 2,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "停在 12h 档，推到次日"
  },
  {
    "id": "TC-L02-R3",
    "initialLevel": 2,
    "initialLapseCount": 2,
    "rating": 3,
    "expectedLevel": 3,
    "expectedDueAt": "now + 1d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "2→3：首次跨出同日区间，12h→1d，L=3 是「1~30 天区间」的起点"
  },
  {
    "id": "TC-L02-R4",
    "initialLevel": 2,
    "initialLapseCount": 2,
    "rating": 4,
    "expectedLevel": 9,
    "expectedDueAt": "now + 60d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "max(4,9)=9，保底生效"
  },
  {
    "id": "TC-L03-R1",
    "initialLevel": 3,
    "initialLapseCount": 2,
    "rating": 1,
    "expectedLevel": 0,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "requeue",
    "expectedLapseCount": 3,
    "note": "**为什么归零而非降到 2**：产品规则为严格归零（PRD 注 3），一条「不认识」即视为未掌握，不保留残余等级；降档会掩盖遗忘强度"
  },
  {
    "id": "TC-L03-R2",
    "initialLevel": 3,
    "initialLapseCount": 2,
    "rating": 2,
    "expectedLevel": 3,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "停在 1d 档，推到次日"
  },
  {
    "id": "TC-L03-R3",
    "initialLevel": 3,
    "initialLapseCount": 2,
    "rating": 3,
    "expectedLevel": 4,
    "expectedDueAt": "now + 2d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "3→4 对应 2d"
  },
  {
    "id": "TC-L03-R4",
    "initialLevel": 3,
    "initialLapseCount": 2,
    "rating": 4,
    "expectedLevel": 9,
    "expectedDueAt": "now + 60d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "max(5,9)=9"
  },
  {
    "id": "TC-L04-R1",
    "initialLevel": 4,
    "initialLapseCount": 2,
    "rating": 1,
    "expectedLevel": 0,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "requeue",
    "expectedLapseCount": 3,
    "note": "严格归零（4d 档遗忘同样归零）"
  },
  {
    "id": "TC-L04-R2",
    "initialLevel": 4,
    "initialLapseCount": 2,
    "rating": 2,
    "expectedLevel": 4,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "停在 2d 档"
  },
  {
    "id": "TC-L04-R3",
    "initialLevel": 4,
    "initialLapseCount": 2,
    "rating": 3,
    "expectedLevel": 5,
    "expectedDueAt": "now + 4d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "4→5 对应 4d"
  },
  {
    "id": "TC-L04-R4",
    "initialLevel": 4,
    "initialLapseCount": 2,
    "rating": 4,
    "expectedLevel": 9,
    "expectedDueAt": "now + 60d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "max(6,9)=9"
  },
  {
    "id": "TC-L05-R1",
    "initialLevel": 5,
    "initialLapseCount": 2,
    "rating": 1,
    "expectedLevel": 0,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "requeue",
    "expectedLapseCount": 3,
    "note": "严格归零"
  },
  {
    "id": "TC-L05-R2",
    "initialLevel": 5,
    "initialLapseCount": 2,
    "rating": 2,
    "expectedLevel": 5,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "停在 4d 档"
  },
  {
    "id": "TC-L05-R3",
    "initialLevel": 5,
    "initialLapseCount": 2,
    "rating": 3,
    "expectedLevel": 6,
    "expectedDueAt": "now + 7d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "5→6 对应 7d"
  },
  {
    "id": "TC-L05-R4",
    "initialLevel": 5,
    "initialLapseCount": 2,
    "rating": 4,
    "expectedLevel": 9,
    "expectedDueAt": "now + 60d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "max(7,9)=9"
  },
  {
    "id": "TC-L06-R1",
    "initialLevel": 6,
    "initialLapseCount": 2,
    "rating": 1,
    "expectedLevel": 0,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "requeue",
    "expectedLapseCount": 3,
    "note": "严格归零"
  },
  {
    "id": "TC-L06-R2",
    "initialLevel": 6,
    "initialLapseCount": 2,
    "rating": 2,
    "expectedLevel": 6,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "停在 7d 档"
  },
  {
    "id": "TC-L06-R3",
    "initialLevel": 6,
    "initialLapseCount": 2,
    "rating": 3,
    "expectedLevel": 7,
    "expectedDueAt": "now + 15d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "6→7 对应 15d"
  },
  {
    "id": "TC-L06-R4",
    "initialLevel": 6,
    "initialLapseCount": 2,
    "rating": 4,
    "expectedLevel": 9,
    "expectedDueAt": "now + 60d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "max(8,9)=9"
  },
  {
    "id": "TC-L07-R1",
    "initialLevel": 7,
    "initialLapseCount": 2,
    "rating": 1,
    "expectedLevel": 0,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "requeue",
    "expectedLapseCount": 3,
    "note": "严格归零（15d 档遗忘同样归零）"
  },
  {
    "id": "TC-L07-R2",
    "initialLevel": 7,
    "initialLapseCount": 2,
    "rating": 2,
    "expectedLevel": 7,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "停在 15d 档"
  },
  {
    "id": "TC-L07-R3",
    "initialLevel": 7,
    "initialLapseCount": 2,
    "rating": 3,
    "expectedLevel": 8,
    "expectedDueAt": "now + 30d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "7→8 对应 30d，到达「1~30 天区间」顶端"
  },
  {
    "id": "TC-L07-R4",
    "initialLevel": 7,
    "initialLapseCount": 2,
    "rating": 4,
    "expectedLevel": 9,
    "expectedDueAt": "now + 60d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "「熟识=等级+2」与「保底进 9」在此恰好重合：max(7+2,9)=9，是 +2 与保底规则的锚点用例"
  },
  {
    "id": "TC-L08-R1",
    "initialLevel": 8,
    "initialLapseCount": 2,
    "rating": 1,
    "expectedLevel": 0,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "requeue",
    "expectedLapseCount": 3,
    "note": "严格归零：已达到「已掌握」阈值（MASTER_L=8）的词遗忘，同样不保留等级"
  },
  {
    "id": "TC-L08-R2",
    "initialLevel": 8,
    "initialLapseCount": 2,
    "rating": 2,
    "expectedLevel": 8,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "停在 30d 档"
  },
  {
    "id": "TC-L08-R3",
    "initialLevel": 8,
    "initialLapseCount": 2,
    "rating": 3,
    "expectedLevel": 8,
    "expectedDueAt": "now + 30d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "**为什么还是 8**：min(8+1,8)=8 触发 30 天封顶。认识最多把词推到 1~30 天区间顶端，进 60 天池必须显式点「熟识」"
  },
  {
    "id": "TC-L08-R4",
    "initialLevel": 8,
    "initialLapseCount": 2,
    "rating": 4,
    "expectedLevel": 10,
    "expectedDueAt": "now + 120d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "max(10,9)=10 → 落到 120 天档（不是 60 天档，因 +2 后已越过 9）"
  },
  {
    "id": "TC-L09-R1",
    "initialLevel": 9,
    "initialLapseCount": 2,
    "rating": 1,
    "expectedLevel": 0,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "requeue",
    "expectedLapseCount": 3,
    "note": "已掌握词（60d 池）遗忘，同样严格归零到 0，不保留等级"
  },
  {
    "id": "TC-L09-R2",
    "initialLevel": 9,
    "initialLapseCount": 2,
    "rating": 2,
    "expectedLevel": 9,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "停在 60d 档，推到次日"
  },
  {
    "id": "TC-L09-R3",
    "initialLevel": 9,
    "initialLapseCount": 2,
    "rating": 3,
    "expectedLevel": 9,
    "expectedDueAt": "now + 60d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "**为什么还是 9**：max(9, min(10,8)) = max(9,8) = 9。外层 max 必须有——只写 min(L+1,8) 会把 60 天档错误降级成 30 天档。「认识」只代表回忆得出，不构成遗忘证据"
  },
  {
    "id": "TC-L09-R4",
    "initialLevel": 9,
    "initialLapseCount": 2,
    "rating": 4,
    "expectedLevel": 10,
    "expectedDueAt": "now + 120d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "max(11,9)=11 → 截到 10，进入 120 天档"
  },
  {
    "id": "TC-L10-R1",
    "initialLevel": 10,
    "initialLapseCount": 2,
    "rating": 1,
    "expectedLevel": 0,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "requeue",
    "expectedLapseCount": 3,
    "note": "120 天档遗忘也严格归零"
  },
  {
    "id": "TC-L10-R2",
    "initialLevel": 10,
    "initialLapseCount": 2,
    "rating": 2,
    "expectedLevel": 10,
    "expectedDueAt": "nextStudyDay0400",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "停在 120d 档（最高档，模糊不降级）"
  },
  {
    "id": "TC-L10-R3",
    "initialLevel": 10,
    "initialLapseCount": 2,
    "rating": 3,
    "expectedLevel": 10,
    "expectedDueAt": "now + 120d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "**为什么还是 10**：max(10, min(11,8)) = 10。最高档不再变化，也绝不被降级"
  },
  {
    "id": "TC-L10-R4",
    "initialLevel": 10,
    "initialLapseCount": 2,
    "rating": 4,
    "expectedLevel": 10,
    "expectedDueAt": "now + 120d",
    "expectedQueueAction": "dequeue",
    "expectedLapseCount": 2,
    "note": "max(12,9)=12 → 截到 10，已封顶，无实际变化"
  }
]
```

**边界用例 JSON**

```json
[
  {
    "id": "TC-B01",
    "fn": "nextStudyDay0400",
    "input": {
      "now": "2026-10-24T03:59:00"
    },
    "expected": {
      "nextStudyDay0400": "2026-10-24T04:00"
    },
    "note": "03:59 属于「学习日 2026-10-23」（因未过 04:00 边界），该学习日的次日是 10-24，次日 04:00 即 2026-10-24T04:00。**注意返回值可能落在同一个自然日**，不要写成 now+1day"
  },
  {
    "id": "TC-B02",
    "fn": "nextStudyDay0400",
    "input": {
      "now": "2026-10-24T04:00:00"
    },
    "expected": {
      "nextStudyDay0400": "2026-10-25T04:00"
    },
    "note": "04:00 整点属于「学习日 2026-10-24」（边界取闭区间左侧归属当天），故次日为 10-25。B01 与 B02 相差 1 分钟，返回值相差 1 整天，是本函数最容易写错的边界"
  },
  {
    "id": "TC-B03",
    "fn": "insertRetry",
    "input": {
      "queue": [
        "C",
        "D",
        "E"
      ],
      "pos": 0,
      "k": 3
    },
    "expected": {
      "queue": [
        "C",
        "D",
        "E",
        "B"
      ]
    },
    "note": "插入位置 = min(pos + k, queue.length) = min(3, 3) = 3 → 追加到尾部，**不是**插到 E 之前（不能用 pos+k-1）"
  },
  {
    "id": "TC-B04",
    "fn": "insertRetry",
    "input": {
      "queue": [],
      "pos": 0,
      "k": 3
    },
    "expected": {
      "queue": [
        "B"
      ]
    },
    "note": "min(3, 0) = 0 → 插到首位。空队列必须正常返回单元素队列，不得抛异常或丢词（会话最后一张卡答「不认识」时会出现此场景）"
  },
  {
    "id": "TC-B05",
    "fn": "insertRetry",
    "input": {
      "queue": [
        "C",
        "D"
      ],
      "pos": 0,
      "k": 3,
      "retryCountBefore": 4,
      "maxRetry": 5
    },
    "expected": {
      "queue": [
        "C",
        "D"
      ],
      "requeued": false,
      "retryCountAfter": 5,
      "dueAt": "nextStudyDay0400",
      "unstable": true
    },
    "note": "retryCount 由 4 增至 5 达到 MAX_RETRY，**不再入队**（队列保持原样），仅设置 dueAt=nextStudyDay0400 并置 unstable=true，供次日首页提示「N 个词不稳定」"
  },
  {
    "id": "TC-B06",
    "fn": "refillQueue",
    "input": {
      "queue": [
        "X",
        "Y"
      ],
      "buffer": 3,
      "dueReviews": [
        {
          "id": "R1",
          "dueAt": 1000
        },
        {
          "id": "R2",
          "dueAt": 500
        }
      ],
      "newWords": [
        "N1"
      ]
    },
    "expected": {
      "queue": [
        "X",
        "Y",
        "R2"
      ]
    },
    "note": "剩余 2 张 < QUEUE_BUFFER(3) → 补 1 张至 3 张。取词优先级：到期复习（按 dueAt **升序**，故 R2 先于 R1）→ 新词。**R2 必须先于 R1**，这是排序断言的真正考点"
  }
]
```

---

## 7. 测试脚手架建议

> 按 `ARCHITECTURE.md` T06 的真实签名编写，可直接落成 `src/lib/srs/transition.test.ts`。

```ts
import { describe, test, expect } from 'vitest';
import { transition, type SrsConfig } from './transition';
import { nextStudyDay0400 } from './studyDay';
import CASES_44 from '../../../test/fixtures/stateTable.json';

const MIN = 60_000, HR = 60 * MIN, DAY = 24 * HR;
const LADDER = [5*MIN, 30*MIN, 12*HR, 1*DAY, 2*DAY, 4*DAY, 7*DAY, 15*DAY, 30*DAY, 60*DAY, 120*DAY];
const LADDER_KEY = ['5min','30min','12h','1d','2d','4d','7d','15d','30d','60d','120d'];

const cfg: SrsConfig = {
  maxLevel: 10, masterLevel: 8, intervalLadder: LADDER, dayStartHour: 4, maxRetry: 5,
};

// 固定时刻，且注入而非读系统时钟
const NOW = new Date('2026-10-24T10:00:00+08:00').getTime();

function expectDueAt(actual: number, spec: string, now: number) {
  if (spec === 'nextStudyDay0400') {
    return expect(actual).toBe(nextStudyDay0400(now, cfg.dayStartHour));
  }
  const m = /^now \+ (.+)$/.exec(spec);
  expect(m).not.toBeNull();
  const idx = LADDER_KEY.indexOf(m![1]);
  expect(idx, `fixture 档位写错: ${spec}`).toBeGreaterThanOrEqual(0);
  return expect(actual).toBe(now + LADDER[idx]);
}

describe.each(CASES_44)('$id (L=$initialLevel, rating=$rating)', (c) => {
  const state: WordState = {
    level: c.initialLevel,
    lapseCount: c.initialLapseCount,
    dueAt: 0,
    retryCountToday: 0,
    reviewCount: 0,
    unstable: false,
    updatedAt: 0,
  } as WordState;

  const { next, enqueue, gap } = transition(state, c.rating, NOW, cfg);

  test('next.level', () => expect(next.level).toBe(c.expectedLevel));
  test('next.dueAt', () => expectDueAt(next.dueAt, c.expectedDueAt, NOW));
  test('next.lapseCount', () => expect(next.lapseCount).toBe(c.expectedLapseCount));
  test('next.updatedAt', () => expect(next.updatedAt).toBe(NOW));
  test('enqueue', () => expect(enqueue).toBe(c.expectedQueueAction === 'requeue'));
  test('gap', () => {
    if (enqueue) { expect(gap).toBeGreaterThanOrEqual(3); expect(gap).toBeLessThanOrEqual(5); }
    else { expect(gap).toBe(0); }
  });
  test('纯函数（同参两次调用结果一致）', () =>
    expect(transition(state, c.rating, NOW, cfg)).toEqual({ next, enqueue, gap }));
});
```

**建议再加两条属性测试兜底回归**

```ts
// 1) 只升不降：任何非 FORGOT 评分都不得降低等级（兜住 PRD 注 5 那类缺陷）
test('monotonic', () => {
  for (let L = 0; L <= 10; L++)
    for (const r of [2, 3, 4] as Rating[]) {
      const { next } = transition(mkState(L), r, NOW, cfg);
      expect(next.level).toBeGreaterThanOrEqual(L);
    }
});

// 2) 档位合法性：level 恒在 [0,10]，dueAt 严格大于 now
test('invariants', () => {
  for (let L = 0; L <= 10; L++)
    for (const r of [1, 2, 3, 4] as Rating[]) {
      const { next } = transition(mkState(L), r, NOW, cfg);
      expect(next.level).toBeGreaterThanOrEqual(0);
      expect(next.level).toBeLessThanOrEqual(10);
      expect(next.dueAt).toBeGreaterThan(NOW);
    }
});
```

> 注：`不认识` 分支的 `dueAt` 为次日 04:00，必然大于 `NOW`（本例 `NOW` 为 10:00），断言成立。若把 `NOW` 设到 03:00 附近，需改用 `TC-B01/B02` 的边界口径单独覆盖。

---

## 8. 附录：建议追加的端到端场景用例（非 T06 必需）

以下 3 条覆盖的是「会话层」而非「转移层」，建议放到批次 3 的集成测试：

| 用例ID | 场景 | 断言要点 |
|---|---|---|
| `TC-E01` | 队列 `[A,B,C,D,E]`，依次作答 认识 / 不认识 / 认识 / 模糊 / 认识 / 再现认识 | 按 PRD 5.7 用例 A 逐步比对队列快照；B 必须在第 3 张卡后重现；会话结算正确率 80%（4/5） |
| `TC-E02` | 同一词连续 5 次「不认识」 | 第 6 次不再入队；`unstable = true`；`retryCountToday = 5`；`dueAt = nextStudyDay0400` |
| `TC-E03` | 会话中途退出再进入 | `retryPool` 中未消化的词出现在新会话队列**前 3 位**内（PRD R9） |

---

## 附：与 PRD 的对应关系

| PRD 位置 | 本文档对应 |
|---|---|
| 5.1 术语与常量 | 第 1 节常量表 |
| 5.2 学习日定义 | `TC-B01` / `TC-B02` |
| 5.3 四档反馈状态转移表 | 第 2 节 44 组 + 第 5 节 D1~D9 |
| 5.3 注 5（认识只升不降） | `TC-L09-R3` / `TC-L10-R3` + 第 7 节属性测试建议 |
| 5.4 R2 队列插入 | `TC-B03` / `TC-B04` |
| 5.4 R3 重现上限 | `TC-B05` |
| 5.4 R5 队列补位 | `TC-B06` |
| 5.4 R9 跨会话连续性 | `TC-E03` |
| 5.7 示例推演 | `TC-E01` / `TC-E02` |
| WRD-16 新词首现防误触 | 第 5 节 D8 |
