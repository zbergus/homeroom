/** Message of anything that was thrown (a rejected fetch gives an Error, but nothing guarantees it). */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : (JSON.stringify(e) ?? String(e));
}
