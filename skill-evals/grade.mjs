#!/usr/bin/env node
/**
 * skill-evals — grade a finished run and aggregate it.
 *
 *   node skill-evals/grade.mjs --run skill-evals/results/onion-architecture-2026-08-24T11-28-00
 *   node skill-evals/grade.mjs --run <dir> --aggregate-only
 *
 * Grading is delegated to an agent (`grader.md` is its brief) because the
 * assertions are semantic — "says the adapter must come from the container" is
 * not a regex. The two things that CAN be decided mechanically are decided
 * mechanically and handed to it: fixture integrity comes from the runner's
 * hashes, and the pass counts are recomputed here from the expectations rather
 * than trusted from the model's own arithmetic.
 *
 * `--aggregate-only` skips the agent and just re-reads existing grading.json
 * files — use it after editing a verdict by hand.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

const argv = process.argv.slice(2);
const opt = (n, f = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? f : argv[i + 1];
};

const runArg = opt('run');
const skill = opt('skill', 'onion-architecture');
const aggregateOnly = argv.includes('--aggregate-only');

if (!runArg) {
  console.error('usage: node skill-evals/grade.mjs --run <results dir> [--skill <name>] [--aggregate-only]');
  process.exit(2);
}

const runRoot = resolve(ROOT, runArg);
if (!existsSync(runRoot)) {
  console.error(`no such run: ${runArg}`);
  process.exit(2);
}

const suite = JSON.parse(
  readFileSync(join(ROOT, '.claude/skills', skill, 'evals/evals.json'), 'utf8'),
);
const integrity = readJson(join(runRoot, 'fixture-integrity.json')) ?? { clean: null, touched: [] };
if (integrity.clean === false) {
  console.error('this run modified its fixtures — grading it would score a moved target.');
  process.exit(1);
}

const dirs = [];
for (const caseDir of readdirSync(runRoot).filter((d) => d.startsWith('case-'))) {
  const testCase = suite.cases.find((c) => caseDir.endsWith(c.name));
  if (!testCase) continue;
  for (const config of readdirSync(join(runRoot, caseDir))) {
    const configDir = join(runRoot, caseDir, config);
    for (const run of readdirSync(configDir).filter((d) => d.startsWith('run-'))) {
      dirs.push({ testCase, config, run, dir: join(configDir, run) });
    }
  }
}

if (!aggregateOnly) {
  const brief = readFileSync(join(ROOT, 'skill-evals/grader.md'), 'utf8');
  for (const d of dirs) {
    if (!existsSync(join(d.dir, 'outputs/review.md'))) {
      console.log(`  – ${d.testCase.name} · ${d.config} · ${d.run} — no review.md, skipped`);
      continue;
    }
    const prompt = [
      brief,
      '',
      '---',
      '',
      `## This run: ${d.testCase.name} · ${d.config} · ${d.run}`,
      '',
      `Review to grade: ${relative(ROOT, join(d.dir, 'outputs/review.md'))}`,
      `Write grading.json to: ${relative(ROOT, join(d.dir, 'grading.json'))}`,
      `run_id: ${d.testCase.name}-${d.config}-${d.run}`,
      '',
      `Fixture integrity (decided by the runner, do not re-derive): ${
        integrity.clean ? 'clean — every fixture is byte-identical' : `TOUCHED: ${integrity.touched.join(', ')}`
      }`,
      '',
      '## The case',
      '```json',
      JSON.stringify(d.testCase, null, 2),
      '```',
    ].join('\n');

    const code = await claude(prompt);
    console.log(`  ${code === 0 ? '✓' : '✗'} graded ${d.testCase.name} · ${d.config} · ${d.run}`);
  }
}

// --- aggregate ---------------------------------------------------------------

const byConfig = {};
for (const d of dirs) {
  const grading = readJson(join(d.dir, 'grading.json'));
  if (!grading) continue;

  const exps = grading.expectations ?? [];
  const passed = exps.filter((e) => e.passed).length;
  grading.summary = { passed, failed: exps.length - passed, total: exps.length, pass_rate: exps.length ? passed / exps.length : 0 };
  writeFileSync(join(d.dir, 'grading.json'), `${JSON.stringify(grading, null, 2)}\n`);

  (byConfig[d.config] ??= []).push({
    case: d.testCase.name,
    run: d.run,
    ...grading.summary,
    findings_reported: grading.findings_reported ?? null,
    false_findings: (grading.false_findings ?? []).length,
    seconds: readJson(join(d.dir, 'timing.json'))?.total_duration_seconds ?? null,
  });
}

const summary = {
  skill,
  run: relative(ROOT, runRoot),
  graded_at: new Date().toISOString(),
  configs: Object.fromEntries(
    Object.entries(byConfig).map(([config, rows]) => [
      config,
      {
        pass_rate: mean(rows.map((r) => r.pass_rate)),
        passed: rows.reduce((a, r) => a + r.passed, 0),
        total: rows.reduce((a, r) => a + r.total, 0),
        false_findings: rows.reduce((a, r) => a + r.false_findings, 0),
        seconds: mean(rows.map((r) => r.seconds).filter((s) => s != null)),
        runs: rows,
      },
    ]),
  ),
};

const a = summary.configs['with-skill'];
const b = summary.configs['baseline'];
summary.delta_pass_rate = a && b ? Number((a.pass_rate - b.pass_rate).toFixed(3)) : null;

writeFileSync(join(runRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(runRoot, 'summary.md'), renderSummary(summary));
console.log(`\n${relative(ROOT, join(runRoot, 'summary.md'))}`);
console.log(renderSummary(summary));

// ---------------------------------------------------------------------------

function renderSummary(s) {
  const row = (name, c) =>
    c
      ? `| ${name} | ${(c.pass_rate * 100).toFixed(0)}% (${c.passed}/${c.total}) | ${c.false_findings} | ${c.seconds ? `${c.seconds.toFixed(0)}s` : '—'} |`
      : `| ${name} | — | — | — |`;
  return [
    `# skill-evals · ${s.skill}`,
    '',
    `Run: \`${s.run}\` · graded ${s.graded_at.slice(0, 10)}`,
    '',
    '| Config | Pass rate | False findings | Time (avg) |',
    '|---|---|---|---|',
    row('With skill', s.configs['with-skill']),
    row('Baseline', s.configs['baseline']),
    '',
    `Delta (pass rate): **${s.delta_pass_rate ?? '—'}**`,
    '',
    'A delta of 0 does not mean the skill is worthless — it means these cases do',
    'not separate it from an agent reading the repo. See the eval set README.',
    '',
  ].join('\n');
}

function claude(prompt) {
  return new Promise((done) => {
    const extra = process.env.CLAUDE_ARGS ? process.env.CLAUDE_ARGS.split(' ').filter(Boolean) : [];
    const child = spawn(CLAUDE_BIN, ['-p', prompt, ...extra], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', () => {
      console.error(`cannot run "${CLAUDE_BIN}" — install the Claude Code CLI or set CLAUDE_BIN.`);
      done(127);
    });
    child.on('close', (code) => done(code ?? 1));
  });
}

function readJson(p) {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
