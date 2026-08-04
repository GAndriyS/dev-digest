import { inflateRawSync } from 'node:zlib';
import { SkillType } from '@devdigest/shared';
import type { SkillImportPreview } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import {
  IMPORT_FALLBACK_NAME,
  MAX_ARCHIVE_ENTRIES,
  MAX_ENTRY_UNCOMPRESSED_BYTES,
  MAX_IMPORT_BASE64_CHARS,
  MAX_IMPORT_DESCRIPTION_CHARS,
  MAX_IMPORT_NAME_CHARS,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  SKILL_IMPORT_CODES,
} from './constants.js';

/**
 * A1 — skill import (L02). Turns an uploaded `.md` or `.zip` into a PREVIEW of
 * the skill inside it. Pure: no database, no filesystem, no subprocess, so
 * every rule below is unit-testable with a Buffer.
 *
 * # The two properties this file exists to guarantee
 *
 * **Nothing is executed.** An archive can contain `install.sh`, a `.js` hook, a
 * symlink, a `Makefile`. We do not run, spawn, resolve or even READ any of it —
 * only entries whose path ends in `.md`/`.markdown` are ever decompressed, and
 * a markdown body is text that later goes into a prompt, never into a shell.
 *
 * **Nothing touches disk.** The archive is parsed out of the Buffer it arrived
 * in. There is no temp directory to zip-slip into and no file to leave behind
 * if the user walks away from the preview. Path safety is still enforced
 * (`assertSafeArchivePath`) because a path that tries to escape is evidence of
 * a hostile archive, and refusing it is cheaper than proving it is harmless.
 *
 * # Why a hand-rolled zip reader
 *
 * No new npm dependency. The zip container is a few fixed-width headers, and
 * Node ships the only hard part (`zlib.inflateRawSync`). We read the CENTRAL
 * DIRECTORY rather than scanning for local headers: the central directory is
 * the archive's authoritative index, it carries real sizes even when the local
 * header defers them to a data descriptor (general-purpose bit 3), and scanning
 * for `PK\x03\x04` would happily "find" entries inside compressed data.
 *
 * Zip64 and encrypted entries are refused, not half-supported. Compression
 * methods other than stored (0) and deflate (8) are skipped per entry.
 */

// ---- errors ---------------------------------------------------------------

/**
 * Every import failure is a 422. A hostile or malformed upload is bad INPUT;
 * answering 500 would both hide the reason from the user and light up the error
 * dashboards on something a stranger can trigger at will.
 */
export class SkillImportError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, 422, details);
    this.name = 'SkillImportError';
  }
}

// ---- filename helpers -----------------------------------------------------

/** Last path segment, with both separators treated as separators. */
export function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? '';
}

/** Lower-cased extension INCLUDING the dot, or `''` when there is none. */
export function fileExtension(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/** Filename without its extension — the last-resort source of a skill name. */
export function filenameStem(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  return (dot <= 0 ? base : base.slice(0, dot)).trim();
}

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(fileExtension(path));
}

/**
 * Archive noise that merely LOOKS like markdown. macOS writes an AppleDouble
 * sidecar `__MACOSX/foo/._SKILL.md` next to every file it zips; it ends in `.md`
 * and contains binary resource-fork data. Treating it as a candidate would let
 * a zip made on a Mac preview as mojibake.
 */
export function isArchiveNoise(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return normalized.startsWith('__MACOSX/') || basename(normalized).startsWith('._');
}

// ---- path safety (zip-slip) ----------------------------------------------

/**
 * Reject any entry path that does not stay inside the archive root.
 *
 * We never write these paths, so this is defence in depth rather than the only
 * thing standing between us and an overwritten `~/.ssh/authorized_keys`. It is
 * still enforced: an archive containing `../../etc/passwd` is not a skill
 * someone assembled by accident, and the honest response to it is to refuse the
 * whole upload rather than to quietly preview the harmless half.
 *
 * Refused: absolute (`/etc/x`), UNC (`//host/share`), Windows drive-relative
 * (`C:x`) and drive-absolute (`C:/x`) paths, any `..` segment, and embedded NUL
 * (a classic way to make a path look different to two different parsers).
 */
export function isUnsafeArchivePath(rawPath: string): boolean {
  const path = rawPath.replace(/\\/g, '/');
  if (path.length === 0) return true;
  if (path.includes('\0')) return true;
  if (path.startsWith('/')) return true;
  if (/^[A-Za-z]:/.test(path)) return true;
  return path.split('/').some((segment) => segment === '..');
}

