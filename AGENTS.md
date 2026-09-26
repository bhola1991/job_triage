# Job Triage — design system rules

Guidance for working on this codebase, and for importing Figma designs through the
Figma MCP server. Every claim below was checked against the files on
2026-09-15, §§1, 2, 7 and 8 again on 2026-09-18, and §§7 and 8 again on
2026-09-24; file:line references are the authority, not this summary.

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

**Changing a token means editing all three by hand, in the same commit** — four,
counting `icon.svg`, whose rim and axes are the `--line` value (§5).

`scripts/selfcheck-tokens.js` now catches the drift that used to go unnoticed:

```bash
node scripts/selfcheck-tokens.js     # must print ALL PASS
```

It diffs `index.html`, `ui-kit/src/v2/tokens.css` and `legal.css` against
`design/jobtriage.tokens.json`, and separately asserts that every token
`ui-kit/src/v2/components.css` reads is defined in **both** theme blocks — a
token defined in only one silently falls through to the other theme's value.
It does not cover `icon.svg`, whose values are hard-coded for a reason (§5).
That one has its own check, because it needs a renderer rather than a parser:

```bash
node scripts/selfcheck-icon.js       # must print ALL PASS
```

It rasterises the icon and asserts the rendered ground is `--ink` and the
rendered rim is `--line`, that every hex literal in the file is still a token
value, that no XML comment contains a `--`, and that no mark reaches past the
maskable safe zone. It borrows Obsidian as a canvas (`obs eval`), since the
repo has no rasteriser and adding one to check a 2KB file is the wrong trade —
so if Obsidian is not running it prints a loud `SKIP` and runs the text checks
only. **A `SKIP` is not a pass**: the geometry did not get checked.

It was written because all four copies had drifted: `legal.css` was off on
three of the seven tokens it carries, `index.html`'s light shadows used a
different shadow colour, this file was missing `shadow-md` and the four dark
`--*-row` washes outright, and `ui-kit`'s light block never overrode the four
`--*-tint` names its own `components.css` reads — so every light-theme pill,
outline button and callout rendered a dark translucent wash on white.

### Accent-on-tint contrast is a constraint, not a preference

Every accent is also used as **text on its own tint** — that is what `.pill2`,
`.callout` and `.btn2.outline` do — so each pair has to clear WCAG AA (4.5:1;
the type is 11-13px, so the 3:1 large-text threshold does not apply).

Five of the eight pairs did not, and nothing noticed until 2026-09-18: light
`--go` 4.25, light `--due` 4.34, dark `--closing` 4.18, dark `--awaiting` 3.78,
dark `--due` 3.08.

There are two ways to fix such a pair, and which one is right differs:

- **Move the accent.** Holding hue and saturation and shifting only lightness
  keeps the meaning. Light `--go` and `--due` moved ~1% this way,
  imperceptibly; dark `--closing` and `--awaiting` moved a few percent and are
  slightly lighter than they were.
- **Move the wash.** Dark `--due` is the case where the accent could not move
  far enough to matter without going pink — it measured only 3.59:1 against
  `--panel2` even with *no* tint, because a translucent wash *lightens* the
  chip and a red that dark needs a dark background. So its wash became
  **opaque** (`--due-tint: #372018`) and the accent stayed `#E2685C`. Being
  opaque also makes that chip independent of whatever surface it sits on,
  which is stricter than the other three, not looser.

That is why `--due-tint` is the one dark tint that is not an `rgba()`. Its chip
is visibly darker than its three siblings (L≈0.019 against L≈0.050) — an
unavoidable consequence of carrying a red that deep at AA, and the reason not
to "tidy" it back into a translucent value.

`scripts/selfcheck-tokens.js` asserts **all sixteen** pairs: each accent as
text on its chip and on its whole-row wash, in both themes. The chip is
measured against the lightest surface it can land on (`--panel2` in dark) since
`StatusPill` is documented safe anywhere (§2); the row only ever sits on the
page, so it is measured against `--ink`. Two pairs have almost no margin —
dark `--go` on its tint at **4.50** and dark `--due` on its row at **4.53** —
so treat both as floors.

