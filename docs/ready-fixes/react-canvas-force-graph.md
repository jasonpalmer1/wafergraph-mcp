# Ready fix: react-canvas-force-graph

Status: NOT YET APPLIED (Claude: apply in that repo)
Source audit: wafergraph-mcp AUDIT_HANDOFF_FOR_CLAUDE.md (2026-08-08)

**Repo:** `jasonpalmer1/react-canvas-force-graph`  
**Severity:** Medium  
**Primary file:** `ForceGraph.jsx` (single runtime component)

---

## Apply order

1. `onNodePick` via ref (avoid stale click handler without resim effect thrash)
2. Include visual props (`color` / `label` / `r`) in graph signature
3. Resize: rescale / rebuild layout after remasure

---

## 1. Stale `onNodePick`

### Bug

Effect deps (~432) omit `onNodePick`:

```js
}, [sig, ambient, interactive, height, maxNodes, packets, reduce])
```

Click handler closes over the `onNodePick` from effect setup time. Parent passes a
new callback each render → clicks call the old one (wrong state/navigation).

Adding `onNodePick` to deps would rebuild the whole simulation on every parent
render if the callback is inline — avoid that.

### Fix — ref pattern

Near other refs (~108–116):

```js
const onNodePickRef = useRef(onNodePick)
onNodePickRef.current = onNodePick
```

In the effect, use the ref (do **not** add `onNodePick` to deps):

```js
const onMove = (e) => {
  const i = pick(e.clientX, e.clientY)
  if (i !== hoverRef.current) {
    hoverRef.current = i
    canvas.style.cursor =
      i >= 0 && onNodePickRef.current ? 'pointer' : 'default'
    // ... tip logic unchanged
  }
}

const onClick = (e) => {
  const pickFn = onNodePickRef.current
  if (!pickFn) return
  const i = pick(e.clientX, e.clientY)
  if (i >= 0) pickFn(simRef.current.N[i].id)
}

if (interactive) {
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerleave', onLeave)
  // Always attach click when interactive; handler no-ops if ref is empty.
  // That way late-bound onNodePick works without rebinding.
  canvas.addEventListener('click', onClick)
}
```

Previously click was only attached `if (onNodePick)` at effect time — with the ref,
attach whenever `interactive` is true.

---

## 2. Visual props in signature

### Bug

```js
const sig =
  nodes.map((n) => n.id).join(',') +
  '|' +
  links.map((l) => l.source + '>' + l.target).join(',')
```

Changing `color`, `label`, or `r` without changing ids/links leaves the sim on
stale visuals (`buildSim` copies those fields once).

### Fix

```js
const sig =
  nodes
    .map((n) => [n.id, n.label ?? '', n.r ?? '', n.color ?? '', n.group ?? ''].join(':'))
    .join(',') +
  '|' +
  links.map((l) => l.source + '>' + l.target).join(',')
```

This rebuilds the sim when visuals change (positions reseed — acceptable for a
prop change). If you need to preserve positions on color-only updates, instead
patch in place without full rebuild:

```js
// Alternative: after buildSim, or in a small layout effect:
useEffect(() => {
  const sim = simRef.current
  if (!sim) return
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const n of sim.N) {
    const src = byId.get(n.id)
    if (!src) continue
    if (src.label != null) n.label = src.label
    if (src.color != null) n.color = src.color
    if (src.r != null) n.r = Math.max(2.2, src.r)
  }
}, [nodes, /* or a visuals-only sig */])
```

For this small library, **including visuals in `sig`** is the simpler fix and
matches "props changed → graph updates." Prefer that unless consumers complain
about re-layout on color tweaks.

---

## 3. Resize rescale

### Bug (`onResize`, ~357–364)

```js
const onResize = () => {
  if (resizeRAF) return
  resizeRAF = requestAnimationFrame(() => {
    resizeRAF = 0
    measure()
    if (reduce) staticFrame()
  })
}
```

Canvas buffer is remasured, but node `x`/`y` stay in the old coordinate space →
graph sits in a corner or clips after width changes. No rebuild, no affine rescale.

### Fix — rescale positions to new size

```js
const onResize = () => {
  if (resizeRAF) return
  resizeRAF = requestAnimationFrame(() => {
    resizeRAF = 0
    const prev = { ...sizeRef.current }
    measure()
    const { w, h } = sizeRef.current
    const sim = simRef.current
    if (sim && prev.w > 0 && prev.h > 0 && (prev.w !== w || prev.h !== h)) {
      const sx = w / prev.w
      const sy = h / prev.h
      for (const n of sim.N) {
        n.x *= sx
        n.y *= sy
        // soft clamp into new bounds
        const pad = n.r + 6
        n.x = Math.min(w - pad, Math.max(pad, n.x))
        n.y = Math.min(h - pad, Math.max(pad, n.y))
      }
    }
    if (reduce) {
      staticFrame()
    } else if (!rafRef.current && visibleRef.current) {
      // wake loop so the rescaled frame paints; nudge cooling slightly
      rafRef.current = requestAnimationFrame(frame)
    } else if (reduce === false) {
      draw()
    }
  })
}
```

Alternative (heavier): `simRef.current = buildSim(useNodes, useLinks, w, h)` on
resize — clean layout, loses settled positions. Rescale is usually enough.

Note: `height` prop changes already remount the effect via deps — that path is fine.
This fix is for **viewport / parent width** changes via `window.resize` (and you may
also want a `ResizeObserver` on `wrap` for flex layouts that don't fire window
resize):

```js
const ro = new ResizeObserver(() => onResize())
ro.observe(wrap)
// cleanup: ro.disconnect()
```

---

## Optional Low (same touch if convenient)

`hexA` (~457–466) only parses 6-digit `#rrggbb`. Document that, or support `#rgb` /
`#rrggbbaa`:

```js
function hexA(color, a) {
  if (color[0] === '#') {
    let h = color.slice(1)
    if (h.length === 3) {
      h = h.split('').map((c) => c + c).join('')
    }
    if (h.length === 8) h = h.slice(0, 6) // ignore existing alpha; use `a`
    if (h.length !== 6) return color
    const n = parseInt(h, 16)
    const r = (n >> 16) & 255
    const g = (n >> 8) & 255
    const b = n & 255
    return `rgba(${r},${g},${b},${a})`
  }
  return color
}
```

README claims settle-and-stop while default `packets=true` keeps rAF (~321). Either
default `packets` to `false`, or clarify in the file header / README:

> With `packets` (default true), the render loop keeps running for decorative edge
> dots even after physics would otherwise settle. Pass `packets={false}` for
> settle-and-stop.

---

## Done when

- [ ] Parent re-creates `onNodePick={() => …}` each render → click still hits latest closure
- [ ] Update node `color`/`label`/`r` without id change → canvas reflects it
- [ ] Shrink browser window / flex parent → nodes stay in view (rescaled), not stuck at old coords
- [ ] No infinite effect loop (ref pattern keeps `onNodePick` out of deps)

## Minimal patch sketch (all three)

```js
// 1) ref
const onNodePickRef = useRef(onNodePick)
onNodePickRef.current = onNodePick

// 2) richer sig
const sig =
  nodes.map((n) => `${n.id}:${n.label ?? ''}:${n.r ?? ''}:${n.color ?? ''}`).join(',') +
  '|' +
  links.map((l) => l.source + '>' + l.target).join(',')

// 3) in onResize after measure(): rescale sim.N by w/prev.w, h/prev.h
```

Deps line stays:

```js
}, [sig, ambient, interactive, height, maxNodes, packets, reduce])
```
