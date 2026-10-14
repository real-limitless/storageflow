import crypto from "node:crypto";
import { decryptString, encryptString, sha256 } from "../crypto.js";
import { HttpError, asBool } from "../http.js";
import type { Row } from "../mappers.js";
import { timingSafeEqualText, generateTotpSecret, verifyTotp } from "../totp.js";
import { accountCanUsePassword, createSession } from "./account.js";
import { recordActivity, recordAudit, type Deps } from "./access.js";

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface MfaEnrollment {
  secret: string;
  otpauth: string;
  recoveryCodes: string[];
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formatRecoveryCode(): string {
  const bytes = crypto.randomBytes(8);
  const raw = [...bytes].map((byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

async function primaryTenantId(deps: Deps, userId: string): Promise<string | null> {
  const rows = await deps.db.query<Row>(
    `SELECT t.id AS tenant_id
     FROM memberships m JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = $1
     ORDER BY t.name
     LIMIT 1`,
    [userId],
  );
  return rows[0] ? String(rows[0].tenant_id) : null;
}

async function auditUser(deps: Deps, userId: string, tenantId: string | null, action: string, detail: Record<string, unknown>): Promise<void> {
  const resolved = tenantId ?? (await primaryTenantId(deps, userId));
  if (!resolved) return;
  await recordAudit(deps, {
    tenantId: resolved,
    actorUserId: userId,
    action,
    targetType: "user",
    targetId: userId,
    detail,
  });
}

export async function beginMfaEnrollment(deps: Deps, user: Row): Promise<MfaEnrollment> {
  if (String(user.kind) === "service") throw new HttpError(400, "invalid", "Service accounts do not use an authenticator");
  if (asBool(user.mfa_enabled)) throw new HttpError(409, "conflict", "An authenticator is already on");
  const secret = generateTotpSecret();
  const recoveryCodes = Array.from({ length: 8 }, () => formatRecoveryCode());
  const userId = String(user.id);
  const now = deps.now().toISOString();
  await deps.db.query(`UPDATE users SET totp_pending_cipher = $2 WHERE id = $1`, [userId, encryptString(deps.config.encryptionKey, secret)]);
  await deps.db.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [userId]);
  for (const code of recoveryCodes) {
    await deps.db.query(`INSERT INTO mfa_recovery_codes (id, user_id, code_cipher, created_at) VALUES ($1,$2,$3,$4)`, [
      crypto.randomUUID(),
      userId,
      encryptString(deps.config.encryptionKey, normalizeRecoveryCode(code)),
      now,
    ]);
  }
  const label = encodeURIComponent(`StorageFlow:${String(user.email)}`);
  const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("StorageFlow")}&algorithm=SHA1&digits=6&period=30`;
  return { secret, otpauth, recoveryCodes };
}

export async function confirmMfaEnrollment(deps: Deps, user: Row, tenantId: string | null, code: string): Promise<{ enabled: true }> {
  if (asBool(user.mfa_enabled)) throw new HttpError(409, "conflict", "An authenticator is already on");
  if (!user.totp_pending_cipher) throw new HttpError(400, "invalid", "Start authenticator setup first");
  const trimmed = code.trim();
  if (!trimmed) throw new HttpError(400, "invalid", "code is required");
  const userId = String(user.id);
  const secret = decryptString(deps.config.encryptionKey, String(user.totp_pending_cipher));
  if (!verifyTotp(secret, trimmed, deps.now())) {
    await auditUser(deps, userId, tenantId, "mfa.reject", { stage: "enroll" });
    throw new HttpError(401, "unauthorized", "That code was not accepted");
  }
  await deps.db.query(`UPDATE users SET totp_cipher = totp_pending_cipher, totp_pending_cipher = NULL, mfa_enabled = true WHERE id = $1`, [userId]);
  await auditUser(deps, userId, tenantId, "mfa.enroll", {});
  return { enabled: true };
}

async function consumeRecoveryCode(deps: Deps, userId: string, code: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length < 8) return false;
  const rows = await deps.db.query<Row>(`SELECT id, code_cipher FROM mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  for (const row of rows) {
    let plain = "";
    try {
      plain = decryptString(deps.config.encryptionKey, String(row.code_cipher));
    } catch {
      continue;
    }
    if (!timingSafeEqualText(plain, normalized)) continue;
    const updated = await deps.db.query<{ id: string }>(
      `UPDATE mfa_recovery_codes SET used_at = $2 WHERE id = $1 AND used_at IS NULL RETURNING id`,
      [String(row.id), deps.now().toISOString()],
    );
    return updated.length > 0;
  }
  return false;
}

export async function verifyMfaChallenge(
  deps: Deps,
  challenge: string,
  code: string,
): Promise<{ token: string; user: Row; tenantId: string | null }> {
  const trimmedChallenge = challenge.trim();
  const trimmedCode = code.trim();
  if (!trimmedChallenge) throw new HttpError(401, "unauthorized", "This sign-in challenge is not valid");
  if (!trimmedCode) throw new HttpError(400, "invalid", "code is required");
  const challenges = await deps.db.query<Row>(`SELECT * FROM mfa_challenges WHERE token_hash = $1`, [sha256(trimmedChallenge)]);
  const pending = challenges[0];
  if (!pending || new Date(String(pending.expires_at)).getTime() <= deps.now().getTime()) {
    throw new HttpError(401, "unauthorized", "This sign-in challenge is not valid");
  }
  const users = await deps.db.query<Row>(`SELECT * FROM users WHERE id = $1`, [String(pending.user_id)]);
  const user = users[0];
  if (!user || !asBool(user.mfa_enabled) || !user.totp_cipher) {
    throw new HttpError(401, "unauthorized", "This sign-in challenge is not valid");
  }
  accountCanUsePassword(user);
  const userId = String(user.id);
  const secret = decryptString(deps.config.encryptionKey, String(user.totp_cipher));
  const totpOk = verifyTotp(secret, trimmedCode, deps.now());
  const recoveryOk = totpOk ? false : await consumeRecoveryCode(deps, userId, trimmedCode);
  if (!totpOk && !recoveryOk) {
    await auditUser(deps, userId, null, "mfa.reject", { stage: "sign-in" });
    throw new HttpError(401, "unauthorized", "That code was not accepted");
  }
  await deps.db.query(`DELETE FROM mfa_challenges WHERE token_hash = $1`, [sha256(trimmedChallenge)]);
  const tenantId = await primaryTenantId(deps, userId);
  const token = await createSession(deps, { userId, tenantId, kind: "member" });
  const method = totpOk ? "totp" : "recovery";
  if (tenantId) {
    await recordActivity(deps, { tenantId, actorUserId: userId, actorEmail: String(user.email), kind: "sign-in", detail: {} });
    await recordAudit(deps, {
      tenantId,
      actorUserId: userId,
      action: "sign-in",
      targetType: "user",
      targetId: userId,
      detail: { method },
    });
    if (method === "recovery") {
      await recordAudit(deps, {
        tenantId,
        actorUserId: userId,
        action: "mfa.recovery",
        targetType: "user",
        targetId: userId,
        detail: {},
      });
    }
  }
  return { token, user, tenantId };
}