function assertSafeArchivePath(rawPath: string): void {
  if (isUnsafeArchivePath(rawPath)) {
    throw new SkillImportError(
      SKILL_IMPORT_CODES.unsafePath,
      `Archive entry "${rawPath}" points outside the archive root. Refusing the upload.`,
      { entry: rawPath },
    );
  }
}

// ---- base64 payload -------------------------------------------------------

/** Base64 alphabet plus whitespace; padding only at the end. */
const BASE64_RE = /^[A-Za-z0-9+/\s]*={0,2}$/;

/**
 * Decode `content_base64` into the raw file bytes.
 *
 * The length cap is checked FIRST, before the regex and before decoding, so an
 * oversized payload costs one comparison rather than a scan and a 3/4-size
 * allocation. `Buffer.from(s, 'base64')` silently ignores garbage, which would
 * turn a wrong-field paste into a confusing "not a valid zip" further down, so
 * the alphabet is validated explicitly.
 */
export function decodeImportPayload(contentBase64: string): Buffer {
  const payload = contentBase64.replace(/^data:[^;,]*;base64,/, '').trim();

  if (payload.length > MAX_IMPORT_BASE64_CHARS) {
    throw new SkillImportError(
      SKILL_IMPORT_CODES.tooLarge,
      `Upload is too large: ${payload.length} encoded characters, limit ${MAX_IMPORT_BASE64_CHARS}.`,
      { encoded_chars: payload.length, limit: MAX_IMPORT_BASE64_CHARS },
    );
  }
  if (payload.length === 0 || !BASE64_RE.test(payload)) {
    throw new SkillImportError(
      SKILL_IMPORT_CODES.invalidBase64,
      '`content_base64` is not valid base64.',
    );
  }

  const bytes = Buffer.from(payload, 'base64');
  if (bytes.length === 0) {
    throw new SkillImportError(SKILL_IMPORT_CODES.invalidBase64, 'The uploaded file is empty.');
  }
  return bytes;
}

// ---- markdown extraction --------------------------------------------------

