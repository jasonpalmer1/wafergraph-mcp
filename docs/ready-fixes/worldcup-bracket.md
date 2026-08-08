# Ready fix: worldcup-bracket

Status: NOT YET APPLIED (Claude: apply in that repo)
Source audit: wafergraph-mcp AUDIT_HANDOFF_FOR_CLAUDE.md (2026-08-08)

**Repo:** `jasonpalmer1/worldcup-bracket`  
**Severity:** CRITICAL  
**Primary file:** `src/index.js` (~1010 lines; Worker + embedded HTML)  
**Schema:** `migrations/001-init.sql` → add `002-edit-token.sql`

Friends-and-family pool, but public APIs + XSS make sabotage trivial. Apply in the
order below before any real money/prizes ride on this.

---

## Apply order

1. Migration: `edit_token` column
2. Server: ownership on PUT (require token); stop name-based ownership on client
3. Server: pick validation (keys, roster, tree consistency)
4. Client: kill HTML-string `onclick` XSS (`data-*` + `addEventListener`)
5. CORS tighten to own origin
6. Lock TOCTOU, input limits, safe `JSON.parse`
7. Admin: prefer session notes; at minimum document `localStorage` risk
8. Docs: align CLAUDE.md / README scoring with `ROUND_POINTS` (20/40/80/160/320)

---

## 1. Migration — `edit_token` on brackets

Create `migrations/002-edit-token.sql`:

```sql
-- Ownership secret for PUT /api/brackets/:id. Shown once on create; never listed in GET.
ALTER TABLE brackets ADD COLUMN edit_token TEXT;
```

Wire it the same way as `001-init` in `package.json` / wrangler (e.g. add
`db:migrate:remote` / `db:migrate:local` scripts that run `002-edit-token.sql`, or
document `wrangler d1 execute worldcup-bracket --remote --file=migrations/002-edit-token.sql`).

Existing rows get `NULL` tokens → PUT must fail closed for those until admin deletes
or you run a one-shot backfill that sets tokens and somehow notifies owners (for a
friends pool: admin delete + re-submit is fine).

---

## 2. Ownership: edit_token on create; require on PUT; kill name-as-identity

### Current (broken)

`POST /api/brackets` (~100–111) inserts name + picks, returns only `{ ok, id }`.  
`PUT /api/brackets/:id` (~113–131) updates **any** id with **no auth**.  
Client `findMyBracket` / `onNameChange` binds to first case-insensitive name match
then PUTs that id — name takeover.

### Server helpers (add near top of `src/index.js`, after `getRole`)

```js
function randomToken() {
  // 32 bytes hex — enough entropy for an unguessable edit secret
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeJsonParse(text, fallback) {
  try {
    if (text == null || text === '') return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
```

### POST — generate + return token once

Replace the POST handler body (~100–111) with:

```js
if (path === '/api/brackets' && method === 'POST') {
  // Atomic lock check: see §6 (UPDATE … WHERE locked=0 pattern preferred for writes)
  const cfg = await env.DB.prepare('SELECT locked FROM config WHERE id=1').first();
  if (cfg && cfg.locked) return errorResponse('Bracket pool is locked', 403);

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 64) return errorResponse('name required (1–64 chars)');

  const validated = validatePicks(body.picks, env); // see §3 — sync helper using TEAMS
  if (validated.error) return errorResponse(validated.error, 400);

  const editToken = randomToken();
  const result = await env.DB.prepare(
    'INSERT INTO brackets (name, picks_json, edit_token) VALUES (?, ?, ?)'
  ).bind(name, JSON.stringify(validated.picks), editToken).run();

  // Return token ONCE — client stores in localStorage. Never include in GET /api/brackets.
  return jsonResponse({
    ok: true,
    id: result.meta.last_row_id,
    edit_token: editToken,
  });
}
```

### PUT — require matching token

