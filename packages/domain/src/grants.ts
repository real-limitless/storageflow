import { coversKey } from "./keys.js";
import type { GrantVerb } from "./types.js";

export interface GrantCheck {
  backendKey: string;
  nodeKind: "file" | "folder";
  verbs: GrantVerb[];
  expiresAt: string | null;
  downloadCap: number | null;
  downloadCount: number;
}

export function grantIsLive(grant: Pick<GrantCheck, "expiresAt">, now: Date): boolean {
  if (!grant.expiresAt) return true;
  return new Date(grant.expiresAt).getTime() > now.getTime();
}

export function grantAllowsVerb(grant: GrantCheck, verb: GrantVerb, now: Date): boolean {
  if (!grantIsLive(grant, now)) return false;
  if (!grant.verbs.includes(verb)) return false;
  if (verb === "download" && grant.downloadCap != null && grant.downloadCount >= grant.downloadCap) return false;
  return true;
}

export function isDropFolder(verbs: readonly GrantVerb[]): boolean {
  return verbs.includes("upload") && !verbs.includes("list");
}

export function verbsForNode(grants: readonly GrantCheck[], nodeKey: string, now: Date): GrantVerb[] {
  const allowed = new Set<GrantVerb>();
  for (const grant of grants) {
    if (!coversKey(grant.backendKey, nodeKey, grant.nodeKind)) continue;
    for (const verb of grant.verbs) {
      if (grantAllowsVerb(grant, verb, now)) allowed.add(verb);
    }
  }
  return [...allowed];
}

export function grantCovers(grant: GrantCheck, nodeKey: string): boolean {
  return coversKey(grant.backendKey, nodeKey, grant.nodeKind);
}
