/**
 * 调用 /api/analyze。读流的逻辑在 ndjson-client.ts,和 optimize 共用。
 */

import { readNdjsonStream } from "./ndjson-client";
import type { AnalyzeRequest, StreamEvent } from "./protocol";

export function readAnalyzeStream(
  payload: AnalyzeRequest,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, unknown> {
  return readNdjsonStream<StreamEvent>(
    "/api/analyze",
    payload,
    signal,
  ) as AsyncGenerator<StreamEvent, void, unknown>;
}