```js
if (putMatch && method === 'PUT') {
  const cfg = await env.DB.prepare('SELECT locked FROM config WHERE id=1').first();
  if (cfg && cfg.locked) return errorResponse('Bracket pool is locked', 403);

  const id = parseInt(putMatch[1], 10);
  const body = await request.json().catch(() => ({}));
  const editToken =
    (typeof body.edit_token === 'string' && body.edit_token) ||
    request.headers.get('x-edit-token') ||
    '';
  if (!editToken || editToken.length > 128) {
    return errorResponse('edit_token required', 403);
  }

  const row = await env.DB.prepare(
    'SELECT id, edit_token FROM brackets WHERE id=?'
  ).bind(id).first();
  if (!row) return errorResponse('Not found', 404);
  if (!row.edit_token || row.edit_token !== editToken) {
    return errorResponse('Forbidden', 403);
  }

  let name = null;
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') return errorResponse('name must be string');
    name = body.name.trim();
    if (!name || name.length > 64) return errorResponse('name required (1–64 chars)');
  }

  const validated = validatePicks(body.picks, env);
  if (validated.error) return errorResponse(validated.error, 400);

  if (name !== null) {
    await env.DB.prepare(
      "UPDATE brackets SET name=?, picks_json=?, updated_at=datetime('now') WHERE id=? AND edit_token=?"
    ).bind(name, JSON.stringify(validated.picks), id, editToken).run();
  } else {
    await env.DB.prepare(
      "UPDATE brackets SET picks_json=?, updated_at=datetime('now') WHERE id=? AND edit_token=?"
    ).bind(JSON.stringify(validated.picks), id, editToken).run();
  }
  // changes===0 → race / wrong token; treat as forbidden
  return jsonResponse({ ok: true });
}
```

**Do not** select `edit_token` in `GET /api/brackets`. Keep listing public for the pool,
but ownership secret stays client-local.

### Client — store token; stop name matching

In the embedded `<script>` state section (~359–371):

```js
var myBracketId = localStorage.getItem('wc_bracket_id')
  ? parseInt(localStorage.getItem('wc_bracket_id'), 10)
  : null;
var myEditToken = localStorage.getItem('wc_edit_token') || null;
```

**Delete / replace** `findMyBracket` and the name-match branch in `onNameChange`:

```js
function findMyBracket() {
  // Ownership is edit_token + id in localStorage — NOT name matching.
  if (!myBracketId || !myEditToken) return;
  var b = allBrackets.find(function (x) { return x.id === myBracketId; });
  if (b) {
    myPicks = Object.assign({}, b.picks || {});
    if (b.name) appName = b.name;
  } else {
    // Bracket was deleted by admin — clear local ownership
    myBracketId = null;
    myEditToken = null;
    localStorage.removeItem('wc_bracket_id');
    localStorage.removeItem('wc_edit_token');
  }
}

function onNameChange(val) {
  appName = val;
  localStorage.setItem('wc_name', val);
  // Do NOT rebind myBracketId from name. That was the takeover bug.
}
```

Update `submitBracket`:

```js
function submitBracket() {
  if (!appName.trim()) { showToast('Enter your name first', 'error'); return; }
  var payload = { name: appName.trim(), picks: myPicks };
  if (myBracketId && myEditToken) {
    payload.edit_token = myEditToken;
    api('PUT', '/brackets/' + myBracketId, payload).then(onSaved).catch(onErr);
  } else {
    api('POST', '/brackets', payload).then(function (d) {
      if (d.ok && d.id && d.edit_token) {
        myBracketId = d.id;
        myEditToken = d.edit_token;
        localStorage.setItem('wc_bracket_id', String(d.id));
        localStorage.setItem('wc_edit_token', d.edit_token);
      }
      onSaved(d);
    }).catch(onErr);
  }
  function onSaved(d) {
    if (d.ok) {
      api('GET', '/brackets').then(function (bd) {
        allBrackets = bd.brackets || [];
        showToast('Bracket saved!', 'success');
        launchConfetti();
        renderTab(appTab);
      });
    } else { showToast(d.error || 'Error saving', 'error'); }
  }
  function onErr() { showToast('Connection error', 'error'); }
}
```

