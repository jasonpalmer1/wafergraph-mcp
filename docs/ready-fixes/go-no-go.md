# Ready fix: go-no-go

Status: NOT YET APPLIED (Claude: apply in that repo)
Source audit: wafergraph-mcp AUDIT_HANDOFF_FOR_CLAUDE.md (2026-08-08)

**Repo:** `jasonpalmer1/go-no-go`  
**Severity:** High  
**Primary file:** `go-no-go.js`  
**Docs:** `README.md`, `PROTOCOL.md`

Claude (and users) trust the marketing claim that every damaging finding is
adversarially verified. The script does not do that today. Fix the script to match
the claims (preferred), or narrow the docs — this patch prefers **fixing the script**.

---

## Apply order

1. Verify **all** `kills`/`major` findings (or drop unverified from killers)
2. Purpose-mode veto vocabulary (WIND-DOWN / GOOD-ENOUGH, not NO-GO)
3. Parallel stress: drop null verdicts (failed verifications)
4. Path detection: relative + Windows paths
5. Doc hygiene: PROTOCOL "five stages" vs four phases in `meta` (optional align)

---

## 1. Verify all damaging findings (or don't count unverified as held)

### Current (`proofOneLens`, ~290–314)

```js
const damaging = findings.filter(f => f.severity === 'kills' || f.severity === 'major').slice(0, 3)
const topSupport = findings.filter(f => f.severity === 'supports').slice(0, 1)
const toVerify = [...damaging, ...topSupport]
```

Only top **3** damaging claims are stressed. `synthPrompt` (~254) says:

> only list a risk under risksHeld/realKillers if its verification shows holdsUp=true
> **(or it was not verified, treat as held)**

So unverified 4th+ killers are treated as held → wrong NO-GO. README/PROTOCOL claim
Stage 3 refutes **every** kills/major.

### Fix A (preferred): verify every kills/major

```js
async function proofOneLens(lens) {
  const res = await agent(lensPrompt(plan, lens), {
    label: `proof:${lens.key}`, phase: 'Proof', schema: LENS_SCHEMA, model: 'sonnet',
  })
  if (!res) return null
  const findings = res.keyFindings || []
  const damaging = findings.filter(f => f.severity === 'kills' || f.severity === 'major')
  // Cap support checks (cost control) but never skip damaging
  const topSupport = findings.filter(f => f.severity === 'supports').slice(0, 1)
  const toVerify = [...damaging, ...topSupport]
  // ... rest unchanged except parallel filter (§3)
}
```

If cost is a concern, add an explicit arg defaulting to full verify:

```js
const { target, mode = 'commercial', serial = false, maxVerifyDamaging = Infinity } = parsedArgs || {}
// ...
const damaging = findings
  .filter(f => f.severity === 'kills' || f.severity === 'major')
  .slice(0, Number.isFinite(maxVerifyDamaging) ? maxVerifyDamaging : undefined)
```

Default must be **all** so marketing stays true. Document `maxVerifyDamaging` as an
escape hatch that **also** changes synth rules (Fix B).

### Fix B (required companion): stop treating unverified as held

In `synthPrompt`, replace the CRUCIAL sentence (~254):

**Before:**

```
CRUCIAL: only list a risk under risksHeld/realKillers if its verification shows holdsUp=true (or it was not verified, treat as held). Put refuted/downgraded ones under refuted/falseAlarms.
```

**After:**

```
CRUCIAL: only list a risk under risksHeld/realKillers if it has a verification with holdsUp=true AND revisedSeverity is still "kills" or "major".
Findings with no verification, failed verification, holdsUp=false, or revisedSeverity "refuted"/"minor"/"supports" must NOT appear in realKillers — put them under falseAlarms or omit.
Unverified damaging findings are INCONCLUSIVE: mention them under perLens only as "unverified (not counted toward veto)" if you must surface them — they must not trigger vetoTriggered.
```

Also tighten veto rule bullet (~246):

**Before:**

```
2. VETO: any single verified deal-killer (holdsUp=true AND severity="kills") caps the verdict to NO-GO (or CONDITIONAL-GO if a repositioning path exists) regardless of composite.
```

**After (mode-aware — see §2):**

