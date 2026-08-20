"use client";

/**
 * Agent 的最终结论,两块内容。
 *
 * 第一块回答「我该改哪里、改成什么」—— 所以 diff 默认摊开,不藏在折叠里。
 * 用户要的是一份能照着抄的清单,多一次点击就多一道门槛。
 *
 * 第二块回答「改不动的怎么办」—— 优化后仍未满足的**全部**要求都在这里,
 * 由算分器统一算出,所以条数和分数永远对得上:
 * 显示 82 分,扣掉的那些能一条条数出来。
 *
 * 刻意**没有**模型写的总结段落。早期版本让模型在 finish 里写一段话总结,
 * 结果它把整份报告都塞进那一个字符串:改了什么、为什么、哪些改不了、
 * 面试怎么说全在里面 —— 和下面的结构化内容重复,还挡在最前面,
 * 让人以为结果就只有那一段。总览那句话现在由代码拼,和分数同源。
 */

import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock,
  Copy,
  Minus,
  RotateCcw,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";
import type {
  AgentResult as Result,
  RemainingItem,
  RemainingKind,
} from "@/lib/agent";
import { useCountUp } from "./use-count-up";

/* ------------------------------------------------------------------ */
/* 「还没解决」的四种原因                                                */
/* ------------------------------------------------------------------ */

type Tone = "unmet" | "partial" | "insufficient";

/** 写全类名而不是拼接 —— Tailwind 靠扫描源码生成样式,拼出来的会被漏掉 */
const TONE_CLASS: Record<Tone, { tint: string; chip: string; bar: string }> = {
  unmet: {
    tint: "bg-unmet-tint",
    chip: "bg-unmet-bg text-unmet",
    bar: "var(--color-unmet)",
  },
  partial: {
    tint: "bg-partial-tint",
    chip: "bg-partial-bg text-partial",
    bar: "var(--color-partial)",
  },
  insufficient: {
    tint: "bg-insufficient-tint",
    chip: "bg-insufficient-bg text-insufficient",
    bar: "var(--color-insufficient)",
  },
};

const KIND_META: Record<
  RemainingKind,
  { label: string; tone: Tone; icon: typeof CircleAlert; fallback: string }
> = {
  partially_improved: {
    label: "已提升,仍有差距",
    tone: "partial",
    icon: TrendingUp,
    fallback:
      "上面那条改写确实让它加了分,但离完全满足还差一截 —— 剩下的差距在经历本身,不是措辞。",
  },
  experience_gap: {
    label: "经历缺失",
    tone: "unmet",
    icon: CircleAlert,
    fallback: "属于经历本身的缺口,改写简历补不上。",
  },
  rewrite_failed: {
    label: "改写无效",
    tone: "partial",
    icon: Minus,
    fallback:
      "试过改写,评分器验证后分数没有变化 —— 说明差的是事实,不是表述方式。",
  },
  not_attempted: {
    label: "本轮未处理",
    tone: "insufficient",
    icon: Clock,
    fallback: "优先级排在其它几条之后,本次没有动它。",
  },
};

/* ------------------------------------------------------------------ */
/* 总览那句话:由代码拼,和分数同源                                       */
/* ------------------------------------------------------------------ */

function overview(result: Result): string {
  const gain = result.finalScore - result.baselineScore;
  const changed = result.effective.length;
  const left = result.remaining.length;

  const head =
    changed === 0
      ? "本轮没有找到能提升分数的改写"
      : `改写 ${changed} 处并通过验证,匹配度 ${result.baselineScore} → ${result.finalScore}(+${gain})`;

  const tail = left === 0 ? ",所有要求都已满足。" : `。还有 ${left} 条未满足。`;

  return head + tail;
}

/* ------------------------------------------------------------------ */
/* 第一块:照着改                                                       */
/* ------------------------------------------------------------------ */

