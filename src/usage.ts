// Lightweight usage telemetry: per-tool-call counts only.
//
// Deliberately minimal — tool name + UTC date, nothing else. No IPs, no query
// contents/arguments, no session/user identifiers, no PII. Backed by
// USAGE_KV (see wrangler.jsonc). Key shape: usage:YYYY-MM-DD:<tool> -> a
// plain integer count stored as a string.
//
// The read-then-write increment below is not atomic under concurrent writes
// to the same key in the same instant — acceptable at this server's volume
// (a rare double-increment isn't worth a Durable-Object-backed counter).
//
// Telemetry must never break a tool call: every failure is swallowed here.
export async function recordUsage(env: Env, tool: string): Promise<void> {
  try {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
    const key = `usage:${date}:${tool}`;
    const current = await env.USAGE_KV.get(key);
    const next = (current ? parseInt(current, 10) || 0 : 0) + 1;
    await env.USAGE_KV.put(key, String(next));
  } catch {
    // Swallow — usage counting is best-effort and must not affect responses.
  }
}
