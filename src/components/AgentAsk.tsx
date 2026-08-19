"use client";

/**
 * Agent 的提问卡片。
 *
 * 刻意**不做成聊天框** —— 聊天框会让人以为可以随便聊,
 * 而这里只需要回答一个具体问题。一次一问、有明确的跳过出口,
 * 用户的认知负担最小。
 *
 * 这个交互存在的意义:agent 在改写失败后判断出"差距不在表述而在事实缺失",
 * 于是转而提问。这一步是整个产品里最能体现"模型自己改变了策略"的地方。
 */

import { CircleQuestionMark } from "lucide-react";
import { useState } from "react";

interface Props {
  question: string;
  onAnswer: (answer: string) => void;
  onSkip: () => void;
  busy: boolean;
  /** 示例回放时预填一个答案,让人不用真的动手打字也能看到后续 */
  suggested?: string;
}

export function AgentAsk({ question, onAnswer, onSkip, busy, suggested }: Props) {
  const [text, setText] = useState(suggested ?? "");

  return (
    <section className="border-insufficient/30 bg-insufficient-tint rounded-xl border p-6 sm:p-8">
      <h2 className="text-insufficient flex items-center gap-2 text-[15px] font-medium">
        <CircleQuestionMark size={16} aria-hidden />
        AI 需要你补充一个信息
      </h2>

      <p className="text-ink-faint mt-1.5 text-xs">
        它尝试改写后发现分数没有提升,判断这条差在事实而不在表述
      </p>

      <p className="mt-4 text-[15px] leading-relaxed font-medium">{question}</p>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={2000}
        autoFocus
        placeholder="如实回答即可。没有的话直接跳过,不要编。"
        className="border-rule bg-surface placeholder:text-ink-faint mt-4 min-h-24 w-full resize-y rounded-lg border p-3.5 text-sm leading-relaxed"
      />

      <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="text-ink-soft hover:text-ink px-3 py-2 text-sm transition-colors disabled:opacity-40"
        >
          跳过这个问题
        </button>
        <button
          type="button"
          onClick={() => onAnswer(text)}
          disabled={busy || text.trim().length === 0}
          className="bg-ink text-paper rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
        >
          {busy ? "处理中…" : "回答并继续"}
        </button>
      </div>
    </section>
  );
}
