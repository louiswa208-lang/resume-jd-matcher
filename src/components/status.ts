/**
 * 四种状态的视觉配置,集中在一处 —— 状态色在页面上出现十几次,
 * 散落各处迟早会不一致。
 *
 * 图标的选择是有语义的,不是随便挑好看的:
 *   已满足    → 对勾
 *   部分满足  → 减号(有,但不够)
 *   不满足    → 叉
 *   证据不足  → **问号**,不是感叹号
 *
 * 最后一条是关键。证据不足意味着「我不知道」,不是「你不行」。
 * 用警告图标 + 警告色会让用户以为自己不合格,而事实可能是他满足要求、
 * 只是没写在简历里。所以它用问号 + 靛蓝,和红黄的「有问题」明确区分开。
 */

import {
  Briefcase,
  Check,
  CircleQuestionMark,
  GraduationCap,
  MessagesSquare,
  Minus,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type { DisplayStatus, RequirementCategory } from "@/lib/types";

export interface StatusMeta {
  label: string;
  /** 卡片里那句更完整的说明 */
  hint: string;
  Icon: LucideIcon;
  /** 文字色 */
  fg: string;
  /** 徽章底色 */
  bg: string;
  /** 整张卡片的极淡底色 */
  tint: string;
  /** 卡片左侧的状态条颜色(CSS 变量,用于内联样式) */
  swatch: string;
}

export const STATUS_META: Record<DisplayStatus, StatusMeta> = {
  met: {
    label: "已满足",
    hint: "简历中有可核验的事实佐证",
    Icon: Check,
    fg: "text-met",
    bg: "bg-met-bg",
    tint: "bg-met-tint",
    swatch: "var(--color-met)",
  },
  partial: {
    label: "部分满足",
    hint: "有相关基础,但存在差距",
    Icon: Minus,
    fg: "text-partial",
    bg: "bg-partial-bg",
    tint: "bg-partial-tint",
    swatch: "var(--color-partial)",
  },
  unmet: {
    label: "不满足",
    hint: "有证据表明不满足",
    Icon: X,
    fg: "text-unmet",
    bg: "bg-unmet-bg",
    tint: "bg-unmet-tint",
    swatch: "var(--color-unmet)",
  },
  insufficient: {
    label: "证据不足",
    hint: "简历里没提到,不代表你没有",
    Icon: CircleQuestionMark,
    fg: "text-insufficient",
    bg: "bg-insufficient-bg",
    tint: "bg-insufficient-tint",
    swatch: "var(--color-insufficient)",
  },
};

export const IMPORTANCE_LABEL = {
  must: "硬性要求",
  nice: "加分项",
} as const;

/**
 * 要求分类的图标。
 *
 * 加它是因为四种分类在卡片上只是四个词,扫读时区分不开;
 * 换成图标之后,「这一栏差的全是经验类」这种事一眼就能看出来 ——
 * 图标在这里承担信息,不是装饰。
 */
export const CATEGORY_ICON: Record<RequirementCategory, LucideIcon> = {
  硬性资格: GraduationCap,
  专业技能: Wrench,
  经验: Briefcase,
  软性素质: MessagesSquare,
};
