# Job Triage — intake brief: asking what the person wants

Self-contained. Hand this to an engineer or agent to execute. Reads with
`STATUS.md`, which records the state this is built on, and `CLAUDE.md` §3 for
the runtime rules (vanilla ES2020 in `index.html`, no build step, no npm).

Every file:line below was checked on 2026-10-08. They move; re-grep before
editing and trust the code over this document.

---

## Why

The app knows what a person **can** do and what they **cannot**. It has no
representation of what they **want**.

The field that looks like it holds preference does not. Every one of the live
profile's `wrong_shapes` is a capability judgement derived from the CV:

```
"Broadcast editor: no broadcast or network credits shown"
"Film director: only assistant direction, no directorial credits"
"Motion graphics/VFX artist: no animation, compositing, or VFX shown"
```

Not one says *I don't want this*. They all say *you can't get this*. And
`gaps` restates the same six facts: "No broadcast, network or large-agency
credits shown", "No motion graphics, VFX or animation work shown". Two fields,
one field's worth of signal, and no preference anywhere.

`mode` (`permanent` | `freelance` | `gig`) is the one intent-shaped field that
exists, and it is **inferred by a model from the CV**. It routes real money —
`PORTALS_BY_MODE` (`index.html:2009`) picks which portals get a Google query,
and `rowsFor` (`api/index.ts:404`) decides which Apify scrapers run and at what
row count. A guess from a document is the weakest possible source for that.

## What this does NOT do, and why

**No personality profiling.** Three reasons, in order of weight:

1. Abandonment at intake is what kills a beta. The app already asks for a CV.
2. Revealed preference is free and better: which rows get opened, dismissed,
   applied to. `events`, `stage` and `date_applied` already exist on every job.
3. DeepSeek stores inputs in the People's Republic of China, keeps them "for as
   long as you have an account", and trains on them unless opted out — verified
   2026-10-08, see `privacy.html`. A personality inventory is the most sensitive
   thing that could be added to that exact payload, and under India's DPDP it is
   a different category of data. We spent 2026-10-08 *reducing* what goes there.

**Nothing here is validated yet, and that is the reason for the ordering.**
`matcher_outcomes` reports **15 applied, 0 replied**. There is currently no
signal that can tell whether any intake change helped. Adding ten questions
multiplies the ways to be wrong with nothing to catch them. So step 3 below is
to get outcomes flowing, and step 4 is explicitly gated behind having them.

---

## The data

Five fields. One free-text, four enums or small objects. All on the profile,
not the track, except `mode`, which stays on the track because a person can
have one salaried direction and one freelance one.

```jsonc
{
  // NEW, asked. Nothing captures urgency today.
  "intent": "now" | "soon" | "browsing",

  // NEW, asked. Maps onto the existing threshold constants; see below.
  "strict": 1 | 2 | 3,

  // NEW, asked. HARD limits. These gate fit to zero, they do not down-weight.
  "limits": {
    "relocate":  false,          // will not move for a job
    "onsite_ok": false,          // will not take an on-site role
    "min_pay":   0,              // 0 = unstated; currency follows profile.country
    "avoid":     []              // free strings: "agency", "night shift", …
  },

  // NEW, asked, optional. One real posting they would apply to today.
  // A comparable beats adjectives: "what would you love" returns aspiration,
  // a pasted posting is falsifiable and Jev can score against it.
  "exemplar": "",

  // EXISTING, on each track. Change: ASK it, stop inferring it.
  "tracks": [{ "mode": "permanent" | "freelance" | "gig" }]
}
```

### Why `limits` is separate from `wrong_shapes`

`wrong_shapes` keeps its current meaning — roles the CV does not support. It
feeds the `shape` flag, which is a *soft* signal and should stay soft: a person
may well apply to a stretch.

`limits` is the opposite kind of fact. A red line is not a preference to be
traded off against a high score; it is an exclusion. Mixing them into one
field would make the stronger one unusable, because the only way to honour a
red line is to stop multiplying it by anything.

---

## 1. Persist it

`PROF_TEXT` and `PROF_JSON` (`index.html:1119-1120`) are the column lists the
save path and the CSV door both read.

```js
const PROF_TEXT = [...,'intent','exemplar'];     // add two
const PROF_JSON = [...,'limits'];                // add one
// `strict` is an integer: it goes beside years_experience in profileRow(),
// NOT in PROF_TEXT, or it will round-trip as the string "2".
```

Then:

- `profileRow()` (`index.html:1183`) — add `r.strict = intOut(prof.strict, extras, 'strict')`.
  **Both branches must emit the same keys.** `selfcheck-rows.js` asserts this
  because PostgREST's batch upsert unions keys across the array and nulls the
  ones an object is missing; a non-uniform batch would null real columns.
- `coerceProfile()` (`index.html:1216`) — the read side. Default `intent` to
  `'browsing'`, `strict` to `2`, `limits` to the object above with everything
  permissive. **Never leave these undefined**: every profile extracted before
  today has no intent, and code downstream must not have to ask whether the
  field exists.
