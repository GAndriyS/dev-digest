import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';

/**
 * L04 — the two persistent-blast behaviours the Blast Radius map depends on:
 * a caller cap that is PER SYMBOL, and a reverse import walk that is two
 * levels deep and survives cycles.
 *
 * No Postgres and no clone: the service's `repo` is patched, exactly like
 * `repo-intel-facade-degraded.test.ts` does, so these exercise the real
 * `tryPersistentBlast` code path against synthetic index rows.
 */

interface FakeIndex {
  /** symbol rows keyed by file */
  symbols: Record<string, Array<{ name: string; kind: string; line: number; endLine: number }>>;
  /** resolved references: caller file → the changed symbol it reaches */
  callers: Array<{ fromPath: string; toSymbol: string; line: number; rank: number }>;
  /** import edges: fromFile imports toFile */
  edges: Array<{ fromFile: string; toFile: string }>;
  /** precomputed per-file endpoints/crons */
  facts?: Record<string, { endpoints: string[]; crons: string[] }>;
}

function buildService(index: FakeIndex): RepoIntelService {
  const container = { config: { repoIntelEnabled: true }, db: {} as never } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    tryGetIndexState: async () => ({ status: 'full' }),
    getSymbolRows: async (_repoId: string, files: string[]) =>
      files.flatMap((path) =>
        (index.symbols[path] ?? []).map((s) => ({
          path,
          name: s.name,
          kind: s.kind,
          exported: true,
          line: s.line,
          endLine: s.endLine,
          signature: null,
        })),
      ),
    getResolvedCallers: async (_repoId: string, _declFiles: string[], names: string[]) =>
      index.callers.filter((c) => names.includes(c.toSymbol)),
    getDependentsOf: async (_repoId: string, files: string[]) =>
      index.edges.filter((e) => files.includes(e.toFile)),
    getFileFacts: async (_repoId: string, files: string[]) =>
      files
        .filter((f) => index.facts?.[f])
        .map((f) => ({
          filePath: f,
          endpoints: index.facts?.[f]?.endpoints ?? [],
          crons: index.facts?.[f]?.crons ?? [],
        })),
  };
  return svc;
}

describe('persistent blast — caller cap is per symbol', () => {
  it('two changed symbols each keep their own 20 callers', async () => {
    const wide = 25;
    const svc = buildService({
      symbols: {
        'src/a.ts': [{ name: 'alpha', kind: 'function', line: 1, endLine: 5 }],
        'src/b.ts': [{ name: 'beta', kind: 'function', line: 1, endLine: 5 }],
      },
      // `alpha`'s callers all outrank `beta`'s, so a GLOBAL slice would keep 20
      // alpha rows and leave `beta` looking like nothing calls it.
      callers: [
        ...Array.from({ length: wide }, (_, i) => ({
          fromPath: `src/callers/a${i}.ts`,
          toSymbol: 'alpha',
          line: i + 1,
          rank: 100 - i,
        })),
        ...Array.from({ length: wide }, (_, i) => ({
          fromPath: `src/callers/b${i}.ts`,
          toSymbol: 'beta',
          line: i + 1,
          rank: 10 - i / 100,
        })),
      ],
      edges: [],
    });

    const blast = await svc.getBlastRadius('r1', ['src/a.ts', 'src/b.ts']);
    const bySymbol = (name: string) => blast.callers.filter((c) => c.viaSymbol === name);

    expect(bySymbol('alpha')).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(bySymbol('beta')).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(blast.degraded).toBe(false);
  });

  it('keeps the highest-ranked callers within a symbol', async () => {
    const svc = buildService({
      symbols: { 'src/a.ts': [{ name: 'alpha', kind: 'function', line: 1, endLine: 5 }] },
      callers: Array.from({ length: MAX_CALLERS_PER_SYMBOL + 5 }, (_, i) => ({
        fromPath: `src/callers/a${i}.ts`,
        toSymbol: 'alpha',
        line: 1,
        rank: i, // the LAST ones are the highest-ranked
      })),
      edges: [],
    });

    const blast = await svc.getBlastRadius('r1', ['src/a.ts']);
    const ranks = blast.callers.map((c) => c.rank);
    expect(ranks).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(Math.min(...ranks)).toBe(5); // ranks 0-4 dropped, not 20-24
  });
});

