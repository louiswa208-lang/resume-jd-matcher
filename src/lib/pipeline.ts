/**
 * 两步 pipeline —— 产品的核心。
 *
 *   第一步:只从 JD 抽取「要求清单」(结构化,非流式)
 *   第二步:拿着清单逐条比对简历(流式,一条一条吐)
 *
 * 为什么拆两步,而不是一次调用搞定(docs/design.md 决策 4):
 * 因为第一步跑完,前端就真的知道了「要核查哪 12 条」。
 * 界面上「正在核查:3年以上B端产品经验」显示的是**真实进度**,
 * 不是前端写死的假动画。一次调用做不到这一点。
 */

import { chatJson, chatStream, LlmError, type ChatMessage } from "./deepseek";
import { JsonObjectExtractor } from "./json-stream";
import { CONFIDENCE_CRITERIA } from "./types";
import type {
  Confidence,
  Importance,
  Judgment,
  Requirement,
  RequirementCategory,
  Satisfaction,
} from "./types";

/**
 * 单次分析最多处理的要求条数。
 * 上限存在的理由是双重的:控制成本和延迟,以及控制**结果页的可读性**——
 * 30 条要求的结果页没人会读完。优先保留硬性要求。
 */
const MAX_REQUIREMENTS = 15;

const CATEGORIES: RequirementCategory[] = [
  "硬性资格",
  "专业技能",
  "经验",
  "软性素质",
];
const IMPORTANCES: Importance[] = ["must", "nice"];
const SATISFACTIONS: Satisfaction[] = ["met", "partial", "unmet"];
const CONFIDENCES: Confidence[] = ["high", "medium", "low"];

/* ------------------------------------------------------------------ */
/* 第一步:抽取要求清单                                                  */
/* ------------------------------------------------------------------ */

const EXTRACT_SYSTEM = `你是一个招聘 JD 分析器。你的任务是把一份岗位描述拆解成一条条独立、可判断的「对候选人的要求」。

规则:

1. 只抽取**对候选人的要求**(通常在"任职要求""岗位要求""任职资格"部分)。
   **不要**抽取岗位职责/工作内容(那是这个岗位要做什么,不是对人的要求)。
2. 每条要求必须是**原子的**——一条只讲一件事。如果原文一句话里包含多个要求
   (例如"熟悉 SQL 和 Python,有数据分析经验"),拆成多条。
3. text 字段尽量保留 JD 原文表述,不要改写成你自己的话。
4. category 必须是以下之一:
   - "硬性资格":学历、专业、工作年限、证书、语言等级等可客观核对的门槛
   - "专业技能":具体的工具、技术、方法论
   - "经验":做过什么类型的事、什么行业、什么规模
   - "软性素质":沟通、抗压、学习能力、团队协作等
5. importance 判断依据是**JD 的原文措辞**,不是你对重要性的主观排序:
   - "must":正常列在任职要求里的条目,以及带"必须""要求""需要"等措辞的
   - "nice":明确标注为"加分项""优先""最好""nice to have""有…者优先"的
   如果 JD 没有明确区分,默认为 "must"。
6. 最多输出 ${MAX_REQUIREMENTS} 条。超出时优先保留 must,再保留靠前的。
7. id 用 "r1"、"r2" 这样的连续编号。

只输出 JSON,格式:
{"requirements":[{"id":"r1","text":"...","category":"硬性资格","importance":"must"}]}`;

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function normalizeRequirement(raw: unknown, index: number): Requirement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const text = asString(r.text);
  if (!text) return null; // 没有文本的要求毫无意义,直接丢弃

  const category = CATEGORIES.includes(r.category as RequirementCategory)
    ? (r.category as RequirementCategory)
    : "专业技能"; // 分类只影响展示分组,猜错不致命,给个中性默认值

  // 重要性猜错会直接影响分数,所以只接受明确的 "nice",其余一律按 must。
  // 宁可高估要求的重要性,也不要把硬性门槛当成加分项而虚高分数。
  const importance = IMPORTANCES.includes(r.importance as Importance)
    ? (r.importance as Importance)
    : "must";

  return {
    id: asString(r.id) ?? `r${index + 1}`,
    text,
    category,
    importance,
  };
}

