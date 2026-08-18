import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/platform/config.js';

/**
 * L05/SPEC-02 — `PROJECT_CONTEXT_FILES` parsing (AC-4, AC-5). Pure — no
 * filesystem, no container. Mirrors the existing `PROJECT_CONTEXT_ROOTS`
 * precedent this config seam is built from.
 */
describe('loadConfig — PROJECT_CONTEXT_FILES', () => {
  it('defaults to ["INSIGHTS.md"] when unset', () => {
    const config = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(config.contextFiles).toEqual(['INSIGHTS.md']);
  });

  it('defaults to ["INSIGHTS.md"] when empty', () => {
    const config = loadConfig({ NODE_ENV: 'test', PROJECT_CONTEXT_FILES: '' } as NodeJS.ProcessEnv);
    expect(config.contextFiles).toEqual(['INSIGHTS.md']);
  });

  it('drops every entry that is not a bare .md file name (AC-5), falling back to the default when nothing survives', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PROJECT_CONTEXT_FILES: 'Makefile,docs/X.md',
    } as NodeJS.ProcessEnv);
    expect(config.contextFiles).toEqual(['INSIGHTS.md']);
  });

  it('accepts multiple distinct .md names, trims whitespace, preserves given casing', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PROJECT_CONTEXT_FILES: 'insights.md , NOTES.MD',
    } as NodeJS.ProcessEnv);
    expect(config.contextFiles).toEqual(['insights.md', 'NOTES.MD']);
  });

  it('drops an entry containing a path separator (either slash) while keeping valid entries', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PROJECT_CONTEXT_FILES: 'INSIGHTS.md,docs/NOTES.md,sub\\dir.md',
    } as NodeJS.ProcessEnv);
    expect(config.contextFiles).toEqual(['INSIGHTS.md']);
  });

  it('de-dupes case-insensitively, keeping the first occurrence', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PROJECT_CONTEXT_FILES: 'INSIGHTS.md,insights.md,Insights.MD',
    } as NodeJS.ProcessEnv);
    expect(config.contextFiles).toEqual(['INSIGHTS.md']);
  });

  it('does not change `contextRoots`', () => {
    const withDefault = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(withDefault.contextRoots).toEqual(['specs', 'docs', 'insights']);

    const withFiles = loadConfig({
      NODE_ENV: 'test',
      PROJECT_CONTEXT_FILES: 'INSIGHTS.md',
      PROJECT_CONTEXT_ROOTS: 'specs',
    } as NodeJS.ProcessEnv);
    expect(withFiles.contextRoots).toEqual(['specs']);
  });
});
