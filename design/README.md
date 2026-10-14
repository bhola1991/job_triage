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

Night `#111315` (charcoal) and salmon paper `#F4E1D2` with `#211A16` ink (2026-10-15; the app also offers a darker pink paper, blush, on top of the light set). Night adopted 2026-10-14, replacing the green near-black `#18211C` that `Ground 18211C.dc.html` still depicts — that artboard shows the law and the layout of its day, not the current values. `jobtriage.tokens.json` is current.

Four accents, one instruction each:

| Role | Dark | Light | Means |
| --- | --- | --- | --- |
| go | `#4CC76B` | `#1C6B38` | Do this now. The only fill-weight button. |
| due | `#FF7A70` | `#B02E2A` | Overdue — past the follow-up date. |
| closing | `#F5B700` | `#7A5000` | Posting old enough to be filled soon. |
| awaiting | `#8FA2FF` | `#2A45AC` | Sent; the next move is theirs. |

Three rules:

1. A row carries at most one accent. If a job is both closing and overdue, the nearer deadline wins and the other becomes plain text.
2. Score is never an accent. Colour says what to do; the number says how good it is.
3. The accent is stated on the row's edge in both themes; the card behind it stays plain.