### The dark surface ramp is tuned, not arbitrary

`--ink → --panel → --panel2 → --line` are spaced to be visibly distinct while
keeping `--muted` (`#93A597`) at AA body contrast on every surface that carries
text. `--panel2` sits exactly on that ceiling at **4.55:1** — lighten it and
muted text fails; darken the set and the app flattens back into one plane, which
is what it did before 2026-09-15 (every surface was then within a 1.55:1 band).
If you need more separation than this, lighten `--muted` first, then re-solve.

### Token vocabulary

Surfaces `--ink --panel --panel2 --line --hair` · text `--text --muted --dim` ·
accents `--go --due --closing --awaiting` each with `-line`, `-tint` and `-row`
in **both** themes, plus `--on-go`/`--on-due` for text on a filled accent ·
`--closed` (grey) · `--shadow --shadow-md --shadow-lg` · fonts `--disp --mono`.

One naming wrinkle worth knowing before you go looking for a bug: the tokens
file calls the light wash behind a chip **`-chip`**, while `index.html` carries
that same value under the **`-tint`** name (what its dark theme calls the same
role). `ui-kit/src/v2/tokens.css` defines both, because its `components.css`
reads `-tint`. Same colour, two names — not two colours. Leaving the `-tint`
override out of the light block is what made every light pill, outline button
and callout render a dark translucent wash on white, so `selfcheck-tokens.js`
now asserts that both names resolve in both themes.

### The colour law — enforce this in any generated code

Four accents, one instruction each (`index.html:13-23`, `design/README.md`):

| Token | Dark | Light | Means |
| --- | --- | --- | --- |
| `--go` | `#56C88A` | `#147A3F` | Do this now. The only fill-weight button. |
| `--due` | `#E2685C` | `#BE3A2D` | Overdue — past the follow-up date. |
| `--closing` | `#DEAF57` | `#8A6314` | Posting old enough to be filled soon. |
| `--awaiting` | `#75BDD3` | `#1E6C86` | Sent; the next move is theirs. |
| `--closed` | `#3E4F44` | `#B6C4BC` | Grey = the absence of an instruction. |

Three rules a Figma import must not violate:

1. **A row carries at most one accent.** Both closing and overdue → nearer deadline wins, the other becomes plain text.
2. **A score is never an accent.** Colour says what to do; the number says how good it is. Reachability stays grey — a second axis, not a verdict.
3. **Both themes tint the cell; dark states the edge as well.** Light washes the row at full weight (`--go-row: #E9F4ED`); dark washes it at roughly a quarter of that (`--go-row: rgba(86,200,138,.075)`, `index.html:39`), because the same tint reads far louder on a near-black ground than on paper. Dark additionally carries the accent as a 5px edge. Until 2026-09-15 dark set every `--*-row` to `transparent` and relied on the edge alone; if you see that in an older artboard, the artboard is out of date, not the code.

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
# → 17/17 components rendered as expected.
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