Optional UX: if user clears site data they lose edit rights — show a short note under
Save: "This browser remembers your edit key. Clearing site data means you cannot edit."

---

## 3. Server-side pick validation

UI tree rules are **not** enforced today — any JSON is accepted; illegal perfect
brackets score max **1600** (`ROUND_POINTS` sum).

Add near helpers (import `TEAMS` already at top):

```js
const TEAM_NAMES = new Set(TEAMS.map((t) => t.name));
const ROUNDS_SRV = ['R32', 'R16', 'QF', 'SF', 'F'];
const ROUND_MATCH_COUNTS_SRV = { R32: 16, R16: 8, QF: 4, SF: 2, F: 1 };
const MAX_PICKS_JSON_BYTES = 16_000;

function validatePicks(raw) {
  if (raw == null) return { picks: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'picks must be an object' };
  }
  const keys = Object.keys(raw);
  if (keys.length > 31) return { error: 'too many picks' };
  const picks = {};

  // Allowed keys only: R32_0…R32_15, R16_0…7, QF_0…3, SF_0…1, F_0
  for (const key of keys) {
    const m = key.match(/^(R32|R16|QF|SF|F)_(\d+)$/);
    if (!m) return { error: 'invalid pick key: ' + key };
    const round = m[1];
    const idx = parseInt(m[2], 10);
    if (idx < 0 || idx >= ROUND_MATCH_COUNTS_SRV[round]) {
      return { error: 'invalid pick index: ' + key };
    }
    const team = raw[key];
    if (team == null || team === '') continue;
    if (typeof team !== 'string' || !TEAM_NAMES.has(team)) {
      return { error: 'unknown team: ' + String(team).slice(0, 40) };
    }
    picks[key] = team;
  }

  // Tree consistency: a later-round pick must appear as a winner of one of the
  // two child matches in the previous round (same geometry as client getPickMatchTeams).
  for (let ri = 1; ri < ROUNDS_SRV.length; ri++) {
    const round = ROUNDS_SRV[ri];
    const prev = ROUNDS_SRV[ri - 1];
    const cnt = ROUND_MATCH_COUNTS_SRV[round];
    for (let i = 0; i < cnt; i++) {
      const key = round + '_' + i;
      const team = picks[key];
      if (!team) continue;
      const c1 = picks[prev + '_' + (i * 2)];
      const c2 = picks[prev + '_' + (i * 2 + 1)];
      // If both children missing, reject advancing pick (prevents inventing finals).
      if (!c1 && !c2) {
        return { error: 'pick ' + key + ' without prior-round support' };
      }
      // If a child is present, winner must be one of the children that exist.
      if (c1 || c2) {
        if (team !== c1 && team !== c2) {
          return { error: 'pick ' + key + ' inconsistent with prior round' };
        }
      }
    }
  }

  // R32 teams should be from the configured slot roster when setup is known —
  // call sites that have env can pass slots; for a first pass, TEAM_NAMES is enough.
  // Stronger check (recommended): load setup slots and require R32_i ∈ {slots[2i], slots[2i+1]}.

  const encoded = JSON.stringify(picks);
  if (encoded.length > MAX_PICKS_JSON_BYTES) {
    return { error: 'picks too large' };
  }
  return { picks };
}

/** Stronger R32 check once you have slots from config */
function validatePicksAgainstSlots(raw, slots) {
  const base = validatePicks(raw);
  if (base.error) return base;
  if (!Array.isArray(slots) || slots.length !== 32) return base;
  for (let i = 0; i < 16; i++) {
    const key = 'R32_' + i;
    const team = base.picks[key];
    if (!team) continue;
    const a = slots[i * 2];
    const b = slots[i * 2 + 1];
    if (team !== a && team !== b) {
      return { error: 'R32 pick not in slot match: ' + key };
    }
  }
  return base;
}
```

