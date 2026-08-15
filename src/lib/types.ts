/**
 * 领域类型定义。
 *
 * 设计要点:模型只输出「判断」(satisfaction / confidence / evidence),
 * 不输出任何分数。分数由 scoring.ts 里的规则算出来。
 * 理由见 docs/design.md 决策 1。
 */

/** 要求的分类,由模型在第一步从 JD 归类 */
export type RequirementCategory = "硬性资格" | "专业技能" | "经验" | "软性素质";

/**
 * 重要性。由模型从 JD **原文措辞**判断("任职要求"vs"加分项"、
 * "必须"vs"优先考虑"),而不是模型自己发明的重要性排序。
 */
export type Importance = "must" | "nice";

/** 第一步输出:从 JD 抽取出的单条要求 */
export interface Requirement {
  id: string;
  /** JD 原文里这条要求的表述,尽量保持原话 */
  text: string;
  category: RequirementCategory;
  importance: Importance;
}

/** 满足程度。这是模型对简历的判断 */
export type Satisfaction = "met" | "partial" | "unmet";

/**
 * 置信度。三档,每档有明确判定标准(见 CONFIDENCE_CRITERIA)。
 * 刻意不用百分比 —— 模型吐出的 "82.3%" 是假精确,没有校准过。
 *
 * 这三条定义是**唯一事实来源**:pipeline.ts 的 prompt 直接引用它们,
 * 不再各写一份,避免两处定义悄悄漂移。
 */
export type Confidence = "high" | "medium" | "low";

/**
 * 分档的关键在 medium 和 low 的边界:**是否需要推断**。
 *
 * 早期版本把 medium 定义成「有相关证据,但存在明确差距,**或需要推断**」,
 * 真实跑测时暴露了问题:模型在备注里写「缺乏直接体现该能力的证据,需推断」,
 * 却依然给了 medium,于是这条没有落进「证据不足」,反而按 0.5 分计入。
 * 软性素质类要求(沟通、逻辑、抗压)在简历里几乎从来没有直接陈述,
 * 会被系统性高估,分数虚高——而虚高恰恰砸的是本产品「诚实」的立身之本。
 *
 * 所以现在把「需要推断」整个划归 low:
 *   medium = 有直接证据,只是不够
 *   low    = 没有直接证据,只能推断
 */
export const CONFIDENCE_CRITERIA: Record<Confidence, string> = {
  high: "简历中有直接、明确的陈述可以佐证",
  medium: "简历中有直接证据,但与要求存在明确差距(例如要求 3 年、简历为 2 年)",
  low: "简历中没有直接陈述,需要推断或引申才能得出结论",
};

/** 第二步输出:针对单条要求的判断 */
export interface Judgment {
  /** 对应 Requirement.id */
  id: string;
  satisfaction: Satisfaction;
  confidence: Confidence;
  /** 简历中支撑该判断的原文片段;找不到时为 null */
  evidence: string | null;
  /** 一句话说明,差距在哪 / 为什么这么判断 */
  note: string;
}

/** 要求 + 判断,合并后用于渲染 */
export interface EvaluatedItem extends Requirement, Omit<Judgment, "id"> {}

/**
 * UI 上呈现的状态。注意它不等于 satisfaction:
 * 当 confidence 为 low 时,无论模型说满足与否,一律归为「证据不足」——
 * 系统承认自己没找到证据,而不是假装知道。
 */
export type DisplayStatus = "met" | "partial" | "unmet" | "insufficient";

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  met: "已满足",
  partial: "部分满足 · 有差距",
  unmet: "不满足",
  insufficient: "证据不足 · 建议补充",
};

/** 算分结果 */
export interface ScoreResult {
  /** 0-100 整数 */
  score: number;
  /** 各状态的条目数,用于结果页那句解释文案 */
  counts: Record<DisplayStatus, number>;
  /** 总条数 */
  total: number;
}

/** 一次完整分析的结果 */
export interface AnalysisResult {
  items: EvaluatedItem[];
  score: ScoreResult;
}
