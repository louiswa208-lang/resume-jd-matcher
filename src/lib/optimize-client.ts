/**
 * 调用 /api/optimize。
 *
 * 注意 ask_user 事件:它不是错误,是 agent 主动中断等你回答。
 * 收到之后要把 history 和 toolCallId 存下来,用户回答后带着它们再请求一次。
 */

import type { AgentEvent, AgentSnapshot } from "./agent";
import type { AgentMessage } from "./deepseek";
import { readNdjsonStream, type StreamErrorEvent } from "./ndjson-client";
import type { EvaluatedItem, Requirement } from "./types";

export interface OptimizeRequest {
  jdText: string;
  resumeText: string;
  requirements: Requirement[];
  baselineItems: EvaluatedItem[];
  baselineScore: number;
  /** 续跑时带上。snapshot 不能少 —— 它承载已生效的改写和累计分数 */
  history?: AgentMessage[];
  snapshot?: AgentSnapshot;
  userAnswer?: string;
  askToolCallId?: string;
}

export type OptimizeEvent = AgentEvent | StreamErrorEvent;

export function runOptimizeStream(
  payload: OptimizeRequest,
  signal?: AbortSignal,
): AsyncGenerator<OptimizeEvent, void, unknown> {
  return readNdjsonStream<AgentEvent>("/api/optimize", payload, signal);
}
