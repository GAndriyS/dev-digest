import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import {
  SkillImportError,
  buildSkillImportPreview,
  chooseMarkdownEntry,
  decodeImportPayload,
  extractSkillCore,
  fileExtension,
  filenameStem,
  firstHeading,
  firstParagraph,
  isArchiveNoise,
  isUnsafeArchivePath,
  readCentralDirectory,
  splitFrontMatter,
} from '../src/modules/skills/import.js';
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_ENTRY_UNCOMPRESSED_BYTES,
  MAX_IMPORT_BASE64_CHARS,
  MAX_IMPORT_NAME_CHARS,
  SKILL_IMPORT_CODES,
} from '../src/modules/skills/constants.js';
import { SkillsService } from '../src/modules/skills/service.js';
import type { Container } from '../src/platform/container.js';

/**
 * L02 — skill import. Hermetic: no database, no filesystem, no model call. Every
 * archive in this file is built in memory by `makeZip` below, which is also the
 * only way to write the hostile ones — a zip bomb or a zip-slip archive is not
 * something to commit as a fixture, and a fixture cannot be adjusted per test.
 *
 * The safety assertions are the point of the file. Each one pins a limit that
 * exists because an attacker controls the bytes on the other side of it.
 */

// ---- in-memory zip writer -------------------------------------------------

interface ZipEntrySpec {
  path: string;
  content?: string | Buffer;
  /** 0 = stored, 8 = deflate (default), anything else = unsupported method. */
  method?: number;
  /** Lie about the uncompressed size, the way a zip bomb's header does. */
  declaredUncompressedSize?: number;
}

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

/** Minimal zip writer: local headers, central directory, EOCD. No CRCs (unread). */
function makeZip(specs: ZipEntrySpec[], opts: { entryCountOverride?: number } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const spec of specs) {
    const name = Buffer.from(spec.path, 'utf8');
    const raw = Buffer.isBuffer(spec.content)
      ? spec.content
      : Buffer.from(spec.content ?? '', 'utf8');
    const method = spec.method ?? 8;
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const declared = spec.declaredUncompressedSize ?? raw.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + data.length;
  }

  const localBlock = Buffer.concat(locals);
  const centralBlock = Buffer.concat(centrals);
  const count = opts.entryCountOverride ?? specs.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16);

  return Buffer.concat([localBlock, centralBlock, eocd]);
}

/** Assert the call throws a SkillImportError with this code, always at 422. */
function expectImportError(fn: () => unknown, code: string): SkillImportError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(SkillImportError);
    const importErr = err as SkillImportError;
    expect(importErr.code).toBe(code);
    expect(importErr.statusCode).toBe(422);
    return importErr;
  }
  throw new Error(`expected ${code} to be thrown, but the call returned normally`);
}

const SKILL_MD = [
  '---',
  'name: api-contract-gate',
  'description: Treats a changed status code as breaking.',
  'type: convention',
  '---',
  '',
  '# API Contract Gate',
  '',
  'Any non-additive change to an existing contract is breaking.',
].join('\n');

// ---- front matter / heading extraction ------------------------------------

