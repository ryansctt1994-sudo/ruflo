/**
 * Regression guard for the Vitest 4 pool configuration (vitest.config.ts).
 *
 * Vitest 4 removed `poolOptions` and `poolMatchGlobs`; both were silently
 * ignored, so suites that change the working directory ran in worker threads,
 * where Node forbids it. Those suites now run in a `chdir-forks` project.
 * This test fails if:
 *   - a removed option comes back, or the root config regains `include`
 *     (with `extends: true` a root `include` is concatenated into the
 *     chdir-forks project, which then collects every file a second time);
 *   - a collected test file changes directory without being routed to forks;
 *   - a listed suite no longer exists or no longer changes directory.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import config, { CHDIR_SUITES, INCLUDE } from '../vitest.config';

const V3 = path.resolve(__dirname, '..');
// Built from parts so this file's own source never matches the scan.
const CHDIR_CALL = new RegExp(['process', 'chdir\\('].join('\\.'));

type Project = { extends?: boolean; test?: Record<string, unknown> };

function project(name: string): Project['test'] {
  const projects = (config.test?.projects ?? []) as Project[];
  return projects.find((p) => p.test?.name === name)?.test;
}

/** Test files the INCLUDE patterns collect, minus the root excludes. */
function collectableTestFiles(): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', 'dist', '.git']);
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      const rel = path.relative(V3, abs).split(path.sep).join('/');
      if (!/\.(test|spec)\.ts$/.test(rel)) continue;
      if (rel.startsWith('__tests__/appliance/')) continue;
      const included = rel.startsWith('__tests__/')
        || rel.startsWith('mcp/__tests__/')
        || (rel.startsWith('@claude-flow/') && rel.includes('/__tests__/'));
      if (included) out.push(rel);
    }
  };
  walk(V3);
  return out.sort();
}

describe('vitest pool configuration (Vitest 4)', () => {
  it('uses no options Vitest 4 removed, and no root include', () => {
    const test = config.test as Record<string, unknown>;
    expect(test).not.toHaveProperty('poolOptions');
    expect(test).not.toHaveProperty('poolMatchGlobs');
    expect(test).not.toHaveProperty('include');
    expect(test.pool).toBe('threads');
  });

  it('routes exactly CHDIR_SUITES to a forks project and excludes them from threads', () => {
    const threads = project('threads');
    const forks = project('chdir-forks');
    expect(threads?.include).toEqual(INCLUDE);
    expect(threads?.exclude).toEqual(CHDIR_SUITES);
    expect(threads?.pool).toBeUndefined(); // inherits the root 'threads' pool
    expect(forks?.include).toEqual(CHDIR_SUITES);
    expect(forks?.pool).toBe('forks');
  });

  it('every collected test file that changes directory is listed in CHDIR_SUITES', () => {
    const changesDir = collectableTestFiles()
      .filter((rel) => CHDIR_CALL.test(fs.readFileSync(path.join(V3, rel), 'utf-8')));
    expect(changesDir).toEqual([...CHDIR_SUITES].sort());
  });

  it('every CHDIR_SUITES entry exists', () => {
    for (const rel of CHDIR_SUITES) {
      expect(fs.existsSync(path.join(V3, rel)), rel).toBe(true);
    }
  });
});
