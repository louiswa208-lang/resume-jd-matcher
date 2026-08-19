"use client";

/**
 * Agent 的最终结论,分三类呈现。
 *
 * 「尝试过但无效」这一栏是刻意保留的:
 * 它证明「+N 分」是**验证出来的**,不是模型自说自话。
 * 一个只报喜的产品,用户没理由相信那些数字。
 */

import { Check, CircleAlert, Minus, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { AgentResult as Result } from "@/lib/agent";
import { useCountUp } from "./use-count-up";

function Diff({ before, after }: { before: string; after: string }) {
  return (
    <div className="mt-3 space-y-2">
      <div className="border-rule-strong border-l-2 pl-3">
        <p className="text-ink-faint mb-1 font-mono text-[10px]">原文</p>
        <p className="text-ink-faint text-sm line-through decoration-1">{before}</p>
      </div>
      <div className="border-met border-l-2 pl-3">
        <p className="text-met mb-1 font-mono text-[10px]">改写后</p>
        <p className="text-ink text-sm">{after}</p>
      </div>
    </div>
  );
}

interface Props {
  result: Result;
  onRestart: () => void;
}

export function AgentResult({ result, onRestart }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const gain = result.finalScore - result.baselineScore;
  const shown = useCountUp(result.finalScore, 900);

  return (
    <div className="space-y-6">
      {/* 总览 */}
      <section className="border-rule bg-surface rounded-xl border p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <span className="text-ink-faint font-mono text-3xl tabular-nums">
              {result.baselineScore}
            </span>
            <span className="text-ink-faint">→</span>
            <span
              className={`font-mono text-5xl leading-none font-medium tracking-tight tabular-nums ${
                gain > 0 ? "text-met" : ""
              }`}
            >
              {shown}
            </span>
            {gain > 0 && (
              <span className="bg-met-bg text-met rounded-full px-2.5 py-1 font-mono text-xs font-medium">
                +{gain}
              </span>
            )}
          </div>
          <span className="text-ink-faint font-mono text-xs">
            迭代 {result.turnsUsed} 轮 · 提问 {result.asksUsed} 次
          </span>
        </div>

        {result.summary && (
          <p className="text-ink-soft mt-5 text-sm">{result.summary}</p>
        )}

        {result.stoppedByBudget && (
          <p className="text-ink-faint mt-3 flex items-start gap-1.5 text-xs">
            <CircleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
            本次达到轮次上限后收尾,可能还有未探索的改进空间。
          </p>
        )}
      </section>

      {/* 已验证有效 */}
      <section>
        <h3 className="flex items-center gap-2 text-[15px] font-medium">
          <Check size={16} className="text-met" strokeWidth={2.5} aria-hidden />
          已验证有效
          <span className="text-ink-faint font-mono text-xs">
            {result.effective.length}
          </span>
        </h3>
        <p className="text-ink-faint mt-1 text-xs">
          每条的分数变化都由评分器实际跑出来,不是估计值
        </p>

        <div className="mt-4 space-y-3">
          {result.effective.map((item, index) => {
            const key = `${item.requirementId}-${index}`;
            const open = openId === key;
            return (
              <article
                key={key}
                className="border-rule bg-met-tint relative overflow-hidden rounded-lg border p-4 pl-5"
              >
                <span
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ background: "var(--color-met)" }}
                  aria-hidden
                />
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-ink-faint font-mono text-[11px]">
                      {item.requirementId}
                    </span>
                    <h4 className="mt-1 text-[15px] leading-snug font-medium">
                      {item.requirementText}
                    </h4>
                  </div>
                  <span className="text-met shrink-0 font-mono text-sm">
                    +{item.delta}
                  </span>
                </div>

                {/* -mx-1 抵消 padding,让热区变大但视觉位置不变 */}
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : key)}
                  className="text-ink-soft hover:text-ink mt-2 -mx-1 inline-block px-1 py-2 text-xs underline underline-offset-2"
                >
                  {open ? "收起对比" : "查看改写前后"}
                </button>

                {open && (
                  <Diff before={item.originalText} after={item.rewrittenText} />
                )}
              </article>
            );
          })}

          {result.effective.length === 0 && (
            <p className="text-ink-soft border-rule rounded-lg border border-dashed p-6 text-center text-sm">
              这一轮没有找到能提升分数的改写。
            </p>
          )}
        </div>
      </section>

      {/* 尝试过但无效 */}
      {result.ineffective.length > 0 && (
        <section>
          <h3 className="flex items-center gap-2 text-[15px] font-medium">
            <Minus size={16} className="text-partial" strokeWidth={2.5} aria-hidden />
            尝试过但无效
            <span className="text-ink-faint font-mono text-xs">
              {result.ineffective.length}
            </span>
          </h3>
          <p className="text-ink-faint mt-1 text-xs">
            改写后分数没有变化,说明差距不在表述,已回退
          </p>

          <div className="mt-4 space-y-3">
            {result.ineffective.map((item, index) => (
              <article
                key={`${item.requirementId}-${index}`}
                className="border-rule bg-partial-tint relative overflow-hidden rounded-lg border p-4 pl-5"
              >
                <span
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ background: "var(--color-partial)" }}
                  aria-hidden
                />
                <span className="text-ink-faint font-mono text-[11px]">
                  {item.requirementId}
                </span>
                <h4 className="mt-1 text-[15px] leading-snug font-medium">
                  {item.requirementText}
                </h4>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* 无法通过改简历解决 */}
      {result.unfixable.length > 0 && (
        <section>
          <h3 className="flex items-center gap-2 text-[15px] font-medium">
            <CircleAlert size={16} className="text-unmet" strokeWidth={2.5} aria-hidden />
            无法通过改简历解决
            <span className="text-ink-faint font-mono text-xs">
              {result.unfixable.length}
            </span>
          </h3>
          <p className="text-ink-faint mt-1 text-xs">
            属于经历缺失,改写和补充都补不上 —— 这里给的是面试应对建议
          </p>

          <div className="mt-4 space-y-3">
            {result.unfixable.map((item) => (
              <article
                key={item.requirementId}
                className="border-rule bg-unmet-tint relative overflow-hidden rounded-lg border p-4 pl-5"
              >
                <span
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ background: "var(--color-unmet)" }}
                  aria-hidden
                />
                <span className="text-ink-faint font-mono text-[11px]">
                  {item.requirementId}
                </span>
                <h4 className="mt-1 text-[15px] leading-snug font-medium">
                  {item.requirementText}
                </h4>
                {item.reason && (
                  <p className="text-ink-soft mt-2 text-sm">{item.reason}</p>
                )}
                {item.interviewAdvice && (
                  <p className="border-rule-strong text-ink-soft mt-3 border-l-2 pl-3 text-sm">
                    面试应对:{item.interviewAdvice}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="border-rule flex justify-end border-t pt-5">
        <button
          type="button"
          onClick={onRestart}
          className="text-ink-soft hover:text-ink -mx-2 inline-flex items-center gap-1.5 px-2 py-2.5 text-sm transition-colors"
        >
          <RotateCcw size={14} aria-hidden />
          回到匹配结果
        </button>
      </div>
    </div>
  );
}
