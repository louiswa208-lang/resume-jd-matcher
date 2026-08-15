/**
 * 首页预置示例。
 *
 * 为什么示例是预置数据、而不是真的去调一次模型:
 *
 *  1. 面试官/HR 点进来只有十几秒耐心,不该为了看个 demo 等 15 秒;
 *  2. 每个访客点一次都是真金白银,示例是最容易被反复点的按钮;
 *  3. 最关键的一条 —— 万一 API 挂了、额度用完了、key 过期了,
 *     作品集首页就废了。预置数据保证这个页面**永远**能展示产品能力。
 *
 * 真实上传走的是完整实时流程(/api/analyze)。示例在界面上有明确标注,
 * 前端按真实节奏回放,视觉上和真实流程一致。
 *
 * 这份数据是**刻意设计**的:它同时包含「已满足」「部分满足」「不满足」
 * 「证据不足」四种状态,以及硬性和加分两种权重 ——
 * 点一次示例,产品的全部能力都能看到。随便找一份简历做不到这一点。
 */

import type { Judgment, Requirement } from "./types";

/** 虚构人物,不含任何真实联系方式 —— 作者本人的简历不适合公开在网上 */
export const EXAMPLE_RESUME = `林清越 | 2026 届毕业生 | 求职意向:B端产品经理

【教育背景】
浙江某大学 | 信息管理与信息系统专业 | 本科 | 2022.09-2026.06
主修课程:数据库原理、管理信息系统、运筹学、数据结构
GPA 3.7/4.0,专业排名前 15%

【实习经历】
字节跳动 · 电商中台 | 产品经理实习生 | 2025.03-2025.09(7个月)
- 负责商家后台「订单管理」模块的迭代,独立完成 6 份 PRD 并主持需求评审,累计推动 14 个需求上线
- 使用 SQL 从数据仓库提取订单履约数据,定位到批量改地址功能失败率高达 8.3%,推动技术侧优化后降至 1.1%
- 设计商家侧核心指标体系与埋点方案,与数据团队共同落地 23 个埋点,支撑月度经营分析
- 与运营、客服、研发三方对齐需求优先级,主导双周需求评审会

某跨境电商创业公司 | 产品实习生 | 2024.07-2024.10(4个月)
- 参与商品中心模块的需求梳理,输出竞品分析报告 2 份
- 使用 Axure 完成中低保真原型 30 余页,配合设计师完成视觉走查

【项目经历】
校园二手交易小程序 | 产品负责人 | 2024.02-2024.06
- 从需求调研、方案设计到上线全流程独立负责,累计注册用户 2400+,月活 600+
- 完成用户访谈 18 场,输出需求文档与交互原型

【技能】
- 熟练使用 SQL(多表关联查询、窗口函数),能独立完成数据提取与分析
- 熟练使用 Axure、Figma 进行原型设计
- 熟悉埋点方案设计与指标体系搭建`;

export const EXAMPLE_JD = `【岗位名称】B端产品经理(供应链方向)

【岗位职责】
1. 负责供应链中台产品的规划与迭代,覆盖采购、仓储、履约等环节;
2. 深入业务一线调研,梳理业务流程,输出产品方案与 PRD;
3. 推动需求落地,协调研发、测试、业务多方资源,保障项目按期上线;
4. 持续跟踪产品数据表现,驱动产品优化。

【任职要求】
1. 本科及以上学历,计算机、信息管理、供应链管理等相关专业;
2. 3 年以上 B 端产品经验;
3. 熟练使用 SQL 进行数据提取与分析;
4. 能独立完成 PRD 撰写与需求评审;
5. 具备供应链、仓储或物流履约类系统的产品经验;
6. 有从 0 到 1 搭建产品的完整经验;
7. 良好的跨部门沟通与推动能力;
8. 逻辑清晰,具备较强的抽象与结构化能力。

【加分项】
1. 熟悉 Axure、Figma 等原型设计工具;
2. 有对接 ERP / WMS 等外部系统经验者优先;
3. 持有 PMP 或供应链相关认证者优先;
4. 了解数据埋点与指标体系设计。`;

