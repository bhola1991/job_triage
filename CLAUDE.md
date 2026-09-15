# Job Triage — design system rules

Guidance for working on this codebase, and for importing Figma designs through the
Figma MCP server. Every claim below was checked against the files on
2026-09-15; file:line references are the authority, not this summary.

---

## 0. Read this before importing anything from Figma

**Two palettes exist in this repository. Only one is shipped.** Picking the
wrong one is the single most likely way to break this codebase, because the
stale file has the more obvious name and sits at the repository root.

| Palette | Ground | Where it lives | Status |
| --- | --- | --- | --- |
| **v2 "go/due/closing/awaiting"** | `#18211C` | `design/jobtriage.tokens.json`, `ui-kit/src/v2/tokens.css`, `index.html` `:root`, `legal.css`, `icon.svg`, `manifest.json` | **SHIPPED — use this** |
| v1 "signal/good/live/warn" | `#0E1411` | `job-triage.tokens.json` (repo root), `*.dc.html` at repo root | Superseded |

(A third, pre-v1 blue-grey ground `#131A21` survived in `icon.svg` and
`manifest.json` until 2026-09-15, when both were brought onto v2.)

Verified: `index.html:30` sets `--ink:#18211C`, matching `design/jobtriage.tokens.json`.
The root `job-triage.tokens.json` says `#0E1411`. They disagree on **17 of the 41
tokens they share** (`ink`, `panel`, `panel2`, `line`, `text`, `muted`, `dim`, all
three shadows, in both themes).

**Rule: `design/jobtriage.tokens.json` is the source of truth.** `design/README.md`
names it "The tokens", and `ui-kit/src/v2/tokens.css:1` records that it was
"Transcribed verbatim" from it. Never read the root `job-triage.tokens.json` when
answering "what colour is X".

### The v1 names are live aliases, not dead code

`index.html:42-61` keeps the v1 names defined, pointed at v2 values:

```css
--go:#56C88A;      /* v2 */
--signal:#56C88A;  /* v1 alias — same hue */
--warn:#E2685C;    /* == --due */
--live:#56C88A;    /* == --go */
```

The comment at `index.html:25-27` states the intent: *"The older names below
(signal, warn, posted, live...) are kept so nothing that reads them breaks, but
they now resolve onto the same law."*

- Do **not** "clean up" v1 names in `index.html` — 40+ call sites depend on them.
- Do **not** introduce new v1 names. New code uses v2 names only.
- `ui-kit` is v2-only; it has no v1 names and must not gain any.

---

## 1. Token definitions

### Format

Design Tokens / Tokens Studio format — `$metadata`, `$themes`, and three token
sets ordered `global` → `dark` → `light`.

```json
{
  "global": {
    "font": {
      "mono": {
        "value": "ui-monospace, 'Cascadia Mono', Consolas, monospace",
        "type": "fontFamilies",
        "description": "Machine facts only: scores, dates, counts. If a human wrote it, it is not mono"
      }
    }
  }
}
```

The `description` fields carry the design law and are load-bearing documentation —
preserve them on any round-trip.

### There is no transformation pipeline

Tokens reach CSS **by hand**. There is no Style Dictionary, no build step, no
generator. The same values are transcribed into three places:

| Consumer | File | Scope |
| --- | --- | --- |
| App | `index.html:28-68` (dark), `:root[data-theme=light]` below it | `:root` |
| Library | `ui-kit/src/v2/tokens.css` | `[data-palette="v2"]` |
| Public pages | `legal.css:3-6` | `:root` + `prefers-color-scheme` |

