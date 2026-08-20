/**
 * 算分规则。**这里没有任何模型调用** —— 这是刻意的。
 *
 * 模型只判断每条要求「满足 / 部分满足 / 不满足」+ 置信度;
 * 总分由下面的加权公式算出。这样做的三个理由(docs/design.md 决策 1):
 *
 *   1. 稳定:同样的判断永远算出同样的分数,刷新不会变。
 *      让模型直接给总分做不到这一点。
 *   2. 可解释:能回答「为什么是 72 分」。
 *   3. 职责划分:确定性计算交给规则,模糊判断交给模型。
 */

import type {
  Confidence,
  DisplayStatus,
  EvaluatedItem,
  Importance,
  Judgment,
  Requirement,
  Satisfaction,
  ScoreResult,
} from "./types";

/**
 * 重要性权重。硬性要求不满足,比加分项不满足扣得多。
 *
 * 这两个数字是**产品决策**,写死在代码里,不交给模型即兴发挥,
 * 也不开放给用户拖动 —— 用户不知道该怎么调,而且会把
 * 「我适不适合这个岗位」变成「我调到几分才开心」。
 */
export const WEIGHT: Record<Importance, number> = {
  must: 3,
  nice: 1,
};

/** 满足程度对应的得分系数 */
export const SATISFACTION_SCORE: Record<Satisfaction, number> = {
  met: 1,
  partial: 0.5,
  unmet: 0,
};

/**
 * 把「模型的判断」翻译成「界面上的状态」。
 *
 * 关键规则:置信度为 low 时一律归为 insufficient(证据不足),
 * 不管模型说满足与否。因为 low 的定义就是「简历里找不到证据」——
 * 这时候声称满足是没有依据的,声称不满足是冤枉用户。
 * 诚实的做法是单独归一类,并提示用户补充。
 */
export function toDisplayStatus(
  satisfaction: Satisfaction,
  confidence: Confidence,
): DisplayStatus {
  if (confidence === "low") return "insufficient";
  return satisfaction;
}

/**
 * 计分用的满足程度。
 * insufficient 按 unmet(0 分)计入 —— 不排除在分母外。
 *
 * 为什么不排除:排除会让分数虚高,用户也看不出自己漏写了关键信息。
 * 按 0 分计入 + 明确标注「证据不足」,才能形成
 * 分数偏低 → 看到原因是没写 → 有动力去补充 → 重新评估 的闭环。
 */
function effectiveSatisfaction(item: EvaluatedItem): Satisfaction {
  return toDisplayStatus(item.satisfaction, item.confidence) === "insufficient"
    ? "unmet"
    : item.satisfaction;
}

/**
 * 加权算分。
 *
 *   score = 100 × Σ(满足系数 × 权重) / Σ(权重)
 *
 * 空清单返回 0 分(而不是除零 NaN)。
 */
export function computeScore(items: EvaluatedItem[]): ScoreResult {
  const counts: Record<DisplayStatus, number> = {
    met: 0,
    partial: 0,
    unmet: 0,
    insufficient: 0,
  };

  let earned = 0;
  let possible = 0;

  for (const item of items) {
    counts[toDisplayStatus(item.satisfaction, item.confidence)] += 1;

    const weight = WEIGHT[item.importance] ?? WEIGHT.nice;
    possible += weight;
    earned += SATISFACTION_SCORE[effectiveSatisfaction(item)] * weight;
  }

  return {
    score: possible === 0 ? 0 : Math.round((earned / possible) * 100),
    counts,
    total: items.length,
  };
}

/**
 * 分数的**分辨率**:一条要求究竟值多少分。
 *
 * 存在的理由:分母是所有要求的权重之和,所以要求条数越少,单条越值钱。
 * 一份只抽出 4 条要求的 JD,一条硬性要求能值 27 分 ——
 * 用户看到「改了一句话涨了 27 分」的第一反应是这分数很好糊弄,
 * 而实际上那是算对的。
 *
 * 与其压住波动(平滑会让分数不再能用一个公式解释清楚,
 * 而可解释是这个产品的立身之本),不如**把分值摆到台面上**:
 * 标出每条值多少分,+27 就从"离谱"变成"算得出来"。
 *
 * 这和置信度刻意不用百分比是同一条原则 —— 不做假精确。
 */
export interface ScoreResolution {
  /** 一条硬性要求折算成多少分 */
  mustPoints: number;
  /** 一条加分项折算成多少分 */
  nicePoints: number;
  /**
   * 单条硬性要求分值过大 —— 要求太少,分数波动会很剧烈,不适合当精确数字看。
   * 阈值 15 分对应总权重 20,大致是 6 条硬性要求上下。
   */
  coarse: boolean;
}

