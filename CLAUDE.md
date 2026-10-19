# Job Triage — design system rules

Guidance for working on this codebase, and for importing Figma designs through the
Figma MCP server. Every claim below was checked against the files on
2026-09-15, §§1, 2, 7 and 8 again on 2026-09-18, §§7 and 8 again on
2026-09-24, the counts in §§3, 6 and 7 on 2026-10-08, and the palette, the
rail and §5 on 2026-10-14; file:line
references are the authority, not this summary.

Two of those counts had gone stale by a wide margin and are worth knowing as a
caution about every other number here: `index.html` was described as ~4,670
lines when it had reached 6,748, and `components.css` as 163 when it was 176.
Nothing checks the prose in this file. Where a claim can be checked by a script
it is — §1 and §8 list those — and where it cannot, treat it as dated.

---

## 0. Read this before importing anything from Figma

**Two palettes exist in this repository. Only one is shipped.** Picking the
wrong one is the single most likely way to break this codebase, because the
stale file has the more obvious name and sits at the repository root.

| Palette | Ground | Where it lives | Status |
| --- | --- | --- | --- |
| **v2 "go/due/closing/awaiting"** | `#111315` (night) / `#F4E1D2` (salmon paper) | `design/jobtriage.tokens.json`, `ui-kit/src/v2/tokens.css`, `index.html` `:root`, `legal.css`, `icon.svg`, `manifest.json` | **SHIPPED — use this** |
| v1 "signal/good/live/warn" | `#0E1411` | `job-triage.tokens.json` (repo root), `*.dc.html` at repo root | Superseded |

(A third, pre-v1 blue-grey ground `#131A21` survived in `icon.svg` and
`manifest.json` until 2026-09-15, when both were brought onto v2.)

Verified: `index.html:34` sets `--ink:#111315`, matching `design/jobtriage.tokens.json`.
(The v2 ground was a green near-black, `#18211C`, until 2026-10-14; the names
and the law did not change, only the values. An artboard on that ground is
out of date, not the code.)
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
--go:#4CC76B;      /* v2 */
--signal:#4CC76B;  /* v1 alias — same hue */
--warn:#FF7A70;    /* == --due */
--live:#4CC76B;    /* == --go */
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

Five of the eight pairs once did not, and nothing noticed until 2026-09-18.
That is why `scripts/selfcheck-tokens.js` asserts **all sixteen** pairs: each
accent as text on its chip and on its row, in both themes. On the palette
adopted 2026-10-14 every tint is **opaque** in both themes, so a chip no longer
depends on the surface under it, and the rows are plain cards (`-row` equals
`--panel`). The measured floor is paper `--due` on its tint at **4.71:1**;
paper `--go` on its tint is 5.20 and everything at night clears 5.8. Treat the
paper red as the one with least room: lighten `--due-tint` or brighten `--due`
and it fails.

Two ways to fix a failing pair, and which is right differs: **move the accent**
(hold hue and saturation, shift lightness — keeps the meaning) or **move the
wash** (when the accent cannot move without changing colour). Run the check
after either.

### Three colour styles: salmon paper, blush, night

The theme button (`#btnTheme`, labelled "Colours") cycles `auto → light →
blush → dark`. `auto` follows the device: salmon by day, night by night.

- **Salmon paper** is the light theme — the pink-brown of a financial daily,
  adopted 2026-10-15 because the near-white before it was too bright. It is
  the one light set in `design/jobtriage.tokens.json`, so the kit and
  `legal.css` carry it too.
- **Blush** is app-only: `:root[data-theme="light"][data-paper="blush"]` in
  `index.html`, a pinker ground a shade darker than salmon. It rides on the
  light theme, so every rule written for light still applies; it only re-points
  values. It is not in the tokens file and `selfcheck-tokens.js` does not see
  it — its contrast was checked when it was set (floor: `--due` on its tint,
  4.76). If you change it, check the same pairs by hand.
- **Night** is the dark theme, neutral charcoal.

