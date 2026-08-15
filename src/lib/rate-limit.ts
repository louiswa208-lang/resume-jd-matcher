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

const DAILY_LIMIT = Number(process.env.DAILY_LIMIT_PER_IP ?? 5);
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
