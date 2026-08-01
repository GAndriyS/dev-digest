---
name: engineering-insights
description: Captures non-obvious engineering findings into the INSIGHTS.md of the module that was touched (server, client, reviewer-core, e2e; root for cross-cutting). Records only findings that are unique and consequential — ones that change what a future session does. Use immediately after a confirmed fix reveals a root cause, an approach fails and is abandoned, a dependency quirk or codebase convention is discovered, or the same error recurs. Also use as an end-of-session wrap-up sweep for any session that involved a problem, decision, or discovery, and when the user says "add to learnings", "add to insights", "wrap up", "запиши інсайт", or "підбий підсумки". Not for trivial edits, for knowledge obvious from reading the code, for restating something already recorded, or for merely interesting observations.
---

# Engineering Insights

Append-only learnings loop over the per-module `INSIGHTS.md` files. The goal:
the next session starts knowing what this one learned the hard way.

## Session protocol (mandatory)

1. **Session start.** As soon as the user's first substantive prompt makes the
   target module clear, read that module's `INSIGHTS.md` **before starting the
   work** (plus the root one when the task is cross-cutting). Treat entries as
   high-confidence guidance unless the user overrides them.
2. **Capture as you go.** When a fact is *confirmed* — a fix verified by
   running it, an approach abandoned for a stated reason — append one entry to
   one section of one file. Do not batch confirmed findings for later.
3. **Pre-write read.** Before ANY write, re-read the target `INSIGHTS.md`.
   If the insight is already recorded — do not write it. If you have genuinely
   new information about an existing entry, append a dated follow-up line next
   to it; never a duplicate entry.
4. **Session end.** Run the wrap-up sweep (below). Recording **nothing is a
   legitimate outcome**: if the session held no problem, decision, or
   discovery, write nothing — including no Session Note. Never invent entries
   to have something to write.

## Which file (exactly one — never duplicate across files)

| Task touched | Write to |
|---|---|
| `server/**` (incl. repo-intel — tag entry `[repo-intel]`) | `server/INSIGHTS.md` |
| `client/**` | `client/INSIGHTS.md` |
| `reviewer-core/**` | `reviewer-core/INSIGHTS.md` |
| `e2e/**` | `e2e/INSIGHTS.md` |
| 2+ packages, repo process/tooling, CI, docs structure | `INSIGHTS.md` (root) |

## Which section

| Section | What goes there | Moment |
|---|---|---|
| What Works | confirmed approach worth repeating | fix verified |
| What Doesn't Work | dead end + WHY (the most valuable section — never skip it) | approach abandoned |
| Codebase Patterns | convention or architectural decision discovered in the code | "so THAT's how it's done here" |
| Tool & Library Notes | dependency quirk, version trap | a library surprised you |
| Recurring Errors & Fixes | an error seen before + its fix | "this happened again" |
| Session Notes | dated 2–4 line session summary | wrap-up only |
| Open Questions | unresolved things worth returning to — a **working queue**, not a record | session end |

## Entry format

Atomic, dated, cold-actionable — one insight per bullet, with evidence:

```markdown
- **2026-07-31** — Promise.all() on the ingest pipeline times out past 30
  items; use Promise.allSettled() with batches of 10 (server/src/ingest.ts:42)
```

Append-only: never rewrite or delete an entry. A correction is a new dated
line next to the old one. **One exception: Open Questions** — see below.

## Quality gates (apply in order; "don't write" is a valid outcome of each)

The default is **not to write**. An entry has to earn its line — every one of
these must pass.

1. **Verified-only** — facts, not hypotheses. The fix ran; the failure was
   observed. Untested theories are not insights.
2. **Consequential** — it must change what someone *does* next: a decision they
   would otherwise make wrong, a trap they would otherwise fall into, a step
   they would otherwise miss. "Interesting", "surprising", or "worth knowing"
   is not enough — if nothing downstream changes, it is trivia, not an insight.
   This file is a working aid, not a diary of the session.
3. **Unique** — not already recorded, and not a rephrasing of something that is.
   Enforced by the pre-write read (protocol step 3). If an existing entry covers
   the same ground, extend it with a dated line **only** when you carry genuinely
   new information; otherwise write nothing. Two entries saying the same thing
   in different words are worse than one, because a reader has to reconcile them.
4. **Cold test** — a reader with zero session context knows exactly what to do
   or avoid. No "be careful with X".
5. **Obviousness test** — if it is obvious to anyone reading the code, don't
   write it. A finding already explained by a comment at the site fails here.
6. **Five-minute test** — will this save 5+ minutes next time? If not, skip.
7. **No secrets** — never tokens, keys, or credentialed URLs in entries.

When in doubt, don't write. A short file that is all signal beats a long one
the next session learns to skim.

Good/bad examples per section: see [examples.md](examples.md).

## Wrap-up sweep (`/engineering-insights` or "підбий підсумки")

First, a depth check: a session of 1–2 exchanges gets a fast pass — one
question, "was there anything substantive?" — and usually ends with nothing
written. For substantive sessions, walk the session in this order:

1. Things that worked and are worth repeating → What Works
2. Approaches that failed or were abandoned, and why → What Doesn't Work
3. Conventions or architectural decisions discovered → Codebase Patterns
4. Library/tool quirks hit → Tool & Library Notes
5. Errors seen before (or likely to recur) + fixes → Recurring Errors & Fixes
6. One dated Session Note (2–4 lines: what was done, key outcome)
7. Anything left unresolved → Open Questions; and **close** any question this
   session answered (below)

Rank candidates by signal strength: **user corrections rank highest**, then
repeated patterns, then one-off findings. Write **at most 5 entries** per
sweep — drop the weakest candidates, not the quality bar. Every candidate
still passes the quality gates and the pre-write read.

## Closing an Open Question

Open Questions is a **queue of things still unknown**, so an answered question
does not belong there. Never leave it in place annotated `(resolved)` — that
turns the queue into a changelog and buries the questions that are still open.

When a question gets answered:

1. **Delete the question** outright.
2. Then ask whether the *answer* is an insight in its own right. Run it through
   the quality gates like any other candidate. If it passes, write it into the
   section it actually belongs to — What Works, What Doesn't Work, Codebase
   Patterns, Tool & Library Notes — as a normal dated entry, phrased as the
   lesson rather than as "the answer to that question".
3. If it does not pass — most often because the decision now lives in the code,
   a comment, or a spec — delete the question and write nothing. Losing a
   question you answered costs nothing; the answer is in the repo.

The append-only rule protects recorded knowledge. A question is not knowledge
yet, which is why this is the one place deletion is correct.

## Maintenance (keeps the loop healthy)

- **Promotion:** an entry that has changed the agent's behaviour twice gets
  promoted to the module's `CLAUDE.md → Conventions` as ONE line (cap 7 — the
  eighth evicts the least relevant back here). The full write-up stays in
  INSIGHTS.md.
- **Prune** (when asked, or during a quarterly review): remove entries about
  since-fixed bugs, merge near-duplicates, resolve contradictions in favour of
  the newer dated entry.
- A file approaching ~200 entries should be split into domain files — raise
  this with the user rather than doing it silently.