/** 只有解析/校验失败才值得重试;key 错了重试一百次也是错的 */
function isRetryable(err: unknown): boolean {
  if (err instanceof LlmError) {
    return err.kind === "upstream" || err.kind === "network";
  }
  return true; // JSON.parse 失败等,值得重试一次
}

export async function extractRequirements(
  jdText: string,
  signal?: AbortSignal,
): Promise<Requirement[]> {
  const messages: ChatMessage[] = [
    { role: "system", content: EXTRACT_SYSTEM },
    { role: "user", content: `以下是岗位描述(JD):\n\n${jdText}` },
  ];

  let lastError: unknown;

  // 最多两次:模型输出不合规是常态,不是异常。第一次失败就重试一次,
  // 两次都不行才告诉用户——而不是直接把 JSON.parse 的报错抛到页面上。
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const content = await chatJson(messages, { signal });
      const parsed = JSON.parse(content) as { requirements?: unknown };

      const list = Array.isArray(parsed.requirements) ? parsed.requirements : [];
      const requirements = list
        .map((item, i) => normalizeRequirement(item, i))
        .filter((r): r is Requirement => r !== null)
        .slice(0, MAX_REQUIREMENTS);

      if (requirements.length > 0) return dedupeIds(requirements);

      lastError = new Error("模型返回了空的要求清单");
    } catch (err) {
      lastError = err;
      if (!isRetryable(err)) throw err;
    }
  }

  if (lastError instanceof LlmError) throw lastError;
  throw new LlmError(
    "upstream",
    "没能从这份 JD 里识别出任职要求。请确认粘贴的内容包含「任职要求」部分。",
  );
}

/** 模型偶尔会重复 id,重复的 id 会让第二步的结果互相覆盖 */
function dedupeIds(requirements: Requirement[]): Requirement[] {
  const seen = new Set<string>();
  return requirements.map((r, i) => {
    if (seen.has(r.id)) {
      const fresh = `r${i + 1}_${seen.size}`;
      seen.add(fresh);
      return { ...r, id: fresh };
    }
    seen.add(r.id);
    return r;
  });
}

/* ------------------------------------------------------------------ */
/* 第二步:逐条比对                                                      */
/* ------------------------------------------------------------------ */

const JUDGE_SYSTEM = `你是一个简历评估器。给你一份简历和一份「岗位要求清单」,你要对**每一条**要求单独判断这位候选人是否满足。

对每条要求输出四个字段:

- satisfaction:
  - "met":简历中有证据表明完全满足
  - "partial":有相关基础但存在明确差距(例如要求 3 年、简历是 2 年)
  - "unmet":有证据表明不满足
- confidence(这是最重要的字段,请严格按标准判断):
  - "high":${CONFIDENCE_CRITERIA.high}
  - "medium":${CONFIDENCE_CRITERIA.medium}
  - "low":${CONFIDENCE_CRITERIA.low}
- evidence:支撑判断的**简历原文片段**,必须逐字摘自简历,不得改写、不得编造。
  如果简历里找不到任何相关内容,必须填 null,同时 confidence 必须为 "low"。
- note:一句话中文说明,重点说清**差距在哪**或**为什么这么判断**。不要复述要求本身。

关键约束:

1. **只要你的判断依赖任何形式的推断、引申或"由 A 可以看出 B",
   而不是简历里的直接陈述,confidence 就必须是 "low"** ——
   无论你觉得这个推断多么合理、多么显然。
   自检方法:如果你打算在 note 里写"可以推断""体现出""说明其具备""间接反映",
   那这条的 confidence 就是 "low",没有例外。
2. **一句自我评价不是证据。** "具备较强的抽象与结构化能力""对新技术有强烈渴望"
   这类话只是把要求换个说法复述了一遍 —— 简历里写了这句,只能说明他愿意这么写。
   要给 "high",evidence 必须是**可核验的事实**:做过什么项目、什么时间、
   多少数量、什么结果。
   自检方法:把 evidence 那段话摆到面试官面前,他能追问出细节吗?
   如果只能追问出"你凭什么这么说",那这条最高就是 "medium"。
3. 上面两条对**软性素质**类要求(沟通、逻辑、抽象、抗压、学习能力等)尤其重要。
   这类能力在简历里要么没有直接陈述(→ low),要么只有一句自夸(→ 最高 medium)。
   只有当简历用具体事情说明了这项能力时,才可能是 "high"。
   宁可让用户自己来补充,也不要替他断言。
4. 简历没写 ≠ 候选人没有。找不到证据时,不要猜"应该不满足",
   而要如实标记 confidence 为 "low",让用户自己补充。
5. 每条要求都要输出,一条都不能漏。

只输出一个 JSON 数组,不要输出任何解释文字、不要用 markdown 代码块。格式:
[{"id":"r1","satisfaction":"met","confidence":"high","evidence":"...","note":"..."}]`;

