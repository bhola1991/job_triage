## Two palettes, one package

This library ships **two design languages side by side** — pick one per screen, never mix them in the same composition:

- **v1** (12 components: `Button`, `SegmentedControl`, `ChannelTag`, `StageTag`, `Chip`, `Flag`, `FormField`, `Disclosure`, `FitReachMeter`, `EmptyState`, `Banner`, `JobCard`) — the currently-shipped app's palette. No wrapper needed; its tokens live at plain `:root`.
- **v2** (12 components: `StatusPill`, `ActionButton`, `QueueSection`, `QueueRow`, `DetailHeader`, `StatGrid`, `ReasonPanel`, `FactRows`, `ContactRow`, `Timeline`, `Callout`, `TopBar`) — the newer go/due/closing/awaiting queue-and-detail design. **Every v2 component sets `data-palette="v2"` on its own root node**, so it's self-contained wherever you drop it — you never need to add that attribute yourself.

Default which one you compose with by matching the screen you're building: a triage queue or job-detail screen → v2; anything closer to the existing app shell (profile, onboarding, a generic list) → v1.

## Load-bearing rule: components need a real dark ground

Both palettes are **dark-by-default** (`color-scheme: dark` at their root). Most primitives own their background (`Chip`, `Flag`, pills, `.job`/`JobCard`, `TopBar`), but several are intentionally transparent and only ever meant to sit on the app's dark page — `StageTag`, `Banner`, `EmptyState` (v1); `QueueRow`, `QueueSection`, `DetailHeader`, `StatGrid`, `FactRows`, `ContactRow`, `Timeline`, `Callout` (v2). **Never place these directly on a white/light canvas** — wrap them (or the page) in a container with `background: var(--ink)` (or `var(--panel)` for a slightly raised surface). This isn't cosmetic: their text color is a near-white `var(--text)` with no fallback, so on a light ground it is close to invisible.

Light mode exists for both palettes (`[data-theme="light"]` on an ancestor — combine with `data-palette="v2"` for the v2 set) and flips the same token names to readable values on a white ground instead.

## Token vocabulary

Compose with `var(--token)`, never a literal hex — both palettes are pure CSS custom properties, no utility classes, no styled-prop system.

v1 (default, unscoped): `--ink --panel --panel2 --line` (surfaces) · `--text --muted --dim` (text) · `--signal --signal-hi --on-signal --cool` (primary action) · `--warn --warn-line --good --good-line` (chip/flag verdicts) · `--posted --posted-dim --cold --cold-dim --neutral --neutral-line --live --live-line --stale-line` (channel/stage) · `--disp --mono` (fonts) · `--shadow --shadow-md --shadow-lg`.

v2 (`[data-palette="v2"]`): `--ink --panel --panel2 --line --hair` (surfaces) · `--text --muted --dim` (text) · `--go --on-go --go-line --go-tint` / `--due --on-due --due-line --due-tint` / `--closing --closing-line --closing-tint` / `--awaiting --awaiting-line --awaiting-tint` (the four status accents — each means exactly one thing: go = do this now, due = overdue, closing = posting about to fill, awaiting = sent, their move) · `--closed` (grey, absence of instruction). Rule the components themselves enforce: a row/card carries at most one accent, and a score/rank figure is never styled with an accent colour — accent means status, not quality.

## Where the truth lives

`styles.css` is the one stylesheet to import — it `@import`s `tokens.css` + `components.css` (v1) and `v2/tokens.css` + `v2/components.css` (v2), so every class and token above is reachable from it. Read it before inventing a new class name; every component's markup uses real, already-defined classes (e.g. `JobCard` renders `.job`/`.jrow`/`.jscore`, `QueueRow` renders `.qrow`/`.rank`/`.fact`) — compose with the exported components' props rather than hand-writing these classes directly.

## Example

```tsx
import { QueueSection, QueueRow, ActionButton } from 'job-triage-ui';

<div data-palette="v2" style={{ background: 'var(--ink)', padding: 16 }}>
  <QueueSection title="Do these first" count={9} tone="go" note="sorted by rank">
    <QueueRow
      accentTone="go" rank={72} rankTone="go"
      title="Forward Deployed Engineer" subtitle="Sarvam AI · Bangalore · posted role"
      facts={[{ label: 'fit / reach', value: '82 · 54' }, { label: 'posted', value: '4d ago' }]}
      actions={<ActionButton tone="go" emphasis="fill">Apply</ActionButton>}
    />
  </QueueSection>
</div>
```