```
2. VETO (commercial): any single verified deal-killer (holdsUp=true AND revisedSeverity="kills") caps the verdict to NO-GO (or CONDITIONAL-GO if a repositioning path exists) regardless of composite.
   VETO (purpose): same evidence rule caps to WIND-DOWN (or GOOD-ENOUGH if a repositioning path exists). Never use NO-GO/CONDITIONAL-GO/GO vocabulary in purpose mode.
3. Unverified findings never trigger veto.
```

(Renumber following bullets.)

---

## 2. Purpose-mode veto vocabulary

### Current

`synthPrompt` sets `verdictFraming` correctly for purpose (~234–236):

```js
const verdictFraming = mode === 'purpose'
  ? 'KEEP-INVESTING (composite ≥ 70) / GOOD-ENOUGH (50–69) / WIND-DOWN (< 50)'
  : 'GO (composite ≥ 70) / CONDITIONAL-GO (50–69) / NO-GO (< 50)'
```

But veto bullet always says **NO-GO / CONDITIONAL-GO** regardless of mode. Model often
emits commercial calls in purpose runs. `DIGEST_SCHEMA` allows both enums on `call`
(fine) but the prompt must not push commercial veto words in purpose mode.

### Fix

Replace the SCORING RULES block in `synthPrompt` with:

```js
function synthPrompt(plan, lensData, lenses, mode) {
  const lensTable = lenses.map(l => `${l.key} (weight ${l.weight})`).join(', ')
  const isPurpose = mode === 'purpose'
  const verdictFraming = isPurpose
    ? 'KEEP-INVESTING (composite ≥ 70) / GOOD-ENOUGH (50–69) / WIND-DOWN (< 50)'
    : 'GO (composite ≥ 70) / CONDITIONAL-GO (50–69) / NO-GO (< 50)'
  const vetoRule = isPurpose
    ? `VETO: any single verified deal-killer (holdsUp=true AND revisedSeverity="kills") caps finalVerdict.call to WIND-DOWN (or GOOD-ENOUGH if a repositioning path exists), regardless of composite. finalVerdict.call MUST be one of KEEP-INVESTING | GOOD-ENOUGH | WIND-DOWN only.`
    : `VETO: any single verified deal-killer (holdsUp=true AND revisedSeverity="kills") caps finalVerdict.call to NO-GO (or CONDITIONAL-GO if a repositioning path exists), regardless of composite. finalVerdict.call MUST be one of GO | CONDITIONAL-GO | NO-GO only.`

  return `You are synthesizing a multi-lens adversarial proofing run. Below is the raw JSON output of all proofing lenses, each with findings AND a verification pass (verifications[].verdict.holdsUp / revisedSeverity tells you which findings survived adversarial scrutiny).

MODE: ${mode}
LENSES WITH WEIGHTS: ${lensTable}
VERDICT THRESHOLDS: ${verdictFraming}

SCORING RULES:
1. weightedComposite = Σ(lensScore × weight) / 100 — compute this from the lensScore values in the data.
2. ${vetoRule}
3. Unverified or failed verifications never trigger veto and must not appear in realKillers.
4. finalVerdict.call must reflect the veto if triggered, using ONLY the vocabulary for this MODE.

PLAN TITLE: ${plan.thesis}

RAW DATA:
${JSON.stringify(lensData, null, 2)}

Distill faithfully into the schema. CRUCIAL: only list a risk under risksHeld/realKillers if it has a verification with holdsUp=true AND revisedSeverity is still "kills" or "major". Put refuted/downgraded/unverified ones under refuted/falseAlarms (label unverified clearly). Keep concrete numbers, competitor names, prices, and sources. Do not invent anything not in the data.`
}
```

---

## 3. Parallel stress filter — drop null verdicts

### Current (~305–311)

```js
const verifs = await parallel(
  toVerify.map(f => () =>
    agent(...)
      .then(v => ({ finding: f, verdict: v }))
  )
)
verifications.push(...verifs.filter(Boolean))
```

`filter(Boolean)` only drops null **entries** from `parallel`. If `agent` returns
`null`, you still push `{ finding: f, verdict: null }`, which is truthy. Synth then
sees a verification object without a real verdict — easy to mis-read as held.

### Fix

```js
if (serial) {
  for (const f of toVerify) {
    const v = await agent(verifyPrompt(f, lens, plan.thesis), {
      label: `stress:${lens.key}`, phase: 'Stress', schema: VERDICT_SCHEMA, model: 'sonnet',
    })
    if (v) verifications.push({ finding: f, verdict: v })
  }
} else {
  const verifs = await parallel(
    toVerify.map(f => () =>
      agent(verifyPrompt(f, lens, plan.thesis), {
        label: `stress:${lens.key}`, phase: 'Stress', schema: VERDICT_SCHEMA, model: 'sonnet',
      }).then(v => (v ? { finding: f, verdict: v } : null))
    )
  )
  verifications.push(...verifs.filter(x => x && x.verdict))
}
```