describe('persistent blast — reverse import closure', () => {
  it('reaches an endpoint two levels away from the changed file', async () => {
    // C imports B imports A(changed). The endpoint is declared in C, which
    // never references the changed symbol at all.
    const svc = buildService({
      symbols: { 'src/a.ts': [{ name: 'helper', kind: 'function', line: 1, endLine: 3 }] },
      callers: [{ fromPath: 'src/b.ts', toSymbol: 'helper', line: 7, rank: 0.5 }],
      edges: [
        { fromFile: 'src/b.ts', toFile: 'src/a.ts' },
        { fromFile: 'src/c.ts', toFile: 'src/b.ts' },
      ],
      facts: { 'src/c.ts': { endpoints: ['GET /api/public/items'], crons: ['nightly'] } },
    });

    const blast = await svc.getBlastRadius('r1', ['src/a.ts']);

    expect(blast.dependentClosure?.['src/a.ts']).toEqual({
      level1: ['src/b.ts'],
      level2: ['src/c.ts'],
    });
    expect(blast.impactedEndpoints).toContain('GET /api/public/items');
    expect(blast.factsByFile?.['src/c.ts']?.crons).toEqual(['nightly']);
  });

  it('stops at two levels — a third hop is not reported', async () => {
    const svc = buildService({
      symbols: { 'src/a.ts': [{ name: 'helper', kind: 'function', line: 1, endLine: 3 }] },
      callers: [],
      edges: [
        { fromFile: 'src/b.ts', toFile: 'src/a.ts' },
        { fromFile: 'src/c.ts', toFile: 'src/b.ts' },
        { fromFile: 'src/d.ts', toFile: 'src/c.ts' },
      ],
      facts: { 'src/d.ts': { endpoints: ['GET /too/far'], crons: [] } },
    });

    const blast = await svc.getBlastRadius('r1', ['src/a.ts']);
    const closure = blast.dependentClosure?.['src/a.ts'];

    expect(closure?.level2).toEqual(['src/c.ts']);
    expect([...(closure?.level1 ?? []), ...(closure?.level2 ?? [])]).not.toContain('src/d.ts');
    expect(blast.impactedEndpoints).not.toContain('GET /too/far');
  });

  it("does not attribute a test file's routes as impacted endpoints", async () => {
    const svc = buildService({
      symbols: { 'src/a.ts': [{ name: 'helper', kind: 'function', line: 1, endLine: 3 }] },
      callers: [{ fromPath: 'src/a.test.ts', toSymbol: 'helper', line: 4, rank: 0.1 }],
      edges: [{ fromFile: 'src/a.test.ts', toFile: 'src/a.ts' }],
      facts: { 'src/a.test.ts': { endpoints: ['GET /health'], crons: [] } },
    });

    const blast = await svc.getBlastRadius('r1', ['src/a.ts']);

    // The spec is still a real caller...
    expect(blast.callers.map((c) => c.file)).toContain('src/a.test.ts');
    // ...but the routes it stands up are not endpoints that depend on the change.
    expect(blast.impactedEndpoints).not.toContain('GET /health');
  });

  it('terminates on an import cycle', async () => {
    const svc = buildService({
      symbols: { 'src/a.ts': [{ name: 'helper', kind: 'function', line: 1, endLine: 3 }] },
      callers: [],
      edges: [
        { fromFile: 'src/b.ts', toFile: 'src/a.ts' },
        { fromFile: 'src/a.ts', toFile: 'src/b.ts' }, // cycle back to the changed file
      ],
      facts: {},
    });

    const blast = await svc.getBlastRadius('r1', ['src/a.ts']);
    const closure = blast.dependentClosure?.['src/a.ts'];

    expect(closure?.level1).toEqual(['src/b.ts']);
    // `a.ts` is a root, so it must not come back as its own level-2 dependent.
    expect(closure?.level2).toEqual([]);
  });
});
