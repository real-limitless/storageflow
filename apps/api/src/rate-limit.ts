export interface RateRule {
  limit: number;
  windowMs: number;
}

export interface RateLimitConfig {
  enabled: boolean;
  signupIp: RateRule;
  signupAccount: RateRule;
  signInIp: RateRule;
  signInAccount: RateRule;
  magicIp: RateRule;
  magicAccount: RateRule;
  magicConsumeIp: RateRule;
  magicConsumeAccount: RateRule;
  mfaIp: RateRule;
  mfaAccount: RateRule;
  ticketIp: RateRule;
  ticketAccount: RateRule;
  abuseIp: RateRule;
  abuseAccount: RateRule;
  portalIp: RateRule;
  portalAccount: RateRule;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;

export function rateLimitFromEnv(env: NodeJS.ProcessEnv): RateLimitConfig {
  const rule = (name: string, limit: number, windowMs: number): RateRule => {
    const limitRaw = env[`RATE_LIMIT_${name}`];
    const windowRaw = env[`RATE_LIMIT_${name}_WINDOW_MS`];
    const parsedLimit = limitRaw == null || limitRaw === "" ? limit : Number(limitRaw);
    const parsedWindow = windowRaw == null || windowRaw === "" ? windowMs : Number(windowRaw);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1_000_000) {
      throw new Error(`RATE_LIMIT_${name} must be a positive integer`);
    }
    if (!Number.isInteger(parsedWindow) || parsedWindow < 1000 || parsedWindow > 86_400_000) {
      throw new Error(`RATE_LIMIT_${name}_WINDOW_MS must be between 1000 and 86400000`);
    }
    return { limit: parsedLimit, windowMs: parsedWindow };
  };
  return {
    enabled: env.RATE_LIMIT_ENABLED !== "0",
    signupIp: rule("SIGNUP_IP", 5, HOUR),
    signupAccount: rule("SIGNUP_ACCOUNT", 3, HOUR),
    signInIp: rule("SIGNIN_IP", 10, MINUTE),
    signInAccount: rule("SIGNIN_ACCOUNT", 5, MINUTE),
    magicIp: rule("MAGIC_IP", 5, 15 * MINUTE),
    magicAccount: rule("MAGIC_ACCOUNT", 3, 15 * MINUTE),
    magicConsumeIp: rule("MAGIC_CONSUME_IP", 10, MINUTE),
    magicConsumeAccount: rule("MAGIC_CONSUME_ACCOUNT", 5, MINUTE),
    mfaIp: rule("MFA_IP", 10, MINUTE),
    mfaAccount: rule("MFA_ACCOUNT", 5, MINUTE),
    ticketIp: rule("TICKET_IP", 30, MINUTE),
    ticketAccount: rule("TICKET_ACCOUNT", 10, MINUTE),
    abuseIp: rule("ABUSE_IP", 5, HOUR),
    abuseAccount: rule("ABUSE_ACCOUNT", 5, HOUR),
    portalIp: rule("PORTAL_IP", 10, MINUTE),
    portalAccount: rule("PORTAL_ACCOUNT", 5, MINUTE),
  };
}

export interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** In-process sliding window. One API process keeps its own counters. */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly now: () => number) {}

  take(key: string, rule: RateRule): RateDecision {
    const now = this.now();
    const windowStart = now - rule.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((at) => at > windowStart);
    if (recent.length >= rule.limit) {
      const oldest = recent[0] ?? now;
      const retryMs = Math.max(0, oldest + rule.windowMs - now);
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
