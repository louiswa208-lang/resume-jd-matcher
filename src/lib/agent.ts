/**
 * 简历优化 Agent。
 *
 * 与第一阶段(两步 pipeline)的根本区别:**控制流由模型决定**。
 * 代码只做三件事 —— 执行模型要调的工具、把结果还给它、在预算耗尽时收尾。
 * 先改哪条、改写失败后是重试还是转而提问、什么时候停,全部是模型的判断。
 *
 * 设计要点见 docs/agent-design.md。最关键的一条:
 * 第一阶段做好的**规则算分器**在这里是 agent 的 reward function ——
 * 模型每次改写完都必须调用它拿到确定性的分数,
 * 而不是自己判断"我改得挺好"。
 */

import {
  chatWithTools,
  LlmError,
  type AgentMessage,
  type ToolCall,
  type ToolDefinition,
} from "./deepseek";
import { judgeRequirements } from "./pipeline";
import {
  computeScore,
  requirementWeightPoints,
  sortByPriority,
  toDisplayStatus,
  WEIGHT,
} from "./scoring";
import {
  STATUS_LABEL,
  type DisplayStatus,
  type EvaluatedItem,
  type Importance,
  type Judgment,
  type Requirement,
} from "./types";

/* ------------------------------------------------------------------ */
/* 预算                                                                */
/* ------------------------------------------------------------------ */

export const BUDGET = {
  /** 硬止损:超过就强制收尾 */
  maxTurns: 12,
  /** 主要成本项 —— 每次改写验证都要跑一次完整的逐条判断 */
  maxRewrites: 6,
  /** 再多就烦人了 */
  maxAsks: 3,
} as const;

/* ------------------------------------------------------------------ */
/* 对外类型                                                            */
/* ------------------------------------------------------------------ */

export interface RewriteRecord {
  requirementId: string;
  requirementText: string;
  originalText: string;
  rewrittenText: string;
  scoreBefore: number;
  scoreAfter: number;
  delta: number;
  /**
   * 这条要求按权重折算成多少分。
   * 「+27」单看像是瞎给的,配上「这条权重 27 分」就是「从 0 补到满」——
   * 同一个数字,可信度完全不同。
   */
  weightPoints: number;
}

/**
 * 一条要求「还没解决」的原因。
 *
 * 四类都要呈现,而不是只报经历缺失:用户问的是「我还差什么」,
 * 只列模型主动标记的那几条会让剩下的差距凭空消失 ——
 * 界面上显示 82 分,却数不出扣掉的 18 分在哪。
 */
export type RemainingKind =
  /**
   * 改写确实加了分,但这条仍未**完全**满足。
   * 例:要求「供应链系统经验」,改写后从不满足升到部分满足 ——
   * 有提升是真的,没满足也是真的,两栏都要出现才诚实。
   */
  | "partially_improved"
  /** 模型判定属于经历缺失,改简历解决不了 */
  | "experience_gap"
  /** 试过改写,算分器验证没有提升 —— 说明差的是事实不是表述 */
  | "rewrite_failed"
  /** 本轮压根没动过(优先级靠后,或预算先用尽了) */
  | "not_attempted";

export interface RemainingItem {
  requirementId: string;
  requirementText: string;
  kind: RemainingKind;
  importance: Importance;
  status: DisplayStatus;
  /** 仅 experience_gap 有:模型给出的原因与面试应对建议 */
  reason?: string;
  interviewAdvice?: string;
}

export interface AgentResult {
  baselineScore: number;
  finalScore: number;
  turnsUsed: number;
  asksUsed: number;
  /** 经算分器验证确实提升的改写 —— 结论页第一块,可直接照着改 */
  effective: RewriteRecord[];
  /**
   * 优化后仍未满足的全部要求 —— 结论页第二块。
   * 由算分器统一算出,所以条数和最终分数永远对得上。
   */
  remaining: RemainingItem[];
  /** 应用了全部有效改写后的简历,供用户整份复制 */
  finalResumeText: string;
  /** 预算耗尽被迫收尾,而不是模型自己判断结束 */
  stoppedByBudget: boolean;
}

