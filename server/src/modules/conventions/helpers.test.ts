import { describe, expect, it } from 'vitest';
import {
  ExtractedConvention,
  buildExtractionMessages,
  clipFile,
  isInsideRoot,
  locateSnippet,
  normalizeRule,
  verifyCandidates,
  type SampleFile,
} from './helpers.js';
import { MAX_FILE_CHARS, MIN_SNIPPET_CHARS } from './constants.js';

const FILE = `import { Redis } from "ioredis";
import { config } from "./config";

export const redis = new Redis(config.redisUrl);

export async function getUser(id: string) {
  const user = await db.users.find(id);
  return ok(user);
}
`;

function candidate(over: Partial<ExtractedConvention> = {}): ExtractedConvention {
  return {
    category: 'structure',
    rule: 'Redis access goes through a single exported client',
    evidence_path: 'src/lib/redis.ts',
    evidence_snippet: 'export const redis = new Redis(config.redisUrl);',
    confidence: 0.85,
    ...over,
  };
}

const FILES: SampleFile[] = [{ path: 'src/lib/redis.ts', content: FILE }];

describe('locateSnippet', () => {
  it('finds an exact single-line snippet and returns its 1-based line', () => {
    expect(locateSnippet(FILE, 'export const redis = new Redis(config.redisUrl);')).toBe(4);
  });

  it('ignores indentation and inner whitespace differences', () => {
    expect(locateSnippet(FILE, '   const   user =  await db.users.find(id);  ')).toBe(7);
  });

  it('matches a snippet that is only part of the line', () => {
    // A model that copies the expression without the `export const` prefix has
    // still pointed at real code. Long enough to clear the substance floor.
    expect(locateSnippet(FILE, 'new Redis(config.redisUrl)')).toBe(4);
  });

  it('matches consecutive lines and reports the first', () => {
    const snippet = 'const user = await db.users.find(id);\nreturn ok(user);';
    expect(locateSnippet(FILE, snippet)).toBe(7);
  });

  it('skips blank lines inside a snippet rather than failing on them', () => {
    expect(locateSnippet(FILE, 'import { Redis } from "ioredis";\n\nimport { config }')).toBe(1);
  });

  it('matches a verbatim snippet that spans a blank line in the FILE', () => {
    // The direction that matters in production: the prompt demands lines copied
    // character-for-character, and file lines 2-4 have a blank between them.
    // Dropping blanks on the snippet side only made this honest copy unmatchable
    // and counted it as a fabrication.
    const snippet = [
      'import { config } from "./config";',
      '',
      'export const redis = new Redis(config.redisUrl);',
    ].join('\n');
    expect(locateSnippet(FILE, snippet)).toBe(2);
  });

  it('reports the file’s real line number, not the blank-stripped one', () => {
    // Two blank lines precede line 7 in FILE. A condensed index would say 5.
    expect(locateSnippet(FILE, 'const user = await db.users.find(id);')).toBe(7);
  });

  it('returns null when the code is not in the file', () => {
    expect(locateSnippet(FILE, 'export const mongo = new Mongo();')).toBeNull();
  });

  it('returns null for an empty snippet rather than matching line 1', () => {
    expect(locateSnippet(FILE, '   \n  ')).toBeNull();
  });

  it.each(['}', '});', 'const', 'import'])(
    'refuses %j — a fragment that matches everywhere identifies nothing',
    (fragment) => {
      // Without a substance floor these all "locate", and a model could attach
      // one to an invented rule and pass the evidence gate.
      expect(locateSnippet(FILE, fragment)).toBeNull();
    },
  );

  it('accepts a snippet just over the substance floor', () => {
    expect('return ok(user);'.length).toBeGreaterThanOrEqual(MIN_SNIPPET_CHARS);
    expect(locateSnippet(FILE, 'return ok(user);')).toBe(8);
  });

  it('does not match lines that are non-consecutive in the file', () => {
    // Both lines exist, but line 4 and line 7 are not adjacent.
    const snippet = 'export const redis = new Redis(config.redisUrl);\nreturn ok(user);';
    expect(locateSnippet(FILE, snippet)).toBeNull();
  });
});

describe('isInsideRoot', () => {
  // The predicate behind the sampler's symlink guard: any public repo can be
  // imported, so a file that resolves outside the clone must never be read.
  it('accepts the root itself and paths beneath it', () => {
    expect(isInsideRoot('/clones/repo', '/clones/repo', '/')).toBe(true);
    expect(isInsideRoot('/clones/repo', '/clones/repo/src/index.ts', '/')).toBe(true);
  });

  it('rejects a sibling whose name merely starts with the root', () => {
    // The trap the trailing separator exists for.
    expect(isInsideRoot('/clones/repo', '/clones/repo-evil/secrets.json', '/')).toBe(false);
  });

  it('rejects a path that resolved out of the clone entirely', () => {
    // What a committed `tsconfig.json -> ~/.devdigest/secrets.json` looks like
    // once realpath has collapsed the link.
    expect(isInsideRoot('/clones/repo', '/home/user/.devdigest/secrets.json', '/')).toBe(false);
  });

  it('works with Windows separators', () => {
    expect(isInsideRoot('C:\\clones\\repo', 'C:\\clones\\repo\\tsconfig.json', '\\')).toBe(true);
    expect(isInsideRoot('C:\\clones\\repo', 'C:\\Users\\PC\\.devdigest\\secrets.json', '\\')).toBe(
      false,
    );
  });
});

