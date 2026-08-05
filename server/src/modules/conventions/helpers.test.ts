import { describe, expect, it } from 'vitest';
import {
  buildExtractionMessages,
  clipFile,
  locateSnippet,
  normalizeRule,
  verifyCandidates,
  type ExtractedConvention,
  type SampleFile,
} from './helpers.js';
import { MAX_FILE_CHARS } from './constants.js';

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
    expect(locateSnippet(FILE, 'new Redis(')).toBe(4);
  });

  it('matches consecutive lines and reports the first', () => {
    const snippet = 'const user = await db.users.find(id);\nreturn ok(user);';
    expect(locateSnippet(FILE, snippet)).toBe(7);
  });

  it('skips blank lines inside a snippet rather than failing on them', () => {
    expect(locateSnippet(FILE, 'import { Redis } from "ioredis";\n\nimport { config }')).toBe(1);
  });

  it('returns null when the code is not in the file', () => {
    expect(locateSnippet(FILE, 'export const mongo = new Mongo();')).toBeNull();
  });

  it('returns null for an empty snippet rather than matching line 1', () => {
    expect(locateSnippet(FILE, '   \n  ')).toBeNull();
  });

  it('does not match lines that are non-consecutive in the file', () => {
    // Both lines exist, but line 4 and line 7 are not adjacent.
    const snippet = 'export const redis = new Redis(config.redisUrl);\nreturn ok(user);';
    expect(locateSnippet(FILE, snippet)).toBeNull();
  });
});

describe('normalizeRule', () => {
  it('folds case, trailing punctuation and repeated spaces together', () => {
    expect(normalizeRule('Always  use async/await.')).toBe(normalizeRule('always use async/await'));
  });
});

describe('verifyCandidates', () => {
  it('keeps a grounded candidate and attaches the derived line', () => {
    const { kept, dropped } = verifyCandidates([candidate()], FILES);
    expect(dropped).toBe(0);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.evidence_line).toBe(4);
  });

  it('overrides a line number the model got wrong', () => {
    // Nothing in ExtractedConvention carries a line — proving the point that the
    // derived value is the only source. Guard against that changing silently.
    const { kept } = verifyCandidates([candidate()], FILES);
    expect(kept[0]!.evidence_line).toBe(4);
    expect('evidence_line' in candidate()).toBe(false);
  });

  it('drops a candidate whose snippet is not in the named file', () => {
    const { kept, dropped } = verifyCandidates(
      [candidate({ evidence_snippet: 'export const mongo = new Mongo();' })],
      FILES,
    );
    expect(kept).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('drops a candidate naming a file that was never sampled', () => {
    const { kept, dropped } = verifyCandidates(
      [candidate({ evidence_path: 'src/does/not/exist.ts' })],
      FILES,
    );
    expect(kept).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('drops a rule the user already rejected, even reworded', () => {
    const { kept, dropped } = verifyCandidates([candidate()], FILES, [
      'Redis  access goes through a single exported client.',
    ]);
    expect(kept).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('drops duplicates within one batch', () => {
    const { kept, dropped } = verifyCandidates([candidate(), candidate()], FILES);
    expect(kept).toHaveLength(1);
    expect(dropped).toBe(1);
  });

  it('keeps grounded candidates when others in the batch are dropped', () => {
    const good = candidate();
    const bad = candidate({ rule: 'Invented rule', evidence_snippet: 'nothing like this' });
    const { kept, dropped } = verifyCandidates([bad, good], FILES);
    expect(kept.map((k) => k.rule)).toEqual([good.rule]);
    expect(dropped).toBe(1);
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

  it('truncates a file past the cap', () => {
    const clipped = clipFile('x'.repeat(MAX_FILE_CHARS + 500));
    expect(clipped.length).toBeLessThan(MAX_FILE_CHARS + 10);
    expect(clipped.endsWith('…')).toBe(true);
  });
});