/**
 * 中断时的运行状态快照。
 *
 * 存在的理由:agent 可能被 ask_user 打断多次,而**已经生效的改写必须跨中断累积**
 * ——否则第二段续跑会从原始简历重新开始,前面挣到的分数全部丢失。
 *
 * 快照连同对话历史一起交给前端保管、原样回传。
 * 后端依然不存任何东西,和第一阶段的原则一致。
 */
export interface AgentSnapshot {
  resumeText: string;
  score: number;
  items: EvaluatedItem[];
  effective: RewriteRecord[];
  ineffective: RewriteRecord[];
  budget: BudgetState;
}

export type AgentEvent =
  | { type: "tool_call"; tool: string; label: string }
  | { type: "tool_result"; tool: string; summary: string; ok: boolean }
  | { type: "score_change"; from: number; to: number; delta: number }
  | {
      type: "ask_user";
      question: string;
      history: AgentMessage[];
      toolCallId: string;
      snapshot: AgentSnapshot;
    }
  | { type: "done"; result: AgentResult };

export interface AgentInput {
  jdText: string;
  resumeText: string;
  requirements: Requirement[];
  baselineItems: EvaluatedItem[];
  baselineScore: number;
  /** 续跑时带上:上一次中断时的完整对话 */
  history?: AgentMessage[];
  /** 续跑时带上:上一次中断时的运行状态,不带会丢失已生效的改写 */
  snapshot?: AgentSnapshot;
  /** 续跑时带上:用户对 ask_user 的回答 */
  userAnswer?: string;
  askToolCallId?: string;
}

/* ------------------------------------------------------------------ */
/* 工具定义(给模型看的)                                               */
/* ------------------------------------------------------------------ */

const TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_gap_detail",
      description:
        "查看某一条岗位要求的完整判断详情:要求原文、权重、当前判定、置信度、简历中的证据、判断备注。用它来决定这条值不值得改、怎么改。",
      parameters: {
        type: "object",
        properties: {
          requirement_id: { type: "string", description: '要求编号,如 "r5"' },
        },
        required: ["requirement_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_in_resume",
      description:
        "在简历中按关键词检索相关段落。改写之前先用它定位到要改的原文,不要凭记忆写原文。",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "检索关键词" },
        },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "try_rewrite",
      description:
        "把简历中的一段原文替换成你写的新版本,系统会重新逐条评分并返回新分数。" +
        "这是你唯一的效果验证手段 —— 不要凭感觉判断改写是否有效,一律用它验证。" +
        "分数提升则改动保留,未提升则自动回退。" +
        "original_text 必须逐字来自简历,可先用 find_in_resume 确认。",
      parameters: {
        type: "object",
        properties: {
          requirement_id: {
            type: "string",
            description: "这次改写针对哪条要求",
          },
          original_text: {
            type: "string",
            description: "简历中要被替换的原文,必须逐字一致",
          },
          rewritten_text: {
            type: "string",
            description:
              "改写后的文本。只能重组和强调简历中已有的事实,严禁编造经历、数字或成果。",
          },
        },
        required: ["requirement_id", "original_text", "rewritten_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "向用户提一个具体问题。当你判断某条要求的差距**不是表述问题而是简历里缺少事实**时使用 —— " +
        "典型信号是:你改写后分数没有变化。问题要具体、可回答,不要问「你还有什么补充」这种空问题。",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "要问用户的问题" },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description:
        "结束优化。当你判断剩余可改项的预期收益已经很低时主动调用,不必用尽预算。" +
        "不需要写总结 —— 改了什么、涨了多少分、还差哪几条,系统会自己根据验证记录列出来。" +
        "你唯一需要提供的是:哪些要求属于经历缺失,以及面试时该怎么应对。",
      parameters: {
        type: "object",
        properties: {
          unfixable: {
            type: "array",
            description:
              "改简历无法解决的要求(属于经历缺失,不是表述问题)。不要把只是没试过的条目放进来。",
            items: {
              type: "object",
              properties: {
                requirement_id: { type: "string" },
                reason: { type: "string", description: "为什么改简历解决不了" },
                interview_advice: {
                  type: "string",
                  description: "面试中可以怎么应对这个缺口",
                },
              },
              required: ["requirement_id", "reason", "interview_advice"],
            },
          },
        },
        // 必填,即使是空数组:强迫模型明确表态哪些是经历缺失,
        // 而不是默认省略 —— 面试应对建议是这个字段唯一的来源。
        required: ["unfixable"],
      },
    },
  },
];

