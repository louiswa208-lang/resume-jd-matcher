"use client";

import { ArrowRight, CircleAlert, RotateCcw } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { ChecklistProgress } from "@/components/ChecklistProgress";
import { ExampleInputs } from "@/components/ExampleInputs";
import { InputForm } from "@/components/InputForm";
import { RequirementCard } from "@/components/RequirementCard";
import { ScoreBoard } from "@/components/ScoreBoard";
import { EXAMPLE_JUDGMENTS, EXAMPLE_REQUIREMENTS } from "@/lib/example";
import type { ErrorKind, StreamStage } from "@/lib/protocol";
import {
  computeScore,
  explainScore,
  isSatisfied,
  sortByPriority,
  toDisplayStatus,
} from "@/lib/scoring";
import { readAnalyzeStream } from "@/lib/stream-client";
import type { EvaluatedItem, Judgment, Requirement } from "@/lib/types";

type Phase = "input" | "running" | "result";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 把清单和判断合并成可渲染的条目;还没判断到的要求不出现 */
function merge(
  requirements: Requirement[],
  judgments: Judgment[],
): EvaluatedItem[] {
  const byId = new Map(judgments.map((j) => [j.id, j]));
  return requirements.flatMap((requirement) => {
    const judgment = byId.get(requirement.id);
    if (!judgment) return [];
    return [
      {
        ...requirement,
        satisfaction: judgment.satisfaction,
        confidence: judgment.confidence,
        evidence: judgment.evidence,
        note: judgment.note,
      },
    ];
  });
}

/**
 * 首页预览用的四张卡片,刻意各取一种状态:
 * r1 已满足 / r2 部分满足 / r5 不满足 / r8 证据不足。
 * 一屏之内把产品的全部输出形态展示完。
 */
const PREVIEW_IDS = ["r1", "r2", "r5", "r8"];
const PREVIEW_ITEMS = merge(
  EXAMPLE_REQUIREMENTS.filter((r) => PREVIEW_IDS.includes(r.id)),
  EXAMPLE_JUDGMENTS.filter((j) => PREVIEW_IDS.includes(j.id)),
);

