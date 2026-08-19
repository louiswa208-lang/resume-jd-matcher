# 简历优化 Agent · 设计

第二阶段。第一阶段(逐条匹配)的产出是一个**确定性的规则算分器**,
这一阶段把它当作 agent 的 **reward function** 用。

---

## 为什么是 agent 而不是 workflow

判据是**控制流由谁决定**,不是步骤多少。

第一阶段是标准的 prompt chaining:两步、顺序写死、无工具、无循环 —— 是 workflow。

这一阶段选 agent 的唯一理由:**任务无法提前完全指定**。
改哪几条、改几轮、什么时候需要向用户提问,因人而异 ——
有人缺表述(改写能解决)、有人缺经历(改写解决不了)、有人只是没写(问一句就有)。
这类判断写不进代码,只能交给模型。

> 能用 workflow 解决的问题就不该上 agent —— workflow 更快、更便宜、更好测。

## 工具箱

设计原则:**工具只做模型做不到的事(评分、检索、提问),不做模型本来就会的事(写文案)**。
所以没有「生成改写」工具 —— 改写文本由模型直接写在 `try_rewrite` 的参数里,
工具只负责验证。

| 工具 | 作用 |
|---|---|
| `get_gap_detail(requirement_id)` | 该条要求的原文、权重、判定、置信度、证据、备注 |
| `find_in_resume(keyword)` | 检索简历中的相关段落 |
| `try_rewrite(requirement_id, original_text, rewritten_text)` | **★ reward 信号**:替换后重跑判断,返回新分数与变化 |
| `ask_user(question)` | 中断循环向用户提问 |
| `finish(...)` | 自行判断结束,输出三类结论 |

**成本优化**:`try_rewrite` 重新评分时只跑第二步判断,不重抽 JD 要求
(要求清单不随简历变)。1 次调用而非 2 次。

## 循环控制

| 限制 | 值 |
|---|---|
| 最大轮次 | 12 |
| 最大 `try_rewrite` | 6(主要成本项) |
| 最大 `ask_user` | 3 |

每轮向模型注入剩余预算,让它**自己收敛**,而不是到点被代码硬砍。

## 状态与交互(分段续跑)

`ask_user` 会打断请求-响应模型,所以:

```
agent 调用 ask_user
  → 后端中断循环,把完整对话历史随事件返回前端
  → 前端展示问题,用户回答
  → 前端带着 history + userAnswer 发起新请求
  → 后端从断点继续
```

**后端全程无状态,agent 状态由前端持有** —— 与第一阶段
「不存储任何用户数据」的原则一致,不需要数据库。

## 协议

`POST /api/optimize`,NDJSON 流:

```
请求  { jdText, resumeText, requirements[], baseline{score,items},
        history?, userAnswer?, askToolCallId? }

事件  { type:"tool_call",    tool, args }
      { type:"tool_result",  tool, summary }
      { type:"score_change", from, to, delta }
      { type:"ask_user",     question, history, toolCallId }
      { type:"done",         result }
      { type:"error",        kind, message }
```

## 输出结构

三类结论,缺一不可:

- **已验证有效** —— 经 `try_rewrite` 确认分数提升,附 +N 分
- **尝试过但无效** —— 诚实呈现失败的尝试及原因
- **无法通过改简历解决** —— 经历缺失类,给面试应对建议而非假装能改

保留「尝试过但无效」是刻意的:它证明分数提升是验证出来的,不是模型自说自话。

## 明确不做

替用户直接改简历 / 导出新简历(信任问题)、多 JD 批量优化、账号与历史记录。