On paper `--line` is a warm near-black (`#2B211C`), close to `--text`, which
is what draws every card and button with a true outline; at night it is a mid
grey (`#59616A`), because a light outline on charcoal would shout. Do not
"fix" the themes to match. Night's surfaces carry no hue; `--muted` (`#AEB4BA`)
clears AA on all three of them.

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
| `--go` | `#4CC76B` | `#1C6B38` | Do this now. The only fill-weight button. |
| `--due` | `#FF7A70` | `#B02E2A` | Overdue — past the follow-up date. |
| `--closing` | `#F5B700` | `#7A5000` | Posting old enough to be filled soon. |
| `--awaiting` | `#8FA2FF` | `#2A45AC` | Sent; the next move is theirs. |
| `--closed` | `#4A5058` | `#BFAEA2` | Grey = the absence of an instruction. |

Three rules a Figma import must not violate:

1. **A row carries at most one accent.** Both closing and overdue → nearer deadline wins, the other becomes plain text.
2. **A score is never an accent.** Colour says what to do; the number says how good it is. Reachability stays grey — a second axis, not a verdict.
3. **The accent is on the row's edge; the card stays plain.** A row is a white (or charcoal) card with a 1.5px outline and a solid 5px edge in its accent, in both themes. Every `--*-row` equals `--panel`. Rows were tinted until 2026-10-14; an artboard that washes the whole cell is out of date, not the code.

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

`index.html` is ~8,240 lines: markup, CSS and application JS in one file. `README.md`
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
  The map's direction hues, `--dir-0` to `--dir-3` (purple, magenta, gold, teal), are in the same position (app-only, both `:root` blocks; blush rides on light). They were picked to stay clear of the four accents and pass the dataviz palette validator against `--panel` in all three colour styles (lightness band, chroma, colour-blind separation of neighbours, 3:1). Re-run it if you change one. `--fresh-0..3` are no longer drawn on the map: freshness is now how solid a dot is (`FRESH_FILL`).
  One of those five is not in the source of truth: **`--cold` is defined only in `index.html`'s two `:root` blocks** (`index.html:53` dark, `:98` light) and appears in neither `design/jobtriage.tokens.json` nor `ui-kit/src/v2/tokens.css` nor §1's token vocabulary. A change to it has nothing upstream to drive it, so `selfcheck-icon.js` reads it from the app and says so. `--plot-fade` (`index.html:2944`) is in the same position. Promoting both is the real fix.
  Its comment must not contain a `--` sequence: XML forbids a double hyphen inside a comment, and it silently makes the whole file an unparseable broken image. Write token names without their leading dashes there.
  Two constraints on its geometry, both easy to undo by accident:
  - **The rim is load-bearing.** The ground is 1.27:1 against a black home screen and 1.03:1 against iOS dark, so without a `--line` rim the tile has no edge and dissolves into the wallpaper. Do not remove it. Inverting to a light ground is not the fix — it fails on a white background in exactly the same way.
  - **Every mark must sit inside the maskable safe zone**, the centred circle of 80% width (radius 204.8 of 512), because the manifest declares `purpose: "any maskable"` and Android crops to it. The content group is scaled `0.92` about the centre for exactly this reason; at full size the axis elbow and both ends reach 222 and get sliced off. Measured: the scaled axes reach **203.7 against the 204.8 limit — a margin of 1.1px in 512**. Treat that as a floor, not as headroom; `selfcheck-icon.js` flags it even while passing.
- The rail's icons: one `IC` map of path data in `index.html` and one `ic(name)` that wraps a path in the convention below. Thirteen today (`tools compass check clock glass send list command inbox chat moon coin exit`). To add one, add a path to `IC`.
- One data plot, `viewBox="0 0 W 420"`: `sizePlot()` sets W (640 to 1000) from the window so the plot fills its card, and scales the axis text on a narrow screen.
- `CAST`, the three people and their car as one static inline SVG (see below).

The convention, which `ic()` applies so nobody has to retype it:

```html
<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">…</svg>
```

24×24 viewBox, `currentColor` stroke so it inherits the token colour, no fill.

### The rail replaced the top bar