**Changing a token means editing all three by hand, in the same commit.** There is
no check that catches drift — `legal.css` already differs on light `--ink`
(`#F6F8F6` vs the app's `#F1F5F2`).

### Token vocabulary

Surfaces `--ink --panel --panel2 --line --hair` · text `--text --muted --dim` ·
accents `--go --due --closing --awaiting` each with `-line` and `-tint` (dark) or
`-chip` and `-row` (light), plus `--on-go`/`--on-due` for text on a filled accent ·
`--closed` (grey) · `--shadow --shadow-md --shadow-lg` · fonts `--disp --mono`.

### The colour law — enforce this in any generated code

Four accents, one instruction each (`index.html:13-23`, `design/README.md`):

| Token | Dark | Light | Means |
| --- | --- | --- | --- |
| `--go` | `#56C88A` | `#157F42` | Do this now. The only fill-weight button. |
| `--due` | `#E2685C` | `#C33B2E` | Overdue — past the follow-up date. |
| `--closing` | `#D9A441` | `#8A6314` | Posting old enough to be filled soon. |
| `--awaiting` | `#57AEC9` | `#1E6C86` | Sent; the next move is theirs. |
| `--closed` | `#3E4F44` | `#B6C4BC` | Grey = the absence of an instruction. |

Three rules a Figma import must not violate:

1. **A row carries at most one accent.** Both closing and overdue → nearer deadline wins, the other becomes plain text.
2. **A score is never an accent.** Colour says what to do; the number says how good it is. Reachability stays grey — a second axis, not a verdict.
3. **Dark states the accent on the row's edge; light tints the whole cell.** In dark, `--*-row` is `transparent` (`index.html:39`).

If a Figma frame colours a score, or stacks two accents on one row, **flag it
rather than implementing it.**

---

## 2. Component library

`ui-kit/` — a private, buildable React package (`job-triage-ui`, not published).

### Architecture

Function components, no state, no hooks, no context. Props in, markup out. Every
component is one `.tsx` file exporting the component and its `Props` interface.

```tsx
// ui-kit/src/v2/components/StatusPill.tsx — the whole file
import type { ReactNode } from 'react';

export interface StatusPillProps {
  tone?: 'go' | 'due' | 'closing' | 'awaiting' | 'neutral';
  children: ReactNode;
}

/** A tinted status pill — counts in the top bar, detail facts, contact states. */
export function StatusPill({ tone = 'neutral', children }: StatusPillProps) {
  return <span data-palette="v2" className={`pill2 ${tone}`}>{children}</span>;
}
```

### The `data-palette="v2"` invariant — non-negotiable

Tokens are scoped under `[data-palette="v2"]`, so **every component sets it on its
own root node**. Verified: all 14 components carry exactly one occurrence.

`ui-kit/.design-sync/NOTES.md` records why — without it, every accent-toned
element rendered blank, because no ancestor in a consuming app sets the attribute.

**Any new component must set `data-palette="v2"` on its root.** Confirm with:

```bash
grep -c 'data-palette="v2"' ui-kit/src/v2/components/*.tsx   # every file must be 1
```

### Components (14)

`TopBar` `StatusPill` `ColorKey` `QueueSection` `QueueRow` `ActionButton`
`DetailHeader` `StatGrid` `ReasonPanel` `FactRows` `ContactRow` `Timeline`
`Callout` `PostingLink` — exported from `ui-kit/src/v2/index.ts`.

Twelve v1 components (`Button`, `Chip`, `JobCard`, `FitReachMeter`, …) were
**deleted** on 2026-09-13 because the app stopped using that design. Do not
resurrect them from the root `*.dc.html` artboards, which still depict them.

### Most components are deliberately transparent

`QueueSection` `QueueRow` `DetailHeader` `StatGrid` `FactRows` `ContactRow`
`Timeline` `Callout` `ColorKey` own no background — they sit on the app's dark
page. Their text is near-white, so **on a white canvas they are invisible.**

```tsx
<div data-palette="v2" style={{ background: 'var(--ink)', padding: 16 }}>
  <QueueSection title="Do these first" count={9} tone="go">…</QueueSection>
</div>
```

`TopBar`, `StatusPill` and `ActionButton` carry their own background and are safe
anywhere. This is the #1 recurring bug in preview harnesses — see NOTES.md.

### Documentation and testing

**No Storybook.** Two mechanisms instead:

- `ui-kit/.design-sync/previews/*.tsx` — one preview per component for the design-sync pane. Previews of transparent components wrap their export in a `var(--ink)` ground div.
- `ui-kit/scripts/selfcheck.js` — renders every export with `renderToStaticMarkup` and asserts expected markup. No test framework.

Verified working:

```bash
cd ui-kit && npm ci && npm run build && npm run selfcheck
# → 16/16 components rendered as expected.
```

Run this after any component change. `npm run selfcheck` reads `dist/`, so
**build first**.

---

## 3. Frameworks & libraries

This repo contains **three separate runtimes**. Do not carry conventions across them.

| | App | Component library | Backend |
| --- | --- | --- | --- |
| Path | `index.html` | `ui-kit/` | `supabase/functions/api/` |
| Language | Vanilla ES2020 in one `<script>` | React 18 + TypeScript (strict) | TypeScript on Deno |
| Styling | One `<style>` block, plain CSS | Plain CSS, two files | — |
| Build | **None** | `tsup` → ESM + CJS + `.d.ts` | Supabase deploy |
| Deps | 2 CDN scripts | React (peer) only | `npm:@supabase/supabase-js@2` |

### The app has no build step

`index.html` is ~4,670 lines: markup, CSS and application JS in one file. `README.md`
states it plainly: *"Open `index.html`. That's the whole install."* No bundler, no
transpiler, no `package.json` at the root, no framework.

**Do not introduce a build step, a framework, or an npm dependency to the app.**
If a Figma import wants React, it belongs in `ui-kit/`, not `index.html`.

Two external dependencies, both loaded by `<script>` tag rather than bundled, both
pinned to an exact version. Keep both pinned.

```html
<!-- index.html:9 — eager, in <head> -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/dist/umd/supabase.js"></script>
```

```js
// index.html:3923 — lazy: fetched only the first time someone picks a PDF CV
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
await loadScript(PDFJS + 'pdf.min.js');
lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
```

pdf.js reads a PDF CV to text **in the browser** — nothing is uploaded to read it.
Follow that pattern for any future dependency: load it on demand, at a pinned
version, and keep the work client-side.

### ui-kit build

`tsup.config.ts` — entries `src/index.ts` and `src/styles.css`, both ESM and CJS,
`dts: true`, `splitting: false`. `tsconfig.json` is `strict`, `jsx: react-jsx`,
`moduleResolution: Bundler`. Imports use explicit `.js` extensions
(`'./components/StatusPill.js'`) — keep that, it is required by the resolution mode.

---

## 4. Asset management

**There are no image assets.** Verified: zero `<img>` tags and zero `data:image`
URIs in `index.html`. The only binary-ish asset in the repo is `icon.svg`.

- **No CDN for assets.** The two CDN URLs are both scripts (supabase-js, pdf.js). Everything else is same-origin.
- **No image optimisation pipeline** — nothing to optimise.
- **Offline**: `sw.js` caches a five-entry shell (`./`, `index.html`, `config.js`, `manifest.json`, `icon.svg`), **network-first** so a deploy reaches users immediately. It only caches same-origin GETs — API traffic (Supabase, DeepSeek, Anthropic, Apify) is never cached.

If a Figma import produces raster assets, **stop and ask.** Adding the first image
to this project means deciding where images live, how the service worker treats
them, and whether the single-file property survives.

---

## 5. Icon system

There is **no icon library, no sprite sheet, and no naming convention** — because
there are almost no icons.

- `icon.svg` — the PWA app icon (a fit × reachability scatter plot). On the v2 palette, using the same colours as the plot it depicts: ground `--ink`, axes `--line`, an open role `--go`, a cold target `--cold`, an unopened one `--dim`. Values are hard-coded because an icon loads outside the document, so `var()` never resolves there — **so it is a fourth place a token change must reach.**
  Its comment must not contain a `--` sequence: XML forbids a double hyphen inside a comment, and it silently makes the whole file an unparseable broken image. Write token names without their leading dashes there.
- Four inline `<svg>` in `index.html`: three 13×13 theme-toggle glyphs (`index.html:3451-3454`) and one `viewBox="0 0 640 420"` data plot (`index.html:3587`).

The convention for the glyphs, if you add one:

```html
<svg width="13" height="13" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2" style="vertical-align:-2px">…</svg>
```

24×24 viewBox, `currentColor` stroke so it inherits the token colour, no fill.

**Do not add an icon dependency** (lucide, heroicons, react-icons) to either the app
or `ui-kit`. Inline the one path you need.

---

## 6. Styling approach

**Plain CSS with custom properties.** No CSS Modules, no styled-components, no
Tailwind, no utility classes, no CSS-in-JS. From `.design-sync/conventions.md`:
*"Compose with `var(--token)`, never a literal hex — there are no utility classes
and no styled-prop system."*

### Class naming

Short, flat, hand-written. No BEM, no hashing. The full `ui-kit` vocabulary
(`ui-kit/src/v2/components.css`, 163 lines):

```
.topbar2 .pill2 .btn2 .btn2-row .qsec .qsec-head .qrow .dhead .dhead-eb
.stat4 .reason-h .reason-body .reason-pills .factrows .contact-row
.timeline .callout .posting-link .lg .lg-h .lg-s
```

Tone is a second class, not a modifier: `className={`pill2 ${tone}`}`.

**Compose with component props, not by hand-writing these classes.** They are
implementation detail.

### Global styles

- App: one `<style>` in `index.html`, `:root` for dark and `:root[data-theme="light"]` for light.
- Library: `ui-kit/src/styles.css` is the only import; it `@import`s `v2/tokens.css` then `v2/components.css`. Scoped to `[data-palette="v2"]` / `[data-palette="v2"][data-theme="light"]`.
- Public pages: `legal.css`, shared by `pricing/terms/refund/privacy/contact.html`.

### Theming

Dark is the default (`color-scheme: dark`). Light is an explicit
`[data-theme="light"]` attribute in the app and library; `legal.css` alone uses
`prefers-color-scheme`. A generated component must define both themes.

### Responsive

Plain media queries, mobile-last (`max-width`). Breakpoints in use:
**1240px, 1080px, 900px, 640px (×2), 480px**. Plus `@media (hover:hover)` for
hover-only affordances and `prefers-reduced-motion` for animation.

No CSS framework grid. Layout is flex and `grid-template-columns`.

---

## 7. Project structure

```
index.html              The entire app — markup, CSS, JS. ~4,670 lines, no build.
config.js               Supabase URL + anon key. Empty = local-only mode.
legal.css               Shared by the five public pages.
pricing/terms/refund/privacy/contact.html
sw.js  manifest.json  icon.svg      PWA shell.
schema.sql  billing.sql             Supabase tables, RLS, credit functions, usage ledger.
supabase/functions/api/index.ts     Deno edge function: search, scoring, payments.
scripts/selfcheck-boards.js         Board-source check.
job-triage.tokens.json              ⚠ STALE v1 tokens. Not the source of truth.
*.dc.html  canvas.json              ⚠ Superseded v1 artboards (ground #0E1411).
design/
  jobtriage.tokens.json             ✅ THE TOKENS.
  Ground 18211C.dc.html             ✅ The reference screen.
  Job Triage Mockups.dc.html        Turn 3 (top) is current; turns 1-2 superseded.
  Colour wheel.dc.html              The hue picker.
  README.md                         The palette, stated.
ui-kit/
  src/index.ts → src/v2/index.ts    Barrel exports.
  src/styles.css                    @imports tokens.css + components.css.
  src/v2/tokens.css                 [data-palette="v2"] token block.
  src/v2/components.css             All component CSS, 163 lines.
  src/v2/components/*.tsx           14 components.
  .design-sync/conventions.md       Usage law. Read before writing against the kit.
  .design-sync/NOTES.md             Incident history. Read before debugging a blank render.
  .design-sync/previews/*.tsx       One preview per component.
  scripts/selfcheck.js              Render assertion for all exports.
```

### Organisation pattern

Organised **by artefact type, not by feature**. The app has no feature folders —
it is one file, sectioned by `/* ═══ heading ═══ */` comment banners. Find code by
grepping those banners.

### `.dc.html` design artboards

Standalone browser-openable pages using an `<x-dc>` / `<helmet>` custom-element
format, loading `./support.js`.

- **`design/support.js` is gitignored on purpose** (root `.gitignore`: *"Design-tool exports… these are the runtime"*). A `.dc.html` will not render until it is supplied locally. This is expected, not a bug.
- **Artboards hardcode hex, not tokens.** Verified: the root artboards contain 0 `var(--…)` and 75–191 hex literals each. They are static snapshots and will **not** pick up a token change. Never treat them as a live design source.

---

## 8. Figma MCP working rules

1. **Map tokens to `design/jobtriage.tokens.json`.** Never the root file.
2. **Target `ui-kit/src/v2/components/` for Code Connect.** It is the only real component layer; `index.html` is not componentised and the `.dc.html` boards are snapshots.
3. **Emit `var(--token)`, never hex.** A generated literal hex is a defect even when the value is correct — it breaks the light theme, which redefines the same names.
4. **Set `data-palette="v2"` on the root of anything generated**, or its accent tokens resolve to nothing.
5. **Check the generated frame against the three colour rules** (§1). An accent on a score, or two accents on a row, is a design error to raise, not to implement.
6. **A token change is three edits**: `design/jobtriage.tokens.json`, `ui-kit/src/v2/tokens.css`, `index.html` `:root` (both themes) — plus `legal.css` if it is one of the seven tokens that file carries. Nothing verifies this; do it in one commit.
7. **Match the runtime you are in.** React + TS in `ui-kit/`; vanilla ES2020 with no dependencies in `index.html`. Never convert one into the other.
8. **Before finishing**: `cd ui-kit && npm run build && npm run selfcheck` must print `16/16`.
