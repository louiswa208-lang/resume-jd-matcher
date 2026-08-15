/**
 * 生成过程。**整个页面的动效预算几乎全花在这里。**
 *
 * 理由:这是唯一一个用户在等待、且需要被解释的时刻。动效在这里是有信息量的
 * ——它在回答「系统现在到底在干什么」,而不是装饰。
 *
 * 更重要的是:这里显示的进度是**真的**。
 * 第一步跑完后前端拿到了真实的要求清单,所以「正在核查:第 5 条」
 * 对应的确实是模型此刻在判断的那一条,不是前端写死的假动画。
 * 这一点是两步 pipeline 换来的,也是这个项目最经得起追问的地方之一。
 */

import { Check, FileSearch } from "lucide-react";
import type { StreamStage } from "@/lib/protocol";
import type { Requirement } from "@/lib/types";

interface Props {
  stage: StreamStage;
  requirements: Requirement[];
  judgedIds: Set<string>;
}

export function ChecklistProgress({ stage, requirements, judgedIds }: Props) {
  // 第一步还没跑完,清单还不存在 —— 此时不假装显示进度条,
  // 老老实实说正在做什么。
  if (stage === "extracting" || requirements.length === 0) {
    return (
      <section className="border-rule bg-surface rounded-xl border p-8">
        <div className="flex items-center gap-3">
          <FileSearch
            size={18}
            className="text-insufficient animate-breathe"
            aria-hidden
          />
          <h2 className="text-[15px] font-medium">正在读取岗位要求</h2>
        </div>
        <p className="text-ink-soft mt-2 text-sm">
          先把这份 JD 拆解成一条条可以单独判断的要求,然后才逐条对照你的简历。
        </p>
      </section>
    );
  }

  const doneCount = judgedIds.size;
  const checkingIndex = requirements.findIndex((r) => !judgedIds.has(r.id));

  return (
    <section className="border-rule bg-surface rounded-xl border p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-medium">正在逐条核对</h2>
        <span className="text-ink-faint font-mono text-sm">
          {doneCount} / {requirements.length}
        </span>
      </div>

      <div
        className="bg-rule mt-4 h-[3px] w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={doneCount}
        aria-valuemin={0}
        aria-valuemax={requirements.length}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${(doneCount / requirements.length) * 100}%`,
            background: "var(--color-insufficient)",
          }}
        />
      </div>

      <ul className="mt-5 space-y-px">
        {requirements.map((requirement, index) => {
          const isDone = judgedIds.has(requirement.id);
          const isChecking = index === checkingIndex;

          return (
            <li
              key={requirement.id}
              className={`flex items-center gap-3 rounded px-2 py-2 text-sm transition-colors ${
                isChecking ? "animate-sweep" : ""
              }`}
            >
              <span className="flex w-4 shrink-0 justify-center" aria-hidden>
                {isDone ? (
                  <Check size={14} className="text-met" strokeWidth={2.5} />
                ) : isChecking ? (
                  <span className="bg-insufficient animate-breathe h-1.5 w-1.5 rounded-full" />
                ) : (
                  <span className="bg-rule-strong h-1 w-1 rounded-full" />
                )}
              </span>

              <span className="text-ink-faint w-6 shrink-0 font-mono text-[11px]">
                {requirement.id}
              </span>

              <span
                className={`min-w-0 flex-1 truncate ${
                  isDone
                    ? "text-ink"
                    : isChecking
                      ? "text-ink"
                      : "text-ink-faint"
                }`}
              >
                {requirement.text}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