- `schema.sql` `public.profiles` — four columns:
  `intent text`, `strict int`, `exemplar text`, `limits jsonb not null default '{}'`.
  Nullable and defaulted, because 2 live profiles and every CSV import predate them.
- A migration under `supabase/migrations/`, named for the day. `schema.sql` is
  the shape; the migrations directory is the history of what the live project
  actually has.

**Check:** `node scripts/selfcheck-rows.js` covers the round trip. Add a case
asserting a profile with no `intent` reads back as `browsing` and not as
`undefined`, and that `strict` survives as a number.

## 2. Ask it

Onboarding is a three-step wizard, `renderOnb()` at `index.html:4410`:

```
ONB.step 0  drop a CV
ONB.step 1  "what we found"
ONB.step 2  "pick a direction"
```

Add **one** step between 1 and 2 — "What are you after" — and extend the steps
array to four. One screen, five controls:

| Control | Field | Shape |
| --- | --- | --- |
| Three radio cards | `intent` | *I need something now* · *In the next few months* · *Just looking* |
| Three radio cards | `strict` | *Show me everything* · *Balanced* · *Only strong matches* |
| Per-track segmented control | `tracks[].mode` | permanent · freelance · gig — **pre-filled with the model's guess**, so the person corrects rather than composes |
| Two checkboxes + one number | `limits` | *I can relocate* · *I can work on-site* · minimum pay |
| One textarea, optional, collapsed | `exemplar` | "Paste one job you'd apply to today" |

Rules this screen must follow:

- **Every control has a default and the step is skippable.** A person who clicks
  straight past gets `browsing` / `strict 2` / the inferred modes / no limits,
  which is exactly today's behaviour. Nothing regresses for someone who does
  not answer.
- **`avoid` is not a free-text box on first run.** Offer the three or four that
  actually recur — agency/consultancy, night shift, commission-only, unpaid —
  and let free text arrive later from the detail pane. An empty text box at
  intake collects nothing and costs a screen.
- It must be reachable again afterwards. Put it behind the existing drawer, next
  to Direction; a person's urgency changes and re-running onboarding to say so
  is absurd.

## 3. Make it change what happens

This is the part worth doing. Four consumers, in descending order of value.

### 3a. `limits` gate fit to zero — the mechanism already exists

`FIT_BLOCK = ['loc']` (`index.html:3360`) with `gateStrength()` (`:3368`)
already multiplies fit toward zero for one flag. Extend the same pattern:

```js
function limitGate(j, prof){
  const L = prof.limits || {};
  let g = 1;
  if (!L.onsite_ok && isOnsite(j))            g = 0;   // from the posting text
  if (!L.relocate  && isElsewhere(j, prof))   g = 0;
  if (L.min_pay    && payBelow(j, L.min_pay)) g = 0;
  if ((L.avoid||[]).some(a => mentions(j, a))) g = 0;
  return g;
}
```

Applied in `fitFromJudgment()` (`index.html:3369`) beside the existing
`FIT_BLOCK` loop, so it composes with what is there.

**Two warnings.** First, `isOnsite`/`payBelow` read the posting text, and a
posting that does not state its pay must **not** be excluded by `min_pay` —
absent is not below. Silently hiding every posting without a salary line would
be the worst possible failure, and it is the likely one. Second, a gate is
destructive: a wrong red line hides jobs with no trace. The pane must say *why*
a row is hidden and offer to show it, and the count of gated rows belongs on
screen. Hidden-with-a-reason is recoverable; hidden silently is not.

### 3b. `intent` changes the ranking

`rankOf()` (`index.html:2974`) is:

```js
Math.pow(fitOf(j),0.65) * Math.pow(reachOf(j),0.35) * confWeight(j)
```

Freshness is not in it at all, and for someone who needs work now it is most of
the answer. Add a fourth term keyed on intent — weight age heavily for `now`,
not at all for `browsing`. `CLOSING_DAYS` (`:4689`) is already the closing-soon
boundary, so the data is there.

`intent` should also decide what the queue leads with: `now` leads with
apply-today rows, `browsing` leads with the strongest matches whatever their age.

### 3c. `strict` maps onto constants that already exist

`WORK_FIT 65`, `WORK_REACH 45`, `STRONG_FIT 75`, `STRONG_REACH 55`
(`index.html:4688`), `MIN_FIT 50` (`:3821`), `FLAG_P 0.8` (`:3289`).

A strictness dial is **surfacing these, not new machinery**:

| `strict` | effect |
| --- | --- |
| 1 — show everything | `MIN_FIT` down, bands unchanged |
| 2 — balanced | today's constants exactly |
| 3 — only strong | `MIN_FIT` up to `WORK_FIT`, lead on `isStrong` only |

Do **not** move `FLAG_P` with this dial. It is calibrated against probabilities
recorded from one pinned model in `scripts/eval/judgments.json`; moving it means
re-recording and re-running `scripts/tune-flag-thresholds.js`. That sweep already
reports a per-code optimum and says plainly that per-code thresholds are a
product decision no F1 score can make — read it before touching the cut.