/* ------------------------------------------------------------------ */
/* 系统提示                                                            */
/* ------------------------------------------------------------------ */

function systemPrompt(): string {
  return `你是一个简历优化助手。目标:在**不编造任何事实**的前提下,通过改写简历中已有的内容,提升它与目标岗位 JD 的匹配度,并产出用户可执行的建议。

你有五个工具。请注意工具的分工:工具负责你做不到的事(查看判断详情、检索简历、**验证效果**、向用户提问),写文案是你自己的本职,不要指望工具替你写。

工作方式:

1. 先用 get_gap_detail 了解差距最大的几条要求,判断哪些值得动。
   优先级参考:权重高(硬性要求 3 分,加分项 1 分)且有改进空间的优先。

2. 改写前用 find_in_resume 定位原文,不要凭记忆写 original_text。

3. 每次改写都必须用 try_rewrite 验证。**分数是唯一标准**,不要凭感觉判断改得好不好。

4. **如果改写后分数没有变化,说明问题不在表述,而在简历里缺少事实。**
   这时不要反复换措辞重试 —— 换用 ask_user 向用户补充信息,拿到回答后再改写。

5. 有些要求属于经历缺失(候选人确实没做过),改写和提问都解决不了。
   识别出来后不要浪费预算,在 finish 里作为 unfixable 列出,并给出面试应对建议。

6. 判断剩余收益已经很低时,主动调用 finish 结束,不必用尽预算。

铁律:

- **严禁编造经历、数字、公司名、成果。** 改写只能重组、强调、具体化简历中**已经存在**的事实,或整合用户通过 ask_user 明确提供的信息。
- 违反这条会让整个产品失去意义 —— 用户拿着编造的简历去面试会当场穿帮。
- **加形容词不算改写。** 往简历里塞一句"具备较强的 X 能力""对 Y 有强烈兴趣"是没用的:
  评分器只认可核验的事实(具体项目、数字、时间、成果),自我评价最高只能拿到 medium 置信度。
  想让一条软性素质要求真正达标,唯一的办法是找到简历里能说明这项能力的**具体事情**并讲清楚;
  简历里确实没有这样的事情时,用 ask_user 去问,而不是替用户写一句漂亮话。
- 每一轮都必须调用至少一个工具。不要只输出文字而不调用工具。`;
}

function budgetNote(state: BudgetState): string {
  return `[预算] 已用 ${state.turns}/${BUDGET.maxTurns} 轮;改写验证还剩 ${
    BUDGET.maxRewrites - state.rewrites
  } 次;提问还剩 ${BUDGET.maxAsks - state.asks} 次。请据此安排剩余动作,接近用尽时尽快 finish。`;
}

/* ------------------------------------------------------------------ */
/* 运行时状态                                                          */
/* ------------------------------------------------------------------ */

export interface BudgetState {
  turns: number;
  rewrites: number;
  asks: number;
}

interface RunState {
  resumeText: string;
  items: EvaluatedItem[];
  score: number;
  effective: RewriteRecord[];
  ineffective: RewriteRecord[];
  budget: BudgetState;
}

/** 重新逐条判断并算分。只跑第二步 —— 要求清单不随简历变化,没必要重抽 */
/**
 * 改写后重新评分 —— **只重判被改的那一条**。
 *
 * 早期版本每次改写都重跑整份清单,分差因此被污染:模型对其它要求的判断
 * 本身带随机性,那部分抖动会被算到这次改写头上。真实运行里出现过
 *「一条权重 11 分的要求,改写后涨了 16 分」—— 多出来的 5 分来自别处,
 * 界面却把它记成这次改写的功劳。
 *
 * reward function 必须只反映**这一个动作**的效果,否则 agent 学到的是噪声。
 * 顺带:每次验证从判断 12 条变成判断 1 条,这是全流程最大的成本项。
 *
 * 代价:一次改写如果顺带帮到了别的要求,这里看不见。
 * 可接受 —— 宁可低估,也不要把噪声当成果。
 */
