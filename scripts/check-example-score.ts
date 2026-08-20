/**
 * 校验示例数据里的分数是不是**真的**由算分器算出来的。
 *
 * 存在的理由:示例是预置回放,分数是手写进去的。这个项目对外的主张是
 *「分数由固定规则计算、可复现」—— 如果示例里的数字算不出来,
 * 面试官只要按公式验算一次就会发现,主张当场作废。
 *
 * 用法:npx tsx scripts/check-example-score.ts
 */

import { EXAMPLE_JUDGMENTS, EXAMPLE_REQUIREMENTS } from "../src/lib/example";
import { computeScore, mergeItems, scoreResolution } from "../src/lib/scoring";
import type { Judgment } from "../src/lib/types";

const baseItems = mergeItems(EXAMPLE_REQUIREMENTS, EXAMPLE_JUDGMENTS);
const baseline = computeScore(baseItems);
console.log("基线分数:", baseline.score, "| 条数:", baseline.total);

const res = scoreResolution(baseItems);
console.log(
  "分值:硬性要求每条",
  res.mustPoints,
  "分,加分项每条",
  res.nicePoints,
  "分 | 需要提示分辨率过粗:",
  res.coarse,
);

/** 把某条要求的判断替换掉,重新算分 —— 和 try_rewrite 做的事一样 */
function after(patches: Record<string, Partial<Judgment>>) {
  const next = EXAMPLE_JUDGMENTS.map((j) =>
    patches[j.id] ? { ...j, ...patches[j.id] } : j,
  );
  return computeScore(mergeItems(EXAMPLE_REQUIREMENTS, next)).score;
}

// r5:补上「履约全链路」的表述后,从不满足变为部分满足
const afterR5 = after({ r5: { satisfaction: "partial", confidence: "high" } });
console.log("r5 改写后:", afterR5, `(+${afterR5 - baseline.score})`);

// r8:补上指标拆解过程后,从证据不足变为已满足
const afterBoth = after({
  r5: { satisfaction: "partial", confidence: "high" },
  r8: { satisfaction: "met", confidence: "high" },
});
console.log("r8 再改写后:", afterBoth, `(+${afterBoth - afterR5})`);

// 两条都改完之后,还剩哪些没满足
const finalItems = mergeItems(
  EXAMPLE_REQUIREMENTS,
  EXAMPLE_JUDGMENTS.map((j) =>
    j.id === "r5"
      ? { ...j, satisfaction: "partial" as const, confidence: "high" as const }
      : j.id === "r8"
        ? { ...j, satisfaction: "met" as const, confidence: "high" as const }
        : j,
  ),
);
const remaining = finalItems.filter(
  (i) => !(i.confidence !== "low" && i.satisfaction === "met"),
);
console.log(
  "仍未满足:",
  remaining.map((i) => `${i.id}(${i.importance})`).join("、"),
);

// 要求条数很少时,单条硬性要求的分值会大到让分数失去意义 —— 界面要提示。
// 这里用一份人造的短清单验证阈值确实会翻转。
const tiny = EXAMPLE_REQUIREMENTS.slice(0, 4).map((r) => ({
  ...r,
  satisfaction: "unmet" as const,
  confidence: "high" as const,
  evidence: null,
  note: "",
}));
const tinyRes = scoreResolution(tiny);
console.log(
  `短 JD(${tiny.length} 条):硬性要求每条 ${tinyRes.mustPoints} 分 | 触发提示:`,
  tinyRes.coarse,
);
