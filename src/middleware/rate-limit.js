// Tiny in-memory per-IP fixed-window rate limiter (no external dependency).
// Good enough for a single-process app; swap for a Redis-backed limiter if you
// scale to multiple instances.
export function rateLimit({ windowMs = 60_000, max = 60, message } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }

  // Periodically drop expired buckets so the map doesn't grow unbounded.
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, e] of hits) if (now > e.resetAt) hits.delete(ip);
  }, windowMs);
  if (timer.unref) timer.unref();

  return function (req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    let e = hits.get(ip);
    if (!e || now > e.resetAt) {
      e = { count: 0, resetAt: now + windowMs };
      hits.set(ip, e);
    }
    e.count++;

    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - e.count));

    if (e.count > max) {
      const retryAfter = Math.ceil((e.resetAt - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({
        error: message || "Too many requests — please slow down and try again in a moment.",
      });
    }
    next();
  };
}
