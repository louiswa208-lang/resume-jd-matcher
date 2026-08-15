/**
 * 前端读取 /api/analyze 的 NDJSON 流。
 *
 * 注意:这个接口的错误有两条路径 ——
 *  1. 流还没开始就失败(校验不过、限流):HTTP 状态码 + JSON body
 *  2. 流开始之后失败(模型出错):HTTP 200,错误作为流里的一个事件
 * 所以不能只看 response.ok 就以为没事,两条路都要处理。
 */

import type { AnalyzeRequest, ErrorKind, StreamEvent } from "./protocol";

export async function* readAnalyzeStream(
  payload: AnalyzeRequest,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, unknown> {
  let response: Response;
  try {
    response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch {
    if (signal?.aborted) return;
    yield {
      type: "error",
      kind: "network",
      message: "连不上服务器,请检查网络后重试。",
    };
    return;
  }

  // 路径 1:流没开起来
  if (!response.ok) {
    let message = "请求失败,请重试。";
    let kind: ErrorKind = "unknown";
    try {
      const data = (await response.json()) as { kind?: string; message?: string };
      if (data.message) message = data.message;
      if (data.kind) kind = data.kind as ErrorKind;
    } catch {
      // 响应体不是 JSON,用默认文案
    }
    yield { type: "error", kind, message };
    return;
  }

  if (!response.body) {
    yield { type: "error", kind: "unknown", message: "服务器没有返回数据。" };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line === "") continue;

        try {
          yield JSON.parse(line) as StreamEvent;
        } catch {
          // 半行或坏行,跳过
        }
      }
    }

    // 流结束时缓冲区里可能还剩最后一行(没有结尾换行)
    const tail = buffer.trim();
    if (tail !== "") {
      try {
        yield JSON.parse(tail) as StreamEvent;
      } catch {
        // 忽略
      }
    }
  } finally {
    reader.releaseLock();
  }
}
