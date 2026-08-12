# Smart Diff — ordering a PR's files by risk

`GET /pulls/:id/smart-diff` returns the `SmartDiff` contract
(`server/src/vendor/shared/contracts/brief.ts:101-134`): the PR's changed
files grouped into `core → wiring → boilerplate`, each file carrying the
line numbers of findings that landed on it, plus a suggestion for splitting
an oversized PR. **It is fully deterministic and makes no model call** — it
recombines data the app already has (`pr_files`, and every review's
findings) rather than asking an LLM to rank anything. The contract is frozen
(see "Where the finding annotations actually come from" below), and nothing
on the server side changed for v2.

The Files-changed tab defaults to this ranked view (`Smart order`) with a
toggle back to the plain, unranked diff (`Original order`) — both are
`DiffTab`, not `SmartDiffViewer` alone; see "Client rendering".

This doc explains the rationale that isn't obvious from either side of the
wire alone: why every review counts (not just the latest), why the group
order is fixed, why the client always has a way back to the plain diff, and
— the part that is easy to miss reading either side in isolation — why the
severity chips and the click-to-finding navigation are built entirely on the
client from data the contract doesn't carry. The classification rules
themselves — the pattern list, the split thresholds — are read from
`server/src/modules/smart-diff/constants.ts`, which is their source of
truth; this doc doesn't restate them.

## Request path

```mermaid
sequenceDiagram
  participant UI as SmartDiffViewer (usePrSmartDiff)
  participant Route as GET /pulls/:id/smart-diff
  participant Svc as SmartDiffService
  participant Repo as container.reviewRepo
  participant Build as buildSmartDiff / classifyPath

  UI->>Route: fetch on mount, and after a run settles
  Route->>Svc: getSmartDiff(workspaceId, prId)
  Svc->>Repo: getPull (tenancy gate — pr_files has no workspace_id)
  Svc->>Repo: getPrFiles(prId)
  Svc->>Repo: reviewsForPull(prId)
  Repo-->>Svc: pull, files, every review + its findings
  Svc->>Build: classify each path, group, propose splits
  Build-->>Svc: SmartDiff {groups, split_suggestion}
  Svc-->>Route: SmartDiff
  Route-->>UI: 200 SmartDiff
  UI->>UI: resolve groups against PrFile; join with findings for<br/>annotations (client-side, see "Where the finding<br/>annotations actually come from"); collapse per role
```

- **Server:** `server/src/modules/smart-diff/{routes,service,helpers,constants}.ts`,
  registered in `server/src/modules/index.ts`. No repository, no new SQL —
  `SmartDiffService` reads through `container.reviewRepo`, the cross-module
  seam already used for reads that don't own their own tables
  (`server/src/modules/smart-diff/service.ts:12-17`). Untouched since v1.
- **Client:** the hook is `usePrSmartDiff` in `client/src/lib/hooks/reviews.ts`;
  the ranked rendering is
  `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/`.
  `DiffTab.tsx` owns the Smart/Original toggle and mounts either
  `SmartDiffViewer` or the plain `DiffViewer` — see "Client rendering".

## Why every review, not just the latest

`finding_lines` on each file is built from **every** `kind:'review'` review
of the PR, dismissed findings excluded (`service.ts:49-65`, the
`reviewFindings` method). A re-run that hits an empty or unchanged diff
writes a new review with zero findings — using only the latest review would
have silently erased the lines an earlier, real review flagged.

The rule matches one the PR list already had to make for its own findings
column, for the same reason: `server/src/modules/pulls/routes.ts:174-177`
sums findings across every review of a PR — unlike `score`, which is
deliberately latest-only — "so the number matches what the detail page shows
once you click a counter through to it." Smart Diff's badges make the same
promise for the reader who lands on the diff directly: they should never
disagree with the counter the reader clicked through.