const FRONT_MATTER_FENCE = /^---[ \t]*$/;
const CODE_FENCE = /^(?:```|~~~)/;
const THEMATIC_BREAK = /^(?:-{3,}|\*{3,}|_{3,})$/;

export interface MarkdownDocument {
  /** Flat top-level `key: value` pairs from the YAML front matter, lower-cased keys. */
  fields: Record<string, string>;
  /** The markdown with the front matter removed. */
  body: string;
}

function unquote(value: string): string {
  const quoted = /^(['"])(.*)\1$/.exec(value);
  return quoted?.[2] ?? value;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Split YAML front matter off the top of a markdown file.
 *
 * Deliberately not a YAML parser: only flat `key: value` lines at column 0 are
 * read, which is exactly what `name` / `description` / `type` are. Nested blocks
 * (`metadata:` followed by indented keys — the shape this repo's own SKILL.md
 * files use) are ignored rather than misread, because the `^` anchor means an
 * indented line never matches.
 *
 * The front matter is REMOVED from the body. Its three interesting keys have
 * been lifted into the preview's own fields, and what is left is YAML that would
 * otherwise be pasted verbatim into a review prompt as if it were review policy.
 * An unterminated `---` is not front matter at all and is left in the body.
 */
export function splitFrontMatter(text: string): MarkdownDocument {
  const source = text.replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/);
  if (!FRONT_MATTER_FENCE.test(lines[0] ?? '')) return { fields: {}, body: source };

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (FRONT_MATTER_FENCE.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  if (end < 0) return { fields: {}, body: source };

  const fields: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.*)$/.exec(line);
    if (!match) continue;
    fields[match[1]!.toLowerCase()] = unquote(match[2]!.trim());
  }
  return { fields, body: lines.slice(end + 1).join('\n').replace(/^\n+/, '') };
}

/**
 * The first level-1 ATX heading. Level 2+ does not count — `# Title` is the
 * document's name, `## Section` is part of it. Fenced code is skipped so a
 * `# comment` inside a shell example never becomes the skill's name.
 */
export function firstHeading(body: string): string | undefined {
  let fenced = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (CODE_FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^#[ \t]+(.+?)[ \t]*#*$/.exec(line);
    if (match) return match[1]!.trim();
  }
  return undefined;
}

/**
 * The first paragraph that is not a heading — the conventional place an author
 * writes what the document is for. Blank lines, headings, thematic breaks and
 * fenced code are skipped until prose starts; the first blank line or heading
 * after it ends the paragraph.
 */
export function firstParagraph(body: string): string | undefined {
  const collected: string[] = [];
  let fenced = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (CODE_FENCE.test(line)) {
      if (collected.length > 0) break;
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (line === '' || line.startsWith('#') || THEMATIC_BREAK.test(line)) {
      if (collected.length > 0) break;
      continue;
    }
    collected.push(line);
  }
  return collected.length > 0 ? collapseWhitespace(collected.join(' ')) : undefined;
}

/**
 * Read the skill core out of one markdown document.
 *
 * Precedence is front matter → document structure → filename, i.e. most
 * explicit wins. `type` falls back to `custom` rather than guessing, because a
 * wrong type silently changes which filter the skill shows up under, and the
 * user is about to see and can fix this in the preview anyway.
 */
export function extractSkillCore(
  text: string,
  fallbackName: string,
): { name: string; description: string; type: SkillType; body: string } {
  const { fields, body } = splitFrontMatter(text);

  const rawName = fields['name'] ?? firstHeading(body) ?? fallbackName;
  const name =
    collapseWhitespace(rawName).slice(0, MAX_IMPORT_NAME_CHARS) ||
    collapseWhitespace(fallbackName).slice(0, MAX_IMPORT_NAME_CHARS) ||
    IMPORT_FALLBACK_NAME;

  const rawDescription = fields['description'] ?? firstParagraph(body) ?? '';
  const description = collapseWhitespace(rawDescription).slice(0, MAX_IMPORT_DESCRIPTION_CHARS);

  const parsedType = SkillType.safeParse(fields['type']);
  const type: SkillType = parsedType.success ? parsedType.data : 'custom';

  return { name, description, type, body };
}

// ---- zip container --------------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const MAX_ZIP_COMMENT = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;
const ZIP64_SENTINEL_16 = 0xffff;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
/** General-purpose bit 0 — the entry is encrypted and we cannot read it. */
const FLAG_ENCRYPTED = 0x0001;

export interface ArchiveEntry {
  path: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  /** Zip stores directories as zero-length entries whose name ends in `/`. */
  isDirectory: boolean;
}

function badArchive(reason: string): SkillImportError {
  return new SkillImportError(
    SKILL_IMPORT_CODES.badArchive,
    `Could not read the archive: ${reason}`,
  );
}

/**
 * Locate the End Of Central Directory record by scanning backwards.
 *
 * It is the last thing in the file except for an optional trailing comment of up
 * to 64 KiB, so the search window is bounded — the whole buffer is never
 * scanned regardless of how big the upload is.
 */
function findEndOfCentralDirectory(buf: Buffer): number {
  const earliest = Math.max(0, buf.length - EOCD_MIN_SIZE - MAX_ZIP_COMMENT);
  for (let i = buf.length - EOCD_MIN_SIZE; i >= earliest; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/**
 * Read the central directory — the archive's authoritative index.
 *
 * Every offset derived from the file is bounds-checked against the buffer before
 * it is used: a truncated or crafted archive must produce a 422, never a
 * `RangeError` out of `readUInt32LE`.
 */
export function readCentralDirectory(buf: Buffer): ArchiveEntry[] {
  if (buf.length < EOCD_MIN_SIZE) throw badArchive('file is too short to be a zip');

  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) throw badArchive('no end-of-central-directory record found');

  const totalEntries = buf.readUInt16LE(eocd + 10);
  const directorySize = buf.readUInt32LE(eocd + 12);
  const directoryOffset = buf.readUInt32LE(eocd + 16);

  // Zip64 puts sentinels here and the real numbers in a separate record. We do
  // not implement it: an archive that needs 64-bit offsets is orders of
  // magnitude over every cap below anyway.
  if (
    totalEntries === ZIP64_SENTINEL_16 ||
    directorySize === ZIP64_SENTINEL_32 ||
    directoryOffset === ZIP64_SENTINEL_32
  ) {
    throw badArchive('zip64 archives are not supported');
  }
  if (totalEntries > MAX_ARCHIVE_ENTRIES) {
    throw new SkillImportError(
      SKILL_IMPORT_CODES.tooManyEntries,
      `Archive has ${totalEntries} entries, limit ${MAX_ARCHIVE_ENTRIES}.`,
      { entries: totalEntries, limit: MAX_ARCHIVE_ENTRIES },
    );
  }
  if (directoryOffset + directorySize > buf.length) throw badArchive('central directory is truncated');

  const entries: ArchiveEntry[] = [];
  let cursor = directoryOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + CENTRAL_HEADER_SIZE > buf.length) throw badArchive('central directory is truncated');
    if (buf.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw badArchive('corrupt central directory header');

    const flags = buf.readUInt16LE(cursor + 8);
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLength = buf.readUInt16LE(cursor + 28);
    const extraLength = buf.readUInt16LE(cursor + 30);
    const commentLength = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);

    const nameStart = cursor + CENTRAL_HEADER_SIZE;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buf.length) throw badArchive('central directory is truncated');

    // Separators are normalised HERE, once, so every consumer — the safety
    // check, the chooser, and the paths we hand back on the wire — sees the same
    // string. The zip spec mandates `/`, but PowerShell's `Compress-Archive`
    // writes `skills\api-gate\SKILL.md`, and it is the default zipper on the
    // platform this product is developed on. (A file whose real name contains a
    // backslash gains a directory level; that trade is worth the interop.)
    const path = buf.toString('utf8', nameStart, nameEnd).replace(/\\/g, '/');

    if (localOffset === ZIP64_SENTINEL_32) throw badArchive('zip64 archives are not supported');

    entries.push({
      path,
      method,
      flags,
      compressedSize,
      uncompressedSize,
      localOffset,
      isDirectory: path.endsWith('/'),
    });
    cursor = nameEnd + extraLength + commentLength;
  }
  return entries;
}

