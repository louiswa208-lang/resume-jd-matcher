"use client";

/**
 * Agent 运行过程。
 *
 * 这里的动效值得花:它是产品里**唯一一处让人看见"AI 在自己做决定"**的地方。
 * 每一条工具调用都是模型自主选的,不是代码排好的顺序 ——
 * 所以逐条浮现不是装饰,它在展示决策过程本身。
 */

import {
  Check,
  CircleQuestionMark,
  FileSearch,
  FlaskConical,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCountUp } from "./use-count-up";

export interface RunStep {
  tool: string;
  label: string;
  /** 工具返回后的一句人话;还没返回时为空 */
  summary?: string;
  ok?: boolean;
  delta?: number;
}

const TOOL_ICON: Record<string, LucideIcon> = {
  get_gap_detail: FileSearch,
  find_in_resume: FileSearch,
  try_rewrite: FlaskConical,
  ask_user: CircleQuestionMark,
  finish: Sparkles,
};

interface Props {
  steps: RunStep[];
  score: number;
  baselineScore: number;
  running: boolean;
}

export function AgentRun({ steps, score, baselineScore, running }: Props) {
  const shown = useCountUp(score);
  const delta = score - baselineScore;

  return (
    <section className="border-rule bg-surface rounded-xl border p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-medium">
          {running && (
            <LoaderCircle
              size={15}
              className="text-insufficient animate-spin"
              aria-hidden
            />
          )}
          {running ? "AI 正在优化你的简历" : "优化过程"}
        </h2>

        <div className="flex items-baseline gap-2 font-mono text-sm">
          <span className="text-ink-faint">{baselineScore}</span>
          <span className="text-ink-faint">→</span>
          <span
            className={`text-lg font-medium tabular-nums transition-colors ${
              delta > 0 ? "text-met" : ""
            }`}
          >
            {shown}
          </span>
          {delta > 0 && (
            <span className="bg-met-bg text-met rounded-full px-2 py-0.5 text-[11px] font-medium">
              +{delta}
            </span>
          )}
        </div>
      </div>

      <p className="text-ink-faint mt-1.5 text-xs">
        下面每一步都是模型自己决定要做的,不是预设流程
      </p>

      <ol className="mt-5 space-y-px">
        {steps.map((step, index) => {
          const Icon = TOOL_ICON[step.tool] ?? FileSearch;
          const pending = step.summary === undefined;
          // 「验证改写」是唯一真正在挣分的动作 —— 它调用的是评分器。
          // 查询和检索只是它的准备工作,视觉上不该同等对待。
          const isVerify = step.tool === "try_rewrite";
          const gained = typeof step.delta === "number" && step.delta > 0;

          return (
            <li
              key={index}
              className={`animate-rise flex items-start gap-3 rounded-md px-2 py-2 text-sm transition-colors ${
                pending ? "animate-sweep" : ""
              } ${gained ? "bg-met-tint" : ""}`}
              style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
            >
              <span className="mt-0.5 flex w-4 shrink-0 justify-center" aria-hidden>
                {pending ? (
                  <Icon size={14} className="text-insufficient" />
                ) : step.ok === false ? (
                  <X size={14} className="text-partial" strokeWidth={2.5} />
                ) : (
                  <Check
                    size={14}
                    className={gained ? "text-met" : "text-ink-faint"}
                    strokeWidth={2.5}
                  />
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span
                  className={
                    pending
                      ? "text-ink"
                      : isVerify
                        ? "text-ink font-medium"
                        : "text-ink-soft"
                  }
                >
                  {step.summary ?? step.label + "…"}
                </span>
              </span>

              {typeof step.delta === "number" && step.delta !== 0 && (
                <span
                  className={`shrink-0 font-mono text-xs tabular-nums ${
                    step.delta > 0 ? "text-met" : "text-ink-faint"
                  }`}
                >
                  {step.delta > 0 ? `+${step.delta}` : "±0"}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
