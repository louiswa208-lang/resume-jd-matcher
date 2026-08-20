/**
 * 示例的 agent 运行记录,供首页回放。
 *
 * 和 example.ts 同一个理由:面试官不该为看 demo 等半分钟,
 * API 挂掉时首页也必须还能完整展示产品能力 —— 而 agent 现在正是主打功能。
 *
 * 编排依据是真实运行中观察到的行为:
 * 先查差距 → 检索原文 → 改写并验证 → **改写失败后转而提问** → 补充信息后再改 → 收尾。
 * 改写的原文全部逐字取自 EXAMPLE_RESUME,所以前后对比是真的。
 */

import type { AgentResult } from "./agent";
import { EXAMPLE_RESUME } from "./example";

export type ExampleBeat =
  | { kind: "tool_call"; tool: string; label: string; wait: number }
  | { kind: "tool_result"; summary: string; ok: boolean; wait: number }
  | { kind: "score"; to: number; delta: number; wait: number }
  | { kind: "ask"; question: string; suggested: string; wait: number }
  /** 收尾也做成一个 beat,由回放循环驱动,不依赖 await 之后的代码 */
  | { kind: "done"; wait: number };

const ORIGINAL_ORDER =
  "负责商家后台「订单管理」模块的迭代,独立完成 6 份 PRD 并主持需求评审,累计推动 14 个需求上线";
const REWRITTEN_ORDER =
  "负责商家后台「订单管理」模块的迭代,覆盖下单到履约的全链路流程设计,独立完成 6 份 PRD 并主持需求评审,累计推动 14 个需求上线";

const ORIGINAL_METRIC =
  "设计商家侧核心指标体系与埋点方案,与数据团队共同落地 23 个埋点,支撑月度经营分析";
const REWRITTEN_METRIC =
  "将「商家用得好不好」这一模糊诉求拆解为活跃、留存、功能渗透、问题解决率四个维度,每个维度定义 2-3 个可埋点指标,与数据团队共同落地 23 个埋点,支撑月度经营分析";

/** 第一段:直到 agent 决定提问为止 */
export const EXAMPLE_AGENT_ACT_ONE: ExampleBeat[] = [
  {
    kind: "tool_call",
    tool: "get_gap_detail",
    label: "查看要求详情",
    wait: 620,
  },
  {
    kind: "tool_result",
    summary: "查看要求 r5:具备供应链、仓储或物流履约类系统的产品经验",
    ok: true,
    wait: 480,
  },
  {
    kind: "tool_call",
    tool: "get_gap_detail",
    label: "查看要求详情",
    wait: 420,
  },
  {
    kind: "tool_result",
    summary: "查看要求 r8:逻辑清晰,具备较强的抽象与结构化能力",
    ok: true,
    wait: 460,
  },
  { kind: "tool_call", tool: "find_in_resume", label: "检索简历", wait: 400 },
  { kind: "tool_result", summary: "在简历中检索「订单」", ok: true, wait: 450 },
  { kind: "tool_call", tool: "try_rewrite", label: "验证改写效果", wait: 520 },
  {
    kind: "tool_result",
    summary: "验证改写(r5):+5 分",
    ok: true,
    wait: 900,
  },
  { kind: "score", to: 71, delta: 5, wait: 500 },
  { kind: "tool_call", tool: "try_rewrite", label: "验证改写效果", wait: 480 },
  {
    kind: "tool_result",
    summary: "验证改写(r8):无提升,已回退",
    ok: true,
    wait: 950,
  },
  { kind: "tool_call", tool: "ask_user", label: "向你提问", wait: 700 },
  {
    kind: "tool_result",
    summary: "改写无法解决,转为向你提问",
    ok: true,
    wait: 500,
  },
  {
    kind: "ask",
    question:
      "改写措辞没能提升这一条,说明简历里缺的是事实而不是表述。请问你在设计那套指标体系时,是怎么把「商家用得好不好」这种模糊问题拆成具体指标的?有没有一个能说明拆解过程的例子?",
    suggested:
      "当时运营只说想知道商家用得好不好,我把它拆成活跃、留存、功能渗透、问题解决率四个维度,每个维度定了 2-3 个可埋点的指标。",
    wait: 300,
  },
];

