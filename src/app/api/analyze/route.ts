/**
 * 分析接口。
 *
 * 流程:限流 → 校验输入 → 开流 → 第一步抽取 → 第二步逐条判断 → 结束。
 *
 * 一个刻意的选择:第一步放在流**里面**跑,而不是跑完再返回。
 * 这样用户点下按钮后立刻就能看到「正在读取 JD 要求…」,
 * 而不是对着一个没有任何反馈的按钮等 5 秒。
 * 代价是第一步的错误只能作为流内事件传回,不能用 HTTP 状态码表达——
 * 所以前端必须处理 error 事件,不能只看 response.ok。
 */

import { LlmError } from "@/lib/deepseek";
import { extractRequirements, judgeRequirements } from "@/lib/pipeline";
import {
  encodeEvent,
  LIMITS,
  type AnalyzeRequest,
  type ErrorKind,
  type StreamEvent,
} from "@/lib/protocol";
import { checkRateLimit, clientIp, formatResetIn } from "@/lib/rate-limit";
import type { Requirement } from "@/lib/types";

/** 这个接口每次都要真实执行,不能被任何一层缓存 */
export const dynamic = "force-dynamic";

function jsonError(status: number, kind: ErrorKind, message: string): Response {
  return Response.json({ type: "error", kind, message }, { status });
}

function validate(body: unknown): AnalyzeRequest | string {
  if (typeof body !== "object" || body === null) return "请求格式错误";
  const b = body as Record<string, unknown>;

  const jdText = typeof b.jdText === "string" ? b.jdText.trim() : "";
  const resumeText = typeof b.resumeText === "string" ? b.resumeText.trim() : "";

  if (jdText.length < LIMITS.jdMin) {
    return "岗位描述太短了,请把完整的 JD(尤其是「任职要求」部分)粘贴进来。";
  }
  if (jdText.length > LIMITS.jdMax) {
    return `岗位描述超过 ${LIMITS.jdMax} 字,请只粘贴岗位描述本身。`;
  }
  if (resumeText.length < LIMITS.resumeMin) {
    return "简历内容太短了。如果上传的 PDF 是扫描件,请把内容粘贴到文本框。";
  }
  if (resumeText.length > LIMITS.resumeMax) {
    return `简历内容超过 ${LIMITS.resumeMax} 字,请精简后再试。`;
  }

  const supplement =
    typeof b.supplement === "string"
      ? b.supplement.trim().slice(0, LIMITS.supplementMax)
      : undefined;

  // 复用上一轮的要求清单(重新评估场景)。这里要重新校验一遍,
  // 因为它来自客户端,不能假定没被改过。
  let requirements: Requirement[] | undefined;
  if (Array.isArray(b.requirements) && b.requirements.length > 0) {
    const parsed = b.requirements
      .filter(
        (r): r is Requirement =>
          typeof r === "object" &&
          r !== null &&
          typeof (r as Requirement).id === "string" &&
          typeof (r as Requirement).text === "string",
      )
      .slice(0, 30);
    if (parsed.length > 0) requirements = parsed;
  }

  return { jdText, resumeText, supplement, requirements };
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_input", "请求体不是合法 JSON");
  }

  const validated = validate(body);
  if (typeof validated === "string") {
    return jsonError(400, "invalid_input", validated);
  }

  const limit = checkRateLimit(clientIp(request));
  if (!limit.allowed) {
    return jsonError(
      429,
      "rate_limited",
      `今天的免费分析额度已用完(每天 ${limit.limit} 次),${formatResetIn(limit.resetInMs)}恢复。你可以先看看首页的示例。`,
    );
  }

  const { jdText, resumeText, supplement, requirements } = validated;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(encodeEvent(event)));
      };

      try {
        // ---- 第一步:拿到要核查的清单 ----
        let list: Requirement[];
        if (requirements) {
          // 重新评估:复用上一轮清单,跳过抽取。
          // 省一次调用,也保证两轮结果逐条可比。
          list = requirements;
        } else {
          send({ type: "status", stage: "extracting" });
          list = await extractRequirements(jdText, request.signal);
        }

        send({ type: "requirements", requirements: list });

        // ---- 第二步:逐条判断,边判边发 ----
        send({ type: "status", stage: "judging" });
        for await (const judgment of judgeRequirements(
          { resumeText, requirements: list, supplement },
          request.signal,
        )) {
          send({ type: "judgment", judgment });
        }

        send({ type: "done" });
      } catch (err) {
        // 客户端主动断开(关页面、点取消)不是错误,静默收尾
        if (request.signal.aborted) {
          controller.close();
          return;
        }

        if (err instanceof LlmError) {
          send({ type: "error", kind: err.kind, message: err.message });
        } else {
          console.error("[analyze] 未预期的错误:", err);
          send({
            type: "error",
            kind: "unknown",
            message: "分析过程出错了,请重试。",
          });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // 已经关掉了,忽略
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // 关掉 Nginx 一类反向代理的缓冲,否则流会被攒成一坨再发,
      // 前端的「逐条出现」就没了
      "X-Accel-Buffering": "no",
    },
  });
}
