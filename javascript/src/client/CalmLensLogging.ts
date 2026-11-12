import { invalidConfig } from "./CalmLensError";
import type { RequestAttempt } from "./CalmLensTypes";

/** How much the client logs: `info` logs retries and failed requests, `debug` every attempt. */
export type LogLevel = "off" | "info" | "debug";

const LOG_LEVELS: readonly LogLevel[] = ["off", "info", "debug"];

/** Where the client logs, such as `console` or a logger with the same methods. */
export interface CalmLensLogger {
  debug(message: string): void;
  info(message: string): void;
}

/**
 * An environment variable, in runtimes that have an environment: Node.js, Bun and Deno (with
 * `--allow-env`). Cloudflare Workers and browsers have none, so it is `undefined` there.
 */
export const readEnv = (name: string): string | undefined => {
  const runtime = globalThis as {
    process?: { env?: Record<string, string | undefined> };
    Deno?: { env?: { get(name: string): string | undefined } };
  };
  try {
    const value = runtime.process?.env?.[name] ?? runtime.Deno?.env?.get(name);
    return value === undefined || value.trim() === "" ? undefined : value.trim();
  } catch {
    // Deno without --allow-env throws.
    return undefined;
  }
};

/** The log level: the option, else `CALMLENS_LOG` from the environment, else `off`. */
export const resolveLogLevel = (option: LogLevel | undefined, fromEnv: boolean): LogLevel => {
  if (option !== undefined) {
    if (!LOG_LEVELS.includes(option)) {
      throw invalidConfig(`logLevel must be one of ${LOG_LEVELS.join(", ")}`);
    }
    return option;
  }
  const env = fromEnv ? readEnv("CALMLENS_LOG")?.toLowerCase() : undefined;
  return LOG_LEVELS.includes(env as LogLevel) ? (env as LogLevel) : "off";
};

/**
 * One line about an attempt: what was sent where, how it ended and what happens next. It holds no
 * API key, upload token, query (which can hold viewer claims), signed URL or body.
 */
export const describeAttempt = (attempt: RequestAttempt): string => {
  const outcome =
    attempt.status !== null
      ? `HTTP ${attempt.status}`
      : attempt.errorCode !== null
        ? attempt.errorCode
        : "no response";
  const parts = [
    `[calmlens] ${attempt.operation ?? "request"} ${attempt.method} ${attempt.path}`,
    `attempt ${attempt.attempt}`,
    outcome,
    `${attempt.durationMs}ms`,
  ];
  if (attempt.requestId) parts.push(`request ${attempt.requestId}`);
  if (attempt.delayMs !== null) parts.push(`retrying in ${attempt.delayMs}ms`);
  return parts.join(" · ");
};
