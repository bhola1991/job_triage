# Job Triage — design files

Drop-in design artefacts. Every `.dc.html` opens directly in a browser; `support.js` must sit beside them.

| File | What it is |
| --- | --- |
| `Job Triage Mockups.dc.html` | The mockup board. Turn 3 (top) is current: queue, job detail, and the colour doc. Turns 2 and 1 are earlier rounds, kept on the superseded ground. |
| `Ground 18211C.dc.html` | The adopted palette on one page — the queue in dark and light. This is the reference screen. |
| `Colour wheel.dc.html` | The hue picker the palette was chosen from. |
| `jobtriage.tokens.json` | The tokens. Design Tokens format, `global` / `dark` / `light` sets. |
| `support.js` | Runtime the `.dc.html` files load. Keep alongside them. |

## The palette

Ground `#18211C` — near-black, green rather than neutral. Light is the same hue inverted: `#F1F5F2` paper with `#18211C` as the ink.

Four accents, one instruction each:

| Role | Dark | Light | Means |
| --- | --- | --- | --- |
| go | `#56C88A` | `#147A3F` | Do this now. The only fill-weight button. |
| due | `#E2685C` | `#BE3A2D` | Overdue — past the follow-up date. |
| closing | `#DEAF57` | `#8A6314` | Posting old enough to be filled soon. |
| awaiting | `#75BDD3` | `#1E6C86` | Sent; the next move is theirs. |
| closed | `#3E4F44` | `#B6C4BC` | Grey: the absence of an instruction. |

These are copied from `jobtriage.tokens.json`, which is the authority. Four of
them moved on 2026-09-18 to clear AA as text on their own tint, and this table
went unchanged until 2026-10-13 — if the two ever disagree again, the JSON is
right and `node scripts/selfcheck-tokens.js` says whether the app agrees with it.

Three rules:

1. A row carries at most one accent. If a job is both closing and overdue, the nearer deadline wins and the other becomes plain text.
2. Score is never an accent. Colour says what to do; the number says how good it is.
3. Both themes tint the row; dark states the accent on the row's edge as well. Dark's wash is about a quarter the weight of light's, because the same tint reads far louder on a near-black ground.

## The layout — apply-first

The colour law says what a row means. This says where things go. It shipped in
`index.html` between 2026-10-04 and 2026-10-05, and one rule drives all of it:

**The row's filled button is the thing you came here to do.**

### One column of work

The queue owns the screen. Everything that gets *more* jobs — search, scoring,
keys, data — is supply, and lives in a drawer opened by `Find work & tools`: off
the left edge on a desktop, up from the bottom on a phone. It is a drawer and
not an icon rail because it holds a text field and a drop target, and every
control stays in the DOM, where the command palette finds it by id.

One job is read in a pane **beside** the queue, never inside it: a third column
from 1200px up, a bottom sheet below that. Rows do not move when it opens.

The top bar, left to right: the tools button, who you are, Direction, the day's
floor, status pills, theme, Commands, account. Direction is in the bar because
changing it re-ranks every job held — a lens over the tool, not a tool in it.

### The row

Rank, title, fit · reach, one fact, then: one filled button, `Read`, and `⋯`.

| Row state | Filled button | Behind `⋯` |
| --- | --- | --- |
| new, posted, link saved | `Apply ↗` — opens the posting and marks it sent | Mark applied without opening · Draft outreach · Find contacts · Not interested |
| new, posted, no link | `Mark applied` | Draft outreach · Find contacts · Not interested |
| new, cold | `Write the DM` | Mark contacted · Find contacts · Not interested |
| sent, overdue | `Write the chase`, in `due` | — (`They replied` sits beside it) |
| sent, not yet due | none filled; `Chase on <date>` in `awaiting` | — |
| in conversation | `Log a note` | — |
| closed | none; `Reopen` | — |

A row with no filled button is saying it is not your move. `⋯` is always
visible, never revealed on hover: hover does not exist on a touch screen.

### The queue

Unapplied: **Do these first** · **Closing soon** · **Worth a shot**, then folded
**Below the bar** and **Not scored yet**. Applied: **Overdue a chase** ·
**In conversation** · **Awaiting them**, then folded **Closed**.

A fold may hide rows. It may not hide a control.

### Surfaces, one job each

| Surface | For | Dismissed by |
| --- | --- | --- |
| Pane / sheet | Reading and acting on one job | Close · Esc · the scrim where it overlays |
| Command palette | Any verb in the app — `⌘K`, `/`, or `Commands` | Esc · picking one |
| Modal | A decision that blocks, or is destructive | An explicit button |
| Toast | What just happened, with Undo — every row change gets one | 9s · Undo · Dismiss |
| Drawer | Finding work and tools | Close · Esc · the scrim |
| Feedback corner | Reporting what broke; carries the toasts inside it | Its own close |

Never open a modal the person did not ask for. A palette entry dispatches by
clicking the real control, so it cannot drift from what the button does.

Layers, bottom to top: `#tasks` 40 · `#scrim` 43 · `#toolbar` 44 · `.side` 45 ·
`#panescrim` 46 · `.pane` and `#fb` 47 · `.palscrim` 48 · `.palbox` 49 ·
`.modal` 50.

### The day's floor

Three dots in the top bar, one per application or cold approach sent today. A
floor, not a streak: it resets every morning and nothing is lost by missing it.

### Keyboard

`j` / `k` walk the queue and the pane follows; arrows do the same once a row is
selected, and scroll the page before that. `Esc` closes the pane, then the
drawer. `⌘K` or `/` opens the palette. Nothing applies from the keyboard yet.

### Width

1240px: row facts drop under the title. 1199px: the pane becomes a sheet.
900px: the drawer becomes a bottom sheet and a thumb bar appears. 640px: rows
stack fully; the bar drops every pill but overdue, and the Commands button.
Touch targets in sheets are 44px.