In POST/PUT, load slots and use the stronger validator:

```js
const cfgRow = await env.DB.prepare(
  'SELECT locked, setup_json FROM config WHERE id=1'
).first();
if (cfgRow && cfgRow.locked) return errorResponse('Bracket pool is locked', 403);
const setup = safeJsonParse(cfgRow && cfgRow.setup_json, {});
const validated = validatePicksAgainstSlots(body.picks, setup.slots);
```

Also validate admin `results` similarly (keys + teams + tree) in
`PUT /api/config/results` — same geometry, winners must be from prior-round results
or R32 slots.

---

## 4. Remove HTML-string `onclick` XSS

### Bug

`jsq()` (~956–958) escapes `\` and `'` but **not `"`**. Handlers sit in
**double-quoted** attributes:

```html
onclick="makePick('R32',0,'…poisoned…')"
```

A stored pick containing `"` can break out of the JS string and the attribute.
`escHtml` is used for display text but **not** for the `onclick` argument path.
Poisoned picks → steal `localStorage.wc_pass` → admin APIs.

### Fix (preferred): data attributes + event delegation

Stop building `onclick="makePick(...)"` / `setResult(...)`. Example for match picks
in `renderMyBracket` — replace the team button HTML (~612–616) with:

```js
html += '<button type="button" class="' + t1cls +
  '" data-action="pick" data-round="' + escHtml(currentRound) +
  '" data-match="' + m +
  '" data-team="' + escHtml(t1) + '">' +
  '<span class="flag">' + teamFlag(t1) + '</span>' + escHtml(t1) + '</button>';
// same for t2
```

After `content.innerHTML = html` in each renderer (or once on `#tab-content`), bind:

```js
function bindTabActions(root) {
  root.onclick = function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    var action = el.getAttribute('data-action');
    if (action === 'pick') {
      makePick(el.getAttribute('data-round'), parseInt(el.getAttribute('data-match'), 10), el.getAttribute('data-team'));
    } else if (action === 'set-result') {
      setResult(el.getAttribute('data-key'), el.getAttribute('data-team'));
    } else if (action === 'toggle-leader') {
      toggleLeader(parseInt(el.getAttribute('data-id'), 10));
    } else if (action === 'toggle-bracket') {
      toggleBracket(parseInt(el.getAttribute('data-id'), 10));
    } else if (action === 'delete-bracket') {
      deleteBracket(parseInt(el.getAttribute('data-id'), 10));
    } else if (action === 'set-round') {
      setRound(el.getAttribute('data-round'));
    } else if (action === 'submit') {
      submitBracket();
    } else if (action === 'toggle-lock') {
      toggleLock();
    } else if (action === 'save-setup') {
      saveSetup();
    } else if (action === 'save-results') {
      saveResults();
    } else if (action === 'switch-tab') {
      switchTab(parseInt(el.getAttribute('data-tab'), 10));
    }
  };
}
```

Call `bindTabActions(content)` at the end of `renderTab` (reassigning `onclick` is fine).

For tab bar / admin gear: use `data-action` the same way, or keep static
`onclick="openAdmin()"` **only** for hardcoded literals with no user data.

### If you must keep inline handlers temporarily

Fix `jsq` to also escape `"` and newlines (still inferior to data attributes):

```js
function jsq(s) {
  var BS = String.fromCharCode(92);
  return String(s == null ? '' : s)
    .split(BS).join(BS + BS)
    .split("'").join(BS + "'")
    .split('"').join(BS + '"')
    .split('\n').join(BS + 'n')
    .split('\r').join(BS + 'r');
}
```

**Still prefer data attributes** — do not ship the temporary-only fix as the final state.

