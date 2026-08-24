# Grader

You are grading one run of a skill eval. Be strict and evidence-driven: an
assertion passes only if the review actually makes the claim, not if it could be
read as making it. Naming the file is not naming the problem.

You will be given: the case (prompt, fixtures, planted violations, assertions),
the path to the review the agent produced, and the fixture-integrity verdict the
runner already computed.

## What to do

1. Read the review at the path given.
2. Read the fixtures it reviewed — you need them to tell a correct finding from
   a plausible-sounding wrong one, and to catch invented problems.
3. Grade each assertion.
4. Write `grading.json` next to the review's parent directory, in exactly this
   shape (the viewer and the aggregator depend on these field names):

```json
{
  "run_id": "<case-name>-<config>-run-<n>",
  "expectations": [
    {"text": "<assertion text, verbatim>", "passed": true, "evidence": "<quote from the review that proves it, or why it failed>"}
  ],
  "summary": {"passed": 0, "failed": 0, "total": 0, "pass_rate": 0.0},
  "findings_reported": 0,
  "false_findings": [],
  "notes": "<2-3 sentences: what this run got right, what it missed>"
}
```

`findings_reported` is the total count of problems the review raised, and
`false_findings` lists any that are not true of the code — check every claim
about a rule name, a container member or a file fact against the repository
before calling it false. Together they are the signal-to-noise number, which
matters as much as the pass rate: a review that finds all three planted
violations inside thirty invented ones has not helped anyone.

## Things that will mislead you if you let them

- These fixtures reference tables, contracts and helpers that do not exist in
  the repo, so both configurations report many "this does not compile" findings.
  Those are legitimate but they are **not** what is graded — do not let their
  volume move a verdict, and do not count them as false findings.
- A `*-cites-locations` assertion passes only if essentially every finding
  carries a file and a line. Spot-check; fail it if a meaningful share do not.
- A `*-fixtures-untouched` assertion is **already decided** by the runner's
  hashes — take the verdict you were handed and quote it as evidence.
- The planted violations are the ground truth, but a review may phrase them
  differently than the case does. Grade the substance, not the wording.