- `icon.svg` — the PWA app icon (a fit × reachability scatter plot). On the v2 palette, using the same colours as the plot it depicts: ground `--ink`, axes `--line`, an open role `--go`, a cold target `--cold`, an unopened one `--dim`. Values are hard-coded because an icon loads outside the document, so `var()` never resolves there — **so it is a fourth place a token change must reach.** `node scripts/selfcheck-icon.js` now checks that it did.
  One of those five is not in the source of truth: **`--cold` is defined only in `index.html`'s two `:root` blocks** (`index.html:53` dark, `:98` light) and appears in neither `design/jobtriage.tokens.json` nor `ui-kit/src/v2/tokens.css` nor §1's token vocabulary. A change to it has nothing upstream to drive it, so `selfcheck-icon.js` reads it from the app and says so. `--plot-fade` (`index.html:2944`) is in the same position. Promoting both is the real fix.
  Its comment must not contain a `--` sequence: XML forbids a double hyphen inside a comment, and it silently makes the whole file an unparseable broken image. Write token names without their leading dashes there.
  Two constraints on its geometry, both easy to undo by accident:
  - **The rim is load-bearing.** The ground is 1.27:1 against a black home screen and 1.03:1 against iOS dark, so without a `--line` rim the tile has no edge and dissolves into the wallpaper. Do not remove it. Inverting to a light ground is not the fix — it fails on a white background in exactly the same way.
  - **Every mark must sit inside the maskable safe zone**, the centred circle of 80% width (radius 204.8 of 512), because the manifest declares `purpose: "any maskable"` and Android crops to it. The content group is scaled `0.92` about the centre for exactly this reason; at full size the axis elbow and both ends reach 222 and get sliced off. Measured: the scaled axes reach **203.7 against the 204.8 limit — a margin of 1.1px in 512**. Treat that as a floor, not as headroom; `selfcheck-icon.js` flags it even while passing.
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
scripts/selfcheck-rows.js           Job/profile <-> typed row round trip.
scripts/selfcheck-sync.js           Save/load/migrate cycle against a PostgREST stand-in.
scripts/selfcheck-boards.js         Board-source check.
scripts/eval-matcher.js             Matcher metrics against scripts/eval/baseline.json.
scripts/eval/                       Recorded model answers + the committed baseline.
scripts/selfcheck-tokens.js         Token-drift check: all consumers vs design/jobtriage.tokens.json.
scripts/selfcheck-icon.js           Icon check: renders icon.svg and asserts colour + maskable geometry.
scripts/pipeline-map.js             Data-pipeline map: resolves code anchors, writes Mermaid notes to an Obsidian vault.
scripts/pipeline-map.spec.js        The declared topology — nodes, edges, anchors. Data only, hand-maintained.
.Codex/settings.json               Shared Codex config: the TypeSafe plugin. Committed on purpose.
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

### `.Codex/` — shared Codex config

`.Codex/settings.json` is **tracked on purpose**. It declares the `typesafe-ai`
marketplace and enables the `typesafe` plugin, so working on this repo brings
that skill with it rather than every machine being set up by hand.

- **Cloning does not finish the job.** Trusting the folder adds the marketplace with no prompt, but Codex will not auto-install a plugin that comes from an external source: it reports the plugin as not installed and prints the command. Run `Codex plugin install typesafe@typesafe-ai` once per machine. `Codex plugin disable typesafe@typesafe-ai` opts out locally without touching the repo.
- **Keep that file to plugin declarations.** Everything in it reaches everyone who clones — no `env`, no `permissions`, no `hooks`, no secrets. Personal overrides belong in `.Codex/settings.local.json`.
- **`.Codex/` is not ignored wholesale.** `.gitignore` names only `.Codex/*.local.json` and `.Codex/launch.json` as per-machine, so a project skill or agent added under `.Codex/` **can** be committed — and a machine-local file nobody thought to name shows up as untracked rather than being silently swallowed. It was ignored wholesale until 2026-09-18, which is why nothing about how this project is worked on could be shared through the repo.
- **What the plugin is**: one MIT-licensed skill of vendor documentation for the TypeSafe API — no hooks, no MCP servers. It carries an always-on context cost in every session; run `Codex plugin details typesafe@typesafe-ai` for the current figures rather than trusting a number written here. It fetches live docs from `docs.typesafe.ai` when it fires, so it is no use offline.

---

## 8. Figma MCP working rules

