/**
 * DeepSeek API 调用层。
 *
 * 刻意不引 SDK,直接用 fetch:
 *  - 依赖少一个,构建快一点
 *  - DeepSeek 走 OpenAI 兼容协议,将来要换模型厂商,改动集中在这一个文件
 *    (这也是为什么整个 pipeline 不直接碰 fetch,只调这里的两个函数)
 */

const API_BASE = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

/** 调用方能识别的错误类型,用于给用户不同的提示文案 */
export type LlmErrorKind =
  | "missing_key"
  | "auth"
  | "rate_limited"
  | "upstream"
  | "network"
  | "timeout";

export class LlmError extends Error {
  kind: LlmErrorKind;
  constructor(kind: LlmErrorKind, message: string) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/* ------------------------------------------------------------------ */
/* Function calling —— agent 用                                        */
/* ------------------------------------------------------------------ */

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/**
 * agent 对话里的一条消息。
 * 比 ChatMessage 多两种形态:带 tool_calls 的 assistant 消息,
 * 和 role 为 "tool" 的工具返回。
 *
 * 这个类型会**原样在前后端之间往返**(分段续跑时前端持有它),
 * 所以字段必须是可 JSON 序列化的纯数据。
 */
export type AgentMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface AssistantTurn {
  content: string | null;
  toolCalls: ToolCall[];
  /** DeepSeek 返回的结束原因,用于判断是不是因为超长被截断 */
  finishReason: string | null;
}

/**
 * 带工具的一次调用。不流式 —— agent 循环里我们要拿到完整的
 * tool_calls 才能执行,流式没有意义(进度事件由循环自己产出)。
 */
export async function chatWithTools(
  messages: AgentMessage[],
  tools: ToolDefinition[],
  opts: { maxTokens?: number; signal?: AbortSignal } = {},
): Promise<AssistantTurn> {
  const res = await post(
    {
      model: MODEL,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0,
      max_tokens: opts.maxTokens ?? 2000,
      stream: false,
    },
    opts.signal,
  );

  const data = (await res.json()) as {
    choices?: {
      message?: { content?: string | null; tool_calls?: ToolCall[] };
      finish_reason?: string;
    }[];
  };

  const choice = data.choices?.[0];
  if (!choice?.message) {
    throw new LlmError("upstream", "模型返回结构异常:缺少 message");
  }

  return {
    content: choice.message.content ?? null,
    toolCalls: choice.message.tool_calls ?? [],
    finishReason: choice.finish_reason ?? null,
  };
}

function apiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || key.trim() === "") {
    throw new LlmError(
      "missing_key",
      "未配置 DEEPSEEK_API_KEY。把 .env.example 复制成 .env.local 并填入你的 key。",
    );
  }
  return key.trim();
}

/** 把 HTTP 状态码映射成我们自己的错误类型 */
function errorFromStatus(status: number, body: string): LlmError {
  if (status === 401 || status === 403) {
    return new LlmError("auth", `API key 无效或无权限(${status})`);
  }
  if (status === 429) {
    return new LlmError("rate_limited", "模型服务限流,请稍后再试");
  }
  return new LlmError(
    "upstream",
    `模型服务返回 ${status}${body ? `:${body.slice(0, 200)}` : ""}`,
  );
}

const TIMEOUT_MS = 90_000;

async function post(body: unknown, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify(body),
      signal: composed,
    });
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (timeout.aborted) {
      throw new LlmError("timeout", "模型服务响应超时");
    }
    throw new LlmError("network", "无法连接模型服务,请检查网络");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw errorFromStatus(res.status, text);
  }
  return res;
}

/**
 * 非流式调用,强制 JSON 输出。
 * 用于第一步(抽取要求清单)—— 这一步要等完整清单才能开始第二步,
 * 流式没有意义。
 */
export async function chatJson(
  messages: ChatMessage[],
  opts: { maxTokens?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const res = await post(
    {
      model: MODEL,
      messages,
      // JSON 模式:让模型只能输出合法 JSON。这消除了一整类
      // 「返回值带 markdown 代码块 / 前后有解释文字」的解析失败。
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: opts.maxTokens ?? 4000,
      stream: false,
    },
    opts.signal,
  );

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new LlmError("upstream", "模型返回结构异常:缺少 content");
  }
  return content;
}

/**
 * 流式调用,产出文本增量。
 * 用于第二步(逐条比对)—— 这一步的结果是逐条产生的,
 * 流式让前端能一条一条渲染出来,而不是干等十几秒再一次性刷出。
 */
export async function* chatStream(
  messages: ChatMessage[],
  opts: { maxTokens?: number; signal?: AbortSignal } = {},
): AsyncGenerator<string, void, unknown> {
  const res = await post(
    {
      model: MODEL,
      messages,
      temperature: 0,
      max_tokens: opts.maxTokens ?? 6000,
      stream: true,
    },
    opts.signal,
  );

  if (!res.body) {
    throw new LlmError("upstream", "模型服务未返回流");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE 以空行分隔事件;逐行处理已经完整到达的部分
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line === "" || !line.startsWith("data:")) continue;

        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;

        try {
          const chunk = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // 单个 chunk 解析失败不致命,跳过继续读
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
