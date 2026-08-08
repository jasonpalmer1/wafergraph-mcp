# Ready fix: jasonwpalmer-com

Status: NOT YET APPLIED (Claude: apply in that repo)
Source audit: wafergraph-mcp AUDIT_HANDOFF_FOR_CLAUDE.md (2026-08-08)

**Repo:** `jasonpalmer1/jasonwpalmer-com`  
**Severity:** High  
**Stack:** Next static export on Cloudflare Pages + Functions (`functions/api/*`)

---

## Apply order

1. CSP: allow visit-log worker; drop unused Beehiiv
2. Rate limit + honeypot on `functions/api/subscribe.js` (+ client field)
3. Check Resend `response.ok` before claiming inbox delivery

---

## 1. CSP — `public/_headers`

### Current (`public/_headers`)

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://subscribe-forms.beehiiv.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://jasonwpalmer.com; connect-src 'self' https://api.web3forms.com https://subscribe-forms.beehiiv.com https://visit-log.jwpalm99.workers.dev; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'
```

### Problem

- `src/app/layout.tsx` loads `<script defer src="https://visit-log.jwpalm99.workers.dev/v.js" />`
- `script-src` allows Beehiiv leftover, **not** `visit-log.jwpalm99.workers.dev`
- Result: live analytics script blocked by CSP
- `connect-src` already allows the visit-log worker (beacon POSTs work if script were allowed)
- No `beehiiv` references remain in `src/` or `functions/` (grep clean) — safe to drop

### Patch — replace the CSP line in `public/_headers`

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://visit-log.jwpalm99.workers.dev; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://jasonwpalmer.com; connect-src 'self' https://api.web3forms.com https://visit-log.jwpalm99.workers.dev; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'
```

Notes:

- After Next export, `out/_headers` is generated from `public/_headers` — edit **`public/_headers`** only; rebuild/deploy so `out/` picks it up.
- Sister site canaifeel.com already allows that worker — match that pattern.
- If Cloudflare dashboard has a conflicting CSP, align or remove the dashboard override so `_headers` wins.

Optional doc cleanup (same PR): `MAILING-LIST.md` / README / CLAUDE.md still mentioning Beehiiv → point at Resend + D1 subscribe flow.

---

## 2. Rate limit + honeypot on `/api/subscribe`

### Current

`functions/api/subscribe.js` — validates email, writes D1, fires Resend. No throttle,
no bot trap. Confirmed live 200 path → confirmation email abuse (Resend cost + reputation).

`src/components/Subscribe.tsx` posts `{ email }` only. Contact forms already use a
honeypot (`botcheck` checkbox) — mirror that pattern.

### 2a. Client — `src/components/Subscribe.tsx`

Add honeypot state + field (hidden from humans, bots fill it):

```tsx
export default function Subscribe() {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — must stay empty
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, website }),
      });
      // ... unchanged ok/error handling
```

In the form JSX, before the email input:

```tsx
<form onSubmit={handleSubmit} className="mx-auto max-w-md">
  {/* honeypot — leave empty; server rejects if filled */}
  <input
    type="text"
    name="website"
    value={website}
    onChange={(e) => setWebsite(e.target.value)}
    tabIndex={-1}
    autoComplete="off"
    aria-hidden
    className="hidden"
  />
  <div className="flex flex-col gap-3 sm:flex-row">
    {/* email + button unchanged */}
```

### 2b. Server — `functions/api/subscribe.js`

Add near top (after `EMAIL_RE`):

```js
const RATE_LIMIT_WINDOW_SEC = 3600; // 1 hour
const RATE_LIMIT_MAX = 5;           // per IP per window
const RATE_LIMIT_EMAIL_MAX = 3;     // per email per window

function clientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function rateLimited(env, key, max) {
  // Prefer KV if bound (e.g. env.RATE_LIMIT_KV). Fallback: D1 table or in-request only.
  const kv = env.RATE_LIMIT_KV || env.VISIT_KV || null;
  if (!kv) {
    // Soft fallback: still enforce honeypot + Resend.ok; document that KV binding is required.
    return false;
  }
  const bucket = `sub:${key}:${Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW_SEC)}`;
  const cur = parseInt((await kv.get(bucket)) || "0", 10);
  if (cur >= max) return true;
  await kv.put(bucket, String(cur + 1), { expirationTtl: RATE_LIMIT_WINDOW_SEC * 2 });
  return false;
}
```

