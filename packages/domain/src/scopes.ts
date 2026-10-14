import { GRANT_VERBS, type GrantVerb } from "./types.js";

export function isGrantScope(value: string): value is GrantVerb {
  return (GRANT_VERBS as readonly string[]).includes(value);
}

/** Grant verbs stored on a scoped API key. An empty list or an unknown verb returns null. */
export function normalizeScopes(values: readonly string[]): GrantVerb[] | null {
  if (values.length === 0) return null;
  const scopes: GrantVerb[] = [];
  for (const value of values) {
    if (!isGrantScope(value)) return null;
    if (!scopes.includes(value)) scopes.push(value);
  }
  return scopes;
}

export function scopeAllows(scopes: readonly GrantVerb[], verb: GrantVerb): boolean {
  return scopes.includes(verb);
}