Also: `escHtml` should escape `'` for attribute context if you ever put values in
single-quoted attrs: `.replace(/'/g, '&#39;')`.

---

## 5. CORS tighten to own origin

### Current

```js
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  ...
};
```

Cross-origin sites can call mutating APIs from a victim browser (with stored
`wc_pass` / future cookies).

### Fix

```js
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const url = new URL(request.url);
  // Same-origin navigations have no Origin; API calls from the Worker page send Origin.
  const allowed = new Set([
    url.origin, // https://worldcup-bracket.jwpalm99.workers.dev
    // add custom domain(s) here if you attach one:
    // 'https://brackets.example.com',
  ]);
  if (env.ALLOWED_ORIGIN) allowed.add(env.ALLOWED_ORIGIN);
  const allow = origin && allowed.has(origin) ? origin : url.origin;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-pass, x-edit-token',
    'Vary': 'Origin',
    // If you move admin to cookies: 'Access-Control-Allow-Credentials': 'true'
    // and never use '*'.
  };
}
```

Thread `request` into `jsonResponse` / `errorResponse` / OPTIONS handlers so every
API response uses `corsHeaders(request, env)`. Reject disallowed origins on
mutating methods with `403` if `Origin` is present and not in the allowlist.

---

## 6. Lock TOCTOU, input limits, safe JSON.parse

### Lock TOCTOU

Today: `SELECT locked` then later `UPDATE brackets …` — admin can lock between.
Prefer conditional update:

```js
// Example for lock toggle (admin):
await env.DB.prepare('UPDATE config SET locked=? WHERE id=1').bind(body.locked ? 1 : 0).run();

// For bracket writes — include lock in a transaction-ish pattern:
const write = await env.DB.prepare(`
  UPDATE brackets SET picks_json=?, name=?, updated_at=datetime('now')
  WHERE id=? AND edit_token=?
    AND (SELECT locked FROM config WHERE id=1) = 0
`).bind(...).run();
if (!write.meta.changes) {
  const locked = await env.DB.prepare('SELECT locked FROM config WHERE id=1').first();
  if (locked && locked.locked) return errorResponse('Bracket pool is locked', 403);
  return errorResponse('Forbidden', 403);
}
```

D1 supports batched statements; at minimum re-check `locked` immediately before write
and use `WHERE id=? AND edit_token=?` so wrong token never updates.

### Input limits

| Field | Limit |
|-------|-------|
| `name` | trim, 1–64 chars, reject whitespace-only |
| `picks` JSON | ≤ 16KB serialized; ≤ 31 keys |
| `edit_token` | 64 hex chars (reject longer) |
| `slots` | exactly 32; each entry `''` or known team name |
| request body | reject if `Content-Length` > 32KB (or `.text()` then size check before `JSON.parse`) |

Fix PUT crash on non-string name (current `nameVal.trim()` throws):

```js
if (body.name !== undefined && typeof body.name !== 'string') {
  return errorResponse('name must be string');
}
```

### Safe JSON.parse on DB fields

Replace bare `JSON.parse(row.setup_json || '{}')` etc. (~56–57, ~93) with
`safeJsonParse(...)` so corrupt rows return `{}` / empty picks instead of 500.

```js
setup: safeJsonParse(row.setup_json, {}),
results: safeJsonParse(row.results_json, {}),
// ...
picks: safeJsonParse(r.picks_json, {}),
```

---

## 7. Admin: prefer session; at minimum document

### Current risk

Admin pass stored in `localStorage` as `wc_pass`, sent as `x-pass` on every request.
XSS (or a malicious extension) reads it. No login rate limit on `POST /api/login`.

### Preferred (when you have a spare hour)

1. `POST /api/login` with admin pass → set `HttpOnly; Secure; SameSite=Strict` session
   cookie (`wc_admin=<random>`; store hash in D1 or DO, TTL 8h).
