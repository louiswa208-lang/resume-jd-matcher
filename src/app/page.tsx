"use client";

import { ArrowRight, CircleAlert, RotateCcw, Sparkles } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { AgentAsk } from "@/components/AgentAsk";
import { AgentResult } from "@/components/AgentResult";
import { AgentRun, type RunStep } from "@/components/AgentRun";
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
import { runOptimizeStream } from "@/lib/optimize-client";
import {
  EXAMPLE_AGENT_ACT_ONE,
  EXAMPLE_AGENT_ACT_TWO,
  EXAMPLE_AGENT_RESULT,
  type ExampleBeat,
} from "@/lib/example-agent";
import type {
  AgentResult as AgentResultData,
  AgentSnapshot,
} from "@/lib/agent";
import type { AgentMessage } from "@/lib/deepseek";
import type { EvaluatedItem, Judgment, Requirement } from "@/lib/types";

type Phase = "input" | "running" | "result";

/** agent 阶段。和 Phase 独立 —— agent 是在 result 之上叠加的一层 */
type OptimizePhase = "idle" | "running" | "asking" | "done";

interface PendingAsk {
  question: string;
  history: AgentMessage[];
  toolCallId: string;
  /** 已生效的改写和累计分数,续跑时必须原样回传 */
  snapshot: AgentSnapshot;
}

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
  const [error, setError] = useState<{
    kind: ErrorKind;
    message: string;
  } | null>(null);
  const [isExample, setIsExample] = useState(false);

  const [jdText, setJdText] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [supplement, setSupplement] = useState("");

  // agent 相关状态。独立于匹配流程 —— 它是叠在结果页上的第二阶段
  const [optPhase, setOptPhase] = useState<OptimizePhase>("idle");
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [agentScore, setAgentScore] = useState(0);
  const [ask, setAsk] = useState<PendingAsk | null>(null);
  const [exampleAsk, setExampleAsk] = useState<{
    question: string;
    suggested: string;
  } | null>(null);
  const [agentResult, setAgentResult] = useState<AgentResultData | null>(null);

  // 用一个自增令牌取消上一次进行中的运行(用户连点、或中途重新开始)
  const runToken = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const optAbortRef = useRef<AbortController | null>(null);

  const resetAgent = useCallback(() => {
    optAbortRef.current?.abort();
    optAbortRef.current = null;
    setOptPhase("idle");
    setSteps([]);
    setAsk(null);
    setExampleAsk(null);
    setAgentResult(null);
  }, []);

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
    resetAgent();
  }, [resetAgent]);

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
    async (
      options: { reuseRequirements?: boolean; supplement?: string } = {},
    ) => {
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

  /**
   * 跑优化 agent。
   *
   * baselineItems / baselineScore 由调用处传入,而不是从闭包里取 ——
   * 它们是渲染期算出来的派生值,放进依赖数组会让这个回调频繁重建。
   *
   * continuation 有值时表示这是「用户回答完问题后的续跑」:
   * 带上 agent 之前的完整对话,后端从断点继续。
   */
  const runOptimize = useCallback(
    async (
      baselineItems: EvaluatedItem[],
      baselineScore: number,
      continuation?: {
        history: AgentMessage[];
        snapshot: AgentSnapshot;
        userAnswer: string;
        askToolCallId: string;
      },
    ) => {
      optAbortRef.current?.abort();
      const controller = new AbortController();
      optAbortRef.current = controller;

      if (!continuation) {
        setSteps([]);
        setAgentScore(baselineScore);
        setAgentResult(null);
      }
      setAsk(null);
      setError(null);
      setOptPhase("running");

      for await (const event of runOptimizeStream(
        {
          jdText,
          resumeText,
          requirements,
          baselineItems,
          baselineScore,
          ...continuation,
        },
        controller.signal,
      )) {
        switch (event.type) {
          case "tool_call":
            setSteps((prev) => [
              ...prev,
              { tool: event.tool, label: event.label },
            ]);
            break;

          case "tool_result":
            // 工具返回总是紧跟在它的调用之后,所以补到最后一条
            setSteps((prev) => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              next[next.length - 1] = {
                ...next[next.length - 1],
                summary: event.summary,
                ok: event.ok,
              };
              return next;
            });
            break;

          case "score_change":
            setAgentScore(event.to);
            setSteps((prev) => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              next[next.length - 1] = {
                ...next[next.length - 1],
                delta: event.delta,
              };
              return next;
            });
            break;

          case "ask_user":
            setAsk({
              question: event.question,
              history: event.history,
              toolCallId: event.toolCallId,
              snapshot: event.snapshot,
            });
            setOptPhase("asking");
            break;

          case "done":
            setAgentResult(event.result);
            setAgentScore(event.result.finalScore);
            setOptPhase("done");
            break;

          case "error":
            setError({ kind: event.kind as ErrorKind, message: event.message });
            setOptPhase("idle");
            break;
        }
      }
    },
    [jdText, resumeText, requirements],
  );

  /**
   * 示例的 agent 回放。不调模型,按预置脚本走。
   * 理由见 lib/example-agent.ts —— agent 是主打功能,
   * 面试官点示例却看不到它是最大的展示缺口。
   */
  const playExampleBeats = useCallback(
    async (beats: ExampleBeat[], token: number) => {
      for (const beat of beats) {
        await sleep(beat.wait);
        if (runToken.current !== token) return;

        switch (beat.kind) {
          case "tool_call":
            setSteps((prev) => [
              ...prev,
              { tool: beat.tool, label: beat.label },
            ]);
            break;
          case "tool_result":
            setSteps((prev) => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              next[next.length - 1] = {
                ...next[next.length - 1],
                summary: beat.summary,
                ok: beat.ok,
              };
              return next;
            });
            break;
          case "score":
            setAgentScore(beat.to);
            setSteps((prev) => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              next[next.length - 1] = {
                ...next[next.length - 1],
                delta: beat.delta,
              };
              return next;
            });
            break;
          case "ask":
            setExampleAsk({
              question: beat.question,
              suggested: beat.suggested,
            });
            setOptPhase("asking");
            return;
          case "done":
            setAgentResult(EXAMPLE_AGENT_RESULT);
            setAgentScore(EXAMPLE_AGENT_RESULT.finalScore);
            setOptPhase("done");
            return;
        }
      }
    },
    [],
  );

  const runExampleOptimize = useCallback(async () => {
    const token = runToken.current;
    setSteps([]);
    setAgentScore(EXAMPLE_AGENT_RESULT.baselineScore);
    setAgentResult(null);
    setExampleAsk(null);
    setOptPhase("running");
    await playExampleBeats(EXAMPLE_AGENT_ACT_ONE, token);
  }, [playExampleBeats]);

  const continueExampleOptimize = useCallback(() => {
    setExampleAsk(null);
    setOptPhase("running");
    // 收尾由 ACT_TWO 里的 done beat 触发,这里不再有 await 之后的代码
    void playExampleBeats(EXAMPLE_AGENT_ACT_TWO, runToken.current);
  }, [playExampleBeats]);

  const items = merge(requirements, judgments);
  const score = computeScore(items);
  const satisfied = items.filter(isSatisfied);
  const gaps = sortByPriority(items.filter((item) => !isSatisfied(item)));
  const insufficientCount = items.filter(
    (item) =>
      toDisplayStatus(item.satisfaction, item.confidence) === "insufficient",
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
              将岗位 JD 拆解为独立的任职要求,逐条核对简历是否满足;再由一个 Agent
              自主改写简历,每次改写都用同一套评分规则验证是否真的有效。
            </p>

            <p className="text-ink-faint mt-4 max-w-xl text-sm">
              每条判断标注证据来源与置信度;匹配度由固定权重规则计算,结果可复现
              —— 这套规则同时是 Agent 判断改写有没有效的依据。
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

            {/*
             * 两个阶段摆在首屏,不滚动就能看见。
             * 之前 agent 只在结果页往下滚才出现 —— 而它恰恰是这个产品
             * 唯一算得上有门槛的部分,藏在下面等于没做。
             */}
            <div
              className="border-rule mt-10 grid gap-px overflow-hidden rounded-xl border sm:grid-cols-2"
              style={{ background: "var(--color-rule)" }}
            >
              <div className="bg-surface p-5">
                <p className="text-ink-faint font-mono text-[11px]">第一阶段</p>
                <h2 className="mt-1.5 text-[15px] font-medium">逐条匹配</h2>
                <p className="text-ink-soft mt-1.5 text-sm leading-relaxed">
                  把 JD 拆成要求清单,逐条判断简历是否满足,按固定权重算出匹配度。
                </p>
              </div>
              <div className="bg-surface p-5">
                <p className="text-ink-faint font-mono text-[11px]">第二阶段</p>
                <h2 className="mt-1.5 flex items-center gap-1.5 text-[15px] font-medium">
                  <Sparkles
                    size={14}
                    className="text-insufficient"
                    aria-hidden
                  />
                  优化 Agent
                </h2>
                <p className="text-ink-soft mt-1.5 text-sm leading-relaxed">
                  自主决定改哪几条、怎么改。每次改写都回到上一阶段的评分规则验证,
                  分数没涨就自动回退。
                </p>
              </div>
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

          {/*
           * ---------- 第二阶段:优化 Agent ----------
           *
           * 用一条顶边 + 标签把它和上面的匹配结果隔开。
           * 之前它和判断卡片长得一样,视觉上像「又一张卡片」——
           * 而它是这个产品里唯一由模型自己决定控制流的部分,
           * 层级和普通卡片相同是不对的。
           */}
          <div className="border-rule-strong space-y-6 border-t-2 pt-8">
            <p className="text-ink-faint font-mono text-[11px] tracking-wide">
              第二阶段 · 优化 AGENT
            </p>

            {optPhase === "idle" && (
              <section className="border-rule bg-surface rounded-xl border p-6 sm:p-8">
                <h2 className="flex items-center gap-2 text-[15px] font-medium">
                  <Sparkles
                    size={16}
                    className="text-insufficient"
                    aria-hidden
                  />
                  让 AI 帮你改
                </h2>
                <p className="text-ink-soft mt-1.5 text-sm">
                  AI
                  会自己决定先改哪几条、怎么改,每改一次都用上面这个评分器重新验证。
                  改写无效时它会转而向你提问。全程只重组你简历里已有的事实,不编造经历。
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      void (isExample
                        ? runExampleOptimize()
                        : runOptimize(items, score.score))
                    }
                    className="bg-ink text-paper inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-medium transition-opacity"
                  >
                    开始优化
                    <ArrowRight size={15} aria-hidden />
                  </button>
                  {isExample && (
                    <span className="text-ink-faint text-xs">
                      示例会回放一段预置的真实运行记录
                    </span>
                  )}
                </div>
              </section>
            )}

            {optPhase !== "idle" && (
              <AgentRun
                steps={steps}
                score={agentScore}
                baselineScore={score.score}
                running={optPhase === "running"}
              />
            )}

            {optPhase === "asking" && exampleAsk && (
              <AgentAsk
                question={exampleAsk.question}
                suggested={exampleAsk.suggested}
                busy={false}
                onAnswer={continueExampleOptimize}
                onSkip={continueExampleOptimize}
              />
            )}

            {optPhase === "asking" && ask && (
              <AgentAsk
                question={ask.question}
                busy={false}
                onAnswer={(answer) =>
                  void runOptimize(items, score.score, {
                    history: ask.history,
                    snapshot: ask.snapshot,
                    userAnswer: answer,
                    askToolCallId: ask.toolCallId,
                  })
                }
                onSkip={() =>
                  void runOptimize(items, score.score, {
                    history: ask.history,
                    snapshot: ask.snapshot,
                    userAnswer: "",
                    askToolCallId: ask.toolCallId,
                  })
                }
              />
            )}

            {optPhase === "done" && agentResult && (
              <AgentResult result={agentResult} onRestart={resetAgent} />
            )}
          </div>

          {/*
           * 补充信息 → 重新评估。整个闭环的收口动作。
           *
           * agent 运行中和提问中不显示:那两个时刻用户正在跟 agent 交互,
           * 旁边再摆一个「补充信息重新评估」的输入框,是两套改进机制同屏抢注意力。
           */}
          {(optPhase === "idle" || optPhase === "done") && (
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
          )}

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