The client repeats this exact rule for its own purposes: the findings it
draws onto diff lines come from `usePrReviews`' every-review flatmap
(`page.tsx`'s `allFindings`), not filtered to `kind: 'review'` — see "Where
the finding annotations actually come from".

## Grouping and ordering

- Groups always render in the fixed order `core, wiring, boilerplate`
  (`ROLE_ORDER`, `constants.ts:84`) — even an empty group is emitted, so the
  client's layout doesn't shift PR to PR.
- Within a group, files sort by finding count (desc), then changed lines
  `additions+deletions` (desc), then path (asc) — a total order, so nothing
  is left to insertion order (`helpers.ts:121-131`, `sortGroup`).
- Classification is **path-pattern only** — a lock file, a boilerplate glob,
  or a wiring glob, checked in that order, with `core` as the default for
  everything else (`helpers.ts:69-74`, `classifyPath`). A file's patch text
  is never inspected; a `pr_files` row with `patch: null` classifies exactly
  like one with a patch.
- `split_suggestion.too_big` fires when the PR's total changed lines exceed
  `SPLIT_TOO_BIG_LINES` (constants.ts); the proposed splits group
  non-boilerplate files by their first two path segments and append one
  boilerplate "chore" split (`helpers.ts:147-176`, `proposeSplits`).

## Client rendering

- **The toggle lives in `DiffTab`, above both viewers.** A local
  `view: "smart" | "original"` state (`DiffTab/constants.ts`,
  `DEFAULT_DIFF_VIEW = "smart"`) picks between `SmartDiffViewer` and the
  plain `DiffViewer`. It is deliberately **not** URL-backed — the ranking is
  a display preference, not shareable state (`DiffTab/constants.ts`
  comment). `Original order` renders `<DiffViewer files={files}
  commenting={commenting} />` with **no `fileMeta` prop at all**
  (`DiffTab.tsx`) — the absence of severity chips and badges there is
  structural, not a conditional inside the viewer.
- **One header, not two `SectionLabel`s.** `DiffTab` renders a single header —
  `t("smartDiff.headerLabel")` ("Reviewer-ordered diff") over
  `t("smartDiff.headerStats", { count })` ("N files") plus the summed
  `+A −D` across every file — with the Smart/Original `Chip` toggle and the
  comments-visibility button on the right (`DiffTab.tsx`, `DiffTab/styles.ts`).
  `SmartDiffViewer` no longer renders its own `SectionLabel`.
- `SmartDiffViewer` maps each `SmartDiffGroup`'s paths back onto the PR's
  real `PrFile` rows (the response carries paths and stats, not patch text)
  and forwards a `fileMeta` prop — `defaultOpen` plus per-file
  `annotations` — into the shared `DiffViewer`/`FileCard`
  (`buildFileMeta`, `SmartDiffViewer/helpers.ts`). Any `PrFile` the response
  doesn't mention (a ranking gap) is appended as an "ungrouped" tail so a
  file never silently vanishes from the tab (`ungroupedFiles`, same file);
  since v2 that tail also carries annotations, for the same reason the
  fallback below does.
- Each role group's header is a colour marker square (`ROLE_MARKER_COLOR`:
  core `--accent`, wiring `--warn`, boilerplate `--text-muted`), the role
  label, a muted one-line description (`ROLE_DESC_KEY`, e.g. "The substance
  of the change — review closely" for core), and the file count
  (`SmartDiffViewer.tsx`, `SmartDiffViewer/constants.ts`). The finding-line
  count v1 showed here is gone — there is nothing group-level left to count
  now that findings render per line instead (see below).
- The `boilerplate` group starts collapsed regardless of its files' size;
  `core`/`wiring` leave `FileCard`'s own size heuristic in charge
  (`DEFAULT_OPEN_BY_ROLE`, `SmartDiffViewer/constants.ts`).
- **A file over the auto-expand threshold** (`totalLines >
  AUTO_EXPAND_MAX_LINES`) gets an amber header tint (`fileHeaderLarge`) and a
  non-clickable `"large · N lines"` chip (`largeChip`), independent of which
  role group it's in (`FileCard.tsx`, `diff-viewer/styles.ts`).
- **Fallback is unconditional.** On a fetch error, an empty response
  (`totalGrouped === 0`), or before a review exists, `SmartDiffViewer` renders
  the plain `DiffViewer` with the unranked files instead — the tab must never
  lose the diff because ranking failed (`SmartDiffViewer.tsx`). Since v2 that
  fallback still carries the client-built annotations (they come from
  findings, not from the ranking that failed) but no `defaultOpen` override,
  since that's a ranking opinion the fallback path doesn't have.
- After a run settles, `page.tsx` invalidates the `['pr-smart-diff', prId]`
  query alongside the review queries, so the ranked view and its annotations
  refresh without a reload.

## Where the finding annotations actually come from

The `SmartDiff` contract carries neither a finding's `id` nor its
`severity` — `SmartDiffFile.finding_lines` is just numbers — and the
contract is frozen for this change (no `contracts` slice; see the v2 plan).
A clickable severity chip needs both, so `SmartDiffViewer/helpers.ts`
joins the PR's findings onto its files **client-side**:
`buildAnnotations(files, findings)` groups by `finding.file`, drops
dismissed findings (`dismissed_at != null`), silently drops a finding whose
`file` doesn't match any known `PrFile` path (same rule `groupFiles` already
applies to a path gap the other way), and sorts each file's list
`CRITICAL → WARNING → SUGGESTION` (`SEVERITY_RANK`) then by line.