1. **Map tokens to `design/jobtriage.tokens.json`.** Never the root file.
2. **Target `ui-kit/src/v2/components/` for Code Connect.** It is the only real component layer; `index.html` is not componentised and the `.dc.html` boards are snapshots.
3. **Emit `var(--token)`, never hex.** A generated literal hex is a defect even when the value is correct — it breaks the light theme, which redefines the same names.
4. **Set `data-palette="v2"` on the root of anything generated**, or its accent tokens resolve to nothing.
5. **Check the generated frame against the three colour rules** (§1). An accent on a score, or two accents on a row, is a design error to raise, not to implement.
6. **A token change is three edits**: `design/jobtriage.tokens.json`, `ui-kit/src/v2/tokens.css`, `index.html` `:root` (both themes) — plus `legal.css` if it is one of the six tokens that file carries. Do it in one commit, then run `node scripts/selfcheck-tokens.js` (§1), which verifies exactly this.
7. **Match the runtime you are in.** React + TS in `ui-kit/`; vanilla ES2020 with no dependencies in `index.html`. Never convert one into the other.
8. **Before finishing**, run the whole harness. There is no test framework and
   no build for the app, so these scripts are the only proof a change works:

   ```bash
   node scripts/selfcheck-rows.js       # job/profile <-> typed row round trip
   node scripts/selfcheck-sync.js       # save/load/migrate cycle, two-tab cases
   node scripts/selfcheck-boards.js     # board search pipeline
   node scripts/selfcheck-tokens.js     # token drift across the four consumers
   node scripts/eval-matcher.js         # matcher metrics vs the committed baseline
   node scripts/pipeline-map.js --check
   node scripts/selfcheck-icon.js       # needs Obsidian; SKIP is not a pass
   cd ui-kit && npm run build && npm run selfcheck   # must print 17/17
   ```

   Each must print `ALL PASS`. Three notes that have cost time before:
   - The icon check needs Obsidian running. `PASS (with skips)` means the
     rendered half did not run, so if you touched `icon.svg` or a token it
     names, start Obsidian and run it again.
   - `eval-matcher.js` **does not call a model**: `scripts/eval/cases.json`
     carries recorded answers, so the metrics move only when this repo changes.
     Re-record those fields from a live run to re-measure the model.
   - The pipeline check needs **nothing but the repo** — it reads source only and
     never touches the vault, so it has no skip state and no excuse for a red
     one. Note the `--check`: the bare command writes notes, which is not a
     verification step.

   This list was four checks until 2026-09-24; `selfcheck-rows`, `selfcheck-sync`
   and `eval-matcher` were added on 2026-09-22 and went unlisted here.

---

## 9. Parse MCP — how this project calls it

