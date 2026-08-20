/**
 * 分数 + 构成条。
 *
 * 构成条是整个页面的 signature 元素,它把最重要的产品决策直接变成了视觉:
 * **分数不是模型凭空给的,是由这些条目加权算出来的。**
 *
 * 每一段 = 一条要求,段的宽度 = 这条要求的权重,颜色 = 判断结果。
 * 于是「硬性要求的段比加分项宽三倍」这件事是**看得见**的 ——
 * 用户不需要读任何说明,就能理解为什么少满足一条硬性要求扣得更多。
 *
 * 页面上的视觉张力只放在这一处,其它地方保持安静。
 */

import { TriangleAlert } from "lucide-react";
import { scoreResolution, WEIGHT, toDisplayStatus } from "@/lib/scoring";
import type { DisplayStatus, EvaluatedItem, ScoreResult } from "@/lib/types";
import { STATUS_META } from "./status";

/** 构成条里的段按状态分组,从「满足」到「不满足」—— 分组后比例一眼可读 */
const SEGMENT_ORDER: DisplayStatus[] = [
  "met",
  "partial",
  "insufficient",
  "unmet",
];

interface Props {
  items: EvaluatedItem[];
  score: ScoreResult;
  explanation: string;
  /** 示例结果需要明确标注,不能让人误以为是实时分析 */
  isExample?: boolean;
}

export function ScoreBoard({ items, score, explanation, isExample }: Props) {
  const segments = SEGMENT_ORDER.flatMap((status) =>
    items
      .filter((item) => toDisplayStatus(item.satisfaction, item.confidence) === status)
      .map((item) => ({ item, status })),
  );

  const totalWeight = segments.reduce(
    (sum, s) => sum + (WEIGHT[s.item.importance] ?? WEIGHT.nice),
    0,
  );
  const resolution = scoreResolution(items);

  return (
    <section className="border-rule bg-surface rounded-xl border p-6 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-6xl leading-none font-medium tracking-tight sm:text-7xl">
            {score.score}
          </span>
          <span className="text-ink-faint text-sm">/ 100</span>
        </div>

        {isExample && (
          <span className="border-rule text-ink-soft rounded-full border px-3 py-1 text-xs">
            示例结果 · 预置数据
          </span>
        )}
      </div>

      {/* 构成条 */}
      <div className="mt-6">
        <div
          className="animate-grow-width flex h-3 gap-[2px] overflow-hidden"
          role="img"
          aria-label={`分数构成:${explanation}`}
        >
          {segments.map(({ item, status }) => {
            const weight = WEIGHT[item.importance] ?? WEIGHT.nice;
            return (
              <div
                key={item.id}
                className="h-full rounded-[1px] first:rounded-l-full last:rounded-r-full"
                style={{
                  width: `${(weight / totalWeight) * 100}%`,
                  background: STATUS_META[status].swatch,
                }}
                title={`${item.text} · ${STATUS_META[status].label}`}
              />
            );
          })}
        </div>

        {/*
         * 把「一条值多少分」直接标出来。
         * 分母是权重之和,所以要求越少单条越值钱 —— 不标的话,
         * 用户看到 agent「改一句话涨 27 分」只会觉得这分数很好糊弄。
         */}
        <p className="text-ink-faint mt-2 font-mono text-[11px]">
          每段 = 一条要求,宽度 = 权重 · 共 {score.total} 条,硬性要求每条{" "}
          {resolution.mustPoints} 分,加分项每条 {resolution.nicePoints} 分
        </p>
      </div>

      <p className="text-ink-soft mt-5 text-sm">{explanation}</p>

      {resolution.coarse && (
        <p className="text-partial bg-partial-tint border-partial/25 mt-3 flex items-start gap-2 rounded-lg border p-3 text-xs">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            这份 JD 只识别出 {score.total} 条要求,单条硬性要求就值{" "}
            {resolution.mustPoints} 分 —— 分数会随一两条判断大幅跳动,
            不适合当精确数字看,请结合下面的逐条判断一起读。
          </span>
        </p>
      )}

      {/* 图例 */}
      <ul className="border-rule mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t pt-4">
        {SEGMENT_ORDER.map((status) => {
          const count = score.counts[status];
          if (count === 0) return null;
          const meta = STATUS_META[status];
          return (
            <li key={status} className="flex items-center gap-2 text-xs">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: meta.swatch }}
                aria-hidden
              />
              <span className="text-ink-soft">{meta.label}</span>
              <span className="font-mono">{count}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