export const EXAMPLE_REQUIREMENTS: Requirement[] = [
  {
    id: "r1",
    text: "本科及以上学历,计算机、信息管理、供应链管理等相关专业",
    category: "硬性资格",
    importance: "must",
  },
  {
    id: "r2",
    text: "3 年以上 B 端产品经验",
    category: "经验",
    importance: "must",
  },
  {
    id: "r3",
    text: "熟练使用 SQL 进行数据提取与分析",
    category: "专业技能",
    importance: "must",
  },
  {
    id: "r4",
    text: "能独立完成 PRD 撰写与需求评审",
    category: "专业技能",
    importance: "must",
  },
  {
    id: "r5",
    text: "具备供应链、仓储或物流履约类系统的产品经验",
    category: "经验",
    importance: "must",
  },
  {
    id: "r6",
    text: "有从 0 到 1 搭建产品的完整经验",
    category: "经验",
    importance: "must",
  },
  {
    id: "r7",
    text: "良好的跨部门沟通与推动能力",
    category: "软性素质",
    importance: "must",
  },
  {
    id: "r8",
    text: "逻辑清晰,具备较强的抽象与结构化能力",
    category: "软性素质",
    importance: "must",
  },
  {
    id: "r9",
    text: "熟悉 Axure、Figma 等原型设计工具",
    category: "专业技能",
    importance: "nice",
  },
  {
    id: "r10",
    text: "有对接 ERP / WMS 等外部系统经验者优先",
    category: "经验",
    importance: "nice",
  },
  {
    id: "r11",
    text: "持有 PMP 或供应链相关认证者优先",
    category: "硬性资格",
    importance: "nice",
  },
  {
    id: "r12",
    text: "了解数据埋点与指标体系设计",
    category: "专业技能",
    importance: "nice",
  },
];

export const EXAMPLE_JUDGMENTS: Judgment[] = [
  {
    id: "r1",
    satisfaction: "met",
    confidence: "high",
    evidence: "信息管理与信息系统专业 | 本科",
    note: "专业与学历均直接命中要求中列出的相关专业。",
  },
  {
    id: "r2",
    satisfaction: "partial",
    confidence: "medium",
    evidence: "产品经理实习生 | 2025.03-2025.09(7个月)",
    note: "两段实习合计约 11 个月,且均为实习性质,与「3 年以上」有明显差距。",
  },
  {
    id: "r3",
    satisfaction: "met",
    confidence: "high",
    evidence: "熟练使用 SQL(多表关联查询、窗口函数),能独立完成数据提取与分析",
    note: "技能自述之外,实习经历中有用 SQL 定位问题并推动优化的具体案例。",
  },
  {
    id: "r4",
    satisfaction: "met",
    confidence: "high",
    evidence: "独立完成 6 份 PRD 并主持需求评审,累计推动 14 个需求上线",
    note: "PRD 撰写与需求评审两项都有可量化的产出。",
  },
  {
    id: "r5",
    satisfaction: "unmet",
    confidence: "high",
    evidence: "负责商家后台「订单管理」模块的迭代",
    note: "B 端经验集中在电商订单管理,虽接触过履约数据分析,但未主导过供应链、仓储或物流系统本身的产品设计。",
  },
  {
    id: "r6",
    satisfaction: "met",
    confidence: "medium",
    evidence: "从需求调研、方案设计到上线全流程独立负责,累计注册用户 2400+",
    note: "有完整的 0 到 1 经历,但对象是 C 端小程序,与 B 端供应链产品的复杂度不同。",
  },
  {
    id: "r7",
    satisfaction: "met",
    confidence: "medium",
    evidence: "与运营、客服、研发三方对齐需求优先级,主导双周需求评审会",
    note: "有跨三方对齐与会议主导的具体动作,可作为沟通推动能力的证据。",
  },
  {
    id: "r8",
    satisfaction: "unmet",
    confidence: "low",
    evidence: null,
    note: "简历中没有直接描述结构化或抽象能力的内容。这类软性素质通常需要在面试中体现,也可以在简历里用具体案例佐证。",
  },
  {
    id: "r9",
    satisfaction: "met",
    confidence: "high",
    evidence: "熟练使用 Axure、Figma 进行原型设计",
    note: "两个工具均被明确点名,且有 30 余页原型的产出佐证。",
  },
  {
    id: "r10",
    satisfaction: "unmet",
    confidence: "low",
    evidence: null,
    note: "简历中未提及任何 ERP 或 WMS 系统的对接经历。如果实习中接触过,值得补充。",
  },
  {
    id: "r11",
    satisfaction: "unmet",
    confidence: "low",
    evidence: null,
    note: "简历中没有证书相关信息。如果持有 PMP 或供应链类认证,建议补上。",
  },
  {
    id: "r12",
    satisfaction: "met",
    confidence: "high",
    evidence: "设计商家侧核心指标体系与埋点方案,与数据团队共同落地 23 个埋点",
    note: "埋点与指标体系两项都有实际落地成果。",
  },
];