async function rescoreOne(
  resumeText: string,
  requirements: Requirement[],
  targetId: string,
  current: EvaluatedItem[],
  signal?: AbortSignal,
): Promise<{ score: number; items: EvaluatedItem[] } | null> {
  const target = requirements.filter((r) => r.id === targetId);
  if (target.length === 0) return null;

  const fresh: Judgment[] = [];
  try {
    for await (const judgment of judgeRequirements(
      { resumeText, requirements: target },
      signal,
    )) {
      fresh.push(judgment);
    }
  } catch {
    // 只判一条时上游抖一下就会整条失败。让这次工具调用失败、
    // 由模型自己决定重试还是换条路,比中断整轮 agent 好。
    return null;
  }
  if (fresh.length === 0) return null;

  const byId = new Map(fresh.map((j) => [j.id, j]));
  const items = current.map((item) => {
    const j = byId.get(item.id);
    if (!j) return item;
    return {
      ...item,
      satisfaction: j.satisfaction,
      confidence: j.confidence,
      evidence: j.evidence,
      note: j.note,
    };
  });
  return { score: computeScore(items).score, items };
}

/* ------------------------------------------------------------------ */
/* 工具执行                                                            */
/* ------------------------------------------------------------------ */

function describeItem(item: EvaluatedItem): string {
  const status =
    STATUS_LABEL[toDisplayStatus(item.satisfaction, item.confidence)];
  return [
    `要求 ${item.id}:${item.text}`,
    `分类:${item.category} | 权重:${WEIGHT[item.importance]}(${
      item.importance === "must" ? "硬性要求" : "加分项"
    })`,
    `当前判定:${status}`,
    `简历中的证据:${item.evidence ?? "(未找到)"}`,
    `判断备注:${item.note}`,
  ].join("\n");
}

/** 检索简历段落。按空行分段,返回命中的段落及其前后文 */
function findInResume(resumeText: string, keyword: string): string {
  const key = keyword.trim();
  if (!key) return "关键词为空。";

  const lines = resumeText.split("\n");
  const hits: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(key)) continue;
    const from = Math.max(0, i - 1);
    const to = Math.min(lines.length - 1, i + 1);
    hits.push(lines.slice(from, to + 1).join("\n"));
    if (hits.length >= 5) break;
  }

  if (hits.length === 0) {
    return `简历中没有包含「${key}」的内容。换个关键词再试,或考虑这条要求可能属于经历缺失。`;
  }
  return `命中 ${hits.length} 处:\n\n${hits.join("\n---\n")}`;
}

