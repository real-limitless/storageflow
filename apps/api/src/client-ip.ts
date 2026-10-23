/** Client address from the socket, or from proxy headers when the peer is trusted. */

export function resolveClientIp(input: {
  peer: string | null;
  forwardedFor: string | null;
  realIp: string | null;
  trusted: readonly string[];
}): string {
  const peer = normalizeIp(input.peer);
  if (!peer || !isTrusted(peer, input.trusted)) return peer ?? "unknown";

  const chain = (input.forwardedFor ?? "")
    .split(",")
    .map((part) => normalizeIp(part))
    .filter((part): part is string => part != null);
  if (chain.length > 0) {
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const hop = chain[index];
      if (hop && !isTrusted(hop, input.trusted)) return hop;
    }
    return chain[0] ?? peer;
  }

  const real = normalizeIp(input.realIp);
  if (real) return real;
  return peer;
}

export function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  let text = value.trim();
  if (!text) return null;
  if (text.startsWith("\"") && text.endsWith("\"") && text.length >= 2) text = text.slice(1, -1).trim();
  if (text.startsWith("[") && text.includes("]")) {
    text = text.slice(1, text.indexOf("]"));
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(text)) {
    text = text.slice(0, text.lastIndexOf(":"));
  }
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(text);
  if (mapped?.[1]) text = mapped[1];
  if (ipv4ToInt(text) != null) return text;
  if (text.includes(":") && /^[0-9a-f:]+$/i.test(text)) return text.toLowerCase();
  return null;
}

function isTrusted(ip: string, trusted: readonly string[]): boolean {
  return trusted.some((entry) => matchesEntry(ip, entry));
}

function matchesEntry(ip: string, entry: string): boolean {
  const item = entry.trim();
  if (!item) return false;
  if (item.includes("/")) return inCidr(ip, item);
  const expected = normalizeIp(item);
  return expected != null && expected === ip;
}

function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const ipInt = ipv4ToInt(normalizeIp(ip) ?? "");
  const baseInt = ipv4ToInt(base ?? "");
  if (ipInt == null || baseInt == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = ((value << 8) | octet) >>> 0;
  }
  return value;
}