The `findings` array it joins against is `usePrReviews`' output, already
fetched by `page.tsx` for the Agent-runs tab's own `allFindings` — Smart
Diff adds no request of its own and makes no additional model or token cost.

The direct consequence, worth stating plainly because nothing else surfaces
it: **the server's `finding_lines` field is now rendered by nothing.** It is
still computed (see "Why every review, not just the latest" above) and still
present on the wire, purely because the contract is frozen; no client code
reads it anymore.

## Findings drawn on the line

- **`CodeLine`** renders a severity chip to the right of the code for every
  annotation that snapped to that rendered line — an icon
  (`SEVERITY_ICON`) plus a label from `shell.diffViewer.annotation*`
  (`CRITICAL` reads **"blocker"**, not "critical") — and an inset stripe
  down the row's left edge (`boxShadow: inset 3px 0 0 <severity color>`,
  `lineRowFor` in `diff-viewer/styles.ts`) coloured by the
  highest-priority annotation on that line. Clicking a chip calls
  `onFindingClick(findingId)`.
- **`FileCard`** snaps each annotation's raw line onto the nearest rendered
  line (`nearestRenderedLine`, unchanged from v1 — a finding's line can fall
  on a deleted line or a gap the stored patch never rendered) and groups them
  by rendered line (`annotationsByLine`). The header badge's count is the
  file's total annotation count and its colour is the worst severity present
  (`findingBadgeFor(worstSeverity(...))`); clicking it calls
  `onFindingClick` with the **first** finding — lowest rendered line, then
  (within that line) highest severity. Unlike v1, the badge no longer opens
  the card or scrolls anywhere itself — it only navigates (see below).

## Clicking a finding — Diff tab to its card in Agent runs

Clicking a chip or a file badge navigates to that finding's card in the
Agent-runs tab through the app's own routing — no GitHub link, no popup:

```mermaid
sequenceDiagram
  participant Chip as CodeLine chip / FileCard badge
  participant SDV as SmartDiffViewer / DiffViewer
  participant Page as page.tsx
  participant FT as FindingsTab
  participant RRA as ReviewRunAccordion
  participant FP as FindingsPanel

  Chip->>SDV: onFindingClick(findingId)
  SDV->>Page: onOpenFinding(findingId) (forwarded through DiffTab)
  Page->>Page: setParams({ tab: "findings", finding: findingId })<br/>ONE router.replace
  Page->>FT: targetFindingId (from ?finding=)
  FT->>FT: resolve targetReviewId — scan runs for the review<br/>owning that finding id
  FT->>RRA: targetReviewId, targetFindingId (every accordion)
  RRA->>RRA: open if review.id === targetReviewId
  RRA->>FP: targetFindingId (only from the owning review; else null)
  FP->>FP: bypass severity filter + hide-low-confidence,<br/>focus + expand, scroll into view
```

