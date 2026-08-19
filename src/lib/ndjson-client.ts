/**
 * 通用的 NDJSON 流读取。/api/analyze 和 /api/optimize 共用。
 *
 * 两个接口的错误都有两条路径,调用方必须都处理:
 *  1. 流还没开起来就失败(校验不过、限流)→ HTTP 状态码 + JSON body
 *  2. 流开始之后失败(模型出错)→ HTTP 200,错误是流里的一个事件
 * 只看 response.ok 会漏掉第 2 种。
 */

export interface StreamErrorEvent {
  type: "error";
  kind: string;
  message: string;
}

export async function* readNdjsonStream<T>(
  url: string,
  payload: unknown,
  signal?: AbortSignal,
): AsyncGenerator<T | StreamErrorEvent, void, unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
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

  if (!response.ok) {
    let message = "请求失败,请重试。";
    let kind = "unknown";
    try {
      const data = (await response.json()) as { kind?: string; message?: string };
      if (data.message) message = data.message;
      if (data.kind) kind = data.kind;
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

      let index: number;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line === "") continue;
        try {
          yield JSON.parse(line) as T;
        } catch {
          // 半行或坏行,跳过
        }
      }
    }

    // 流结束时可能还剩最后一行(没有结尾换行)
    const tail = buffer.trim();
    if (tail !== "") {
      try {
        yield JSON.parse(tail) as T;
      } catch {
        // 忽略
      }
    }
  } finally {
    reader.releaseLock();
  }
}