describe('splitFrontMatter', () => {
  it('reads flat key: value pairs and REMOVES the front matter from the body', () => {
    const { fields, body } = splitFrontMatter(SKILL_MD);
    expect(fields).toMatchObject({
      name: 'api-contract-gate',
      description: 'Treats a changed status code as breaking.',
      type: 'convention',
    });
    // The three keys were lifted into the preview's own fields; leaving the YAML
    // in the body would paste it into a review prompt as if it were policy.
    expect(body).not.toContain('---');
    expect(body.startsWith('# API Contract Gate')).toBe(true);
  });

  it('strips surrounding quotes from a value', () => {
    const { fields } = splitFrontMatter(['---', 'name: "quoted: name"', "type: 'rubric'", '---', 'x'].join('\n'));
    expect(fields['name']).toBe('quoted: name');
    expect(fields['type']).toBe('rubric');
  });

  it('ignores a nested YAML block instead of misreading its keys', () => {
    const { fields } = splitFrontMatter(
      ['---', 'name: onion', 'metadata:', '  version: 1.0.0', '  tags: a, b', '---', '# x'].join('\n'),
    );
    expect(fields['name']).toBe('onion');
    expect(fields['metadata']).toBe('');
    expect(fields['version']).toBeUndefined();
  });

  it('treats an unterminated fence as ordinary body text, not front matter', () => {
    const text = ['---', 'name: never-closed', '', '# Title'].join('\n');
    const { fields, body } = splitFrontMatter(text);
    expect(fields).toEqual({});
    expect(body).toBe(text);
  });

  it('tolerates a BOM and CRLF line endings', () => {
    const { fields, body } = splitFrontMatter('\uFEFF---\r\nname: crlf\r\n---\r\n# Title\r\n');
    expect(fields['name']).toBe('crlf');
    expect(body.startsWith('# Title')).toBe(true);
  });
});

describe('firstHeading / firstParagraph', () => {
  it('takes the first level-1 heading, not a level-2 one', () => {
    expect(firstHeading('## Section\n\n# Real Title\n\ntext')).toBe('Real Title');
  });

  it('ignores a "# comment" inside a fenced code block', () => {
    expect(firstHeading(['```bash', '# not a heading', '```', '', '# Actual Title'].join('\n'))).toBe(
      'Actual Title',
    );
  });

  it('returns undefined when there is no level-1 heading', () => {
    expect(firstHeading('## only\n\ntext')).toBeUndefined();
  });

  it('takes the first non-heading paragraph and collapses it to one line', () => {
    const body = ['# Title', '', 'First line of prose', 'wrapped across two.', '', 'Second para.'].join('\n');
    expect(firstParagraph(body)).toBe('First line of prose wrapped across two.');
  });

  it('skips a thematic break and a leading code fence', () => {
    expect(firstParagraph(['---', '', '```', 'code', '```', '', 'The prose.'].join('\n'))).toBe('The prose.');
  });

  it('returns undefined for a document with no prose', () => {
    expect(firstParagraph('# Only\n\n## Headings')).toBeUndefined();
  });
});

describe('extractSkillCore — precedence', () => {
  it('prefers front matter over the heading and the filename', () => {
    const core = extractSkillCore(SKILL_MD, 'ignored-stem');
    expect(core.name).toBe('api-contract-gate');
    expect(core.description).toBe('Treats a changed status code as breaking.');
    expect(core.type).toBe('convention');
  });

  it('falls back to the first heading, then the first paragraph', () => {
    const core = extractSkillCore('# No Front Matter\n\nWhat it does.\n', 'stem');
    expect(core.name).toBe('No Front Matter');
    expect(core.description).toBe('What it does.');
    expect(core.type).toBe('custom');
  });

  it('falls back to the filename stem when there is no heading', () => {
    const core = extractSkillCore('just prose, no heading\n', 'my-skill');
    expect(core.name).toBe('my-skill');
  });

  it('falls back to `custom` for a type outside the SkillType enum', () => {
    const core = extractSkillCore(['---', 'name: x', 'type: not-a-real-type', '---', 'body'].join('\n'), 's');
    expect(core.type).toBe('custom');
  });

  it('accepts every SkillType enum value from front matter', () => {
    for (const type of ['rubric', 'convention', 'security', 'custom']) {
      expect(extractSkillCore(['---', `type: ${type}`, '---', 'b'].join('\n'), 's').type).toBe(type);
    }
  });

  it('collapses whitespace and caps a pathologically long name', () => {
    const core = extractSkillCore(`# ${'x'.repeat(500)}\n\ntext`, 's');
    expect(core.name).toHaveLength(MAX_IMPORT_NAME_CHARS);
  });
});

