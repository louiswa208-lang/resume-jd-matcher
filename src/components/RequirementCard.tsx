/**
 * 单条要求的判断卡片。
 *
 * 卡片的核心不是结论,是**证据** —— 从简历里逐字摘出来的那段原文。
 * 所以它被排成引文的样子(左侧竖线 + 引号标记),像一份带引证的审阅意见。
 * 这直接对应产品最重要的主张:判断必须有出处,不能凭空下结论。
 *
 * 证据为空时不留白,而是明说「简历中未找到相关内容」——
 * 系统承认自己没找到,比假装有把握更可信。
 *
 * 底色按状态浅浅着色。目的不是好看,是让状态**有面积**:
 * 扫一眼整栏,颜色的分布本身就告诉你结果是什么样子,
 * 不用逐条去读那个小徽章。
 */

import { Quote } from "lucide-react";
import { toDisplayStatus } from "@/lib/scoring";
import type { EvaluatedItem } from "@/lib/types";
import { CATEGORY_ICON, IMPORTANCE_LABEL, STATUS_META } from "./status";

interface Props {
  item: EvaluatedItem;
  /** 入场动画的错峰延迟(毫秒) */
  delayMs?: number;
  /** 紧凑版:首页预览用,省掉说明文字只留结论和证据 */
  compact?: boolean;
}

export function RequirementCard({ item, delayMs = 0, compact = false }: Props) {
  const status = toDisplayStatus(item.satisfaction, item.confidence);
  const meta = STATUS_META[status];
  const { Icon } = meta;
  const CategoryIcon = CATEGORY_ICON[item.category];

  return (
    <article
      className={`animate-rise border-rule relative overflow-hidden rounded-lg border p-4 pl-5 ${meta.tint}`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {/* 左侧状态条 —— 扫读时不用看文字就能分辨状态 */}
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: meta.swatch }}
        aria-hidden
      />

      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="text-ink-faint flex min-w-0 items-center gap-1.5">
          <span className="font-mono text-[11px]">{item.id}</span>
          {CategoryIcon && (
            <CategoryIcon size={12} className="shrink-0" aria-hidden />
          )}
          <span className="text-[11px]">
            {IMPORTANCE_LABEL[item.importance]} · {item.category}
          </span>
        </div>

        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.bg} ${meta.fg}`}
        >
          <Icon size={12} strokeWidth={2.5} aria-hidden />
          {meta.label}
        </span>
      </header>

      <h3 className="mt-2 text-[15px] leading-snug font-medium">{item.text}</h3>

      {item.evidence ? (
        <blockquote className="border-rule-strong text-ink-soft mt-3 border-l-2 pl-3 text-sm">
          <Quote
            size={11}
            className="text-ink-faint mr-1 inline -translate-y-1.5"
            aria-hidden
          />
          {item.evidence}
        </blockquote>
      ) : (
        <p className={`${meta.fg} mt-3 text-sm opacity-80`}>
          简历中未找到相关内容
        </p>
      )}

      {!compact && item.note && (
        <p className="text-ink-soft mt-3 text-sm">{item.note}</p>
      )}
    </article>
  );
}
