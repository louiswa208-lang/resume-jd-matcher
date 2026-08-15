/**
 * 示例所使用的 JD 与简历。
 *
 * 为什么单独做一个组件、而不是把示例内容填进真实输入框:
 * 输入框属于用户。示例往里写内容,用户看完示例回到首页就得先全选删掉
 * 才能填自己的 —— 这是拿用户的工作区去做演示,不该这么干。
 *
 * 两个框都是**只读**的。可编辑但编辑了不生效会误导:
 * 用户会以为改一改就能重跑,实际上示例是预置数据,不走模型。
 */

import { EXAMPLE_JD, EXAMPLE_RESUME } from "@/lib/example";

function InputPreview({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-ink-faint font-mono text-[11px]">
          {text.length} 字
        </span>
      </div>
      <textarea
        readOnly
        value={text}
        aria-label={`示例使用的${title}(只读)`}
        className="border-rule bg-paper text-ink-soft mt-2 h-44 w-full resize-none rounded-lg border p-3 text-xs leading-relaxed"
      />
    </div>
  );
}

/**
 * 分析中和结果页用的是同一个形态、同一个位置。
 * 这样从「分析中」切到「结果」时这一块纹丝不动,分数直接在它下方长出来,
 * 视觉上是连续的,不会有整页重排的跳动感。
 */
export function ExampleInputs() {
  return (
    <section className="border-rule bg-surface rounded-xl border p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-medium">本次示例的输入</h2>
        <span className="border-rule text-ink-soft rounded-full border px-3 py-1 text-xs">
          预置数据
        </span>
      </div>
      <p className="text-ink-soft mt-1.5 text-sm">
        以下是这次示例所使用的岗位 JD 与简历,下方的判断结果均基于这两份内容。
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <InputPreview title="岗位 JD" text={EXAMPLE_JD} />
        <InputPreview title="简历" text={EXAMPLE_RESUME} />
      </div>
    </section>
  );
}
