# Ready fix: claude-code-setup

Status: NOT YET APPLIED (Claude: apply in that repo)
Source audit: wafergraph-mcp AUDIT_HANDOFF_FOR_CLAUDE.md (2026-08-08)

**Repo:** `jasonpalmer1/claude-code-setup`  
**Severity:** High  
**Focus:** `hooks/`, `commands/tokens.md`, `routines/monday-cockpit.sh`

Templates/hooks that Claude follows literally — path mismatches and broad unattended
grants are real blast radius, not doc nits.

---

## Apply order

1. Ledger path alignment (`token-ledger.py` ↔ `/tokens` ↔ template)
2. SessionEnd: shrink `acceptEdits` blast radius
3. Monday cockpit: narrow `Bash(git:*)` / `Bash(node:*)` grants
4. (Same PR) `hook-errors.log` mkdir already fixed in ledger; ensure shell redirect path exists

---

## 1. Ledger path alignment

### Bug

| Writer | Path |
|--------|------|
| `hooks/token-ledger.py` `LEDGER` | `~/.claude/token_ledger.md` (default) |
| `commands/tokens.md` | Reads `<MEMORY_DIR>/token_ledger.md` |

`CLAUDE.md.template` defines `<MEMORY_DIR>` as e.g.
`~/.claude/projects/<your-id>/memory/`. After onboarding search-replace, `/tokens`
looks in the memory dir; the SessionEnd hook writes to `~/.claude/token_ledger.md`.
**`/tokens` reports empty / missing while the ledger grows elsewhere.**

Comments in `token-ledger.py` (~23–26) already hint at pointing LEDGER at the memory
dir — make that the documented default and keep one source of truth.

### Fix (pick one convention and apply everywhere)

**Recommended: ledger lives in MEMORY_DIR**

1. Change `hooks/token-ledger.py`:

```python
# Before:
LEDGER = os.path.expanduser("~/.claude/token_ledger.md")

# After — resolve from env, then memory-dir convention, then legacy fallback:
def default_ledger_path():
    env = os.environ.get("CLAUDE_TOKEN_LEDGER")
    if env:
        return os.path.expanduser(env)
    # Prefer tiered-memory layout used by CLAUDE.md.template /tokens
    mem = os.environ.get("CLAUDE_MEMORY_DIR")
    if mem:
        return os.path.join(os.path.expanduser(mem), "token_ledger.md")
    # Legacy single-file location (pre-alignment installs)
    legacy = os.path.expanduser("~/.claude/token_ledger.md")
    # If ONBOARDING set a memory dir pattern, document that users should export
    # CLAUDE_MEMORY_DIR or set LEDGER explicitly after copy.
    return legacy

LEDGER = default_ledger_path()
```

Simpler variant if you don't want env indirection — make the template comment the
**required** edit and set the example to memory dir:

```python
# REQUIRED on install: point at your memory dir (same path /tokens reads).
# Example:
# LEDGER = os.path.expanduser("~/.claude/projects/-Users-<you>/memory/token_ledger.md")
LEDGER = os.path.expanduser("~/.claude/token_ledger.md")  # change me
```

And update `ONBOARDING.md` / `README.md` install step 5 to include:

> Set `LEDGER` in `hooks/token-ledger.py` to `<MEMORY_DIR>/token_ledger.md` — the
> same path you substituted into `commands/tokens.md`.

2. Update `commands/tokens.md` opener to be unambiguous:

```markdown
Read the token ledger at `<MEMORY_DIR>/token_ledger.md` (this MUST be the same file
`hooks/token-ledger.py` writes — if `/tokens` looks empty, check `LEDGER` in
`token-ledger.py` first).
```

3. Optional migration note in README:

```markdown
If you already have `~/.claude/token_ledger.md` and a memory-dir install, move it:
`mv ~/.claude/token_ledger.md <MEMORY_DIR>/token_ledger.md` and point `LEDGER` there.
```

### Also ensure error log dir exists for the shell hook

`session-end-log.sh` redirects stderr to `$HOME/.claude/hub/hook-errors.log` without
mkdir. `token-ledger.py` already `makedirs` for its own ERROR_LOG — add to the shell
hook before the python call:

```sh
mkdir -p "$HOME/.claude/hub"
python3 "$HOME/.claude/hooks/token-ledger.py" "$tp" >/dev/null 2>>"$HOME/.claude/hub/hook-errors.log" || true
```

---

## 2. SessionEnd — `acceptEdits` blast radius

### Current (`hooks/session-end-log.sh` ~26–27)

```sh
CLAUDE_AUTOLOG=1 claude -p "/log Read the just-ended session transcript at $tp and write its summary." \
  --model sonnet --permission-mode acceptEdits >/dev/null 2>&1 &
```

`acceptEdits` auto-approves Edit/Write across the session. An unattended `/log` that
misfires (wrong cwd, prompt injection in transcript, hallucinated "fix the bug")
can modify arbitrary project files with nobody watching.

### Fix options (apply at least one; prefer A+B)

**A. Drop `acceptEdits`; allowlist write paths**

