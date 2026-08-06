# Examples

Good/bad pairs for the rules in [SKILL.md](SKILL.md). Each pair names the rule it
demonstrates and the cost of getting it wrong. Code is TypeScript/React as used
in `client/`.

---

## 1. Promotion — shared is earned, not predicted

**Rule:** climb the placement ladder one rung at a time, in response to a real
second consumer.

```tsx
// BAD — one consumer, parked in shared "because it might be reused"
// src/components/finding-label/FindingLabel.tsx
export function FindingLabel({ finding }: { finding: FindingRecord }) { … }
// imported by exactly one file: app/repos/[repoId]/pulls/[number]/_components/FindingCard
```

```tsx
// GOOD — lives with its only consumer; moves up the day a second one appears
// app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingLabel.tsx
```

A shared module with one consumer is the most expensive kind of wrong: it is far
from the code that defines it, and the next person who needs the same thing does
not know it exists, so they write a second one.

---

## 2. Junk-drawer files

**Rule:** a file needs an owner. Group by who uses it, not by what it is.

```ts
// BAD — src/lib/constants.ts, an app-wide bucket of unrelated values
export const POLL_INTERVAL_MS = 5000;
export const SEVERITY_ORDER = ["CRITICAL", "WARNING", "SUGGESTION"];
export const MAX_DIFF_LINES = 2000;
export const DEFAULT_PAGE_SIZE = 25;
```

```ts
// GOOD — each constant sits with the code that gives it meaning
// components/severity-counters/constants.ts    → SEVERITY_ORDER
// app/repos/[repoId]/pulls/constants.ts        → DEFAULT_PAGE_SIZE
// app/.../_components/DiffTab/constants.ts     → MAX_DIFF_LINES
// lib/hooks/usePolling.ts                      → POLL_INTERVAL_MS
```

Everyone appends to a bucket file, nobody prunes it, and one edit forces every
consumer to recompile and re-review.

---

## 3. Logic in the component body

**Rule:** the component body wires; it does not decide. Extract calculations,
grouping and formatting into named pure functions.

```tsx
// BAD — aggregation inlined; untestable without rendering
export function RunHistory({ reviews }: Props) {
  const byRun: Record<string, SeverityCountsView> = {};
  for (const review of reviews) {
    if (!review.run_id) continue;
    const counts = { critical: 0, warning: 0, suggestion: 0 };
    for (const f of review.findings) {
      if (f.severity === "CRITICAL") counts.critical += 1;
      else if (f.severity === "WARNING") counts.warning += 1;
      else if (f.severity === "SUGGESTION") counts.suggestion += 1;
    }
    byRun[review.run_id] = counts;
  }
  return <ul>{/* … */}</ul>;
}
```

```tsx
// GOOD — named, colocated, testable without a renderer
// RunHistory/helpers.ts
export function rollupSeverities(findings: FindingRecord[]): SeverityCountsView { … }
export function severityCountsByRun(reviews: ReviewRecord[]): Record<string, SeverityCountsView> { … }

// RunHistory/RunHistory.tsx
const countsByRun = severityCountsByRun(reviews);
```

This is the real shape of `RunHistory/helpers.ts` in this repo — the extraction
also gave the edge case ("runs that never persisted a review get no entry") a
place to be documented.

---

## 4. Business logic inside `useEffect`

**Rule:** hooks hold state and effects; they delegate computation to pure
functions.

```ts
// BAD — one giant effect doing state, fetching and the business rules
function useFindings(prId: string) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    fetch(`/api/prs/${prId}/findings`)
      .then((r) => r.json())
      .then((data) => {
        const visible = data.filter((f) => !f.dismissed);
        visible.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
        setRows(visible.map((f) => ({ ...f, label: `${f.severity}: ${f.title}` })));
      });
  }, [prId]);
  return rows;
}
```

```ts
// GOOD — data access in the project's query hook, rules in pure functions
// helpers.ts
export function toVisibleRows(findings: FindingRecord[]): Row[] { … }

// useFindingRows.ts
export function useFindingRows(prId: string) {
  const { data } = useFindings(prId);            // lib/hooks/*, over lib/api.ts
  return toVisibleRows(data ?? []);
}
```

The bad version cannot be tested without a fake fetch and a renderer; the good
one tests the rules with a plain array.

---

## 5. Raw `fetch` in a component

**Rule:** all API access goes through one client, so there is one place to mock.

```tsx
// BAD — bypasses lib/api.ts and the global fetch mock; the test will lie
useEffect(() => { fetch(`${process.env.NEXT_PUBLIC_API_BASE}/repos`).then(…) }, []);
```

```tsx
// GOOD
const { data, isLoading } = useRepos();   // src/lib/hooks/repos.ts → src/lib/api.ts
```

---

## 6. Domain knowledge leaking into the shared layer

**Rule:** if a "util" imports a domain type, it is a helper and belongs with the
feature.

```ts
// BAD — src/lib/utils.ts
import type { FindingRecord } from "@devdigest/shared";
export function formatFindingLabel(f: FindingRecord) { … }
```

```ts
// GOOD
// src/lib/utils.ts                     → truncate(), pluralize()  (no domain imports)
// components/severity-counters/helpers.ts → formatFindingLabel()  (knows findings)
```

A shared layer that knows about one feature will, over time, know about all of
them — and then nothing can be changed without touching it.

---