- `?tab=` and `?finding=` must land in the **same** `router.replace`
  (`page.tsx`'s `setParams`) — two sequential `setParam` calls each close
  over the same `useSearchParams()` snapshot, so the second call rebuilds
  `URLSearchParams` from data that doesn't yet have the first call's key and
  overwrites it. Leaving the Diff tab for any other tab clears `?finding=` so
  reopening Diff later doesn't re-trigger the scroll.
- `FindingsTab` resolves `targetReviewId` once (a `FindingRecord` carries
  `review_id`, not the run's own `id`, so this is a small scan) and hands
  it to every `ReviewRunAccordion`; only the accordion whose `review.id`
  matches forwards `targetFindingId` down to its own `FindingsPanel` — every
  other accordion gets `null`, so only one panel ever runs the scroll loop
  below.
- `FindingsPanel.visibleFindings` (`FindingsPanel/helpers.ts`) keeps the
  target past **both** cuts that would otherwise hide it: an active severity
  filter and hide-low-confidence. A click that lands on a finding the
  reader's own filter would have hidden must not look like it did nothing.
  The panel also seeds `focusIdx` from the target (not `0`) so it starts
  focused and expanded rather than flashing open at the top first.
- **The scroll re-runs every animation frame until the target's document
  offset stops moving**, rather than firing once on mount
  (`FindingsPanel.tsx`, `SCROLL_SETTLE_MAX_FRAMES = 30`, `~0.5s` at 60fps).
  A single mount-time `scrollIntoView` measured 2252px short: the accordions
  above the target open in their own effects, and their cards expand as they
  render, sliding the target further down the document on the frames after
  the panel's own effect already ran. The loop walks `offsetTop`/
  `offsetParent` (the element's position in the document, which the loop's
  own scrolling doesn't disturb — unlike its viewport rect, which does) and
  stops once that value holds for two consecutive frames or the frame cap is
  hit. Scroll behaviour is instant, not smooth, because a smooth animation
  aims at a position computed when it starts and a still-moving target would
  outrun it. `FindingCard` sets `scrollMarginTop: 16` so the sticky page
  header doesn't cover the landing target.

## What it deliberately doesn't do

- No `repo-intel` blast-radius signal — that facade degrades to `[]` on an
  unindexed repo, which would make classification differ machine to machine.
- No `pseudocode_summary` — the contract field is `.nullish()` and stays
  unset; producing it would need a model call, which this endpoint doesn't make.
- No refresh from GitHub — it reads whatever `pr_files` already holds.
  `GET /pulls/:id` is what refreshes that table (`pulls/routes.ts:249-258`);
  this endpoint is a pure read.

## Tests

- `server/test/smart-diff.test.ts` — unit: classification per pattern,
  ordering, `finding_lines` dedup, the `too_big` boundary. Unchanged by v2
  (server untouched).
- `server/test/smart-diff.it.test.ts` — integration: the route end-to-end
  against a seeded PR, tenancy (404/422), and that the request makes no LLM call.
- `.../SmartDiffViewer/SmartDiffViewer.test.tsx` — grouping, collapse
  defaults, the annotation chip's severity label and click, the file badge
  navigating instead of opening/scrolling, a dismissed finding producing no
  chip or badge, and the plain-diff fallback.
- `.../DiffTab/DiffTab.test.tsx` — Smart order shows annotations and group
  headers; Original order strips both without dropping any file; the header's
  file count and summed `+/-`.
- `.../FindingsTab/FindingsTab.test.tsx` — the accordion owning the target
  finding opens while sibling accordions stay closed; no accordion opens
  beyond the default when there is no target.
- `.../FindingsPanel/FindingsPanel.test.tsx` — the target survives an active
  severity filter and hide-low-confidence, renders focused + expanded (not
  necessarily at index 0), and the `requestAnimationFrame` scroll loop fires
  only when there is a target.
- `client/src/components/diff-viewer/{DiffViewer,FileCard}` tests — the
  `DiffLineAnnotation` prop plumbing and the badge/chip rendering shared with
  the plain diff viewer.
- `e2e/specs/09-pr-smart-diff.flow.json` — read-only browser check that the
  Files-changed tab groups seeded PR #482 by role and that the Smart/Original
  order toggle renders (see `e2e/README.md`).
