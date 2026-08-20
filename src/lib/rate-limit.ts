/**
 * 按 IP 的每日调用限流。
 *
 * ⚠️ 已知局限(有意接受的取舍):
 * 这是**进程内内存**限流。部署到 Vercel 这类 serverless 平台后,
 * 每个实例有自己的一份计数,实例回收后计数归零。
 * 也就是说这是一道**软门槛**——足够拦住顺手多点几次的普通用户,
 * 拦不住铁了心要刷的人。
 *
 * 为什么 v1 接受这个局限:真正可靠的限流需要外部存储(Redis / Vercel KV),
 * 那要额外的账号、配置和一个新的失败点。作品集项目的实际风险是
 * 「朋友多点几次」,不是「被人恶意刷爆」。等真出现滥用再换,
 * 换的时候只需要替换这个文件里的两个函数。
 */

/*
 * 30 次是按实测成本定的,不是拍的。
 *
 * 实测一次完整使用(逐条匹配 + agent 优化到收尾)约:
 *   输入 44,030 token(其中 18,048 命中缓存)+ 输出 4,497 token
 * 其中 agent 占约 93% —— 每次 try_rewrite 都要重跑一次判断。
 * 按 deepseek-chat 的量级折算,单次成本在一毛钱以内。
 *
 * 原来定 5 是上线时的保守值。真实场景是同一家公司的面试官共用一个出口 IP,
 * 5 次很容易被前几个人用完,后面的人只能看示例 —— 这个代价比多花几块钱大得多。
 *
 * 注意上面那条局限:多实例下这只是软门槛,配 30 不等于上限就是 30。
 * 成本可控靠的是单次便宜,不是限流严。
 */
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT_PER_IP ?? 30);
const WINDOW_MS = 24 * 60 * 60 * 1000;

interface Entry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Entry>();

/** 顺手清理过期条目,避免长期运行的实例内存无限增长 */
function sweep(now: number): void {
  if (buckets.size < 1000) return;
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

/**
 * 从请求头里取客户端 IP。
 * x-forwarded-for 可能是 "客户端, 代理1, 代理2",取第一个。
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  /** 距离额度重置还有多久(毫秒) */
  resetInMs: number;
}

export function checkRateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(ip);

  if (!existing || existing.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return {
      allowed: true,
      remaining: DAILY_LIMIT - 1,
      limit: DAILY_LIMIT,
      resetInMs: WINDOW_MS,
    };
  }

  if (existing.count >= DAILY_LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      limit: DAILY_LIMIT,
      resetInMs: existing.resetAt - now,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: DAILY_LIMIT - existing.count,
    limit: DAILY_LIMIT,
    resetInMs: existing.resetAt - now,
  };
}

/** 把毫秒转成「约 3 小时」这样的中文说法,用于限流提示文案 */
export function formatResetIn(ms: number): string {
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours <= 1) return "1 小时内";
  return `约 ${hours} 小时后`;
}