describe('normalizeRule', () => {
  // Against a literal, not against itself: `normalizeRule(a) === normalizeRule(b)`
  // is also satisfied by a normalizer that collapses every input to one token,
  // which would make every candidate after the first look like a duplicate.
  it('produces the expected normal form', () => {
    expect(normalizeRule('Always  use async/await.')).toBe('always use async/await');
  });

  it('keeps genuinely different rules apart', () => {
    expect(normalizeRule('Use async/await')).not.toBe(normalizeRule('Use Result types'));
  });
});

describe('verifyCandidates', () => {
  it('keeps a grounded candidate and attaches the derived line', () => {
    const { kept, droppedNoEvidence } = verifyCandidates([candidate()], FILES);
    expect(droppedNoEvidence).toBe(0);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.evidence_line).toBe(4);
  });

  it('gives the model no way to supply a line — the derived one is the only source', () => {
    // Structural: ExtractedConvention has no line field, and a model that sends
    // one anyway has it stripped. If someone adds one to the schema, this fails.
    expect('evidence_line' in candidate()).toBe(false);
    const parsed = ExtractedConvention.parse({ ...candidate(), evidence_line: 99 });
    expect(parsed).not.toHaveProperty('evidence_line');
  });

  it('keeps two genuinely different rules in one batch', () => {
    // The mirror of the dedupe tests: proves normalization separates as well as
    // it collapses, so an over-eager normalizer cannot silently swallow rules.
    const { kept, droppedDuplicate } = verifyCandidates(
      [candidate(), candidate({ rule: 'Handlers return ok() rather than raw values' })],
      FILES,
    );
    expect(kept).toHaveLength(2);
    expect(droppedDuplicate).toBe(0);
  });

  it('drops a candidate whose snippet is not in the named file', () => {
    const { kept, droppedNoEvidence } = verifyCandidates(
      [candidate({ evidence_snippet: 'export const mongo = new Mongo();' })],
      FILES,
    );
    expect(kept).toHaveLength(0);
    expect(droppedNoEvidence).toBe(1);
  });

  it('drops a candidate naming a file that was never sampled', () => {
    const { kept, droppedNoEvidence } = verifyCandidates(
      [candidate({ evidence_path: 'src/does/not/exist.ts' })],
      FILES,
    );
    expect(kept).toHaveLength(0);
    expect(droppedNoEvidence).toBe(1);
  });

  it('drops a rule the user already rejected, even reworded', () => {
    const { kept, droppedDuplicate, droppedNoEvidence } = verifyCandidates([candidate()], FILES, [
      'Redis  access goes through a single exported client.',
    ]);
    expect(kept).toHaveLength(0);
    // Counted as a duplicate, NOT as missing evidence: the model behaved
    // correctly here, and the wire field must not call this a fabrication.
    expect(droppedDuplicate).toBe(1);
    expect(droppedNoEvidence).toBe(0);
  });

  it('drops duplicates within one batch', () => {
    const { kept, droppedDuplicate } = verifyCandidates([candidate(), candidate()], FILES);
    expect(kept).toHaveLength(1);
    expect(droppedDuplicate).toBe(1);
  });

  it('keeps grounded candidates when others in the batch are dropped', () => {
    const good = candidate();
    const bad = candidate({ rule: 'Invented rule', evidence_snippet: 'nothing like this' });
    const { kept, droppedNoEvidence } = verifyCandidates([bad, good], FILES);
    expect(kept.map((k) => k.rule)).toEqual([good.rule]);
    expect(droppedNoEvidence).toBe(1);
  });
});

describe('buildExtractionMessages', () => {
  it('names every sampled path verbatim so evidence_path can match it', () => {
    const [, user] = buildExtractionMessages(FILES, 'SYS');
    expect(user!.content).toContain('### src/lib/redis.ts');
    expect(user!.content).toContain('new Redis(config.redisUrl)');
  });

  it('puts the system prompt in the system role', () => {
    const [system] = buildExtractionMessages(FILES, 'SYS');
    expect(system).toEqual({ role: 'system', content: 'SYS' });
  });
});

describe('clipFile', () => {
  it('leaves a small file alone', () => {
    expect(clipFile('short')).toBe('short');
  });

  it('truncates from the TAIL, keeping the head', () => {
    // Markers on both ends: a homogeneous fixture cannot tell head-truncation
    // from tail-truncation, and slicing the wrong end would send the model the
    // bottom of every large file while still passing a length check.
    const clipped = clipFile(`HEAD_MARKER${'x'.repeat(MAX_FILE_CHARS)}TAIL_MARKER`);
    expect(clipped.startsWith('HEAD_MARKER')).toBe(true);
    expect(clipped).not.toContain('TAIL_MARKER');
    expect(clipped.length).toBe(MAX_FILE_CHARS + 2); // clipped text + "\n…"
  });
});
