import type { TransferPlan, TransferSettings } from "./types.js";

export interface PlanLimits {
  waitSeconds: number;
  bytesPerSecond: number;
  dailyBytes: number;
  cooldownSeconds: number;
  ticketTtlSeconds: number;
}

export function limitsFor(plan: TransferPlan, settings: TransferSettings): PlanLimits {
  if (plan === "paid") {
    return {
      waitSeconds: 0,
      bytesPerSecond: settings.paidBytesPerSecond,
      dailyBytes: settings.paidDailyBytes,
      cooldownSeconds: 0,
      ticketTtlSeconds: settings.ticketTtlSeconds,
    };
  }
  return {
    waitSeconds: settings.freeWaitSeconds,
    bytesPerSecond: settings.freeBytesPerSecond,
    dailyBytes: settings.freeDailyBytes,
    cooldownSeconds: settings.freeCooldownSeconds,
    ticketTtlSeconds: settings.ticketTtlSeconds,
  };
}

export function ticketWindow(now: Date, limits: PlanLimits): { readyAt: Date; expiresAt: Date } {
  const readyAt = new Date(now.getTime() + limits.waitSeconds * 1000);
  const expiresAt = new Date(readyAt.getTime() + limits.ticketTtlSeconds * 1000);
  return { readyAt, expiresAt };
}

export function cooldownRemaining(now: Date, lastCreatedAt: Date | null, cooldownSeconds: number): number {
  if (!lastCreatedAt || cooldownSeconds <= 0) return 0;
  const until = lastCreatedAt.getTime() + cooldownSeconds * 1000;
  return Math.max(0, until - now.getTime());
}

export function dailyRemaining(used: number, cap: number): number {
  return Math.max(0, cap - used);
}

export function chunkDelayMs(bytes: number, bytesPerSecond: number): number {
  if (bytesPerSecond <= 0 || bytes <= 0) return 0;
  return Math.ceil((bytes / bytesPerSecond) * 1000);
}

export const DEFAULT_TRANSFER_SETTINGS: TransferSettings = {
  freeWaitSeconds: 30,
  freeBytesPerSecond: 50 * 1024,
  freeDailyBytes: 2 * 1024 * 1024 * 1024,
  freeCooldownSeconds: 60,
  paidBytesPerSecond: 10 * 1024 * 1024,
  paidDailyBytes: 100 * 1024 * 1024 * 1024,
  ticketTtlSeconds: 60 * 60,
};
