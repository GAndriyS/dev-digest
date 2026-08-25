/**
 * Static quality checks for the harness artifacts — no model, no network. The fast gate to run
 * before the (slower) LLM evals.
 *
 *   pnpm eval:quality                 # every skill, every agent, and the A/B pairs
 *   pnpm eval:quality onion-architecture   # one skill, nothing else
 *
 * Three sections, because three kinds of thing rot in three different ways: a SKILL.md loses a
 * reference file, an agent's frontmatter stops matching its filename, and an A/B pair drifts apart
 * so that a measurement across it reports the drift instead of the rule (see artifacts/pairs.ts).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import matter from "gray-matter";
import { REPO_ROOT, SKILLS_DIR, AGENTS_DIR, EVALS_DIR } from "./artifacts/paths.js";
import { checkPairs } from "./artifacts/pairs.js";

const REQUIRED = ["name", "description"];
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

interface Report {
  skill: string;
  errors: string[];
  warnings: string[];
  verdict: "PASS" | "WARN" | "FAIL";
}

const verdictOf = (errors: string[], warnings: string[]): Report["verdict"] =>
  errors.length ? "FAIL" : warnings.length ? "WARN" : "PASS";

function* internalLinks(body: string): Generator<[string, string]> {
  for (const m of body.matchAll(LINK_RE)) {
    const target = m[2];
    if (/^(https?:|#|mailto:)/.test(target)) continue;
    const path = target.split("#")[0];
    if (path) yield [target, path];
  }
}

function evaluate(skillDir: string): Report {
  const name = basename(skillDir);
  const skillMd = join(skillDir, "SKILL.md");
  if (!existsSync(skillMd)) {
    return { skill: name, errors: [`SKILL.md not found in ${skillDir}`], warnings: [], verdict: "FAIL" };
  }
  const { data: fm, content: body } = matter(readFileSync(skillMd, "utf8"));
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const f of REQUIRED) {
    if (!(f in fm)) errors.push(`missing frontmatter field: ${f}`);
    else if (!fm[f]) errors.push(`empty frontmatter field: ${f}`);
  }
  if (fm.name && fm.name !== name) errors.push(`frontmatter name '${fm.name}' != directory '${name}'`);
  if (body.length < 100) errors.push("SKILL.md body suspiciously short (< 100 chars)");
  if (body.split("\n").filter((l) => l.startsWith("#")).length < 2) errors.push("fewer than 2 headings — likely incomplete");
  for (const [target, path] of internalLinks(body)) {
    if (!existsSync(join(skillDir, path))) errors.push(`broken reference (${target}) — not found: ${path}`);
  }

  const evalFile = join(EVALS_DIR, "skills", name, `${name}.eval.ts`);
  if (!existsSync(evalFile)) warnings.push(`no eval file (expected: ${relative(REPO_ROOT, evalFile)})`);
  if (body.split("\n").length > 500) {
    warnings.push(`SKILL.md very long (${body.split("\n").length} lines) — consider splitting`);
  }

  return { skill: name, errors, warnings, verdict: verdictOf(errors, warnings) };
}

/**
 * The same gate for a subagent definition. An agent is one file, not a folder, and its
 * frontmatter is load-bearing in a way a skill's is not: `name` is the dispatch address, and
 * `tools` is what the eval harness reads to decide which tools to grant (artifacts/load.ts). A
 * `name` that stopped matching its filename fails silently — the delegation just never resolves.
 */
function evaluateAgent(file: string): Report {
  const name = basename(file, ".md");
  const { data: fm, content: body } = matter(readFileSync(file, "utf8"));
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const f of REQUIRED) {
    if (!(f in fm)) errors.push(`missing frontmatter field: ${f}`);
    else if (!fm[f]) errors.push(`empty frontmatter field: ${f}`);
  }
  if (fm.name && fm.name !== name) errors.push(`frontmatter name '${fm.name}' != file '${name}.md'`);
  if (body.trim().length < 100) errors.push("body suspiciously short (< 100 chars)");
  if (typeof fm.tools === "string" && /\ball tools\b|\*/i.test(fm.tools)) {
    warnings.push(`tools: '${fm.tools}' — a wildcard grant collapses to read-only under eval (load.ts)`);
  }

  const evalFile = join(EVALS_DIR, "agents", name, `${name}.eval.ts`);
  if (!existsSync(evalFile)) warnings.push(`no eval file (expected: ${relative(REPO_ROOT, evalFile)})`);

  return { skill: name, errors, warnings, verdict: verdictOf(errors, warnings) };
}

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

const verdictColor = (v: Report["verdict"]) => (v === "FAIL" ? RED : v === "WARN" ? YELLOW : GREEN);

function print(r: Report): boolean {
  console.log(`\n${"=".repeat(56)}\n${r.skill}  [${verdictColor(r.verdict)}${r.verdict}${RESET}]\n${"=".repeat(56)}`);
  r.errors.forEach((e) => console.log(`  ${RED}ERROR: ${e}${RESET}`));
  r.warnings.forEach((w) => console.log(`  ${YELLOW}WARN:  ${w}${RESET}`));
  if (!r.errors.length && !r.warnings.length) console.log(`  ${GREEN}all checks passed.${RESET}`);
  return r.verdict === "FAIL";
}

function main() {
  const args = process.argv.slice(2);
  const selected = args.length > 0;
  const dirs = selected
    ? args.map((a) => (a.includes("/") ? a : join(SKILLS_DIR, a)))
    : readdirSync(SKILLS_DIR)
        .map((d) => join(SKILLS_DIR, d))
        .filter((d) => statSync(d).isDirectory() && existsSync(join(d, "SKILL.md")));

  let failures = 0;
  for (const d of dirs.sort()) if (print(evaluate(d))) failures++;
  console.log(`\n${"=".repeat(56)}\nTotal: ${dirs.length} skills, ${failures} failures`);

  // Naming a skill on the command line means "check that one thing" — agents and pairs are the
  // full sweep only.
  if (selected) process.exit(failures ? 1 : 0);

  const agentFiles = readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => join(AGENTS_DIR, f))
    .sort();
  let agentFailures = 0;
  for (const f of agentFiles) if (print(evaluateAgent(f))) agentFailures++;
  console.log(`\n${"=".repeat(56)}\nTotal: ${agentFiles.length} agents, ${agentFailures} failures`);

  // A/B pairs. A drifted pair is an ERROR, not a warning: it does not degrade a measurement, it
  // silently changes what was measured.
  const pairs = checkPairs();
  let pairFailures = 0;
  for (const [label, issues] of pairs) {
    console.log(`\n${"=".repeat(56)}\npair: ${label}  [${verdictColor(issues.length ? "FAIL" : "PASS")}${issues.length ? "FAIL" : "PASS"}${RESET}]\n${"=".repeat(56)}`);
    issues.forEach((i) => console.log(`  ${RED}ERROR: ${i}${RESET}`));
    if (!issues.length) console.log(`  ${GREEN}in sync, and the dimension is removed everywhere.${RESET}`);
    if (issues.length) pairFailures++;
  }
  console.log(`\n${"=".repeat(56)}\nTotal: ${pairs.length} A/B pairs, ${pairFailures} failures`);

  process.exit(failures + agentFailures + pairFailures ? 1 : 0);
}

main();