If you don't want a new KV namespace yet, use D1:

```sql
-- migrations/00N-subscribe-rate.sql (add when convenient)
CREATE TABLE IF NOT EXISTS subscribe_rate (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
```

```js
async function rateLimitedD1(db, key, max) {
  const bucket = `sub:${key}:${Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW_SEC)}`;
  const row = await db.prepare(
    "SELECT count FROM subscribe_rate WHERE bucket = ?"
  ).bind(bucket).first();
  const cur = row ? row.count : 0;
  if (cur >= max) return true;
  await db.prepare(
    `INSERT INTO subscribe_rate (bucket, count) VALUES (?, 1)
     ON CONFLICT(bucket) DO UPDATE SET count = count + 1`
  ).bind(bucket).run();
  return false;
}
```

In `onRequestPost`, after parsing body and **before** D1 write / Resend:

```js
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  // Honeypot: any non-empty value → fake success (don't tip off bots)
  const honey = typeof body.website === "string" ? body.website.trim() : "";
  if (honey) {
    return Response.json({
      ok: true,
      message: "Almost there — check your inbox to confirm.",
    });
  }

  // ... existing email validation ...

  const ip = clientIp(request);
  if (await rateLimited(env, "ip:" + ip, RATE_LIMIT_MAX)) {
    return Response.json(
      { ok: false, error: "Too many requests. Try again later." },
      { status: 429 }
    );
  }
  if (await rateLimited(env, "email:" + email, RATE_LIMIT_EMAIL_MAX)) {
    return Response.json(
      { ok: false, error: "Too many requests. Try again later." },
      { status: 429 }
    );
  }

  // ... existing D1 + Resend ...
}
```

**Wrangler / Pages binding:** add a KV namespace binding named `RATE_LIMIT_KV` in the
Pages project settings (or `wrangler.toml` if used), **or** ship the D1 fallback above.
Document the chosen approach in `MAILING-LIST.md`.

Minimum viable without KV: honeypot alone still blocks naive bots; add KV/D1 rate
limit in the same PR if possible — audit marked abuse as High because Resend sends
on every 200.

---

## 3. Check Resend `response.ok`

### Current (~150–170)

```js
await fetch("https://api.resend.com/emails", { ... });
// catch only — HTTP 4xx/5xx still fall through to success message
```

User always sees "Almost there — check your inbox" even when Resend rejects.

### Patch

```js
if (env.RESEND_API_KEY) {
  const confirmUrl = `${siteUrl}/api/confirm?token=${token}`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: "Confirm your subscription to Jason's dispatch log",
        html: buildConfirmationHtml(confirmUrl, siteUrl),
      }),
    });
    if (!res.ok) {
      // Subscriber row already stored as pending — tell the truth without leaking Resend details.
      return Response.json({
        ok: true,
        message:
          "You're on the list, but the confirmation email failed to send. Try again in a few minutes.",
      });
    }
  } catch {
    return Response.json({
      ok: true,
      message:
        "You're on the list, but the confirmation email failed to send. Try again in a few minutes.",
    });
  }
}

return Response.json({
  ok: true,
  message: env.RESEND_API_KEY
    ? "Almost there — check your inbox to confirm."
    : "You're on the list — I'll send a confirmation shortly.",
});
```

Do **not** log the API key or Resend response body to the client.

---

## Done when

- [ ] Browser console on jasonwpalmer.com: no CSP violation for `visit-log…/v.js`
- [ ] Network: `v.js` loads 200; beacons still allowed by `connect-src`
- [ ] Beehiiv gone from `script-src` / `connect-src`
- [ ] POST `/api/subscribe` with `{ email, website: "http://spam" }` → fake ok, **no** Resend send / no new meaningful row growth (or row skipped — prefer skip insert on honeypot to avoid DB spam)
- [ ] >5 requests from same IP in window → 429
- [ ] Forced Resend failure (bad key in preview) → message mentions send failure, not "check your inbox"

### Honeypot refinement (recommended)

Short-circuit **before** D1 insert when honeypot filled:

```js
if (honey) {
  return Response.json({
    ok: true,
    message: "Almost there — check your inbox to confirm.",
  });
}
```

---

## Out of scope (audit Medium — optional follow-ups)

- `BootSequence` Escape / focus trap / `prefers-reduced-motion`
- Stale company counts in blog copy vs live tools data
- Live `Access-Control-Allow-Origin: *` from CF dashboard (not from repo `_headers`)
