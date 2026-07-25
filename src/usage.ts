// Lightweight usage telemetry: counts only, never identities.
//
// Deliberately minimal. No IPs, no query contents/arguments, no user
// identifiers, no PII. What is recorded:
//
//   usage:YYYY-MM-DD:<tool>              -> tool calls that day
//   sessions:YYYY-MM-DD                  -> distinct MCP sessions that day
//   client:YYYY-MM-DD:<name>@<version>   -> which CLIENT SOFTWARE connected
//   selftest:<any of the above>          -> our own testing, kept out of the real counts
//
// `client` records software identity (e.g. "claude-code@2.1.0"), which the MCP
// `initialize` handshake sends as `clientInfo`. That is not a user identifier
// and does not weaken the no-PII rule above: it says what program connected,
// never who ran it.
//
// Counting sessions rather than users is deliberate. One person reconnecting
// creates several sessions, so this is an adoption signal, not a headcount, and
// getting an actual user count would require identifying people. Read it as
// "distinct connections", never "distinct humans".
//
// Backed by USAGE_KV (see wrangler.jsonc). Values are plain integers stored as
// strings.
//
// The read-then-write increment below is not atomic under concurrent writes to
// the same key in the same instant — acceptable at this server's volume (a rare
// double-increment isn't worth a Durable-Object-backed counter).
//
// Telemetry must never break a tool call: every failure is swallowed here.

/** UTC date. Note this rolls over at 00:00 UTC, i.e. 7pm CT — evening activity
 *  lands on the next day's key. Kept as UTC so keys are unambiguous. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function bump(env: Env, key: string): Promise<void> {
  const current = await env.USAGE_KV.get(key);
  const next = (current ? parseInt(current, 10) || 0 : 0) + 1;
  await env.USAGE_KV.put(key, String(next));
}

/**
 * `clientInfo` is attacker-controlled text from a remote peer, so it is
 * sanitized before it can ever become part of a KV key: restricted charset,
 * hard length cap, empty falls back to "unknown".
 */
function sanitizeClientPart(raw: string | undefined, max: number): string {
  if (!raw) return "unknown";
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-{2,}/g, "-").slice(0, max);
  return cleaned.replace(/^-+|-+$/g, "") || "unknown";
}

/**
 * Our own smoke tests and probes would otherwise be indistinguishable from real
 * adoption — and at this server's volume they dominate. Anything self-declaring
 * one of these client names is counted under a `selftest:` prefix instead.
 */
const SELF_TEST_CLIENTS = /^(smoke|test|probe|dev|curl|debug|healthcheck)/;

export function isSelfTestClient(name: string | undefined): boolean {
  return SELF_TEST_CLIENTS.test(sanitizeClientPart(name, 40));
}

export async function recordUsage(env: Env, tool: string, selfTest = false): Promise<void> {
  try {
    await bump(env, `${selfTest ? "selftest:" : ""}usage:${today()}:${tool}`);
  } catch {
    // Swallow — usage counting is best-effort and must not affect responses.
  }
}

/**
 * Called once per MCP session, from the `initialize` handshake. Records both the
 * session and which client software opened it.
 */
export async function recordSessionStart(
  env: Env,
  clientName: string | undefined,
  clientVersion: string | undefined,
): Promise<void> {
  try {
    const prefix = isSelfTestClient(clientName) ? "selftest:" : "";
    const name = sanitizeClientPart(clientName, 40);
    const version = sanitizeClientPart(clientVersion, 20);
    const date = today();
    await Promise.all([
      bump(env, `${prefix}sessions:${date}`),
      bump(env, `${prefix}client:${date}:${name}@${version}`),
    ]);
  } catch {
    // Swallow — telemetry must never affect a session.
  }
}