---

## 4. Path detection

### Current (~269–273)

```js
const isPath = target.startsWith('/') || target.startsWith('~')
if (target.startsWith('~')) {
  throw new Error('go-no-go: the workflow sandbox cannot expand "~" — pass an absolute path (e.g. /Users/you/projects/my-idea)')
}
```

Relative paths (`./foo`, `../foo`, `foo/bar`) and Windows paths (`C:\…`, `D:/…`)
are treated as **inline idea text** → Forge never reads `CLAUDE.md`.

### Fix

```js
function detectPath(target) {
  if (typeof target !== 'string') return { isPath: false }
  const t = target.trim()
  // Refuse tilde — sandbox can't expand
  if (t.startsWith('~')) {
    throw new Error(
      'go-no-go: the workflow sandbox cannot expand "~" — pass an absolute path (e.g. /Users/you/projects/my-idea)'
    )
  }
  // POSIX absolute
  if (t.startsWith('/')) return { isPath: true, path: t }
  // Windows absolute: C:\ or C:/
  if (/^[A-Za-z]:[\\/]/.test(t)) return { isPath: true, path: t }
  // Explicit relative path (has a path separator and looks like a filesystem ref)
  if (
    (t.startsWith('./') || t.startsWith('../') || t.includes('/')) &&
    !/\s/.test(t) &&
    t.length < 512 &&
    !t.includes('\n')
  ) {
    // Relative paths are ambiguous with short idea blurbs like "ai/ml for X".
    // Only treat as path if it ends with a path-like segment or exists as a common project marker request.
    // Safer rule: relative path must start with ./ or ../
    if (t.startsWith('./') || t.startsWith('../')) {
      return { isPath: true, path: t }
    }
  }
  return { isPath: false }
}

const { isPath, path: pathTarget } = detectPath(target)
// forgePrompt(target, isPath) — when isPath, pass pathTarget || target
```

Update `forgePrompt` call:

```js
const plan = await agent(
  forgePrompt(isPath ? (pathTarget || target) : target, isPath),
  { label: 'forge', phase: 'Forge', schema: PLAN_SCHEMA, model: 'sonnet' }
)
```

README already says "Pass absolute paths" — keep that; the code change makes
`./repo` and `C:\Users\…` work when users ignore the docs.

---

## 5. PROTOCOL / meta stage count (Medium, same PR if touching docs)

| Source | Stages |
|--------|--------|
| README / PROTOCOL | 5 (Forge, Proof, Stress, Synthesize, **Decide**) |
| `meta.phases` in `go-no-go.js` | 4 (Decide folded into Synthesize) |

Pick one:

**Option A — docs match code:** In README + PROTOCOL, note Decide is part of
Synthesize output (`finalVerdict`), and list 4 implementation phases.

**Option B — code matches docs:** Add `{ title: 'Decide' }` phase and call
`phase('Decide')` before return (even if work is already in digest).

Recommend **Option A** (less churn): one sentence in PROTOCOL under stage 5:

> In the workflow script, Decide is emitted as `digest.finalVerdict` inside the
> Synthesize agent call — there is no separate Decide agent.

---

## Done when

- [ ] A lens returning 5× `kills` runs 5 stress agents (not 3)
- [ ] Synth prompt forbids unverified → `realKillers` / veto
- [ ] `mode: 'purpose'` synth prompt never says NO-GO/CONDITIONAL-GO in veto rules
- [ ] Failed `agent()` in parallel stress does not leave `{ verdict: null }` in data
- [ ] `go-no-go` on `./my-project` or `/abs/path` uses path Forge prompt
- [ ] README/PROTOCOL either verify-all claim holds, or explicitly document the cap

## Quick test plan

```text
# In Claude Code with the workflow installed:
Run go-no-go on mode purpose with a tiny gift-app idea — confirm call ∈ {KEEP-INVESTING, GOOD-ENOUGH, WIND-DOWN}
Run go-no-go with a plan that yields >3 kills on one lens — confirm stress agent count ≥ kills count in the run UI
```