## 7. Barrels — public API, not convenience

**Rule:** export the supported surface; keep internals unexported so they stay
free to move.

```ts
// BAD — components/severity-counters/index.ts
export * from "./SeverityCounters";
export * from "./FindingsPopover";
export * from "./popoverHelpers";
export * from "./useHoverIntent";
```

```ts
// GOOD — the real file: one line, one supported entry point
export { SeverityCounters, type SeverityCountsView } from "./SeverityCounters";
```

With the bad version, renaming `useHoverIntent` is a breaking change to the whole
app; with the good one it is a local edit.

---

## 8. Importing a sibling through your own barrel

**Rule:** inside a module, import siblings by direct path. This single habit
prevents most import cycles.

```ts
// BAD — FindingsPopover.tsx
import { SeverityCounters } from ".";       // module imports its own barrel → cycle
```

```ts
// GOOD
import { SeverityCounters } from "./SeverityCounters";
```

---

## 9. Splitting a component

**Rule:** split on reasons to change, not on line count.

```tsx
// BAD — a 300-line component chopped into three files that always change together
<PrDetailHeaderTop … />
<PrDetailHeaderMiddle … />
<PrDetailHeaderBottom … />
```

```tsx
// GOOD — split along a real seam: data/state vs painting, and a self-contained subtree
export function FindingsTab({ prId }: Props) {     // container: data, filter state
  const { data } = useFindings(prId);
  const [severity, setSeverity] = useSeverityParam();
  return <FindingsPanel findings={filterBySeverity(data, severity)} onSelect={setSeverity} />;
}
```

Three fragments that always change together turn one edit into three files.
`Top/Middle/Bottom` names are the tell: they describe position, not
responsibility.

---

## 10. Duplication — wait for the third occurrence

**Rule:** abstract on a shared *reason to change*. A boolean parameter added to
fit a new caller means "do the other thing entirely".

```ts
// BAD — merged on shape after the second occurrence, then patched with a flag
function renderCounts(counts: SeverityCountsView, isTimelineRow: boolean) {
  if (isTimelineRow) { /* compact, no labels, no link */ }
  else { /* full, labelled, links to filtered view */ }
}
```

```ts
// GOOD — two callers, two reasons to change, kept apart until a real seam appears
function PrRowCounters({ counts, onSelect }: PrRowCountersProps) { … }
function TimelineCounters({ counts }: TimelineCountersProps) { … }
// the genuinely shared part — the tally — is what got extracted:
export function rollupSeverities(findings: FindingRecord[]): SeverityCountsView { … }
```

When an existing abstraction already carries flags for its callers, inlining it
back into each caller is progress, not regression.

---

## 11. Server/client boundary placed too high

**Rule:** the boundary decides bundle membership. Push it down; use `children` to
nest server content inside a client wrapper.

```tsx
// BAD — everything this layout imports is now in the client bundle
"use client";
export default function Layout({ children }) {
  const [open, setOpen] = useState(false);
  return <aside>…</aside>;
}
```

```tsx
// GOOD — server layout composes; the interactive part is a small island
export default function Layout({ children }) {         // server component
  return <CollapsibleSidebar>{children}</CollapsibleSidebar>;
}

// CollapsibleSidebar.tsx
"use client";
export function CollapsibleSidebar({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <aside data-open={open}>{children}</aside>;   // children stay server-rendered
}
```

A client component cannot import a server component — but it can receive one
through `children`. If you are tempted to pass a function across the boundary,
the logic is on the wrong side.

---

## 12. Redeclaring contract values

**Rule:** import domain enums and types from the contract package so a backend
change breaks the build instead of silently disagreeing.

```ts
// BAD — a private copy that drifts the moment the server adds a severity
export const SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;
export type Severity = (typeof SEVERITIES)[number];
```

```ts
// GOOD
import type { FindingSeverity } from "@devdigest/shared";
```

`client/src/vendor/shared` is a trimmed copy of the server's canonical set and
does not update itself — a wire-crossing change must be mirrored deliberately.

---

## 13. Placeholder auxiliary files

**Rule:** create `constants.ts` / `helpers.ts` / `styles.ts` when there is
content for them.

```
BAD  FilterBar/
     ├── FilterBar.tsx
     ├── constants.ts   ← empty
     ├── helpers.ts     ← empty
     ├── styles.ts      ← empty
     └── index.ts
```

```
GOOD FilterBar/
     ├── FilterBar.tsx
     └── index.ts
```

An empty `constants.ts` tells the next reader that constants were considered and
placed. They were not.

---

## 14. Styling — follow this codebase, not the generic advice

**Rule:** `client/` styles with colocated `styles.ts` objects. This overrides the
Tailwind guidance in `react-best-practices`.

```tsx
// BAD here — utility classes; this codebase has no Tailwind
<span className="inline-flex items-center gap-1.5 rounded" />
```

```ts
// GOOD — styles.ts: static objects with `satisfies`, functions for state
export const s = {
  wrap: { display: "inline-flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  chip: (interactive: boolean, dimmed: boolean, selected: boolean): CSSProperties => ({
    cursor: interactive ? "pointer" : "default",
    opacity: dimmed ? 0.4 : 1,
    outline: selected ? "2px solid var(--accent)" : "none",
  }),
} as const;
```

Design tokens arrive as CSS variables (`var(--accent)`), so the colocated object
still defers to the theme.
