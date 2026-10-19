/**
 * Provider payloads (ESPN, NHL) are undocumented and wide, and the parsers read them with optional chaining.
 * `Raw` is the ONE place `any` is allowed in this codebase (the linter flags it everywhere else). The rule that keeps it
 * from leaking: a value only reaches a domain type (`Game`, `Team`, `ScoringPlay`...) through `str`, `optStr`,
 * `finite` or `strArr` below, so a field that changes type upstream degrades to "missing" instead of corrupting state.
 */
// biome-ignore lint/suspicious/noExplicitAny: see above
export type Raw = any;

/** A string, a number printed as a string, else `fallback`. */
export function str(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  return typeof v === "number" && Number.isFinite(v) ? String(v) : fallback;
}

/** Like `str`, but undefined when there is nothing (or an empty string). */
export function optStr(v: unknown): string | undefined {
  return str(v) || undefined;
}

/** A finite number, or a numeric string such as "5.5"; else undefined. */
export function finite(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Strings of an array; anything else (and non-string items) is dropped. */
export function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.flatMap((x) => (typeof x === "string" && x ? [x] : [])) : [];
}

export async function getJson(url: string, timeoutMs = 8000): Promise<Raw> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "homeroom/0.1" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}