describe('filename helpers', () => {
  it('reads the extension and stem from either separator', () => {
    expect(fileExtension('a/b/SKILL.MD')).toBe('.md');
    expect(fileExtension('C:\\tmp\\pack.zip')).toBe('.zip');
    expect(fileExtension('LICENSE')).toBe('');
    expect(filenameStem('skills/api-contract-gate.md')).toBe('api-contract-gate');
  });

  it('does not treat a dotfile as all-extension', () => {
    expect(fileExtension('.gitignore')).toBe('');
    expect(filenameStem('.gitignore')).toBe('.gitignore');
  });
});

// ---- base64 payload -------------------------------------------------------

describe('decodeImportPayload', () => {
  it('decodes plain base64 and strips a data-URL prefix', () => {
    const raw = Buffer.from('# hi', 'utf8').toString('base64');
    expect(decodeImportPayload(raw).toString()).toBe('# hi');
    expect(decodeImportPayload(`data:text/markdown;base64,${raw}`).toString()).toBe('# hi');
  });

  it('rejects a payload over the encoded-size cap', () => {
    const err = expectImportError(
      () => decodeImportPayload('A'.repeat(MAX_IMPORT_BASE64_CHARS + 1)),
      SKILL_IMPORT_CODES.tooLarge,
    );
    expect(err.details).toMatchObject({ limit: MAX_IMPORT_BASE64_CHARS });
  });

  it('rejects non-base64 rather than silently decoding garbage', () => {
    expectImportError(() => decodeImportPayload('not base64 !!!'), SKILL_IMPORT_CODES.invalidBase64);
    expectImportError(() => decodeImportPayload('   '), SKILL_IMPORT_CODES.invalidBase64);
  });
});

// ---- path safety ----------------------------------------------------------

describe('isUnsafeArchivePath — zip-slip', () => {
  it.each([
    ['../etc/passwd'],
    ['a/../../b.md'],
    ['..\\..\\windows\\system32\\x.md'],
    ['/etc/passwd'],
    ['//host/share/x.md'],
    ['C:/Windows/x.md'],
    ['C:x.md'],
    ['ok\0/../evil.md'],
    [''],
  ])('rejects %j', (path) => {
    expect(isUnsafeArchivePath(path)).toBe(true);
  });

  it.each([['SKILL.md'], ['skills/api/SKILL.md'], ['a..b/x.md'], ['...md']])(
    'accepts %j',
    (path) => {
      expect(isUnsafeArchivePath(path)).toBe(false);
    },
  );

  it('refuses the WHOLE archive when any entry escapes the root', () => {
    const zip = makeZip([
      { path: 'SKILL.md', content: '# Fine' },
      { path: '../../etc/cron.d/evil', content: 'x' },
    ]);
    expectImportError(
      () => buildSkillImportPreview('pack.zip', zip),
      SKILL_IMPORT_CODES.unsafePath,
    );
  });
});

// ---- markdown upload ------------------------------------------------------

describe('buildSkillImportPreview — a bare markdown file', () => {
  it('previews the file with its own name as the single source file', () => {
    const preview = buildSkillImportPreview('api-contract-gate.md', Buffer.from(SKILL_MD, 'utf8'));
    expect(preview).toMatchObject({
      name: 'api-contract-gate',
      type: 'convention',
      source_files: ['api-contract-gate.md'],
      skipped_files: [],
    });
    expect(preview.body).toContain('# API Contract Gate');
  });

  it('accepts .markdown as well as .md', () => {
    expect(buildSkillImportPreview('x.markdown', Buffer.from('# T\n\nP.', 'utf8')).name).toBe('T');
  });

  it('rejects an empty (whitespace-only) file', () => {
    expectImportError(
      () => buildSkillImportPreview('x.md', Buffer.from('   \n\n', 'utf8')),
      SKILL_IMPORT_CODES.empty,
    );
  });

  it('rejects a markdown file over the per-entry size cap', () => {
    const huge = Buffer.alloc(MAX_ENTRY_UNCOMPRESSED_BYTES + 1, 0x61);
    expectImportError(
      () => buildSkillImportPreview('x.md', huge),
      SKILL_IMPORT_CODES.entryTooLarge,
    );
  });

  it('refuses any other extension instead of sniffing the bytes', () => {
    for (const filename of ['install.sh', 'skill.txt', 'pack.tar.gz', 'noext']) {
      expectImportError(
        () => buildSkillImportPreview(filename, Buffer.from('# T', 'utf8')),
        SKILL_IMPORT_CODES.unsupportedFile,
      );
    }
  });
});