const COARSE_THRESHOLD = 15;

/**
 * 取整而不保留小数:总分本来就是整数,给出「10.7 分」是假精确 ——
 * 和置信度刻意不用百分比是同一条原则。
 *
 * 注意这里说的是**权重折算的分值**,不是「这条最多能涨几分」。
 * 分差由两个取整后的总分相减得到,可能比它多 1 或少 1,这是取整的正常结果,
 * 所以对外的措辞是「这条权重 N 分」而不是「满分 N 分」。
 */
export function scoreResolution(items: EvaluatedItem[]): ScoreResolution {
  const possible = items.reduce(
    (sum, item) => sum + (WEIGHT[item.importance] ?? WEIGHT.nice),
    0,
  );
  if (possible === 0) {
    return { mustPoints: 0, nicePoints: 0, coarse: false };
  }
  const per = (weight: number) => Math.round((weight / possible) * 100);
  const mustPoints = per(WEIGHT.must);
  return {
    mustPoints,
    nicePoints: per(WEIGHT.nice),
    coarse: mustPoints > COARSE_THRESHOLD,
  };
}

/** 单条要求折算成多少分 —— 用于把 agent 的「+N 分」放回可比的尺度上 */
export function requirementWeightPoints(
  items: EvaluatedItem[],
  importance: Importance,
): number {
  const r = scoreResolution(items);
  return importance === "must" ? r.mustPoints : r.nicePoints;
}

/**
 * 把要求清单和判断合并成可渲染 / 可算分的条目。
 * 还没判断到的要求不出现(流式过程中会有这种中间态)。
 */
export function mergeItems(
  requirements: Requirement[],
  judgments: Judgment[],
): EvaluatedItem[] {
  const byId = new Map(judgments.map((j) => [j.id, j]));
  return requirements.flatMap((requirement) => {
    const judgment = byId.get(requirement.id);
    if (!judgment) return [];
    return [
      {
        ...requirement,
        satisfaction: judgment.satisfaction,
        confidence: judgment.confidence,
        evidence: judgment.evidence,
        note: judgment.note,
      },
    ];
  });
}

/** 已适配栏:只放明确满足的 */
export function isSatisfied(item: EvaluatedItem): boolean {
  return toDisplayStatus(item.satisfaction, item.confidence) === "met";
}

/**
 * 待补强栏的排序:差距最大、权重最高的排最前。
 *
 * 用户的注意力有限,排在最前面的应该是「最值得你现在去做点什么」的那几条,
 * 而不是按 JD 原文顺序。这是产品判断,不是技术细节。
 */
const GAP_PRIORITY: Record<DisplayStatus, number> = {
  unmet: 0, // 明确不满足,差距最实
  insufficient: 1, // 可能有,只是没写 —— 补一句就能改善
  partial: 2, // 有基础但不够
  met: 3, // 不会出现在这一栏
};

export function sortByPriority(items: EvaluatedItem[]): EvaluatedItem[] {
  return [...items].sort((a, b) => {
    const wa = WEIGHT[a.importance] ?? WEIGHT.nice;
    const wb = WEIGHT[b.importance] ?? WEIGHT.nice;
    // 先按权重降序:硬性要求永远排在加分项前面
    if (wa !== wb) return wb - wa;

    const sa = GAP_PRIORITY[toDisplayStatus(a.satisfaction, a.confidence)];
    const sb = GAP_PRIORITY[toDisplayStatus(b.satisfaction, b.confidence)];
    return sa - sb;
  });
}

/**
 * 结果页分数下面那句解释文案。
 *
 * 存在的理由:证据不足按 0 分计入会让首次出分偏低,用户第一眼看到
 * 「48 分」可能直接就走了。这句话把「分数低是因为信息缺失」摆到分数旁边,
 * 而不是藏在下面等用户自己发现。
 */
export function explainScore(result: ScoreResult): string {
  const { counts, total } = result;
  if (total === 0) return "没有从这份 JD 中识别出可评估的要求。";

  const parts = [`共识别出 ${total} 条要求,${counts.met} 条已满足`];
  if (counts.partial > 0) parts.push(`${counts.partial} 条部分满足`);
  if (counts.unmet > 0) parts.push(`${counts.unmet} 条不满足`);
  if (counts.insufficient > 0) {
    parts.push(`${counts.insufficient} 条因简历未提及暂记为不满足`);
  }

  const tail =
    counts.insufficient > 0
      ? "。补充这几条信息后重新评估,分数会更准确。"
      : "。";

  return parts.join("、") + tail;
}
