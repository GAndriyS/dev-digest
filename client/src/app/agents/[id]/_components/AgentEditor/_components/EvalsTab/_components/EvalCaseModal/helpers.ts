/** Pretty-printed starting text for the expected-output textarea — an empty
    `must_not_flag` shape for a new case, or the case's own stored value
    round-tripped through JSON.stringify for an existing one. */
export function stringifyExpectedOutput(value: unknown): string {
  return JSON.stringify(value ?? { findings: [] }, null, 2);
}

export type ParsedJson = { ok: true; value: unknown } | { ok: false };

/** AC-10: the JSON-validity check the modal keys its indicator and its
    Save-blocking off. Never throws — a parse failure is a normal, expected
    result here, not an error state. */
export function parseExpectedOutput(text: string): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** The fields the `MUST find "…" at file:line` banner line (AC-60) needs off
    one raw `expected_output.findings[]` entry. Read defensively, never with
    a schema parse: a hand-made case's JSON is not validated against the
    `Finding` contract, so a missing `file`/`start_line` renders as `?`/`0`
    instead of throwing mid-render. `title` is `null` (not `"?"`) so the
    caller can fall back to the case's own name, per AC-60's own wording. */
export interface ExpectedFindingLocator {
  title: string | null;
  file: string;
  line: number;
}

export function expectedFindingLocator(finding: unknown): ExpectedFindingLocator {
  const f = typeof finding === "object" && finding !== null ? (finding as Record<string, unknown>) : {};
  return {
    title: typeof f.title === "string" && f.title.length > 0 ? f.title : null,
    file: typeof f.file === "string" ? f.file : "?",
    line: typeof f.start_line === "number" ? f.start_line : 0,
  };
}

/** One escaped-text line summarising a raw `actual_output.findings[]` entry
    (AC-65) — the model's own output, read defensively for the same reason as
    `expectedFindingLocator` above: never a schema parse, never markup, and a
    plain string so the caller can only ever render it as a text node. */
export function summarizeActualFinding(finding: unknown): string {
  const f = typeof finding === "object" && finding !== null ? (finding as Record<string, unknown>) : {};
  const title = typeof f.title === "string" && f.title.length > 0 ? f.title : "(untitled finding)";
  const file = typeof f.file === "string" ? f.file : "?";
  const line = typeof f.start_line === "number" ? f.start_line : null;
  const location = line != null ? `${file}:${line}` : file;
  const severity = typeof f.severity === "string" ? f.severity.toUpperCase() : null;
  return severity ? `[${severity}] ${title} — ${location}` : `${title} — ${location}`;
}

/** `EvalRunRecord.duration_ms` as the fixed-one-decimal seconds string
    `caseEditor.resultSummary`'s `{duration}` placeholder wants (mirrors
    `RunTraceDrawer/helpers.ts#formatSeconds`, minus the "s" suffix the i18n
    string already supplies). `null` (a pre-duration row) reads as "0.0"
    rather than throwing. */
export function durationSeconds(ms: number | null): string {
  return ((ms ?? 0) / 1000).toFixed(1);
}

/** A metric fraction (0..1) as the whole-number percent
    `caseEditor.resultSummary`'s `{recall}`/`{precision}`/`{citation}`
    placeholders want. `scoring.ts`'s three metrics are never `null` on a
    scored run (only on an errored one, which this panel never reaches this
    helper for) — the `?? 0` is a defensive TS narrowing, not a real case. */
export function pctMetric(value: number | null): number {
  return Math.round((value ?? 0) * 100);
}