/** 第二段:用户回答之后 */
export const EXAMPLE_AGENT_ACT_TWO: ExampleBeat[] = [
  { kind: "tool_call", tool: "try_rewrite", label: "验证改写效果", wait: 600 },
  {
    kind: "tool_result",
    summary: "验证改写(r8):+11 分",
    ok: true,
    wait: 900,
  },
  { kind: "score", to: 82, delta: 11, wait: 500 },
  {
    kind: "tool_call",
    tool: "get_gap_detail",
    label: "查看要求详情",
    wait: 450,
  },
  {
    kind: "tool_result",
    summary: "查看要求 r10:有对接 ERP / WMS 等外部系统经验者优先",
    ok: true,
    wait: 460,
  },
  { kind: "tool_call", tool: "finish", label: "整理结论", wait: 700 },
  {
    kind: "tool_result",
    summary: "判断剩余收益已低,主动结束",
    ok: true,
    wait: 600,
  },
  { kind: "done", wait: 600 },
];

/**
 * 这里的每个分数都由 scripts/check-example-score.ts 用真实算分器验算过。
 * 示例是预置的,但数字不能是编的 —— 面试官照着公式验算一次就会发现。
 *
 * 66 → 71(r5 不满足 → 部分满足)→ 82(r8 证据不足 → 已满足)。
 * 注意 r5 改完仍只是「部分满足」,所以它同时出现在两栏:
 * 上面记它加了 5 分,下面记它仍未完全达标。两条都是真的。
 */
export const EXAMPLE_AGENT_RESULT: AgentResult = {
  baselineScore: 66,
  finalScore: 82,
  turnsUsed: 7,
  asksUsed: 1,
  effective: [
    {
      requirementId: "r5",
      requirementText: "具备供应链、仓储或物流履约类系统的产品经验",
      originalText: ORIGINAL_ORDER,
      rewrittenText: REWRITTEN_ORDER,
      scoreBefore: 66,
      scoreAfter: 71,
      delta: 5,
    },
    {
      requirementId: "r8",
      requirementText: "逻辑清晰,具备较强的抽象与结构化能力",
      originalText: ORIGINAL_METRIC,
      rewrittenText: REWRITTEN_METRIC,
      scoreBefore: 71,
      scoreAfter: 82,
      delta: 11,
    },
  ],
  remaining: [
    {
      requirementId: "r2",
      requirementText: "3 年以上 B 端产品经验",
      kind: "experience_gap",
      importance: "must",
      status: "partial",
      reason:
        "简历中的 B 端产品经历为 7 个月实习,与 3 年的年限要求是客观差距,改写无法弥补。",
      interviewAdvice:
        "不要绕开年限。用密度换年限:讲清 7 个月里独立完成 6 份 PRD、推动 14 个需求上线的节奏,再说明你已经跑通过完整的需求闭环。",
    },
    {
      requirementId: "r5",
      requirementText: "具备供应链、仓储或物流履约类系统的产品经验",
      kind: "partially_improved",
      importance: "must",
      status: "partial",
    },
    {
      requirementId: "r10",
      requirementText: "有对接 ERP / WMS 等外部系统经验者优先",
      kind: "experience_gap",
      importance: "nice",
      status: "insufficient",
      reason:
        "简历与补充信息中均无 ERP 或 WMS 系统的对接经历,属于经历缺失,改写无法弥补。",
      interviewAdvice:
        "不必回避。可以说明订单管理与履约数据分析的经验,以及你对上下游系统对接的理解,把话题引到可迁移的部分。",
    },
    {
      requirementId: "r11",
      requirementText: "持有 PMP 或供应链相关认证者优先",
      kind: "experience_gap",
      importance: "nice",
      status: "insufficient",
      reason: "没有相关证书,且这是客观资质,无法通过表述解决。",
      interviewAdvice:
        "作为加分项权重较低,不建议花时间补证书;可以提及正在系统学习的供应链相关课程或知识来源。",
    },
  ],
  // 由原始简历套用两处改写得到,不手写 —— 手写迟早会和上面的 diff 对不上
  finalResumeText: EXAMPLE_RESUME.replace(
    ORIGINAL_ORDER,
    REWRITTEN_ORDER,
  ).replace(ORIGINAL_METRIC, REWRITTEN_METRIC),
  stoppedByBudget: false,
};