/** 每个工具执行后要回给模型的文本,以及给前端看的一句人话 */
interface ToolOutcome {
  toModel: string;
  summary: string;
  ok: boolean;
  scoreChange?: { from: number; to: number; delta: number };
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  state: RunState,
  requirements: Requirement[],
  signal?: AbortSignal,
): Promise<ToolOutcome> {
  if (name === "get_gap_detail") {
    const id = String(args.requirement_id ?? "");
    const item = state.items.find((i) => i.id === id);
    if (!item) {
      return {
        toModel: `没有编号为 ${id} 的要求。可用编号:${state.items.map((i) => i.id).join("、")}`,
        summary: `查询 ${id} —— 不存在`,
        ok: false,
      };
    }
    return {
      toModel: describeItem(item),
      summary: `查看要求 ${id}:${item.text.slice(0, 20)}…`,
      ok: true,
    };
  }

  if (name === "find_in_resume") {
    const keyword = String(args.keyword ?? "");
    return {
      toModel: findInResume(state.resumeText, keyword),
      summary: `在简历中检索「${keyword}」`,
      ok: true,
    };
  }

  if (name === "try_rewrite") {
    const requirementId = String(args.requirement_id ?? "");
    const original = String(args.original_text ?? "");
    const rewritten = String(args.rewritten_text ?? "");

    if (!original || !rewritten) {
      return {
        toModel: "original_text 和 rewritten_text 都不能为空。",
        summary: "改写参数不完整",
        ok: false,
      };
    }
    if (!state.resumeText.includes(original)) {
      return {
        toModel:
          "简历中找不到这段原文,无法替换。请先用 find_in_resume 拿到准确的原文再试,注意标点和空格必须完全一致。",
        summary: "改写失败:原文未匹配",
        ok: false,
      };
    }
    if (state.budget.rewrites >= BUDGET.maxRewrites) {
      return {
        toModel: "改写验证次数已用尽,请调用 finish 结束并输出结论。",
        summary: "改写次数已用尽",
        ok: false,
      };
    }

    state.budget.rewrites += 1;
    const candidate = state.resumeText.replace(original, rewritten);
    const rescored = await rescoreOne(
      candidate,
      requirements,
      requirementId,
      state.items,
      signal,
    );
    if (!rescored) {
      return {
        toModel: `无法对 ${requirementId} 重新评分(编号不存在,或本次判断失败)。请确认编号无误后重试,或换一条要求。`,
        summary: `验证改写(${requirementId}):评分失败`,
        ok: false,
      };
    }
    const { score: newScore, items: newItems } = rescored;

    const before = state.score;
    const delta = newScore - before;
    const requirement = requirements.find((r) => r.id === requirementId);
    // 这条要求按权重折算的分值。要求条数少时单条能值二三十分,
    // 不给参照系的话「+27」看着像瞎给的,给了就是「从 0 分补到满」。
    const weightPoints = requirementWeightPoints(
      newItems,
      requirement?.importance ?? "nice",
    );
    const record: RewriteRecord = {
      requirementId,
      requirementText: requirement?.text ?? requirementId,
      originalText: original,
      rewrittenText: rewritten,
      scoreBefore: before,
      scoreAfter: newScore,
      delta,
      weightPoints,
    };

    if (delta > 0) {
      // 有效 —— 保留,后续改写在此基础上继续
      state.resumeText = candidate;
      state.items = newItems;
      state.score = newScore;
      state.effective.push(record);
      return {
        toModel: `改写有效。匹配度 ${before} → ${newScore}(+${delta};这条要求按权重折算值 ${weightPoints} 分)。改动已保留,后续在此基础上继续。`,
        summary: `验证改写(${requirementId}):+${delta} 分 / 这条权重 ${weightPoints} 分`,
        ok: true,
        scoreChange: { from: before, to: newScore, delta },
      };
    }

    // 无效 —— 回退。
    // 刻意**不发 scoreChange**:改动已经回退,当前分数仍是 before。
    // 把试算出来的 newScore 报给前端会让界面显示一个从未生效过的分数。
    state.ineffective.push(record);
    return {
      toModel: `改写无效,匹配度仍为 ${before} 分,改动已回退。这说明差距不在表述,而是简历里缺少相应事实 —— 不要再换措辞重试,考虑用 ask_user 向用户补充信息。`,
      summary: `验证改写(${requirementId}):无提升,已回退`,
      ok: true,
    };
  }

  return {
    toModel: `未知工具:${name}`,
    summary: `未知工具 ${name}`,
    ok: false,
  };
}

