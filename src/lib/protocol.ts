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