Everything the top bar held is in `<nav class="rail" id="rail">`, down the
left edge: 76px of icons, each with a short word under it and count badges,
296px with words when opened. Order: the views first, then Direction and
**Work model** (`#btnWork`, feedback #16), then **More**, which holds profile,
Search & tools (`#tbOpen`), Commands, Replies, Feedback, Colours, Credits and
Sign out (`.r-more`, shown by `.rail.more`). There is no "Find work" item any
more (2026-10-18): searching is a "Find more work" button inside the Map and To
decide (`[data-findmore]`, opens the same drawer), and the work model is said
back in one line at the top of the Map and Companies (`workStrip`). Since
2026-10-17 nothing in the rail is a status-only item: the day's count and the
overdue/closing/awaiting counts went (feedback #14, "cannot click"); their
numbers are badges on To decide and Applied.

- **Every control kept its id** (`tbOpen`, `trackSel`, `btnPal`, `btnTheme`, `btnFeedback`, `btnCredits`, `btnSignOut`, and `btnReplies` when inbound mail is live), because the command palette dispatches by clicking them. Do not rename or duplicate one.
- **The views live in the rail, not in tabs** (since 2026-10-17): To decide (home since 2026-10-19), Companies, Applied, Dashboard — ids `viewDecide viewCompanies viewApplied viewDash`, each with its count. **There is no Map view any more** (feedback #21): the map is a layer of To decide — beside the list in a sticky right column at ≥1100px (`.decide`, `.dmap`; a job's pane takes its place while open), and on a narrower screen behind a "Map" button that opens it above the list (`MAPON`, `#mapToggle`). While the map is zoomed or filtered to a Key line, the list is exactly the jobs in its view, from every direction, with a "Showing the N in the map's view · Show all" line (`.mapnote`, `[data-mapclear]`). A hidden `#viewMap` stays so the command list's "Map" (and anything that clicks it) opens To decide with the map. Inside To decide a pinned Key sits under the plot, not beside it. The tab row and the Posted / Cold filter are gone; sort is one "Sorted by" select.
- **The map is the centre.** One plane with everything on it — every direction, waiting and applied, companies to approach (`mapItems`). Before applying, a dot's colour AND shape say its direction (`dirColour`, `dirShape`, both by the direction's place in the profile, so a direction looks the same whichever is picked; untagged jobs count as the picked one), and how solid it is says how fresh it is; after applying, its colour is the colour law. Hovering the **Key** tab on the map's right edge pops up a panel (clicking pins it open; pinned, it sits beside the plot on a wide screen, and pinned/unpinned is remembered in `triage:mapkey`) listing every class — where it stands, posted, direction, kind of work (`FAMILIES`) — counted over what is in view. Hovering a line lights only those dots (each dot carries `data-st data-fresh data-dir data-fam`, from `dotKeys`). **Clicking a line makes the map that class** (`MAPSEL`, `selectClass`): only its dots, framed to fit, a step on the trail, until another line is clicked, the same line again, "Show everything", or the trail's first step. The Dashboard's direction rows use the same. Scrolling zooms about the pointer, one trail step per run of scrolling; dragging a box zooms to the box; any step of the trail goes back. **On a phone** (feedback #17, #18) the plot is taller than wide (`sizePlot`, `PHONE()`), dots are 1.3x, it opens on where the jobs are (`BASE = fitFrame(...)`, trail "Where your jobs are"), two fingers pinch about their midpoint, one finger pans once zoomed (unzoomed it scrolls the page: `touch-action:pan-y`, `.zoomed` takes it), and a double tap steps back. Headless tests drive this with `Input.dispatchTouchEvent` under `Emulation.setTouchEmulationEnabled`. Hovering a dot shows `#mapTip`; clicking it opens the pane. The map has no list of its own; To decide's list is the list. Unzoomed, it follows the picked direction (`inDir`, from `job.dir`, set when a job is scored).
- **Open pushes, it does not cover**, at every width where the rail is a column (above 900px): `.rail.open ~ .wrap` takes a 296px margin. It pushed only from 1200px until 2026-10-15, which meant it covered the queue on most laptops. Below 1200px the decision pane is a sheet over the page, so the queue still has room. On a screen under 800px tall the drawing at its foot is hidden rather than cut off.
- **On a phone (≤900px) it is a strip along the bottom** that pulls up into a sheet, by its handle (`#railGrab`) or a swipe. It replaced `#toolbar`.
- **On a phone the Unapplied tab is a swipe deck.** One job at a time, in the queue's own order (do these first, closing, worth a shot, below the bar), swiped like a dating app: right saves it, left passes it, and the filled button between the two still does the job's one action. The bands are hidden on a phone; the folds stay. The Applied tab keeps its per-section carousels (`.qcar`, scroll-snap, position kept in `CAR`).
- **Saved is an event, not a column.** `isSaved(j)` looks for a `kind:'saved'` entry in the job's `events`, so it syncs with the row, shows in its history, undoes through `snapRow`, and counts as history, so a saved job is never purged as untouched. Saved jobs sit in their own section at the top of Unapplied at every width, and every new row's ⋯ menu has "Save for later".
- **Passed is local.** A left swipe changes nothing about the job; the key goes into `localStorage` `triage:passed:<profile>` so it stays out of the deck on this device, and "Go through them again" clears it. Back undoes the last pass.
- **Open is remembered** (`localStorage` `triage:rail`) on a wide screen only; on a phone open is a sheet, and a sheet must not be the first thing a page shows.
- **The avatar is neutral, the badges carry the accents.** A badge is a count of rows in that state, so its colour means what the row's edge means.
- **Closed, the direction picker is the compass**: the native `<select>` lies invisibly over the icon, so one click opens the list with no scripted menu.

### The views share one language (2026-10-17)

Every view is a slice of the map and behaves like it: **hover tells, click does.**

- **Direction is identity, never instruction.** `dirMark(id)` draws a direction's colour and shape (the map's own) on job rows, company cards, the map's in-view list and the Dashboard's "By direction" table — only when a profile has two or more directions.
- **At rest a row shows its one button.** On a pointer screen (`@media(hover:hover)`) a waiting row hides Read and ⋯ until hover or focus, and shows a thumbnail of the map with its dot (`.qmini`); an applied row shows its last three events on hover (`.qhist`). Touch screens see everything, always.
- **Keyboard triage in To decide:** j/k walk (existing `moveSel`), Enter presses the row's primary button, s saves, x closes it as not interested and moves to the next. They click the row's own buttons, so logging and undo are the same as a click.
- **One row, one section, everywhere.** To decide's markup is the house style: `jobCard` for jobs, and `rowCard({acc, rank, title, sub, facts:[2], acts, st, pop})` + `sectOf(acc,title,sub,n,inner)` for anything else (a company, a direction, a pipeline stage, a logged event). The Map's in-view list, Companies ("Ask someone you know" in green, "Approach cold", "From your network") and every Dashboard section are built from them. Do not add a new card style; extend `rowCard`.
- **Companies:** the row edge is green only when you know someone there (the instruction is "ask them"); one filled button; who you know and the full company read are the row's hover popover (`pop`). Setup is one strip (`.costrip`).
- **The Dashboard opens on its top (`dashTop`, feedback #19):** four numbers (sent this week, replies this week, reply rate ever, waiting on you), "Sent each week" over the last 8 rolling weeks with one line per direction in its hue AND map shape (a ring = a reply that week; points carry `data-tip`, shown in `#dTip`), and "Where everything stands", direction × stage, each cell a grey count whose click opens the map on that slice (`selectClass` with a second class, `MAPSEL.test`). Its panes are `.dpane` — `.dcard` is the phone swipe deck's card, do not reuse it. The rows follow below.
- **The Dashboard's counts are grey.** "By direction" (found, sent, replies, reply rate) is the one question the pipeline cannot answer; its button zooms the map to that direction (`zoomToClass`), and each pipeline stage opens its view.
- **The next-step banner** shows on To decide and Applied only.
- **Your CV for this job** (`tailorCv`, `showCv`, banner "the CV, tailored to one job"): from the job pane's rail or a row's ⋯ menu. One AI call reorders and rewords the person's own CV (`p.raw`) around the posting and returns `{cv, changes, gaps}`; gaps — what the posting asks for that the CV does not show — are said to the person and never written into the CV. Saved on the job as `j.cvt` (JSON, carried in extras), editable in place, and "Download as PDF" is a print window (the browser's own Save as PDF; no library).
- **Dialogs take the app font from `.modal`.** They are appended to `<body>`, outside `#app`; before 2026-10-19 every dialog rendered in the browser's serif.
- Headless Chrome reports no hover pointer and cannot emulate one, so hover CSS never fires in a CDP test; swap `@media(hover:hover)` for `@media all` in a test copy to check it.

### The selected row blows up

A selected row (`.qitem.sel`) keeps exactly two things: the job's name, large,
and its one button. Rank, scores, Read and the ⋯ menu are hidden on that row,
because the pane beside it already shows all of them. `primaryAct(j,i)` is the
single source of that button — the row leads with it, the blown-up row keeps
only it, and on a small screen the sheet's header (`.pane-pri`) repeats it.
If a state's primary action changes, change it there and nowhere else.

That row and the sign-in card are the **only two hard offset shadows**
(`5px 5px 0 var(--hard)`) in the app. A third stops meaning "this one".

### The people

`CAST` is the three job seekers and their car: the felt-pen drawings
themselves, traced to flat-colour paths (one potrace layer per colour) and
recoloured onto the cast's own hues. The marker's wobbly outline is kept on
purpose; the colours are not the marker's. They stand at the foot of the open
rail on a light tile (`--tile`) in **both** themes, since they are ink on paper.
Their colours are hard-coded in the SVG and are not tokens: a yellow shirt says
nothing about a closing job. The palette is fixed: ink `#14181A`, yellow
`#F5B700`, red `#E5484D`, blue `#2F5BEA`, green `#1F9D55`, brown `#6B4A2F`,
window grey `#B9C6D3`, and the three skin tones `#F2B79C` `#8E5B3D` `#C98A68`.
`--brand` (purple) is the one brand colour and is likewise not an accent.

All the art is one `ART` object in `index.html` (`cast` = the three people and
the car as drawn, `car` = the car alone for the waiting scene, `woman` and
`girl` = the two poster characters, `they` = the lettering "they can't help
you.", `watch` = the standing woman in sunglasses, `juice` = the lettering "JOBS
with Juice", `man` = the standing man, `boy` = the standing boy), turned into markup by `artSvg(key, class, label)`. `CAST`, `AU_PEOPLE`, `CAR_SVG` and the empty states' `.empty-art` all
come from it, so a change to the drawings is one edit. The poster woman's robe
and hair sit on the magenta and teal direction hues (`--dir-1`, `--dir-3`,
light values); the girl's on the cast red, pink (`--dir-1`, night value) and
an indigo. The standalone sources are in `design/art/`. **Re-tracing them is
not scripted in this repository**: they were made once from photographs of the
drawings, so keep the SVGs rather than regenerating them.

It is about 202 KB of path data inline. That is the cost of keeping the
hand-drawn edge; do not add a fifth piece without simplifying the others.

**Do not add an icon dependency** (lucide, heroicons, react-icons) to either the app
or `ui-kit`. Inline the one path you need.

### The opening page and onboarding are always paper

The sign-in screen (`renderAuth`, `auScene`, the `.au-*` rules in `index.html`)
shows the three people the app is for, standing on a lined floor beside their
car, with signing in as a card on the same page. Reset, claim and recover use
the same frame. It began as a felt-pen drawing with a wavy sky and a wobble
filter; since 2026-10-14 it is the clean version of that — the same figures as
`CAST` (`AU_PEOPLE`, the same art), with the straight-line fill kept for the
floor alone.

**First-time visitors also get the lettered headline** ("they can't help you.",
`ART.they`) in `.au-hero`, passed to `auScene` only when the visitor has not
signed in here before. It stands between the card and the sun on a wide, tall
screen (1100px by 760px or more), sits as a short line under the card on a
phone, and is absent in between, where the card's own headline carries the
page. Returning visitors ("Welcome back.") and the reset, claim and recover
screens do not get it.

**A board search is the long wait, so it gets a second character.** `waitScene`
gives the wait a companion (`.wait.co`, `.wait-pal`): someone stands at the end
of a taller road and the car drives up to them, then starts over (`driveTo`). A
search (it has an id) gets the girl (`ART.girl`); the boot splash, shown while
the app waits on the network, gets the woman in sunglasses (`ART.watch`), who
watches. With neither the scene is the car alone. Under
`prefers-reduced-motion` the car parks.

**Two next-step banners carry a picture.** `nextStep()` marks the states that
have art (`art:'score'` for "N jobs not scored yet", `art:'clear'` for "Clear for
today"); `NEXT_ART` turns each into markup, and the banner is drawn inside a
`.nextrow` with the picture in a `.next-art` tile beside it. The picture is never
inside the banner, because the banner's edge carries an instruction colour. The
woman in sunglasses watches scoring; the girl and the "JOBS with Juice" lettering
mark a clear day. The tile is hidden under 700px. **Overdue and "a reply" have
no entry on purpose**: they wait for two poses that are not drawn yet (the man
glancing at a watch, the cast with both arms up). Add the art, then add the key
to `NEXT_ART` and `art:` to `nextStep()`; nothing else changes.

**"Sent." is a beat, not a rule.** When a job is marked sent, `stageChange`
asks `sentMoment()` whether this send earns a picture: the first three sends ever
in this browser (`triage:sentart`), and the send that reaches the day's target
(`DAY_FLOOR`). If so the toast is drawn with the man (`ART.man`) on a tile at its
left, "Sent.", "The next move is theirs." and an "n of 3 today" eyebrow; every
other send is the plain "Marked applied". Undo is always there. The man waits; he
does not cheer.

**"Saved on this device" is a calm card.** When a save only reaches this device,
`softNote(reason)` draws the woman in pink (`ART.woman`) on a tile beside the
message and a Try again button, instead of a red mono line. The reason is kept in
`SOFT` and drawn again after every render, because each render rebuilds
`#syncInfo`; it clears when a save gets through. It is a wait, not an alarm, so
there is no red and no warning colour.

**Each onboarding step has its own figure.** In `renderOnb` the band under the
top bar holds the cast only on "What we found"; on the other steps one person
stands over the right edge of the 680px column (`.au-solo`): the woman in pink
on "Your profile" (calm, beside the drop zone), the woman in sunglasses on "Pick
a direction" (looking), the boy on "What you want" (the newcomer, asking).
"What we found" keeps the cast until the man reading a sheet is drawn.

**The boy peeks over the map card until the first application is sent.**
`renderMap` draws `.map-peek` (head and shoulders on a tile tab at the card's top
right) while no job has left the `new` stage, i.e. for a newcomer. It ends the
moment anything is sent, closed or answered. It is a first-times beat: it is not
shown to anyone who has used the app.

- **It adds no image file.** Inline SVG plus two CSS pseudo-elements (the floor
  and the sun). §4's "zero `<img>`, zero `data:image`" still holds.
- **Its values are fixed, not read from `:root`.** `--au-ink`, `--au-paper`,
  `--au-gr` and the rest live on `.au-scene`, `.au-strip` and `.ob-paper` and
  hold salmon paper's values, so these screens stay salmon paper for someone whose
  device is set to night. Do not lift them onto `:root`.
- **The green button carries white text.** `--au-gr` is `#1C6B38`, 6.5:1 under
  white. (The marker green it replaced was 3.2:1 and had to carry ink.)
- **The card's hard offset shadow is one of the two in the product** — the
  other is the selected job. Buttons and fields here have none.
- **Onboarding is on the same paper** (`.ob-paper`, with the people as a strip
  across the top). It is done by re-pointing the app's tokens inside that
  wrapper, not by restyling components, so anything added to onboarding follows
  without work. Do not copy that wrapper onto any screen with rows.
- Dialogs opened from these screens are appended to `<body>`, outside the
  wrapper, so they render in whichever theme the app is in.
- Inside the app the people appear once, at the foot of the open rail. Anywhere
  else — an empty state, say — they stand on `--tile` and never on a row.

---

## 6. Styling approach

**Plain CSS with custom properties.** No CSS Modules, no styled-components, no
Tailwind, no utility classes, no CSS-in-JS. From `.design-sync/conventions.md`:
*"Compose with `var(--token)`, never a literal hex — there are no utility classes
and no styled-prop system."*

### Class naming

Short, flat, hand-written. No BEM, no hashing. The full `ui-kit` vocabulary
(`ui-kit/src/v2/components.css`, 176 lines):

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
index.html              The entire app — markup, CSS, JS. ~8,240 lines, no build.
config.js               Supabase URL + anon key. Empty = local-only mode.
legal.css               Shared by the five public pages.
STATUS.md               Where this stands: what is live, what drifted, what is measured. The gap-tracking document.
INTAKE.md               Build brief: asking the person what they WANT (intent, strictness, red lines). Specified, not built.
PLAN.md  AUDIT.md       Dated records of earlier briefs and findings. NOT rewritten as the project moves; read as of their own date.
src/index.js            Cloudflare Worker: POST /api/contact, else env.ASSETS.fetch().
src/reply-match.mjs     Inbound-mail decision logic. One copy, two consumers.
src/mime-lite.mjs       Just enough MIME to classify a mail. Hand-written: no root package.json.
pricing/terms/refund/privacy/contact.html
sw.js  manifest.json  icon.svg      PWA shell.
schema.sql  billing.sql             Supabase tables, RLS, credit functions, usage ledger.
supabase/functions/api/index.ts     Deno edge function: search, scoring, payments.
supabase/functions/reap-apify/      Cancels Apify runs nobody is polling. Needs pg_cron + pg_net; not scheduled.
supabase/migrations/                What has actually been applied to the live project, newest last. schema.sql is the shape; these are the history.
scripts/index/                      The OFFLINE CRAWLER, and the reason the corpus exists: 99.8% of job_index comes
                                    from here, not from a user's search. Parked outside the app -- nothing in
                                    index.html reads it -- and run nightly at 05:00 IST by GitHub Actions
                                    (.github/workflows/crawl.yml) since 2026-10-19; the laptop's systemd
                                    timer is disabled (it missed nights asleep). State between nights is in
                                    a PRIVATE Supabase Storage bucket, crawl-state (state.sh) -- never the
                                    repo, which is public. A manual run is dry unless dry=false.
  ingest.js                         Crawls 324 ATS boards across 6 platforms + 3 aggregator feeds. Per-host pacing.
  push-index.js                     Pushes to job_index: 35-day cap, thin-row refusal, retry-then-halve, 120s timeout.
  verify.js                         Liveness: a set difference over daily snapshots. Two absences close a posting.
  harvest-slugs.js  probe-ats.js    Finding new boards. probe-ats guesses a company's ATS; --write names orphans.
  sitemap-jobs.js  corpus-urls.js   Sitemap harvesting and the url list verify.js reads.
  probe-boards.js                   Can a job board be bulk-downloaded? robots.txt, job sitemap, feed, JobPosting data. Input: the boards profiles name.
  jsonld-boards.js                  Reads the boards sources.json "jsonld" lists: job sitemap, then JobPosting data or labelled fields per page. New pages only, cached.
  retrieve.js  validate.js          Local read and check helpers. No network.
  refresh.sh                        What the timer runs. Waits on the above, so a hang there cancels every later night.
  state.sh                          pull/push the crawl's state (checks.json, jsonld cache, sources.json, probe results)
                                    to the crawl-state bucket. pull REFUSES without checks.json: a fresh store re-dates
                                    every posting. Never run two crawls on one day -- the second doubles every absence.
  sources.json                      The board catalogue: greenhouse 150, ashby 84, lever 40, smartrecruiters 23, recruitee 19, workable 8.
scripts/compare-tiers.js            Top-K overlap between two models' rankings, from ai_model. A measurement.
scripts/record-deepseek.js          Scores the eval cases on a named tier (DEEPSEEK_API_KEY, from the SHELL).
scripts/check-jsearch-overlap.js    Whether a source returns postings the corpus already holds.
scripts/selfcheck-rows.js           Job/profile <-> typed row round trip.
scripts/selfcheck-sync.js           Save/load/migrate cycle against a PostgREST stand-in.
scripts/selfcheck-boards.js         Board-source check.
scripts/selfcheck-reply.js          Inbound-mail decision check. Offline, no model.
scripts/selfcheck-feedback.js       When the app asks for feedback: the gap, the back-off, the failure floor.
scripts/read-feedback.js            Reads public.feedback with the service role. The ONLY reader; RLS gives the app no view of it.
scripts/heartbeat.js                Is the LIVE system working? Corpus freshness, DeepSeek balance, Mantiks credits, whether the
                                    refresh unit is stuck. NOT part of §8: it needs the network and real keys. refresh.sh runs it last.
scripts/morning.sh                  heartbeat + read-feedback + insights, summarised as a desktop notification. Run at 09:00 by jobtriage-morning.timer.
scripts/insights.js                 What each beta tester did and where they stopped, from the tables plus public.activity. Rules and counts, no model. Reads only.
scripts/selfcheck-worker.js         The Worker's two public write routes, and pricing.html's prices against the code. Offline, stubbed env.
scripts/eval-matcher.js             Matcher metrics against scripts/eval/baseline.json.
scripts/record-eval.ts              Records what scripts/eval/ commits: --deepseek fills `recorded`, --jev writes judgments.json. Live, needs keys.
scripts/tune-flag-thresholds.js     FLAG_P sweep per code, offline against judgments.json. A measurement, not a gate.
scripts/eval/                       Recorded model answers + the committed baseline.
scripts/eval/cases.json             31 labelled postings. `expect.flags` = what to RAISE (DeepSeek's contract); `expect.codes` = what is TRUE per code, omitting what a posting does not determine. Read its _note before labelling.
scripts/eval/judgments.json         One raw Jev judgement per case, committed so the threshold sweep runs offline.
scripts/selfcheck-tokens.js         Token-drift check: all consumers vs design/jobtriage.tokens.json.
scripts/selfcheck-icon.js           Icon check: renders icon.svg and asserts colour + maskable geometry.
scripts/pipeline-map.js             Data-pipeline map: resolves code anchors, writes Mermaid notes to an Obsidian vault.
scripts/pipeline-map.spec.js        The declared topology — nodes, edges, anchors. Data only, hand-maintained.
.claude/settings.json               Shared Claude Code config: the TypeSafe plugin. Committed on purpose.
job-triage.tokens.json              ⚠ STALE v1 tokens. Not the source of truth.
*.dc.html  canvas.json              ⚠ Superseded v1 artboards (ground #0E1411).
design/
  jobtriage.tokens.json             ✅ THE TOKENS.
  Ground 18211C.dc.html             ✅ The reference screen.
  Job Triage Mockups.dc.html        Turn 4 (top, the map as home) is current; turn 3 holds the colour law; 1-2 superseded.
  Colour wheel.dc.html              The hue picker.
  README.md                         The palette, stated.
ui-kit/
  src/index.ts → src/v2/index.ts    Barrel exports.
  src/styles.css                    @imports tokens.css + components.css.
  src/v2/tokens.css                 [data-palette="v2"] token block.
  src/v2/components.css             All component CSS, 176 lines.
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

### `.claude/` — shared Claude Code config

`.claude/settings.json` is **tracked on purpose**. It declares the `typesafe-ai`
marketplace and enables the `typesafe` plugin, so working on this repo brings
that skill with it rather than every machine being set up by hand.

- **Cloning does not finish the job.** Trusting the folder adds the marketplace with no prompt, but Claude Code will not auto-install a plugin that comes from an external source: it reports the plugin as not installed and prints the command. Run `claude plugin install typesafe@typesafe-ai` once per machine. `claude plugin disable typesafe@typesafe-ai` opts out locally without touching the repo.
- **Keep that file to plugin declarations.** Everything in it reaches everyone who clones — no `env`, no `permissions`, no `hooks`, no secrets. Personal overrides belong in `.claude/settings.local.json`.
- **`.claude/` is not ignored wholesale.** `.gitignore` names only `.claude/*.local.json` and `.claude/launch.json` as per-machine, so a project skill or agent added under `.claude/` **can** be committed — and a machine-local file nobody thought to name shows up as untracked rather than being silently swallowed. It was ignored wholesale until 2026-09-18, which is why nothing about how this project is worked on could be shared through the repo.
- **What the plugin is**: one MIT-licensed skill of vendor documentation for the TypeSafe API — no hooks, no MCP servers. It carries an always-on context cost in every session; run `claude plugin details typesafe@typesafe-ai` for the current figures rather than trusting a number written here. It fetches live docs from `docs.typesafe.ai` when it fires, so it is no use offline.

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
   node scripts/selfcheck-reply.js      # inbound-mail decisions; offline, no model
   node scripts/selfcheck-feedback.js   # when the app asks for feedback
   node scripts/selfcheck-worker.js     # the Worker's public write routes
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
   `selfcheck-reply` was added on 2026-10-05.

   **These eight are all offline and all about code, and that is their limit.**
   On 2026-10-08 two things were broken in production at once and every one of
   them passed: the nightly refresh had been frozen for a day behind a socket
   with no timeout, and the DeepSeek account was at `402 Insufficient Balance`,
   so scoring and drafting were dead. Both failures look exactly like disuse.
   `node scripts/heartbeat.js` is the other kind of check — it asks the live
   system questions code cannot predict, needs the network and real keys, and
   is therefore deliberately NOT in the list above. `refresh.sh` runs it as its
   last step and exits non-zero on a problem, so systemd records a failure
   rather than a success.

   One note on `selfcheck-reply`: its fixtures are mostly near-misses on
   purpose, because what it guards is ground truth. `jobs.stage = 'live'` is
   the only record in this project that anybody ever heard back, so a *false*
   reply is unrecoverable in a way a missed one is not. If you change
   `src/reply-match.mjs`, mutation-test the check as well as running it — two
   of the obvious loosenings (dropping the bulk-header veto on a human cue,
   resolving an ambiguous company to the first match) each produce a false
   `live`, and each is caught today.

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
