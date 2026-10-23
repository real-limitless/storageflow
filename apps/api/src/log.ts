export type LogOutcome = "success" | "failure" | "denied";

export type LogCategory = "auth" | "access" | "admin" | "config" | "rate_limit" | "runtime";

export interface LogEvent {
  timestamp: string;
  service: string;
  environment: string;
  request_id: string | null;
  actor: string | null;
  source_ip: string | null;
  action: string;
  outcome: LogOutcome;
  category: LogCategory;
  message?: string;
}

export interface Logger {
  write(event: LogEvent): void;
}

const SECRET_KEY = /password|passwd|secret|token|authorization|cookie|api[_-]?key|credential|session|private/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[redacted]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(item, depth + 1);
    }
    return output;
  }
  return value;
}

export function redactString(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsfk_[A-Za-z0-9_-]{9,}\b/g, (match) => match.slice(0, 12))
    .replace(/((?:password|passwd|secret|token|authorization|cookie)\s*[=:]\s*)([^\s,;]+)/gi, "$1[redacted]");
}

export function formatLog(event: LogEvent): string {
  return JSON.stringify(redact(event));
}

export function createLogger(write: (line: string) => void = (line) => {
  process.stdout.write(`${line}\n`);
}): Logger {
  return {
    write(event) {
      write(formatLog(event));
    },
  };
}

export function runtimeEvent(
  config: { environment: string },
  now: Date,
  action: string,
  outcome: LogOutcome,
  message: string,
): LogEvent {
  return {
    timestamp: now.toISOString(),
    service: "storageflow-api",
    environment: config.environment,
    request_id: null,
    actor: null,
    source_ip: null,
    action,
    outcome,
    category: "runtime",
    message: redactString(message),
  };
}