Parse (<https://parse.bot>, docs <https://docs.parse.bot>) turns a website into a
typed API. The account holds **"monsterindia.com API"** (slug
`monsterindia-com-api`), whose first endpoint is `GET search_jobs` — full-text
search over **foundit.in** listings, paginated by `offset`/`limit`, filtered by
location, experience and freshness.

**Registration is deliberately machine-local.** It was added with

```bash
claude mcp add --transport http parse "https://api.parse.bot/mcp"
```

which writes to `~/.claude.json` under this project, **not** to
`.claude/settings.json`. That file is committed and §7 keeps it to plugin
declarations only — no `env`, no servers, nothing that reaches everyone who
clones. Anyone else working here runs that one command themselves.

**Two ways in, two credentials.** The MCP server is account-wide: one connection
exposes the platform tools (`search`, `build`, `inspect`, `call`, `revise`) plus
every API in the account as a tool group. It authorises over OAuth — run `/mcp`,
pick `parse`, approve in the browser. The REST API takes a key instead:

```
POST https://api.parse.bot/scraper/{scraper_id}/{endpoint_name}
X-API-Key: pmx_...
```

**The key is read from `PARSE_API_KEY`, never hard-coded and never committed.**
Locally it lives in `.env.local` beside `TYPESAFE_API_KEY` (gitignored by
`.env*.local`); on a server it is an environment variable like any other secret.
Keys are issued at <https://parse.bot/settings>.

**Know the overlap before you wire it into search.** foundit.in is already
covered by the `indiatech` scraper (`supabase/functions/api/index.ts`), whose
`boards` are `["instahyre", "cutshort", "foundit"]`. Adding this as a search
source would buy the same postings twice unless Foundit is dropped from that
actor first. Its real value is as a *cheaper or richer* read of Foundit, not as
a new site — measure it against `source_yield.inr_per_exclusive_50` like any
other source before believing otherwise.

---

## 10. Mantiks — how this project calls it

Mantiks (<https://mantiks.io>) tracks hiring activity: jobs aggregated by
company, with contacts and reposting history attached. Base URL
`https://dashboard.mantiks.io/api/v2`, auth header `X-API-KEY`.

**The key is read from `MANTIKS_API_KEY`**, which lives in `.env.local` beside
`TYPESAFE_API_KEY` and `PARSE_API_KEY` (gitignored by `.env*.local`). Never
inline it — the snippet this was set up from carried the key in the source, and
that key should be treated as burned.

```bash
set -a && . ./.env.local && set +a
curl -s https://dashboard.mantiks.io/api/v2/credits/balance -H "X-API-KEY: $MANTIKS_API_KEY"
# {"leads_credits":50}
```

### Credits

| Endpoint | Credits |
| --- | --- |
| `POST /searches/preview`, `POST /searches` | **0** |
| `GET /locations/search?query=` | 0 |
| `GET /jobs/{id}`, `POST /companies/{id}/jobs`, `GET /jobs/{id}/history` | 1 |
| `GET /jobs/{id}/best-fitting` | 1 **if a contact is found** |

The account holds **50 leads credits**. That is ~50 contact lookups, so prototype
against `/searches/preview`, which is free and returns real rows.

### The request schema is undocumented — this was read off the validator

There is no public spec (`/openapi.json` 404s, `/docs` redirects to login). The
shape below was recovered by POSTing `{}` and reading the 400s back, which is
also how to recover it again when it changes. **Every field is required**; there
are no optionals, so a partial body is always a 400.

```jsonc
{ "job":     { "locations": [{ "id": "1269750", "radius": 0 }],  // id from /locations/search
               "job_title_query": "data engineer",
               "job_title_include": [], "job_title_exclude": [],
               "description_include": [], "description_exclude": [], "description_query": "",
               "published_date_window_days": 30,   // one of 1|7|15|30|90|180|360
               "volume": { "gte": 1, "lte": 1000 }, "is_reposting": false },
  "company": { "size": { "gte": 1, "lte": 100000 },
               "sectors": [], "sectors_excluded": [], "websites": [], "websites_excluded": [],
               "exclude_consulting_recruiting": false },
  "people":  { "has_valid_email": false, "allow_missing_people": true,
               "persona_strategy": "best",   // "all" | "best"
               "phone": false } }
```

Locations are objects, never strings: resolve a name through
`GET /locations/search?query=India` first and take the row whose `type` is
`country`, `region` or `city` as appropriate.

### What it is and is not, for this app

It is **company-shaped, not seeker-shaped**: a preview returns companies with a
representative job and a `matching_jobs` count, and the `people` block is about
emails and phone numbers. It is a prospecting tool, so do not reach for it as
another board in `searchAll`.

Three parts of it are worth more to this app than its search is:

- `GET /jobs/{id}/best-fitting` — one credit for the contact the HR finder
  currently spends `COST.apifyQuery * 3` (~₹0.90) of Google queries to guess at.
- `GET /jobs/{id}/history` and `job.is_reposting` — whether a posting has been
  re-posted. Nothing else in this app can know that, and it speaks directly to
  `--closing` and to reachability: a role advertised four times is either hard to
  fill or not real.
- `POST /searches` — a saved search with **scheduled exports**, which is the
  daily new-jobs feed `scripts/index/` was written to prove. JSearch has no such
  endpoint; this does.