2. Admin routes check cookie session, not `x-pass`.
3. Client: stop persisting `wc_pass` in `localStorage`; keep only `wc_role=admin` as a
   UI hint (server is source of truth).
4. Rate-limit login: e.g. 5 failures / IP / 15 min in KV or in-memory DO.

### Minimum for this pass (document + harden)

Add a short section to `CLAUDE.md` / `README.md`:

> Admin authentication uses a shared passcode sent as `x-pass` and cached in
> `localStorage` (`wc_pass`). This is acceptable only for a tiny friends pool.
> Any XSS can steal the admin pass. Prefer migrating to an HttpOnly session cookie
> before the pool has real stakes. Do not reuse `ADMIN_PASS` anywhere else.

Also: clear `wc_pass` from localStorage when leaving admin mode (already done in
`openAdmin` toggle-off) and never echo the pass in API responses (already true).

Optional small harden without full sessions: rate-limit `/api/login` via KV counter.

---

## 8. Align scoring docs with code

### Code (source of truth) — `ROUND_POINTS` in embedded JS ~376

```js
var ROUND_POINTS = { R32: 20, R16: 40, QF: 80, SF: 160, F: 320 };
// Max score = 16*20 + 8*40 + 4*80 + 2*160 + 1*320 = 320*5 = 1600
```

Leaderboard UI copy (~680) already says ESPN-style 20/40/80/160/320.

### Docs that are WRONG today

**`CLAUDE.md` ~43:**

```
- Scoring: R32=1pt, R16=2, QF=4, SF=8, F=16, Champion bonus=32
```

**Replace with:**

```
- Scoring (ESPN-style, matches ROUND_POINTS in src/index.js): R32=20, R16=40, QF=80, SF=160, F=320 (champion). No separate bonus — F_0 is the champion pick. Max = 1600.
```

Also fix API notes in CLAUDE.md (~36–37): POST/PUT brackets are **not** gated on
`x-pass` in current public-pool code (init sets friend with empty pass). After this
fix: POST open (with validation); PUT requires `edit_token`; admin routes need admin
role. Update the auth bullet (~9) to describe edit tokens + admin pass/session.

**`README.md` ~8:**

```
… (R32 = 1pt, R16 = 2, QF = 4, SF = 8, Final = 16, correct champion = 32 bonus) …
```

**Replace with:**

```
… ESPN-style scoring (R32 = 20, R16 = 40, QF = 80, SF = 160, Champion = 320; max 1600) …
```

Also update README auth blurb: anyone can create a bracket; editing requires the
browser-held `edit_token` from create; admin pass is only for setup/results/lock/delete.

---

## Suggested commit sequence (in worldcup-bracket repo)

1. `migrations/002-edit-token.sql` + POST/PUT ownership + client localStorage token
2. `validatePicks` / slots check on POST/PUT (+ results validation)
3. XSS: data-attribute event delegation; delete unsafe `onclick` with user data
4. CORS + limits + `safeJsonParse` + atomic lock on writes
5. Doc sync CLAUDE.md + README scoring/auth

## Done when

- [ ] `PUT /api/brackets/:id` without correct `edit_token` → 403
- [ ] `GET /api/brackets` never returns `edit_token`
- [ ] Typing another player's name does **not** take over their bracket
- [ ] Illegal picks (bad key, unknown team, tree break) → 400
- [ ] Stored pick with `"` / `<script>` cannot execute (manual: inject via wrangler D1, open Brackets tab)
- [ ] CORS does not reflect arbitrary `Origin: https://evil.test`
- [ ] CLAUDE.md + README scoring = 20/40/80/160/320
- [ ] Smoke: create → save token → PUT ok → PUT with wrong token fails → lock blocks writes

## Out of scope / later

- Leaderboard tie-break for charity prize (audit Medium)
- Full admin cookie session (documented as preferred in §7)
- Unique constraint on `name` (optional; ownership no longer depends on it)
