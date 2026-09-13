## One palette: the colour law

This library is the design the Job Triage app ships: a green near-black ground and four accents, each meaning exactly one thing — **go** = do this now, **due** = overdue, **closing** = the posting is about to be filled, **awaiting** = sent, their move. Grey (`--closed`) is only ever the absence of an instruction.

Components (14): `TopBar`, `StatusPill`, `ColorKey`, `QueueSection`, `QueueRow`, `ActionButton`, `DetailHeader`, `StatGrid`, `ReasonPanel`, `FactRows`, `ContactRow`, `Timeline`, `Callout`, `PostingLink`.

**Every component sets `data-palette="v2"` on its own root node**, which is where the tokens live — so each is self-contained wherever you drop it. If you write your own layout wrapper that reads the tokens (e.g. `background: var(--ink)`), put `data-palette="v2"` on that wrapper too.

Three rules the components enforce, and your own layout should respect:
1. A row carries **at most one** accent. If a job is both closing and overdue, the nearer deadline wins.
2. A **score is never an accent**. A rank or fit figure is a number, not an instruction.
3. Dark states the accent on the row's edge; light (`data-theme="light"` alongside `data-palette="v2"`) tints the whole cell.

## Load-bearing: give components a real dark ground

The palette is **dark by default**. `QueueSection`, `QueueRow`, `DetailHeader`, `StatGrid`, `FactRows`, `ContactRow`, `Timeline`, `Callout` and `ColorKey` are intentionally transparent — in the app they sit on the dark page. **Never place them directly on a white canvas**: wrap the page in `<div data-palette="v2" style={{ background: 'var(--ink)' }}>` (or `var(--panel)` for a raised surface). Their text is near-white `var(--text)`, so on a light ground it is close to invisible.

## Behaviour worth knowing

- `QueueRow` takes `onOpen`: the whole row then becomes clickable and lifts on hover; clicks on its own buttons and links are left alone. Put a `Details` `ActionButton` in `actions` too, for keyboard users.
- `PostingLink` shows "open the original posting" when given a `url`, and a Google search for the title, company and location when the url is missing or the literal `"nan"`.
- `ColorKey` takes `counts` for `go`, `due`, `closing`, `awaiting`, `closed`.

## Token vocabulary

Compose with `var(--token)`, never a literal hex — there are no utility classes and no styled-prop system.

`--ink --panel --panel2 --line --hair` (surfaces) · `--text --muted --dim` (text) · `--go --on-go --go-line --go-tint` · `--due --on-due --due-line --due-tint` · `--closing --closing-line --closing-tint` · `--awaiting --awaiting-line --awaiting-tint` · `--closed` · `--shadow --shadow-md --shadow-lg` · `--disp --mono` (fonts).

## Where the truth lives

`styles.css` is the one stylesheet to import; it `@import`s `v2/tokens.css` and `v2/components.css`. Read it before inventing a class name — compose with the components' props rather than hand-writing their classes (`.qrow`, `.stat4`, `.pill2`…).

## Example

```tsx
import { QueueSection, QueueRow, ActionButton } from 'job-triage-ui';

<div data-palette="v2" style={{ background: 'var(--ink)', padding: 16 }}>
  <QueueSection title="Do these first" count={9} tone="go" note="sorted by rank">
    <QueueRow
      accentTone="go" rank={72} rankTone="go"
      title="Forward Deployed Engineer" subtitle="Sarvam AI · Bangalore · posted role"
      facts={[{ label: 'fit / reach', value: '82 · 54' }, { label: 'posted', value: '4d ago' }]}
      actions={<><ActionButton size="sm">Details</ActionButton><ActionButton tone="go" emphasis="fill" size="sm">Apply</ActionButton></>}
      onOpen={() => {}}
    />
  </QueueSection>
</div>
```