```sh
# Summaries should only touch the conversation log under MEMORY_DIR.
# Replace <MEMORY_DIR> at install time the same way as other templates.
MEM_DIR="${CLAUDE_MEMORY_DIR:-$HOME/.claude/projects/DEFAULT/memory}"

CLAUDE_AUTOLOG=1 claude -p "/log Read the just-ended session transcript at $tp and write its summary under the conversation log only. Do not modify any other files." \
  --model sonnet \
  --allowedTools "Read,Glob,Grep,Write(${MEM_DIR}/conversations/**),Edit(${MEM_DIR}/conversations/**),Write(${MEM_DIR}/conversations_index.md),Edit(${MEM_DIR}/conversations_index.md)" \
  >/dev/null 2>>"$HOME/.claude/hub/hook-errors.log" &
```

Adjust paths to match whatever `/log` (`commands/log.md`) actually writes.

**B. If your Claude build supports it, use a stricter permission mode**

```sh
--permission-mode plan
# or omit --permission-mode and rely solely on --allowedTools
```

Never use `acceptEdits` / `bypassPermissions` on a backgrounded SessionEnd hook.

**C. Document the risk** (minimum if A needs per-user path wiring)

In `hooks/session-end-log.sh` header and README hooks section:

> WARNING: `--permission-mode acceptEdits` auto-applies file edits with no human in
> the loop. Replace with an `--allowedTools` allowlist scoped to your conversation
> log paths before enabling this hook on a machine with sensitive repos.

**D. Guard cwd**

```sh
# Run from a harmless directory so relative writes don't hit a random repo
cd "$HOME" || exit 0
CLAUDE_AUTOLOG=1 claude -p "..." ...
```

Recommended ship: **A + D + mkdir from §1**. Remove `acceptEdits` entirely.

---

## 3. Monday cockpit grants

### Current (`routines/monday-cockpit.sh` ~12–14)

```sh
claude -p "..." \
  --model sonnet \
  --allowedTools "Bash($HOME/.claude/routines/standup-scan.sh*),Bash(bash $HOME/.claude/routines/standup-scan.sh*),Bash(zsh $HOME/.claude/routines/standup-scan.sh*),Bash(git:*),Bash(node:*),Read,Glob,Grep,Write($PULSE_LOG),Edit($PULSE_LOG)" \
```

Comments/README claim the grant is **narrow**. `Bash(git:*)` and `Bash(node:*)` are
not — they allow any git/node invocation (push, reset, arbitrary scripts via
`node ~/evil.js`).

### Fix

Standup already isolates fleet git into `standup-scan.sh` (allowlisted by path).
Pulse should run a **fixed** analytics script path, not bare `node:*`.

```sh
# Fill in at install — absolute path to the pulse/analytics script pulse.md documents:
PULSE_SCRIPT="<PULSE_SCRIPT_PATH>"   # e.g. $HOME/projects/visit-log/scripts/pulse.js

claude -p "Produce a Monday-cockpit report. (1) STANDUP: run ONLY ~/.claude/routines/standup-scan.sh … (2) PULSE: run ONLY node $PULSE_SCRIPT … append today's reading to $PULSE_LOG (the ONLY file you may write). …" \
  --model sonnet \
  --allowedTools "Bash($HOME/.claude/routines/standup-scan.sh),Bash(bash $HOME/.claude/routines/standup-scan.sh),Bash(zsh $HOME/.claude/routines/standup-scan.sh),Bash(node $PULSE_SCRIPT),Bash(node $PULSE_SCRIPT *),Read,Glob,Grep,Write($PULSE_LOG),Edit($PULSE_LOG)" \
  > "$OUT" 2>"$OUT_DIR/$(date +%F)-monday-cockpit.err"
```

If pulse truly needs one-off git read status outside the scan script, add **exact**
prefixes only, e.g.:

```text
Bash(git -C $HOME/projects/foo status *),Bash(git -C $HOME/projects/foo log *)
```

— never `Bash(git:*)`.

### Docs to update

`routines/README.md` (~30–34) currently says:

> a couple of read-only git/node command prefixes

**Replace with:**

> exact script paths only (`standup-scan.sh`, your pulse script). Do **not** use
> `Bash(git:*)` or `Bash(node:*)` — those are full interpreter/VCS grants and are
> unsafe for unattended launchd runs.

Same correction in `monday-cockpit.sh` header comment (~4–5) and root `README.md`
routines blurb (~82) if it still implies git/node prefixes are "narrow."

Add `<PULSE_SCRIPT_PATH>` to the "Fill in before use" list in `routines/README.md`.

---

## Done when

- [ ] Fresh install: SessionEnd writes a row; `/tokens` reads that same file
- [ ] `session-end-log.sh` has no `--permission-mode acceptEdits`
- [ ] Autolog `--allowedTools` cannot Edit/Write outside conversation log paths
- [ ] `monday-cockpit.sh` has no `Bash(git:*)` / `Bash(node:*)`
- [ ] `mkdir -p ~/.claude/hub` before redirect; first SessionEnd doesn't fail on missing dir
- [ ] README/routines docs match the tightened grants

## Out of scope (audit Medium — optional)

- Firewall counter in `/tmp` (symlink/race on shared machines) — `hooks/context-firewall.py`
- Slash commands referencing `/code-review`, playbook file, `/verify` not shipped by this repo