function parseArgs(call: ToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.function.arguments || "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

const TOOL_LABEL: Record<string, string> = {
  get_gap_detail: "查看要求详情",
  find_in_resume: "检索简历",
  try_rewrite: "验证改写效果",
  ask_user: "向你提问",
  finish: "整理结论",
};

/* ------------------------------------------------------------------ */
/* 主循环                                                              */
/* ------------------------------------------------------------------ */

export async function* runAgent(
  input: AgentInput,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent, void, unknown> {
  const { requirements } = input;

  // 续跑时从快照恢复,否则从基线开始。
  // 关键:快照带着已生效的改写和累计分数 —— 少了它,
  // 每次被 ask_user 打断后都会退回原始简历重来。
  const state: RunState = input.snapshot
    ? {
        resumeText: input.snapshot.resumeText,
        items: input.snapshot.items,
        score: input.snapshot.score,
        effective: [...input.snapshot.effective],
        ineffective: [...input.snapshot.ineffective],
        budget: { ...input.snapshot.budget },
      }
    : {
        resumeText: input.resumeText,
        items: input.baselineItems,
        score: input.baselineScore,
        effective: [],
        ineffective: [],
        budget: { turns: 0, rewrites: 0, asks: 0 },
      };

  // 续跑:接上一次中断的对话,并把用户的回答作为那次 ask_user 的工具返回
  let messages: AgentMessage[];
  if (input.history && input.history.length > 0) {
    messages = [...input.history];
    if (input.askToolCallId) {
      messages.push({
        role: "tool",
        tool_call_id: input.askToolCallId,
        content: input.userAnswer?.trim()
          ? `用户回答:${input.userAnswer.trim()}`
          : "用户跳过了这个问题,请不要再问同一件事,继续用其它方式优化或直接 finish。",
      });
      state.budget.asks += 1;
    }
  } else {
    const gapLines = input.baselineItems
      .filter((i) => toDisplayStatus(i.satisfaction, i.confidence) !== "met")
      .map(
        (i) =>
          `- ${i.id}(权重 ${WEIGHT[i.importance]}):${i.text} —— 当前${
            STATUS_LABEL[toDisplayStatus(i.satisfaction, i.confidence)]
          }`,
      )
      .join("\n");

    messages = [
      { role: "system", content: systemPrompt() },
      {
        role: "user",
        content: `目标岗位 JD:\n${input.jdText}\n\n候选人简历:\n${input.resumeText}\n\n当前匹配度:${input.baselineScore} 分。\n\n未满足的要求:\n${gapLines}\n\n请开始优化。`,
      },
    ];
  }

  let stoppedByBudget = false;
  let declared: UnfixableDeclaration[] = [];

  while (state.budget.turns < BUDGET.maxTurns) {
    // 预算提示以 system 消息注入,和任务内容分开
    const turn = await chatWithTools(
      [...messages, { role: "system", content: budgetNote(state.budget) }],
      TOOLS,
      { signal },
    );

    state.budget.turns += 1;
    messages.push({
      role: "assistant",
      content: turn.content,
      tool_calls: turn.toolCalls,
    });

    if (turn.toolCalls.length === 0) {
      // 模型光说话不干活 —— 提醒一次,再犯就收尾
      messages.push({
        role: "system",
        content: "你没有调用任何工具。请调用工具推进,或调用 finish 结束。",
      });
      continue;
    }

    for (const call of turn.toolCalls) {
      const name = call.function.name;
      const args = parseArgs(call);

      yield { type: "tool_call", tool: name, label: TOOL_LABEL[name] ?? name };

      if (name === "finish") {
        declared = parseUnfixable(args.unfixable, requirements);
        // 补一条结果事件,否则界面上这一步会一直停在「进行中」
        yield {
          type: "tool_result",
          tool: "finish",
          summary: "判断剩余收益已低,主动结束",
          ok: true,
        };
        yield {
          type: "done",
          result: buildResult(input, state, declared, false),
        };
        return;
      }

      if (name === "ask_user") {
        const question = String(args.question ?? "").trim();
        if (!question || state.budget.asks >= BUDGET.maxAsks) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: !question
              ? "问题为空,请给出具体问题。"
              : "提问次数已用尽,请用其它方式优化或调用 finish。",
          });
          continue;
        }
        yield {
          type: "tool_result",
          tool: "ask_user",
          summary: "改写无法解决,转为向你提问",
          ok: true,
        };
        // 中断:把对话**和运行状态**一起交给前端保管,等用户回答后再续跑。
        // 少传 snapshot 会让已生效的改写在下一段丢失。
        yield {
          type: "ask_user",
          question,
          history: messages,
          toolCallId: call.id,
          snapshot: {
            resumeText: state.resumeText,
            score: state.score,
            items: state.items,
            effective: state.effective,
            ineffective: state.ineffective,
            budget: state.budget,
          },
        };
        return;
      }

      const outcome = await executeTool(
        name,
        args,
        state,
        requirements,
        signal,
      );
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: outcome.toModel,
      });
      yield {
        type: "tool_result",
        tool: name,
        summary: outcome.summary,
        ok: outcome.ok,
      };
      if (outcome.scoreChange && outcome.scoreChange.delta !== 0) {
        yield { type: "score_change", ...outcome.scoreChange };
      }
    }
  }

  // 轮次用尽,模型没有主动收尾
  stoppedByBudget = true;
  yield {
    type: "done",
    result: buildResult(input, state, declared, stoppedByBudget),
  };
}

