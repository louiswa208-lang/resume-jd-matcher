"use client";

import {
  CircleAlert,
  ClipboardList,
  FileUser,
  LoaderCircle,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { extractPdfText } from "@/lib/pdf";
import { LIMITS } from "@/lib/protocol";

interface Props {
  jdText: string;
  onJdChange: (value: string) => void;
  resumeText: string;
  onResumeChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
}

export function InputForm({
  jdText,
  onJdChange,
  resumeText,
  onResumeChange,
  onSubmit,
  busy,
}: Props) {
  const [parsing, setParsing] = useState(false);
  const [pdfNote, setPdfNote] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState(false);
  const resumeRef = useRef<HTMLTextAreaElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;

    setParsing(true);
    setPdfNote(null);
    setPdfError(false);

    const result = await extractPdfText(file);

    setParsing(false);
    if (result.ok) {
      // 把解析结果填进文本框而不是藏起来:用户能当场确认「系统读到的
      // 是不是我简历里的内容」,解析歪了也能直接改。
      onResumeChange(result.text);
      setPdfNote(`已读取 ${file.name} 的 ${result.pages} 页文字,可在下方核对或修改`);
    } else {
      setPdfError(true);
      setPdfNote(result.message);
      resumeRef.current?.focus();
    }
  }

  const jdReady = jdText.trim().length >= LIMITS.jdMin;
  const resumeReady = resumeText.trim().length >= LIMITS.resumeMin;
  const canSubmit = jdReady && resumeReady && !busy && !parsing;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* 岗位描述 */}
      <div className="flex flex-col">
        <label
          htmlFor="jd"
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <ClipboardList size={15} className="text-ink-faint" aria-hidden />
          岗位描述
        </label>
        <p className="text-ink-faint mt-1 text-xs">
          整段粘贴即可,记得带上「任职要求」部分 —— 判断都是从那里来的。
        </p>
        <textarea
          id="jd"
          value={jdText}
          onChange={(event) => onJdChange(event.target.value)}
          maxLength={LIMITS.jdMax}
          placeholder="把招聘网站上的岗位描述粘贴到这里…"
          className="border-rule bg-surface placeholder:text-ink-faint mt-3 min-h-56 flex-1 resize-y rounded-lg border p-4 text-sm leading-relaxed"
        />
        <p className="text-ink-faint mt-1.5 text-right font-mono text-[11px]">
          {jdText.trim().length}
        </p>
      </div>

      {/* 简历 */}
      <div className="flex flex-col">
        <label
          htmlFor="resume"
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <FileUser size={15} className="text-ink-faint" aria-hidden />
          你的简历
        </label>
        <p className="text-ink-faint mt-1 text-xs">
          上传 PDF 或直接粘贴文字。
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="border-rule-strong hover:border-ink focus-within:border-ink inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-4 py-2 text-sm transition-colors">
            {parsing ? (
              <LoaderCircle size={15} className="animate-spin" aria-hidden />
            ) : (
              <Upload size={15} aria-hidden />
            )}
            {parsing ? "正在读取…" : "选择 PDF 文件"}
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              disabled={parsing || busy}
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        </div>

        {pdfNote && (
          <p
            className={`mt-2 flex items-start gap-1.5 text-xs ${
              pdfError ? "text-unmet" : "text-ink-soft"
            }`}
          >
            {pdfError && (
              <CircleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
            )}
            {pdfNote}
          </p>
        )}

        <textarea
          id="resume"
          ref={resumeRef}
          value={resumeText}
          onChange={(event) => onResumeChange(event.target.value)}
          maxLength={LIMITS.resumeMax}
          placeholder="或者把简历内容直接粘贴到这里…"
          className="border-rule bg-surface placeholder:text-ink-faint mt-3 min-h-56 flex-1 resize-y rounded-lg border p-4 text-sm leading-relaxed"
        />
        <p className="text-ink-faint mt-1.5 text-right font-mono text-[11px]">
          {resumeText.trim().length}
        </p>
      </div>

      {/* 提交 */}
      <div className="lg:col-span-2">
        <div className="border-rule flex flex-col gap-4 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-ink-soft flex items-start gap-2 text-xs sm:items-center">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 sm:mt-0" aria-hidden />
            <span>
              PDF 在你的浏览器里解析,文件不会上传。只有提取出的文字会被发送用于分析,
              分析完即丢弃,不做任何存储。
            </span>
          </p>

          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="bg-ink text-paper shrink-0 rounded-lg px-6 py-3 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
          >
            {busy ? "分析中…" : "开始逐条核对"}
          </button>
        </div>

        {!canSubmit && !busy && (jdText.length > 0 || resumeText.length > 0) && (
          <p className="text-ink-faint mt-2 text-right text-xs">
            {!jdReady && !resumeReady
              ? "岗位描述和简历都还需要再多一些内容"
              : !jdReady
                ? "岗位描述还太短"
                : "简历内容还太短"}
          </p>
        )}
      </div>
    </div>
  );
}
