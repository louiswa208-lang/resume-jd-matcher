/**
 * 在**浏览器里**把 PDF 解析成纯文本。
 *
 * 这是整个产品最重要的隐私决策(docs/design.md 决策 6):
 * 简历文件从头到尾没有离开过用户的浏览器,只有提取出的纯文本会被发送。
 * 所以我们能说一句精确且可验证的话 ——
 * 「你的简历文件从未离开浏览器」,而不是所有网站都在写的
 * 「我们重视您的隐私」。
 *
 * pdfjs 只在真正需要解析时动态载入,避免它进入首屏包体积。
 */

export type PdfExtractResult =
  | { ok: true; text: string; pages: number }
  /** 提取不到文字,基本可以断定是扫描件/图片型 PDF */
  | { ok: false; reason: "scanned" | "corrupt" | "encrypted"; message: string };

/** 少于这个字数就认为「没提取到有效文字」 */
const MIN_MEANINGFUL_CHARS = 40;

export async function extractPdfText(file: File): Promise<PdfExtractResult> {
  const pdfjs = await import("pdfjs-dist");

  // worker 必须显式指定,否则 pdfjs 会去猜路径,在打包环境下猜不中。
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  let doc;
  try {
    const buffer = await file.arrayBuffer();
    doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "PasswordException") {
      return {
        ok: false,
        reason: "encrypted",
        message: "这份 PDF 有密码保护,请先解除密码,或把内容粘贴到下面的文本框。",
      };
    }
    return {
      ok: false,
      reason: "corrupt",
      message: "这份 PDF 读不出来,请换一份,或把内容粘贴到下面的文本框。",
    };
  }

  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();

    let line = "";
    const lines: string[] = [];

    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      // hasEOL 标记这个片段是不是一行的结尾。用它还原换行,
      // 而不是把整页拼成一长串 —— 简历的结构(时间、公司、职位分行)
      // 对后面的判断质量影响很大。
      if (item.hasEOL) {
        lines.push(line.trimEnd());
        line = "";
      }
    }
    if (line.trim()) lines.push(line.trimEnd());

    pageTexts.push(lines.filter((l) => l.trim() !== "").join("\n"));
    page.cleanup();
  }

  const text = pageTexts.join("\n\n").trim();

  if (text.replace(/\s/g, "").length < MIN_MEANINGFUL_CHARS) {
    // 诚实降级:不假装解析成功,直接说清楚原因和下一步该干什么
    return {
      ok: false,
      reason: "scanned",
      message:
        "这份 PDF 像是扫描件或图片,提取不到文字。请把简历内容粘贴到下面的文本框。",
    };
  }

  return { ok: true, text, pages: doc.numPages };
}
