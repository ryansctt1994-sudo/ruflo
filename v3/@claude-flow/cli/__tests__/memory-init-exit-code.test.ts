/**
 * Regression: `memory init` must not exit 0 when its own verification fails.
 *
 * Before the fix the init action printed "Verification failed" (e.g. the
 * "Database access" check failing because sql.js could not be resolved) and
 * still returned success, and the #1428 force-exit timer then called
 * process.exit(0). These tests pin the outcome for the healthy, failed,
 * offline (hash-fallback embedding) and --no-verify paths, including what the
 * delayed exit timer does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const { initializeMemoryDatabase, verifyMemoryInit, loadEmbeddingModel } = vi.hoisted(() => ({
  initializeMemoryDatabase: vi.fn(),
  verifyMemoryInit: vi.fn(),
  loadEmbeddingModel: vi.fn(),
}));

vi.mock('../src/memory/memory-initializer.js', () => ({
  initializeMemoryDatabase,
  verifyMemoryInit,
  loadEmbeddingModel,
}));

vi.mock('../src/output.js', () => {
  const spinner = { start: vi.fn(), succeed: vi.fn(), fail: vi.fn(), stop: vi.fn() };
  const output = new Proxy({} as Record<string, unknown>, {
    get: (_t, key) =>
      key === 'createSpinner' ? () => spinner : (...args: unknown[]) => (args[0] ?? ''),
  });
  return { output };
});

import { memoryCommand } from '../src/commands/memory.js';
import type { CommandContext } from '../src/types.js';

const initCmd = memoryCommand.subcommands!.find((c) => c.name === 'init')!;

function dbResult(dbPath: string) {
  return {
    success: true,
    backend: 'hybrid',
    schemaVersion: '3.0.0',
    dbPath,
    features: {
      vectorEmbeddings: true, patternLearning: true, temporalDecay: true,
      hnswIndexing: true, migrationTracking: true,
    },
    tablesCreated: [],
    indexesCreated: [],
  };
}

function verification(tests: Array<{ name: string; passed: boolean; details?: string }>) {
  const failed = tests.filter((t) => !t.passed).length;
  return {
    success: failed === 0,
    tests,
    summary: { passed: tests.length - failed, failed, total: tests.length },
  };
}

const HEALTHY = [
  { name: 'Schema verification', passed: true, details: '11 tables found' },
  { name: 'Write entry', passed: true },
  { name: 'Read entry', passed: true },
  { name: 'Generate embedding', passed: true, details: '384-dim vector (Xenova/all-MiniLM-L6-v2)' },
  { name: 'Pattern storage', passed: true },
  { name: 'Vector index config', passed: true },
];

describe('memory init exit code', () => {
  let tmp: string;
  let ctx: CommandContext;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-memory-init-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmp);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.useFakeTimers();
    initializeMemoryDatabase.mockResolvedValue(dbResult(path.join(tmp, 'memory.db')));
    ctx = { args: [], flags: { _: [] }, cwd: tmp, interactive: false };
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('healthy: succeeds, and the delayed #1428 force-exit uses code 0', async () => {
    verifyMemoryInit.mockResolvedValue(verification(HEALTHY));

    const result = await initCmd.action!(ctx);

    expect(result).toMatchObject({ success: true });
    vi.runAllTimers();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('failed verification: returns exitCode 1 and schedules no exit(0)', async () => {
    verifyMemoryInit.mockResolvedValue(verification([
      { name: 'Database access', passed: false, details: "Cannot find package 'sql.js'" },
    ]));

    const result = await initCmd.action!(ctx);

    expect(result).toMatchObject({ success: false, exitCode: 1 });
    vi.runAllTimers();
    expect(exitSpy).not.toHaveBeenCalled();
    // An unverified database is not synced into .claude/.
    expect(fs.existsSync(path.join(tmp, '.claude', 'memory.db'))).toBe(false);
  });

  it('any single failed check fails init', async () => {
    verifyMemoryInit.mockResolvedValue(verification(
      HEALTHY.map((t) => (t.name === 'Read entry' ? { ...t, passed: false } : t)),
    ));

    const result = await initCmd.action!(ctx);

    expect(result).toMatchObject({ success: false, exitCode: 1 });
  });

  it('offline: a verification that passes via the hash-fallback embedding succeeds', async () => {
    verifyMemoryInit.mockResolvedValue(verification(
      HEALTHY.map((t) =>
        t.name === 'Generate embedding' ? { ...t, details: '128-dim vector (hash-fallback)' } : t),
    ));

    const result = await initCmd.action!(ctx);

    expect(result).toMatchObject({ success: true });
    vi.runAllTimers();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('--no-verify: skips verification and succeeds', async () => {
    ctx.flags = { verify: false, _: [] };

    const result = await initCmd.action!(ctx);

    expect(verifyMemoryInit).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true });
  });

  it('schema initialization failure still returns exitCode 1', async () => {
    initializeMemoryDatabase.mockResolvedValue({ success: false, error: 'disk full' });

    const result = await initCmd.action!(ctx);

    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(verifyMemoryInit).not.toHaveBeenCalled();
  });
});