/** Stored and deflate are the only two methods in practice; the rest we skip. */
export function isSupportedMethod(method: number): boolean {
  return method === METHOD_STORED || method === METHOD_DEFLATE;
}

function entryTooLarge(path: string, size: number): SkillImportError {
  return new SkillImportError(
    SKILL_IMPORT_CODES.entryTooLarge,
    `Archive entry "${path}" expands to ${size} bytes, limit ${MAX_ENTRY_UNCOMPRESSED_BYTES}.`,
    { entry: path, bytes: size, limit: MAX_ENTRY_UNCOMPRESSED_BYTES },
  );
}

/**
 * Decompress ONE entry. Called only for the single markdown file that becomes
 * the preview body — every other entry's bytes are never touched.
 *
 * The declared size was already capped by the caller; `maxOutputLength` caps it
 * again during inflation, because the central directory is attacker-controlled
 * data and a bomb can simply declare 12 bytes.
 */
export function readEntryData(buf: Buffer, entry: ArchiveEntry): Buffer {
  if ((entry.flags & FLAG_ENCRYPTED) !== 0) throw badArchive(`entry "${entry.path}" is encrypted`);

  const header = entry.localOffset;
  if (header + LOCAL_HEADER_SIZE > buf.length) throw badArchive('local header is out of bounds');
  if (buf.readUInt32LE(header) !== LOCAL_SIGNATURE) throw badArchive('corrupt local file header');

  // The local header's own name/extra lengths are read (not the central
  // directory's): zip writers legitimately store different extra fields in the
  // two places, and using the wrong one lands mid-stream.
  const nameLength = buf.readUInt16LE(header + 26);
  const extraLength = buf.readUInt16LE(header + 28);
  const start = header + LOCAL_HEADER_SIZE + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buf.length) throw badArchive('entry data is truncated');

  const raw = buf.subarray(start, end);
  if (entry.method === METHOD_STORED) {
    if (raw.length > MAX_ENTRY_UNCOMPRESSED_BYTES) throw entryTooLarge(entry.path, raw.length);
    return raw;
  }

  try {
    return inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_UNCOMPRESSED_BYTES });
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw entryTooLarge(entry.path, MAX_ENTRY_UNCOMPRESSED_BYTES);
    }
    throw badArchive(`entry "${entry.path}" could not be decompressed`);
  }
}

/**
 * Which markdown entry becomes the skill body when an archive has several.
 *
 * `SKILL.md` first — that is the filename the whole skill convention is built
 * around, so an author who wrote one has already answered this question. Failing
 * that, the SHORTEST path: the file nearest the root is the entry point, and
 * `docs/reference/appendix.md` is not. Ties break lexicographically so the same
 * archive always previews the same way.
 */