/** 模型在 finish 里申报的「经历缺失」条目,是面试应对建议的唯一来源 */
interface UnfixableDeclaration {
  requirementId: string;
  reason: string;
  interviewAdvice: string;
}

function parseUnfixable(
  raw: unknown,
  requirements: Requirement[],
): UnfixableDeclaration[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((u): UnfixableDeclaration[] => {
    if (typeof u !== "object" || u === null) return [];
    const o = u as Record<string, unknown>;
    const id = String(o.requirement_id ?? "");
    // 编号对不上就丢弃 —— 宁可少一条建议,也不要凭空造一条要求
    if (!requirements.some((r) => r.id === id)) return [];
    return [
      {
        requirementId: id,
        reason: String(o.reason ?? ""),
        interviewAdvice: String(o.interview_advice ?? ""),
      },
    ];
  });
}

function buildResult(
  input: AgentInput,
  state: RunState,
  declared: UnfixableDeclaration[],
  stoppedByBudget: boolean,
): AgentResult {
  const gapById = new Map(declared.map((d) => [d.requirementId, d]));
  const improved = new Set(state.effective.map((r) => r.requirementId));
  const triedAndFailed = new Set(state.ineffective.map((r) => r.requirementId));

  /*
   * 判定顺序是有讲究的:**算分器的记录优先于模型的说法**。
   * 一条要求如果确实被改写加过分,不管模型在 finish 里怎么说,
   * 它都是「已提升、仍有差距」,而不是「经历缺失」——
   * 前者有验证记录支撑,后者只是模型的判断。
   */
  const kindOf = (id: string): RemainingKind =>
    improved.has(id)
      ? "partially_improved"
      : gapById.has(id)
        ? "experience_gap"
        : triedAndFailed.has(id)
          ? "rewrite_failed"
          : "not_attempted";

  /*
   * 「还没解决的」以**算分器的最终判定**为准,而不是把模型说的话抄一遍。
   *
   * 这样有两个好处:
   *   1. 条数和分数天然一致 —— 界面上的 94 分,扣掉的那些能一条条数出来。
   *   2. 同一条要求先失败后成功(问过用户再改就成了)的情况自动消失:
   *      它已经 met,根本不会进这个列表,不会出现自相矛盾的两栏。
   */
  const remaining = sortByPriority(
    state.items.filter(
      (item) => toDisplayStatus(item.satisfaction, item.confidence) !== "met",
    ),
  ).map((item): RemainingItem => {
    const kind = kindOf(item.id);
    const gap = gapById.get(item.id);
    return {
      requirementId: item.id,
      requirementText: item.text,
      kind,
      importance: item.importance,
      status: toDisplayStatus(item.satisfaction, item.confidence),
      // 面试建议只在模型确实把它当经历缺口时才给 ——
      // 一条刚被改写提升过的要求,配一段「面试怎么圆场」是自相矛盾的
      reason: kind === "experience_gap" ? gap?.reason : undefined,
      interviewAdvice:
        kind === "experience_gap" ? gap?.interviewAdvice : undefined,
    };
  });

  return {
    baselineScore: input.baselineScore,
    finalScore: state.score,
    turnsUsed: state.budget.turns,
    asksUsed: state.budget.asks,
    effective: state.effective,
    remaining,
    finalResumeText: state.resumeText,
    stoppedByBudget,
  };
}

/** 供 API 层做输入校验用 */
export function assertUsable(input: AgentInput): string | null {
  if (input.requirements.length === 0) return "缺少要求清单";
  if (input.baselineItems.length === 0) return "缺少基线判断结果";
  if (!input.resumeText.trim()) return "缺少简历内容";
  if (!input.jdText.trim()) return "缺少岗位描述";
  return null;
}

export { LlmError };