/**
 * 复制改好的简历全文。
 *
 * 三层降级,因为 navigator.clipboard 会在好几种正常情况下直接抛错:
 * 页面失焦、用户拒绝权限、被 iframe 的 Permissions Policy 挡住、非安全上下文。
 * 早期版本只做了第一层,失败时弹一句「浏览器拒绝了剪贴板权限」——
 * 那是把问题原样丢回给用户,等于没给出路。
 *
 *   1. navigator.clipboard.writeText —— 首选
 *   2. execCommand("copy") —— 已废弃但兼容面广得多,很多失败场景它反而能成
 *   3. 都不行就把全文摊开并全选,用户自己按 Ctrl+C
 *
 * 「展开全文」也做成常驻入口:不该只有复制失败时才能看到完整结果。
 */
function CopyResume({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  /** 记的是「为什么展开」:用户自己点开的,还是复制失败兜底摊出来的 */
  const [open, setOpen] = useState<false | "manual" | "fallback">(false);

  function flash() {
    setCopied(true);
    setTimeout(() => setCopied(false), 2400);
  }

  /** 老办法:塞一个临时 textarea 选中再 execCommand */
  function legacyCopy(): boolean {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      // 放在视口外但不能 display:none —— 隐藏元素选不中
      el.style.position = "fixed";
      el.style.top = "-1000px";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      flash();
      return;
    } catch {
      // 继续往下降级,不在这里报错
    }
    if (legacyCopy()) {
      flash();
      return;
    }
    // 两条路都不通:摊开全文并全选,把动作交还给用户。
    // 选中交给 textarea 的 autoFocus + onFocus 做 —— 声明式,
    // 不用去猜 ref 什么时候挂上、effect 跑几遍。
    setOpen("fallback");
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void copy()}
          className="border-rule-strong hover:border-ink inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors"
        >
          {copied ? (
            <Check size={14} className="text-met" aria-hidden />
          ) : (
            <Copy size={14} aria-hidden />
          )}
          {copied ? "已复制" : "复制改好的简历全文"}
        </button>

        <button
          type="button"
          onClick={() => setOpen((v) => (v ? false : "manual"))}
          className="text-ink-soft hover:text-ink -mx-1 inline-flex items-center gap-1.5 px-1 py-2 text-sm underline underline-offset-2"
        >
          {open ? (
            <ChevronUp size={14} aria-hidden />
          ) : (
            <ChevronDown size={14} aria-hidden />
          )}
          {open ? "收起全文" : "展开全文"}
        </button>
      </div>

      {open && (
        <div className="mt-3">
          <textarea
            readOnly
            // 兜底展开时自动聚焦并全选;用户自己点「展开全文」时不抢焦点
            autoFocus={open === "fallback"}
            value={text}
            onFocus={(event) => event.currentTarget.select()}
            className="border-rule bg-paper h-64 w-full resize-y rounded-lg border p-3.5 font-mono text-xs leading-relaxed"
          />
          <p className="text-ink-faint mt-1.5 text-xs">
            {open === "fallback"
              ? "浏览器不让网页写剪贴板,已经帮你全选好了 —— 按 Ctrl+C(Mac 为 ⌘+C)即可。"
              : "点进文本框会自动全选,按 Ctrl+C(Mac 为 ⌘+C)复制。"}
          </p>
        </div>
      )}
    </div>
  );
}

