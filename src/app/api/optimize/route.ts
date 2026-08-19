/**
 * 简历优化 Agent 接口。
 *
 * 和 /api/analyze 的关键区别:这里的执行路径**不是固定的**。
 * 每次运行调用多少次模型、调哪些工具、跑几轮,由模型自己决定,
 * 所以事件流的形状也因运行而异。
 *
 * 另一个区别是它可能**中途停下来等用户回答**(ask_user)。
 * 那时后端把 agent 的完整对话历史随事件返回,由前端保管;
 * 用户回答后前端带着历史再请求一次,后端从断点继续。
 * 后端全程无状态 —— 和第一阶段不存储用户数据的原则一致。
 */

import {
  assertUsable,
  runAgent,
  type AgentInput,
  type AgentSnapshot,
} from "@/lib/agent";
import { LlmError, type AgentMessage } from "@/lib/deepseek";
import { encodeEvent, USER_FACING_ERROR, type ErrorKind } from "@/lib/protocol";
import { checkRateLimit, clientIp, formatResetIn } from "@/lib/rate-limit";
import type { EvaluatedItem, Requirement } from "@/lib/types";

export const dynamic = "force-dynamic";

/** agent 单次运行可能跑十几次模型调用,给足超时 */
export const maxDuration = 300;

function jsonError(status: number, kind: ErrorKind, message: string): Response {
  return Response.json({ type: "error", kind, message }, { status });
}

function isRequirement(v: unknown): v is Requirement {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.text === "string";
}

function isEvaluatedItem(v: unknown): v is EvaluatedItem {
  if (!isRequirement(v)) return false;
  const r = v as unknown as Record<string, unknown>;
  return (
    typeof r.satisfaction === "string" && typeof r.confidence === "string"
  );
}

/**
 * history 来自客户端,不能假定没被改过。
 * 只做结构校验 —— 内容本来就是我们自己上一轮发出去的。
 */
function sanitizeHistory(v: unknown): AgentMessage[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const out: AgentMessage[] = [];
  for (const m of v) {
    if (typeof m !== "object" || m === null) continue;
    const o = m as Record<string, unknown>;
    if (o.role === "system" || o.role === "user") {
      if (typeof o.content === "string") out.push({ role: o.role, content: o.content });
    } else if (o.role === "assistant") {
      out.push({
        role: "assistant",
        content: typeof o.content === "string" ? o.content : null,
        tool_calls: Array.isArray(o.tool_calls)
          ? (o.tool_calls as AgentMessage[])
          : undefined,
      } as AgentMessage);
    } else if (o.role === "tool") {
      if (typeof o.tool_call_id === "string" && typeof o.content === "string") {
        out.push({
          role: "tool",
          tool_call_id: o.tool_call_id,
          content: o.content,
        });
      }
    }
  }
  // 上限:防止客户端回传一个超大数组把上游打爆
  return out.length > 0 ? out.slice(-80) : undefined;
}

/**
 * 快照同样来自客户端。这里只做结构校验和数值收敛 ——
 * 它本来就是我们上一段发出去的东西,但不能假定它没被改过:
 * 尤其 budget 被篡小会绕过成本上限。
 */
function sanitizeSnapshot(v: unknown): AgentSnapshot | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const s = v as Record<string, unknown>;
  if (typeof s.resumeText !== "string" || !s.resumeText.trim()) return undefined;

  const budget = (
    typeof s.budget === "object" && s.budget !== null ? s.budget : {}
  ) as Record<string, unknown>;
  const num = (x: unknown) =>
    typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0;

  return {
    resumeText: s.resumeText,
    score: typeof s.score === "number" ? Math.round(s.score) : 0,
    items: Array.isArray(s.items) ? (s.items.filter(isEvaluatedItem) as EvaluatedItem[]) : [],
    effective: Array.isArray(s.effective) ? (s.effective as AgentSnapshot["effective"]) : [],
    ineffective: Array.isArray(s.ineffective)
      ? (s.ineffective as AgentSnapshot["ineffective"])
      : [],
    budget: {
      turns: num(budget.turns),
      rewrites: num(budget.rewrites),
      asks: num(budget.asks),
    },
  };
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_input", "请求体不是合法 JSON");
  }
  if (typeof body !== "object" || body === null) {
    return jsonError(400, "invalid_input", "请求格式错误");
  }
  const b = body as Record<string, unknown>;

  const requirements = Array.isArray(b.requirements)
    ? b.requirements.filter(isRequirement)
    : [];
  const baselineItems = Array.isArray(b.baselineItems)
    ? b.baselineItems.filter(isEvaluatedItem)
    : [];

  const input: AgentInput = {
    jdText: typeof b.jdText === "string" ? b.jdText.trim() : "",
    resumeText: typeof b.resumeText === "string" ? b.resumeText.trim() : "",
    requirements,
    baselineItems,
    baselineScore:
      typeof b.baselineScore === "number" ? Math.round(b.baselineScore) : 0,
    history: sanitizeHistory(b.history),
    snapshot: sanitizeSnapshot(b.snapshot),
    userAnswer: typeof b.userAnswer === "string" ? b.userAnswer.slice(0, 2000) : undefined,
    askToolCallId:
      typeof b.askToolCallId === "string" ? b.askToolCallId : undefined,
  };

  const problem = assertUsable(input);
  if (problem) {
    return jsonError(400, "invalid_input", `${problem},请先完成一次匹配分析。`);
  }

  // 续跑不重复计入限额 —— 否则 agent 问三个问题就会烧掉四次配额,
  // 而那本来是同一次优化。
  const isContinuation = Boolean(input.history);
  if (!isContinuation) {
    const limit = checkRateLimit(`optimize:${clientIp(request)}`);
    if (!limit.allowed) {
      return jsonError(
        429,
        "rate_limited",
        `今天的优化额度已用完(每天 ${limit.limit} 次),${formatResetIn(limit.resetInMs)}恢复。`,
      );
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(encodeEvent(event as never)));
      };

      try {
        for await (const event of runAgent(input, request.signal)) {
          send(event);
        }
      } catch (err) {
        if (request.signal.aborted) {
          controller.close();
          return;
        }
        if (err instanceof LlmError) {
          console.error(`[optimize] ${err.kind}: ${err.message}`);
          send({
            type: "error",
            kind: err.kind,
            message: USER_FACING_ERROR[err.kind],
          });
        } else {
          console.error("[optimize] 未预期的错误:", err);
          send({
            type: "error",
            kind: "unknown",
            message: USER_FACING_ERROR.unknown,
          });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
