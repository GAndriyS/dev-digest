#!/usr/bin/env node
/**
 * skill-evals — run a skill's own eval set, with the skill and without it.
 *
 *   node skill-evals/run.mjs --skill onion-architecture
 *   node skill-evals/run.mjs --skill onion-architecture --runs 3 --config with-skill
 *   node skill-evals/run.mjs --skill onion-architecture --case core-purity --dry-run
 *
 * Cases live with the skill (`.claude/skills/<skill>/evals/evals.json`) so the
 * skill can be delivered with its tests attached; only this harness stays here.
 *
 * The two configurations differ in exactly one thing: `with-skill` is told to
 * read the skill first, `baseline` is forbidden from reading `.claude/skills/`
 * at all. Everything else — prompt, repo access, model — is identical, because
 * the number we want is the skill's marginal value over an agent that already
 * has this repository in front of it.
 *
 * Fixture integrity is checked here rather than asked of the grader: the runner
 * hashes every fixture before and after a run, so "the agent edited the code it
 * was asked to review" is a fact, not a judgement call.
 *
 * Requires the Claude Code CLI on PATH (or $CLAUDE_BIN). This machine did not
 * have it when the harness was written, so the spawn path is unexercised —
 * `--dry-run` writes every prompt without executing anything and is the way to
 * check wiring before spending tokens.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CONFIGS = ['with-skill', 'baseline'];

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);

const skill = opt('skill');
const runs = Number(opt('runs', '1'));
const only = opt('case');
const configs = (opt('config') ?? CONFIGS.join(',')).split(',').map((s) => s.trim());
const dryRun = flag('dry-run');

if (!skill || !Number.isFinite(runs) || configs.some((c) => !CONFIGS.includes(c))) {
  console.error(
    'usage: node skill-evals/run.mjs --skill <name> [--runs N] [--case <name>] ' +
      `[--config ${CONFIGS.join(',')}] [--out DIR] [--dry-run]`,
  );
  process.exit(2);
}

const skillDir = join(ROOT, '.claude/skills', skill);
const evalsFile = join(skillDir, 'evals/evals.json');
if (!existsSync(evalsFile)) {
  console.error(`no eval set for "${skill}" — expected ${relative(ROOT, evalsFile)}`);
  console.error('skills that ship one:', listSkillsWithEvals().join(', ') || '(none)');
  process.exit(2);
}

const suite = JSON.parse(readFileSync(evalsFile, 'utf8'));
const cases = only ? suite.cases.filter((c) => c.name === only) : suite.cases;
if (cases.length === 0) {
  console.error(`no case named "${only}" in ${relative(ROOT, evalsFile)}`);
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outRoot = resolve(ROOT, opt('out', join('skill-evals/results', `${skill}-${stamp}`)));
const fixturesDir = join(skillDir, 'evals/fixtures');

console.log(`skill-evals · ${skill} · ${cases.length} case(s) × ${configs.length} config(s) × ${runs} run(s)`);
console.log(`out: ${relative(ROOT, outRoot)}${dryRun ? ' (dry run — nothing is executed)' : ''}`);

const before = hashTree(fixturesDir);
const results = [];

for (const testCase of cases) {
  for (const config of configs) {
    for (let run = 1; run <= runs; run++) {
      const runDir = join(outRoot, `case-${testCase.id}-${testCase.name}`, config, `run-${run}`);
      const outputs = join(runDir, 'outputs');
      mkdirSync(outputs, { recursive: true });

      const prompt = buildPrompt(testCase, config, outputs);
      writeFileSync(join(runDir, 'prompt.txt'), prompt);

      if (dryRun) {
        console.log(`  [dry] ${testCase.name} · ${config} · run-${run}`);
        continue;
      }

      const started = Date.now();
      const code = await claude(prompt, runDir);
      const seconds = (Date.now() - started) / 1000;
      writeFileSync(
        join(runDir, 'timing.json'),
        `${JSON.stringify({ total_duration_seconds: Number(seconds.toFixed(1)), exit_code: code }, null, 2)}\n`,
      );
      results.push({ case: testCase.name, config, run, seconds, code });
      console.log(`  ${code === 0 ? '✓' : '✗'} ${testCase.name} · ${config} · run-${run} · ${seconds.toFixed(0)}s`);
    }
  }
}

const after = hashTree(fixturesDir);
const touched = Object.keys(before).filter((f) => before[f] !== after[f]);
writeFileSync(
  join(outRoot, 'fixture-integrity.json'),
  `${JSON.stringify({ touched, clean: touched.length === 0 }, null, 2)}\n`,
);
if (touched.length > 0) {
  console.error('\nfixtures were modified during the run — every case is void:', touched.join(', '));
  console.error('restore them (git checkout) before trusting any result.');
  process.exit(1);
}

if (!dryRun) {
  console.log(`\ndone · ${results.filter((r) => r.code === 0).length}/${results.length} runs exited clean`);
  console.log(`grade them: node skill-evals/grade.mjs --run ${relative(ROOT, outRoot)}`);
}

// ---------------------------------------------------------------------------

function buildPrompt(testCase, config, outputs) {
  const fixturesRel = relative(ROOT, fixturesDir);
  const body = testCase.prompt
    .replaceAll('{FIXTURES}', fixturesRel)
    .replaceAll('{OUTPUT}', relative(ROOT, outputs));

  const preamble =
    config === 'with-skill'
      ? `Read ${relative(ROOT, join(skillDir, 'SKILL.md'))} first and follow it (read the files it points at, if any).`
      : `Do NOT read anything under .claude/skills/ except the fixture files named below — this run works without the skill library. Rely on the repository itself and your own judgement.`;

  return [
    preamble,
    '',
    'Task from the user:',
    body,
    '',
    'Rules for this run:',
    '- Do NOT modify the fixture files. This is a review, not a fix.',
    `- Write exactly one output file: ${relative(ROOT, join(outputs, 'review.md'))}`,
    '- Answer in the language the user asked in.',
  ].join('\n');
}

function claude(prompt, runDir) {
  return new Promise((done) => {
    const extra = process.env.CLAUDE_ARGS ? process.env.CLAUDE_ARGS.split(' ').filter(Boolean) : [];
    const child = spawn(CLAUDE_BIN, ['-p', prompt, ...extra], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    child.on('error', (err) => {
      writeFileSync(join(runDir, 'agent.log'), String(err));
      console.error(`\ncannot run "${CLAUDE_BIN}" — install the Claude Code CLI or set CLAUDE_BIN.`);
      done(127);
    });
    child.on('close', (code) => {
      writeFileSync(join(runDir, 'agent.log'), Buffer.concat(chunks).toString());
      done(code ?? 1);
    });
  });
}

function hashTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

function listSkillsWithEvals() {
  const base = join(ROOT, '.claude/skills');
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((name) => existsSync(join(base, name, 'evals/evals.json')));
}
