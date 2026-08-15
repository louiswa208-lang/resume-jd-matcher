/**
 * 从「正在流式到达的文本」里增量提取完整的 JSON 对象。
 *
 * 为什么需要这个:第二步的输出是一个 JSON 数组,一条判断一个对象。
 * 如果等整个数组下载完再 JSON.parse,前端就只能干等十几秒——
 * 我们想要的是「判断一条、渲染一条」。
 *
 * 做法:扫描字符流,维护花括号深度(正确处理字符串内的括号和转义),
 * 每当深度从 1 回到 0,就说明一个对象完整了,立刻吐出来。
 *
 * 附带好处:模型如果多嘴加了 ```json 代码块标记或前后解释文字,
 * 这个扫描器天然忽略——它只认花括号。
 */
export class JsonObjectExtractor {
  private buf = "";
  private cursor = 0;
  private depth = 0;
  private objStart = -1;
  private inString = false;
  private escaped = false;

  /** 喂入一段增量文本,返回这段文本让哪些对象变完整了 */
  push(chunk: string): string[] {
    this.buf += chunk;
    const found: string[] = [];

    while (this.cursor < this.buf.length) {
      const ch = this.buf[this.cursor];

      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
        } else if (ch === "\\") {
          this.escaped = true;
        } else if (ch === '"') {
          this.inString = false;
        }
      } else if (ch === '"') {
        this.inString = true;
      } else if (ch === "{") {
        if (this.depth === 0) this.objStart = this.cursor;
        this.depth += 1;
      } else if (ch === "}") {
        this.depth -= 1;
        if (this.depth === 0 && this.objStart >= 0) {
          found.push(this.buf.slice(this.objStart, this.cursor + 1));
          this.objStart = -1;
        }
        // 容错:模型偶尔多吐一个右括号时不要把状态搞乱
        if (this.depth < 0) this.depth = 0;
      }

      this.cursor += 1;
    }

    return found;
  }

  /** 到目前为止收到的完整原文,用于兜底解析和排错 */
  get text(): string {
    return this.buf;
  }
}
