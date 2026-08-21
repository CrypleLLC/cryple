export const WINDOW_MS = 60_000;
export const DEFAULT_REQUESTS_PER_MINUTE = 120;

const SWEEP_THRESHOLD = 10_000;

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface CounterWindow {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, CounterWindow>();
  private readonly limit: number;

  constructor(limit: number = DEFAULT_REQUESTS_PER_MINUTE) {
    this.limit = limit;
  }

  check(key: string, now: number = Date.now()): RateLimitDecision {
    if (this.windows.size > SWEEP_THRESHOLD) {
      this.sweep(now);
    }

    const current = this.windows.get(key);

    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (current.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      };
    }

    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key);
      }
    }
  }
}

export function readRequestsPerMinute(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REQUESTS_PER_MINUTE;
}

export function clientKey(forwardedFor: string | null, realIp: string | null): string {
  const first = forwardedFor?.split(',')[0]?.trim();
  if (first) {
    return first;
  }

  const direct = realIp?.trim();
  return direct && direct.length > 0 ? direct : 'unknown';
}