function Rewrite({ item }: { item: Result["effective"][number] }) {
  return (
    <article className="border-rule bg-met-tint relative overflow-hidden rounded-lg border p-4 pl-5 sm:p-5 sm:pl-6">
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
            为了满足:{item.requirementText}
          </h4>
        </div>
        {/* 配上满分才有参照系 —— 单独一个「+27」看着像瞎给的 */}
        <div className="shrink-0 text-right">
          <span className="bg-met-bg text-met inline-block rounded-full px-2.5 py-1 font-mono text-xs font-medium">
            +{item.delta} 分
          </span>
          <p className="text-ink-faint mt-1 font-mono text-[10px]">
            这条权重 {item.weightPoints} 分
          </p>
        </div>
      </div>

      {/* 摊开,不折叠 —— 这一段就是「该改哪里」的答案本身 */}
      <div className="mt-4 space-y-3">
        <div>
          <p className="text-ink-faint mb-1.5 text-xs">把简历里这句</p>
          <p className="border-rule-strong text-ink-faint border-l-2 pl-3 text-sm line-through decoration-1">
            {item.originalText}
          </p>
        </div>
        <div>
          <p className="text-met mb-1.5 text-xs font-medium">改成</p>
          <p className="border-met text-ink border-l-2 pl-3 text-sm">
            {item.rewrittenText}
          </p>
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* 第二块:还没解决的                                                    */
/* ------------------------------------------------------------------ */

function Remaining({ item }: { item: RemainingItem }) {
  const meta = KIND_META[item.kind];
  const tone = TONE_CLASS[meta.tone];
  const Icon = meta.icon;

  return (
    <article
      className={`border-rule relative overflow-hidden rounded-lg border p-4 pl-5 sm:p-5 sm:pl-6 ${tone.tint}`}
    >
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: tone.bar }}
        aria-hidden
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-ink-faint font-mono text-[11px]">
            {item.requirementId} ·{" "}
            {item.importance === "must" ? "硬性要求" : "加分项"}
          </span>
          <h4 className="mt-1 text-[15px] leading-snug font-medium">
            {item.requirementText}
          </h4>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${tone.chip}`}
        >
          <Icon size={12} strokeWidth={2.5} aria-hidden />
          {meta.label}
        </span>
      </div>

      <p className="text-ink-soft mt-2.5 text-sm">
        {item.reason || meta.fallback}
      </p>

      {item.interviewAdvice && (
        <div className="border-rule-strong mt-3 border-l-2 pl-3">
          <p className="text-ink-faint mb-1 text-xs">面试时可以这么说</p>
          <p className="text-ink-soft text-sm">{item.interviewAdvice}</p>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */

interface Props {
  result: Result;
  onRestart: () => void;
}

export function AgentResult({ result, onRestart }: Props) {
  const gain = result.finalScore - result.baselineScore;
  const shown = useCountUp(result.finalScore, 900);

  return (
    <div className="space-y-8">
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

        <p className="text-ink-soft mt-5 text-sm">{overview(result)}</p>

        {result.stoppedByBudget && (
          <p className="text-ink-faint mt-3 flex items-start gap-1.5 text-xs">
            <CircleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
            本次达到轮次上限后收尾,可能还有未探索的改进空间。
          </p>
        )}
      </section>

      {/* 第一块:照着改 */}
      <section>
        <h3 className="flex items-center gap-2 text-base font-medium">
          <Check size={17} className="text-met" strokeWidth={2.5} aria-hidden />
          按这个改你的简历
          <span className="text-ink-faint font-mono text-xs">
            {result.effective.length}
          </span>
        </h3>
        <p className="text-ink-faint mt-1 text-xs">
          每条的分数变化都由评分器实际跑出来,不是估计值;改写只重组简历里已有的事实
        </p>

        <div className="mt-4 space-y-3">
          {result.effective.map((item, index) => (
            <Rewrite key={`${item.requirementId}-${index}`} item={item} />
          ))}

          {result.effective.length === 0 && (
            <p className="text-ink-soft border-rule rounded-lg border border-dashed p-6 text-center text-sm">
              这一轮没有找到能提升分数的改写。差距可能不在表述,而在经历本身 ——
              见下面一节。
            </p>
          )}
        </div>

        {result.effective.length > 0 && result.finalResumeText && (
          <CopyResume text={result.finalResumeText} />
        )}
      </section>

      {/* 第二块:还没解决的 */}
      {result.remaining.length > 0 && (
        <section>
          <h3 className="flex items-center gap-2 text-base font-medium">
            <CircleAlert
              size={17}
              className="text-unmet"
              strokeWidth={2.5}
              aria-hidden
            />
            还没解决的 {result.remaining.length} 条
          </h3>
          <p className="text-ink-faint mt-1 text-xs">
            优化结束后仍未满足的全部要求,按重要程度排序 —— 这些就是那{" "}
            {100 - result.finalScore} 分扣在哪
          </p>

          <div className="mt-4 space-y-3">
            {result.remaining.map((item) => (
              <Remaining key={item.requirementId} item={item} />
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