### 3d. `exemplar` as a Jev comparable — done

A third Score, `fit_exemplar`, in `supabase/functions/_shared/judge.ts`: "how
close is the role in `posting` to the kind of work in `exemplar`", with the
exemplar in state beside the posting. Not an extraction — System One selects
among candidates code has already found and cannot generate.

Three things about it are worth knowing before changing it.

**It is the only question that is conditional.** `buildJudge` omits
`fit_exemplar` entirely when the exemplar is empty, so nobody who skipped the
field pays a token for a question about nothing — and `shapeJudge` therefore
*filters* `JUDGE_SCORE_DIMS` instead of mapping it, because `r.answers.fit_exemplar`
is undefined on those calls and `.score` would throw. Every judgement recorded
in `scripts/eval/judgments.json` predates the dimension and carries two scores;
they still compose, because `fitFromJudgment` normalises by the weight it
actually found.

**The weight is 0.15, and it was 0.3 first.** An exemplar is evidence about
*targeting* — the same axis as `fit_targeting`, stated concretely rather than as
adjectives — so the two belong on the same side of `FIT_W`'s own rule that
capability outweighs wanting it. At 0.3 they did not (0.6 < 0.4 + 0.3) and
`eval-matcher.js` caught the consequence: a job the person plainly cannot do,
matching their pasted posting, outranking one they plainly can. The queue would
have filled with near-copies of whatever single posting they pasted. At 0.15 a
top-to-bottom exemplar swing moves fit about 13 points — enough to re-order a
shortlist, not enough to dictate one.

**Two constants and one list now have to agree across runtimes**, and
`scripts/pipeline-map.js` asserts all three: `FIT_W`'s keys against
`JUDGE_SCORE_DIMS` (a dimension asked but not weighted is paid for and thrown
away; one weighted but not asked silently makes the weights lie), and
`EXEMPLAR_CAP` against `JUDGE_EXEMPLAR_CAP` (the app truncates before posting so
a long paste cannot push a batch of fifty past `JUDGE_BATCH_CHARS`, which the
server answers 400 for and `scoreAndCut` swallows by design).

The cost was the easy part, and the estimate held: one more Score on a call that
already asks ten nouls and two scores, over the same state, answered in
parallel.

---

## 4. Only then: whether any of it helped

**Gated on outcomes existing.** `matcher_outcomes` is 15 applied, 0 replied.
Until `replied` has data, every quality claim is agreement between models rather
than evidence about anyone getting a job.

The reply automation is built and dark: `src/reply-match.mjs`, the `email()`
export in `src/index.js`, `INBOX_LIVE = false` in `index.html`. It needs a
registered domain. That is the dependency — not more intake fields.

When outcomes exist, the question to ask of this work is narrow: **do rows that
pass the red lines get replies at a higher rate than rows that would have been
gated?** That is measurable from `inbound_mail` plus `jobs.stage`, and it is the
only thing that justifies keeping the gates.

---

## Order, and what each step costs

| | Work | Needs |
| --- | --- | --- |
| ~~1~~ | **Done** — five fields, defaults that mean "as before" | applied |
| ~~2~~ | **Done** — a fourth onboarding step, every control defaulted | — |
| ~~3a~~ | **Done** — `redLine()`, gated at read time, reason shown, count on screen | — |
| ~~3b~~ | **Done** — `rankFor`/`freshWeight`; `rankOf` left pure for the eval slice and the map anchor | — |
| ~~3c~~ | **Done** — `STRICT_SHIFT` over the four constants; display bands only, MIN_FIT untouched | — |
| ~~3d~~ | **Done** — `fit_exemplar`, conditional, weighted 0.15 so targeting plus exemplar still lose to capability | — |
| 4 | Measure it | a domain, so `replied` has data |

1–3d are a day and change nothing for a person who skips the step. 4 is the one
that decides whether any of it was right.

## Checks to add

- `selfcheck-rows.js` — the five fields round-trip; a pre-today profile reads
  back with defaults, not `undefined`; both `profileRow` branches emit the same
  keys.
- `selfcheck-boards.js` — a posting that trips a red line gates to fit 0; a
  posting with **no stated pay** does **not** gate on `min_pay`; `strict` 1/2/3
  move `MIN_FIT` and nothing else. For 3d: that `scoreAndCut` actually passes
  the profile's exemplar as `judgeMany`'s third argument, trimmed, and sends
  `''` when there is none. A dropped argument there costs nothing visible — Jev
  is simply not asked, and fit falls back to two dimensions and a plausible
  number.
- `eval-matcher.js` — for 3d: that a two-score judgement composes to exactly
  what it did before `fit_exemplar` existed; that the exemplar moves fit in both
  directions; and that it plus targeting still lose to capability.
- Mutation-test each one. Three checks written on 2026-10-08 passed while being
  vacuous — a pricing regex that crossed `</tr>` and matched nothing, a privacy
  check that found "linkedin" in a comment about its removal, and a systemd
  timestamp that `Date.parse` returned `NaN` for so the branch never ran.
  Running a new check and seeing it pass proves nothing.