// ---- archive upload -------------------------------------------------------

describe('buildSkillImportPreview — an archive', () => {
  it('reads a deflated SKILL.md and lists nothing as skipped', () => {
    const preview = buildSkillImportPreview('pack.zip', makeZip([{ path: 'SKILL.md', content: SKILL_MD }]));
    expect(preview.name).toBe('api-contract-gate');
    expect(preview.source_files).toEqual(['SKILL.md']);
    expect(preview.skipped_files).toEqual([]);
  });

  it('reads a STORED (uncompressed) entry too', () => {
    const zip = makeZip([{ path: 'SKILL.md', content: '# Stored\n\nProse.', method: 0 }]);
    expect(buildSkillImportPreview('pack.zip', zip).name).toBe('Stored');
  });

  it('skips every non-markdown entry and never reads it', () => {
    const zip = makeZip([
      { path: 'skill/SKILL.md', content: SKILL_MD },
      { path: 'skill/install.sh', content: '#!/bin/sh\nrm -rf /\n' },
      { path: 'skill/hook.js', content: 'process.exit(1)' },
      { path: 'skill/logo.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      { path: 'skill/Makefile', content: 'all:\n\t:' },
    ]);
    const preview = buildSkillImportPreview('pack.zip', zip);
    expect(preview.source_files).toEqual(['skill/SKILL.md']);
    expect(preview.skipped_files).toEqual([
      'skill/Makefile',
      'skill/hook.js',
      'skill/install.sh',
      'skill/logo.png',
    ]);
    // The executable content is nowhere near the preview.
    expect(preview.body).not.toContain('rm -rf');
  });

  it('normalises backslash separators, as written by PowerShell Compress-Archive', () => {
    const zip = makeZip([
      { path: 'skills\\api-gate\\SKILL.md', content: SKILL_MD },
      { path: 'install.sh', content: 'rm -rf /' },
    ]);
    const preview = buildSkillImportPreview('pack.zip', zip);
    expect(preview.name).toBe('api-contract-gate');
    expect(preview.source_files).toEqual(['skills/api-gate/SKILL.md']);
    expect(preview.skipped_files).toEqual(['install.sh']);
  });

  it('treats a backslash-separated directory entry as a directory', () => {
    const zip = makeZip([
      { path: 'skills\\', content: '', method: 0 },
      { path: 'skills\\SKILL.md', content: '# T\n\nP.' },
    ]);
    expect(buildSkillImportPreview('pack.zip', zip).skipped_files).toEqual([]);
  });

  it('does not list directory entries as skipped files', () => {
    const zip = makeZip([
      { path: 'skill/', content: '', method: 0 },
      { path: 'skill/SKILL.md', content: '# T\n\nP.' },
    ]);
    expect(buildSkillImportPreview('pack.zip', zip).skipped_files).toEqual([]);
  });

  it('prefers SKILL.md over other markdown, and lists the rest as sources', () => {
    const zip = makeZip([
      { path: 'docs/a.md', content: '# A' },
      { path: 'deep/nested/SKILL.md', content: '# Chosen\n\nProse.' },
      { path: 'README.md', content: '# R' },
    ]);
    const preview = buildSkillImportPreview('pack.zip', zip);
    expect(preview.name).toBe('Chosen');
    expect(preview.source_files[0]).toBe('deep/nested/SKILL.md');
    expect(preview.source_files.slice(1)).toEqual(['README.md', 'docs/a.md']);
  });

  it('falls back to the shortest markdown path when there is no SKILL.md', () => {
    const zip = makeZip([
      { path: 'docs/reference/appendix.md', content: '# Appendix' },
      { path: 'rules.md', content: '# Rules\n\nProse.' },
    ]);
    expect(buildSkillImportPreview('pack.zip', zip).name).toBe('Rules');
  });

  it('skips macOS AppleDouble sidecars that merely look like markdown', () => {
    const zip = makeZip([
      { path: '__MACOSX/._SKILL.md', content: Buffer.from([0x00, 0x05, 0x16, 0x07]) },
      { path: 'SKILL.md', content: '# Real\n\nProse.' },
    ]);
    const preview = buildSkillImportPreview('pack.zip', zip);
    expect(preview.name).toBe('Real');
    expect(preview.skipped_files).toEqual(['__MACOSX/._SKILL.md']);
    expect(isArchiveNoise('__MACOSX/x/._a.md')).toBe(true);
  });

  it('skips a markdown entry compressed with an unsupported method', () => {
    const zip = makeZip([
      { path: 'bzipped.md', content: '# Unreadable', method: 12 },
      { path: 'plain.md', content: '# Readable\n\nProse.' },
    ]);
    const preview = buildSkillImportPreview('pack.zip', zip);
    expect(preview.name).toBe('Readable');
    expect(preview.source_files).toEqual(['plain.md']);
    expect(preview.skipped_files).toEqual(['bzipped.md']);
  });

  it('reports no_markdown when the only markdown uses an unsupported method', () => {
    const zip = makeZip([{ path: 'only.md', content: '# X', method: 12 }]);
    const err = expectImportError(
      () => buildSkillImportPreview('pack.zip', zip),
      SKILL_IMPORT_CODES.noMarkdown,
    );
    expect(err.details).toMatchObject({ skipped_files: ['only.md'] });
  });

  it('reports no_markdown for an archive with no markdown at all', () => {
    expectImportError(
      () => buildSkillImportPreview('pack.zip', makeZip([{ path: 'run.sh', content: 'echo' }])),
      SKILL_IMPORT_CODES.noMarkdown,
    );
  });

  it('uses the ARCHIVE name as the fallback, never the "SKILL" stem', () => {
    const zip = makeZip([{ path: 'SKILL.md', content: 'prose with no heading\n' }]);
    expect(buildSkillImportPreview('my-imported-skill.zip', zip).name).toBe('my-imported-skill');
  });

  it('rejects an empty markdown entry', () => {
    expectImportError(
      () => buildSkillImportPreview('pack.zip', makeZip([{ path: 'SKILL.md', content: '\n \n' }])),
      SKILL_IMPORT_CODES.empty,
    );
  });
});

// ---- zip bombs and malformed containers -----------------------------------

describe('archive size caps', () => {
  it('rejects an entry whose DECLARED size is over the per-entry cap', () => {
    const zip = makeZip([
      { path: 'SKILL.md', content: '# T', declaredUncompressedSize: MAX_ENTRY_UNCOMPRESSED_BYTES + 1 },
    ]);
    const err = expectImportError(
      () => buildSkillImportPreview('pack.zip', zip),
      SKILL_IMPORT_CODES.entryTooLarge,
    );
    expect(err.details).toMatchObject({ limit: MAX_ENTRY_UNCOMPRESSED_BYTES });
  });

  it('rejects an archive whose entries SUM over the total cap', () => {
    // Nine entries of exactly 1 MiB each: every one passes the per-entry cap,
    // the sum does not. This is the aggregate half of the bomb defence.
    const specs = Array.from({ length: 9 }, (_, i) => ({
      path: `f${i}.bin`,
      content: 'x',
      declaredUncompressedSize: MAX_ENTRY_UNCOMPRESSED_BYTES,
    }));
    expectImportError(
      () => buildSkillImportPreview('pack.zip', makeZip(specs)),
      SKILL_IMPORT_CODES.archiveTooLarge,
    );
  });

  it('rejects an archive with more entries than the cap, before reading any', () => {
    const zip = makeZip([{ path: 'SKILL.md', content: '# T' }], {
      entryCountOverride: MAX_ARCHIVE_ENTRIES + 1,
    });
    expectImportError(() => buildSkillImportPreview('pack.zip', zip), SKILL_IMPORT_CODES.tooManyEntries);
  });

  it('catches a header that LIES about the uncompressed size', () => {
    // The classic bomb: 4 MiB of zeros deflates to a few KiB, and the central
    // directory claims 12 bytes so the pre-inflate cap waves it through. Only
    // zlib's maxOutputLength stops it.
    const bomb = Buffer.alloc(4 * 1024 * 1024, 0);
    const zip = makeZip([{ path: 'SKILL.md', content: bomb, declaredUncompressedSize: 12 }]);
    expectImportError(
      () => buildSkillImportPreview('pack.zip', zip),
      SKILL_IMPORT_CODES.entryTooLarge,
    );
  });
});

describe('malformed containers answer 422, never a RangeError', () => {
  it('rejects bytes that are not a zip at all', () => {
    expectImportError(
      () => buildSkillImportPreview('pack.zip', Buffer.from('this is not a zip file', 'utf8')),
      SKILL_IMPORT_CODES.badArchive,
    );
  });

  it('rejects an archive truncated after its central directory offset', () => {
    const zip = makeZip([{ path: 'SKILL.md', content: SKILL_MD }]);
    const truncated = Buffer.concat([zip.subarray(0, 20), zip.subarray(zip.length - 22)]);
    expectImportError(
      () => buildSkillImportPreview('pack.zip', truncated),
      SKILL_IMPORT_CODES.badArchive,
    );
  });

  it('rejects a zip64 archive rather than misreading its sentinels', () => {
    const zip = makeZip([{ path: 'SKILL.md', content: SKILL_MD }]);
    zip.writeUInt16LE(0xffff, zip.length - 22 + 10);
    expectImportError(() => readCentralDirectory(zip), SKILL_IMPORT_CODES.badArchive);
  });

  it('rejects a corrupt central directory header signature', () => {
    const zip = makeZip([{ path: 'SKILL.md', content: SKILL_MD }]);
    const centralOffset = zip.readUInt32LE(zip.length - 22 + 16);
    zip.writeUInt32LE(0xdeadbeef, centralOffset);
    expectImportError(() => readCentralDirectory(zip), SKILL_IMPORT_CODES.badArchive);
  });
});

describe('chooseMarkdownEntry', () => {
  it('is deterministic for equal-length paths', () => {
    expect(chooseMarkdownEntry(['b/x.md', 'a/y.md'])).toBe('a/y.md');
  });

  it('returns undefined for an empty candidate list', () => {
    expect(chooseMarkdownEntry([])).toBeUndefined();
  });

  it('matches SKILL.md case-insensitively, at any depth', () => {
    expect(chooseMarkdownEntry(['a.md', 'deep/deeper/skill.MD'])).toBe('deep/deeper/skill.MD');
  });
});

// ---- the service seam -----------------------------------------------------

describe('SkillsService.importPreview', () => {
  /** A repository that fails loudly if the preview touches persistence. */
  const forbiddenRepo = new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(`importPreview must not persist anything (called repo.${String(prop)})`);
      },
    },
  );
  const container = { skillsRepo: forbiddenRepo } as unknown as Container;

  it('returns the preview and writes nothing', async () => {
    const service = new SkillsService(container);
    const preview = await service.importPreview({
      filename: 'api-contract-gate.md',
      content_base64: Buffer.from(SKILL_MD, 'utf8').toString('base64'),
    });
    expect(preview.name).toBe('api-contract-gate');
    expect(preview.source_files).toEqual(['api-contract-gate.md']);
  });

  it('surfaces a parse failure as a 422 AppError, not a 500', async () => {
    const service = new SkillsService(container);
    await expect(
      service.importPreview({
        filename: 'pack.zip',
        content_base64: Buffer.from('nope', 'utf8').toString('base64'),
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: SKILL_IMPORT_CODES.badArchive });
  });
});
