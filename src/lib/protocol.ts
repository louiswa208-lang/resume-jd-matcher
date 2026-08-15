/**
 * 前后端之间的流式协议。
 *
 * 用 NDJSON(一行一个 JSON 对象)而不是 SSE:
 * 我们不需要 SSE 的自动重连和事件类型,只需要「一行一个事件」,
 * NDJSON 更简单,前后端各十几行代码就能收发。
 */

import type { Judgment, Requirement } from "./types";

export type StreamStage = "extracting" | "judging";

export type ErrorKind =
  | "invalid_input"
  | "rate_limited"
  | "missing_key"
  | "auth"
  | "upstream"
  | "network"
  | "timeout"
  | "unknown";

export type StreamEvent =
  /** 阶段变化,用于界面切换提示文案 */
  | { type: "status"; stage: StreamStage }
  /**
   * 第一步的产物。前端拿到它之后,才**真的知道**要核查哪几条,
   * 界面上的逐条进度从这一刻起是真实的。
   */
  | { type: "requirements"; requirements: Requirement[] }
  /** 第二步的产物,一条一条到达 */
  | { type: "judgment"; judgment: Judgment }
  | { type: "done" }
  | { type: "error"; kind: ErrorKind; message: string };

export interface AnalyzeRequest {
  jdText: string;
  resumeText: string;
  /** 用户点「重新评估」时补充的信息 */
  supplement?: string;
  /**
   * 重新评估时把上一轮的要求清单带回来,跳过第一步。
   * 既省一次调用,也保证两轮结果条目一致、可比较。
   */
  requirements?: Requirement[];
}

/** 输入长度边界。上限是为了控制成本,下限是为了拦住明显不是 JD/简历的输入 */
export const LIMITS = {
  jdMin: 20,
  jdMax: 20_000,
  resumeMin: 50,
  resumeMax: 30_000,
  supplementMax: 3_000,
} as const;

export function encodeEvent(event: StreamEvent): string {
  return JSON.stringify(event) + "\n";
}

/**
 * 给**用户**看的错误文案。
 *
 * 和内部错误信息分开的理由:内部信息是给我排错用的
 * (「未配置 DEEPSEEK_API_KEY」「模型服务返回 502」),
 * 对用户毫无意义,还会暴露实现细节。用户只需要知道两件事:
 * 这是谁的问题、现在该干什么。
 *
 * 所以按「用户能不能自己解决」分两类:
 *  - 能解决的(输入有问题、超额度)→ 说清楚怎么改
 *  - 不能解决的(密钥、鉴权、上游故障)→ 不甩锅给用户,给一条退路
 */
export const USER_FACING_ERROR: Record<ErrorKind, string> = {
  invalid_input: "输入内容有问题,请检查后重试。",
  rate_limited: "今天的免费分析额度已用完,请明天再来。你可以先看看首页的示例。",
  // 下面三种都是服务端配置或上游的问题,用户改什么都没用,
  // 所以不解释原因,直接给一条现在就能走的路。
  missing_key: "分析服务暂时不可用。你可以先看看首页的示例结果。",
  auth: "分析服务暂时不可用。你可以先看看首页的示例结果。",
  upstream: "分析服务暂时不可用,请稍后再试。",
  network: "网络连接不稳定,请检查网络后重试。",
  timeout: "这次分析超时了,请重试。如果多次失败,可以把简历内容精简一些。",
  unknown: "分析过程出了点问题,请重试。",
};