export default function Page() {
  const [phase, setPhase] = useState<Phase>("input");
  const [stage, setStage] = useState<StreamStage>("extracting");
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [judgments, setJudgments] = useState<Judgment[]>([]);
  const [error, setError] = useState<{ kind: ErrorKind; message: string } | null>(
    null,
  );
  const [isExample, setIsExample] = useState(false);

  const [jdText, setJdText] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [supplement, setSupplement] = useState("");

  // 用一个自增令牌取消上一次进行中的运行(用户连点、或中途重新开始)
  const runToken = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    runToken.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("input");
    setError(null);
    setRequirements([]);
    setJudgments([]);
    setSupplement("");
    setIsExample(false);
  }, []);

  /**
   * 示例:按真实节奏回放预置数据,不调模型。
   * 理由见 lib/example.ts —— 面试官不该等 15 秒,额度不该被刷,
   * 而且 API 挂掉时首页依然要能展示产品。
   */
  const runExample = useCallback(async () => {
    const token = ++runToken.current;
    abortRef.current?.abort();

    // 刻意**不**写 jdText / resumeText:输入框属于用户。
    // 示例内容单独由 <ExampleInputs> 展示,
    // 这样用户看完示例回到首页时,拿到的是干净的空表单。
    setIsExample(true);
    setError(null);
    setSupplement("");
    setRequirements([]);
    setJudgments([]);
    setStage("extracting");
    setPhase("running");

    await sleep(750);
    if (runToken.current !== token) return;

    setRequirements(EXAMPLE_REQUIREMENTS);
    setStage("judging");
    await sleep(320);

    for (const judgment of EXAMPLE_JUDGMENTS) {
      if (runToken.current !== token) return;
      setJudgments((prev) => [...prev, judgment]);
      await sleep(185);
    }

    await sleep(420);
    if (runToken.current !== token) return;
    setPhase("result");
  }, []);

  /** 真实分析:走完整的两步 pipeline */
  const runAnalysis = useCallback(
    async (options: { reuseRequirements?: boolean; supplement?: string } = {}) => {
      const token = ++runToken.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const reuse = options.reuseRequirements ? requirements : undefined;

      setIsExample(false);
      setError(null);
      setJudgments([]);
      if (!reuse) setRequirements([]);
      setStage(reuse ? "judging" : "extracting");
      setPhase("running");

      for await (const event of readAnalyzeStream(
        {
          jdText,
          resumeText,
          supplement: options.supplement,
          requirements: reuse,
        },
        controller.signal,
      )) {
        if (runToken.current !== token) return;

        switch (event.type) {
          case "status":
            setStage(event.stage);
            break;
          case "requirements":
            setRequirements(event.requirements);
            break;
          case "judgment":
            setJudgments((prev) => [...prev, event.judgment]);
            break;
          case "done":
            setPhase("result");
            break;
          case "error":
            setError({ kind: event.kind, message: event.message });
            setPhase("input");
            break;
        }
      }
    },
    [jdText, resumeText, requirements],
  );

  const items = merge(requirements, judgments);
  const score = computeScore(items);
  const satisfied = items.filter(isSatisfied);
  const gaps = sortByPriority(items.filter((item) => !isSatisfied(item)));
  const insufficientCount = items.filter(
    (item) => toDisplayStatus(item.satisfaction, item.confidence) === "insufficient",
  ).length;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex min-h-7 items-center justify-between gap-4">
        {/*
         * 首页的产品名由 H1 承担,这里留空,避免同一屏出现两次同样的字。
         * 进入分析流程和结果页后 H1 不再显示,才由顶部补上产品名。
         */}
        <span className="font-mono text-sm font-medium tracking-tight">
          {phase !== "input" && "简历与 JD 匹配工具"}
        </span>

        {phase !== "input" && (
          <button
            type="button"
            onClick={reset}
            className="text-ink-soft hover:text-ink inline-flex items-center gap-1.5 text-xs transition-colors"
          >
            <RotateCcw size={13} aria-hidden />
            重新开始
          </button>
        )}
      </header>

      {phase === "input" && (
        <>
          <section className="mt-12 sm:mt-16">
            <h1 className="text-4xl leading-[1.15] font-medium tracking-tight sm:text-[3.25rem]">
              简历与 JD 匹配工具
            </h1>

            <p className="text-ink-soft mt-5 max-w-2xl text-lg leading-relaxed sm:text-xl">
              将岗位 JD 拆解为独立的任职要求,逐条核对简历是否满足,并输出匹配度与差距清单。
            </p>

            <p className="text-ink-faint mt-4 max-w-xl text-sm">
              每条判断标注证据来源与置信度;匹配度由固定权重规则计算,结果可复现。
            </p>

            <div className="mt-8">
              <button
                type="button"
                onClick={() => void runExample()}
                className="bg-ink text-paper group inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-medium"
              >
                看一份示例结果
                <ArrowRight
                  size={15}
                  className="transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </button>
            </div>
          </section>

          {/*
           * 直接把真实产出摆在首页。
           * 比任何一句「AI 智能匹配」的文案都更快回答「这东西到底做什么」,
           * 顺带让四种状态色第一次出现在用户眼前。
           */}
          <section className="mt-14">
            <h2 className="text-base font-semibold tracking-tight sm:text-lg">
              判断结果分为四类
            </h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {PREVIEW_ITEMS.map((item, index) => (
                <RequirementCard
                  key={item.id}
                  item={item}
                  compact
                  delayMs={index * 70}
                />
              ))}
            </div>
          </section>

          {error && (
            <div
              role="alert"
              className="border-unmet/25 bg-unmet-bg text-unmet mt-10 flex items-start gap-2.5 rounded-lg border p-4 text-sm"
            >
              <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span>{error.message}</span>
            </div>
          )}

          <section className="border-rule mt-14 border-t pt-10 sm:mt-20">
            <h2 className="text-lg font-medium">用你自己的简历试试</h2>
            <p className="text-ink-soft mt-1.5 text-sm">
              两个框都填好就能开始。
            </p>

            <div className="mt-7">
              <InputForm
                jdText={jdText}
                onJdChange={setJdText}
                resumeText={resumeText}
                onResumeChange={setResumeText}
                onSubmit={() => void runAnalysis()}
                busy={false}
              />
            </div>
          </section>
        </>
      )}

      {phase === "running" && (
        <div className="mt-12 space-y-6">
          {/* 示例时先摆出输入,让人看清「正在核对的是这两份东西」 */}
          {isExample && <ExampleInputs />}
          <ChecklistProgress
            stage={stage}
            requirements={requirements}
            judgedIds={new Set(judgments.map((j) => j.id))}
          />
        </div>
      )}

      {phase === "result" && (
        <div className="mt-12 space-y-8">
          {/*
           * 位置和「分析中」完全一致 —— 切到结果页时这一块不动,
           * 分数在它下方出现,页面不重排。
           */}
          {isExample && <ExampleInputs />}

          <ScoreBoard
            items={items}
            score={score}
            explanation={explainScore(score)}
            isExample={isExample}
          />

          {/* 补充信息 → 重新评估。整个闭环的收口动作 */}
          <section className="border-rule bg-surface rounded-xl border p-6 sm:p-8">
            <h2 className="text-[15px] font-medium">
              {insufficientCount > 0
                ? `有 ${insufficientCount} 条是因为简历里没提到`
                : "还有信息没写进简历?"}
            </h2>
            <p className="text-ink-soft mt-1.5 text-sm">
              {insufficientCount > 0
                ? "这些不代表你不满足,只是简历里找不到证据。补充之后重新评估,结果会更准。"
                : "补充任何简历里没写的经历,重新评估一次。"}
            </p>

            <textarea
              value={supplement}
              onChange={(event) => setSupplement(event.target.value)}
              maxLength={3000}
              placeholder="例如:大二有一段 6 个月的 B 端产品实习,简历里没写。"
              className="border-rule bg-paper placeholder:text-ink-faint mt-4 min-h-24 w-full resize-y rounded-lg border p-3.5 text-sm leading-relaxed"
            />

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-ink-faint text-xs">
                {isExample
                  ? "示例结果不支持重新评估,换成你自己的简历即可使用。"
                  : "复用上一轮的要求清单,只重新判断,结果逐条可比。"}
              </p>
              <button
                type="button"
                disabled={isExample || supplement.trim().length === 0}
                onClick={() =>
                  void runAnalysis({
                    reuseRequirements: true,
                    supplement,
                  })
                }
                className="border-ink hover:bg-ink hover:text-paper rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-current"
              >
                重新评估
              </button>
            </div>
          </section>

          {/* 待补强在前:用户最需要处理的是这些 */}
          <div className="grid gap-8 lg:grid-cols-2">
            <section>
              <h2 className="flex items-center gap-2 text-[15px] font-medium">
                <span
                  className="h-3.5 w-1 rounded-full"
                  style={{ background: "var(--color-unmet)" }}
                  aria-hidden
                />
                待补强
                <span className="text-ink-faint font-mono text-xs">
                  {gaps.length}
                </span>
              </h2>
              <p className="text-ink-faint mt-1 text-xs">
                按权重和差距排序,最值得先处理的在最上面
              </p>
              <div className="mt-4 space-y-3">
                {gaps.map((item, index) => (
                  <RequirementCard
                    key={item.id}
                    item={item}
                    delayMs={index * 45}
                  />
                ))}
                {gaps.length === 0 && (
                  <p className="text-ink-soft border-rule rounded-lg border border-dashed p-6 text-center text-sm">
                    每条要求都满足了。
                  </p>
                )}
              </div>
            </section>

            <section>
              <h2 className="flex items-center gap-2 text-[15px] font-medium">
                <span
                  className="h-3.5 w-1 rounded-full"
                  style={{ background: "var(--color-met)" }}
                  aria-hidden
                />
                已适配
                <span className="text-ink-faint font-mono text-xs">
                  {satisfied.length}
                </span>
              </h2>
              <p className="text-ink-faint mt-1 text-xs">
                这些可以在面试里主动讲
              </p>
              <div className="mt-4 space-y-3">
                {satisfied.map((item, index) => (
                  <RequirementCard
                    key={item.id}
                    item={item}
                    delayMs={index * 45}
                  />
                ))}
                {satisfied.length === 0 && (
                  <p className="text-ink-soft border-rule rounded-lg border border-dashed p-6 text-center text-sm">
                    暂时没有明确满足的要求。
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      <footer className="border-rule text-ink-faint mt-20 border-t pt-6 text-xs">
        <p>
          简历文件在浏览器本地解析,不上传、不存储。分数由固定规则计算,
          模型只负责逐条判断。
        </p>
      </footer>
    </main>
  );
}