function normalizeJudgment(raw: unknown): Judgment | null {
  if (typeof raw !== "object" || raw === null) return null;
  const j = raw as Record<string, unknown>;

  const id = asString(j.id);
  if (!id) return null; // 没有 id 就无法对应到要求,只能丢弃

  // satisfaction 和 confidence 直接影响分数和「证据不足」的判定,
  // 不接受猜测:值非法时按最保守的方式处理(不满足 + 低置信度),
  // 这样它会被归入「证据不足」,提示用户补充,而不是悄悄算成满足。
  const satisfaction = SATISFACTIONS.includes(j.satisfaction as Satisfaction)
    ? (j.satisfaction as Satisfaction)
    : "unmet";
  const confidence = CONFIDENCES.includes(j.confidence as Confidence)
    ? (j.confidence as Confidence)
    : "low";

  const evidence = asString(j.evidence);

  // 一致性修正:声称有高置信度却拿不出证据,是模型在自相矛盾。
  // 以「有没有证据」为准 —— 这是可核对的事实,而置信度是模型的自我评价。
  const coherentConfidence: Confidence = evidence === null ? "low" : confidence;

  return {
    id,
    satisfaction,
    confidence: coherentConfidence,
    evidence,
    note: asString(j.note) ?? "",
  };
}

/** 模型漏判某条要求时的兜底。文案要让用户看出这是系统的问题,不是他简历的问题 */
function fallbackJudgment(id: string): Judgment {
  return {
    id,
    satisfaction: "unmet",
    confidence: "low",
    evidence: null,
    note: "系统未能完成对这条要求的判断,建议你手动确认。",
  };
}

export interface JudgeInput {
  resumeText: string;
  requirements: Requirement[];
  /** 用户点「重新评估」时补充的信息 */
  supplement?: string;
}

/**
 * 流式产出每条要求的判断。
 *
 * 收尾时会对模型漏掉的要求补上兜底判断 —— 结果页必须每条要求都有着落,
 * 不能因为模型少吐了一条就让界面缺一块。
 */
export async function* judgeRequirements(
  input: JudgeInput,
  signal?: AbortSignal,
): AsyncGenerator<Judgment, void, unknown> {
  const { resumeText, requirements, supplement } = input;

  const requirementList = requirements
    .map((r) => `${r.id}. [${r.category}] ${r.text}`)
    .join("\n");

  const supplementBlock = supplement?.trim()
    ? `\n\n候选人补充说明(这些信息未写在简历里,但同样属于他的真实经历,请一并作为证据考虑):\n${supplement.trim()}`
    : "";

  const messages: ChatMessage[] = [
    { role: "system", content: JUDGE_SYSTEM },
    {
      role: "user",
      content: `简历全文:\n\n${resumeText}${supplementBlock}\n\n---\n\n岗位要求清单(请逐条判断,共 ${requirements.length} 条):\n\n${requirementList}`,
    },
  ];

  const extractor = new JsonObjectExtractor();
  const validIds = new Set(requirements.map((r) => r.id));
  const seen = new Set<string>();

  for await (const delta of chatStream(messages, { signal })) {
    for (const objText of extractor.push(delta)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(objText);
      } catch {
        continue; // 单个对象坏了不影响其它条,跳过
      }

      const judgment = normalizeJudgment(parsed);
      if (!judgment) continue;
      // 只接受清单里存在的 id,防止模型凭空造出一条判断
      if (!validIds.has(judgment.id) || seen.has(judgment.id)) continue;

      seen.add(judgment.id);
      yield judgment;
    }
  }

  // 一条都没解析出来 = 这一步彻底失败,应该报错而不是把整页标成「证据不足」
  if (seen.size === 0) {
    throw new LlmError("upstream", "模型未能返回可用的判断结果,请重试。");
  }

  for (const requirement of requirements) {
    if (!seen.has(requirement.id)) {
      yield fallbackJudgment(requirement.id);
    }
  }
}
