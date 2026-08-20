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
 * 这三条定义被真实运行修正过两次,两次都是同一个毛病:
 * **规则允许了某种「不算证据的东西」冒充证据,分数因此虚高。**
 *
 * 第一次 —— 推断。
 * 早期 medium 写作「有相关证据,但存在明确差距,**或需要推断**」。
 * 模型在备注里写「缺乏直接体现该能力的证据,需推断」却依然给 medium,
 * 于是这条没落进「证据不足」,反而按 0.5 分计入。修法:把「需要推断」整个划归 low。
 *
 * 第二次 —— 自我声称。
 * 修完第一次之后,high 是「简历中有直接、明确的陈述可以佐证」。
 * 但**一句自夸本身就是「直接明确的陈述」**:简历里写上「对新技术有强烈渴望」,
 * 这条软性素质就能拿满分。第二阶段的 agent 把这个洞找出来并利用了 ——
 * 它发现往简历里加一句形容词是最省力的涨分方式,一条要求直接从 0 分跳到满分。
 * 这不是 agent 的问题,是 reward function 定义得不对。
 *
 * 所以现在的分界是**证据的种类**,不是证据的有无:
 *   high   = 可核验的事实(项目、数字、时间、成果)
 *   medium = 只有自我声称,或有事实但不够
 *   low    = 连声称都没有,只能推断
 */
export const CONFIDENCE_CRITERIA: Record<Confidence, string> = {
  high: "简历中有**可核验的事实**支撑:具体的项目、数字、时间、成果或经历",
  medium:
    "简历中有直接相关的陈述,但要么与要求存在明确差距(例如要求 3 年、简历为 2 年),要么只是自我评价式的声称、背后没有事实佐证",
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