export function chooseMarkdownEntry(paths: string[]): string | undefined {
  const ranked = [...paths].sort(
    (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0),
  );
  return ranked.find((p) => basename(p).toLowerCase() === 'skill.md') ?? ranked[0];
}

// ---- preview assembly -----------------------------------------------------

function previewFromMarkdown(filename: string, content: Buffer): SkillImportPreview {
  if (content.length > MAX_ENTRY_UNCOMPRESSED_BYTES) {
    throw entryTooLarge(basename(filename), content.length);
  }
  const text = content.toString('utf8');
  if (text.trim().length === 0) {
    throw new SkillImportError(SKILL_IMPORT_CODES.empty, 'The markdown file is empty.');
  }
  const core = extractSkillCore(text, filenameStem(filename));
  return { ...core, source_files: [basename(filename)], skipped_files: [] };
}

/**
 * Preview an archive.
 *
 * Order is load-bearing: paths are validated, then counts and declared sizes are
 * capped, and only THEN is a single entry decompressed. Nothing hostile gets to
 * spend CPU before it has been bounded.
 */
function previewFromArchive(filename: string, content: Buffer): SkillImportPreview {
  const entries = readCentralDirectory(content);

  let totalUncompressed = 0;
  for (const entry of entries) {
    assertSafeArchivePath(entry.path);
    if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw entryTooLarge(entry.path, entry.uncompressedSize);
    }
    totalUncompressed += entry.uncompressedSize;
  }
  if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
    throw new SkillImportError(
      SKILL_IMPORT_CODES.archiveTooLarge,
      `Archive expands to ${totalUncompressed} bytes, limit ${MAX_TOTAL_UNCOMPRESSED_BYTES}.`,
      { bytes: totalUncompressed, limit: MAX_TOTAL_UNCOMPRESSED_BYTES },
    );
  }

  // Directory entries are structure, not content — listing them as "skipped"
  // would tell the user nothing and bury the files that actually were skipped.
  const files = entries.filter((e) => !e.isDirectory);
  const candidates = files.filter(
    (e) => isMarkdownPath(e.path) && !isArchiveNoise(e.path) && isSupportedMethod(e.method),
  );
  const candidatePaths = new Set(candidates.map((e) => e.path));
  const skipped = files
    .filter((e) => !candidatePaths.has(e.path))
    .map((e) => e.path)
    .sort();

  const chosenPath = chooseMarkdownEntry(candidates.map((e) => e.path));
  const chosen = candidates.find((e) => e.path === chosenPath);
  if (!chosen) {
    throw new SkillImportError(
      SKILL_IMPORT_CODES.noMarkdown,
      'The archive contains no readable markdown file (.md / .markdown).',
      { skipped_files: skipped },
    );
  }

  const text = readEntryData(content, chosen).toString('utf8');
  if (text.trim().length === 0) {
    throw new SkillImportError(
      SKILL_IMPORT_CODES.empty,
      `Archive entry "${chosen.path}" is empty.`,
    );
  }

  // The archive's own name, not the entry's: inside a skill bundle the markdown
  // is conventionally called SKILL.md, and "SKILL" is not a skill name.
  const core = extractSkillCore(text, filenameStem(filename));
  const sourceFiles = [
    chosen.path,
    ...candidates.map((e) => e.path).filter((p) => p !== chosen.path).sort(),
  ];
  return { ...core, source_files: sourceFiles, skipped_files: skipped };
}

/**
 * Build the preview for an uploaded file. The extension decides how the bytes
 * are read; anything else is refused rather than guessed at, because sniffing a
 * "probably text" file is how a binary blob ends up in a model prompt.
 */
export function buildSkillImportPreview(filename: string, content: Buffer): SkillImportPreview {
  const extension = fileExtension(filename);
  if (MARKDOWN_EXTENSIONS.has(extension)) return previewFromMarkdown(filename, content);
  if (extension === '.zip') return previewFromArchive(filename, content);
  throw new SkillImportError(
    SKILL_IMPORT_CODES.unsupportedFile,
    `Cannot import "${basename(filename)}" — upload a .md, .markdown, or .zip file.`,
    { filename: basename(filename) },
  );
}
