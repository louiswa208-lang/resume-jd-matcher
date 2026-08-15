import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

/*
 * IBM Plex:有真实的工程 / 审阅气质,和「逐条核对一份文件」这个动作吻合。
 * Mono 用在编号(r1、r2)、权重标签和分数上 —— 等宽字体呼应「清单」这个母题。
 *
 * next/font 在构建时把字体下载并自托管,运行时不请求外部 CDN。
 * 这一点对国内访问很重要:不会因为字体 CDN 被墙而让整页字体崩掉。
 */
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "简历与 JD 匹配工具",
  description:
    "粘贴岗位描述、上传简历,把 JD 拆成一条条要求逐条比对:哪些满足、哪些有差距、哪些只是简历里没写。每条判断都附简历原文作为证据,分数由规则算出。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${plexSans.variable} ${plexMono.variable} h-full`}
    >
      <body className="bg-paper text-ink flex min-h-full flex-col">
        {children}
      </body>
    </html>
  );
}
