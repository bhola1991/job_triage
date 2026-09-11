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
| go | `#56C88A` | `#157F42` | Do this now. The only fill-weight button. |
| due | `#E2685C` | `#C33B2E` | Overdue — past the follow-up date. |
| closing | `#D9A441` | `#8A6314` | Posting old enough to be filled soon. |
| awaiting | `#57AEC9` | `#1E6C86` | Sent; the next move is theirs. |

Three rules:

1. A row carries at most one accent. If a job is both closing and overdue, the nearer deadline wins and the other becomes plain text.
2. Score is never an accent. Colour says what to do; the number says how good it is.
3. Dark states the accent on the row edge; light tints the whole cell.
