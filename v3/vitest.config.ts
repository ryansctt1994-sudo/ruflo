/**
 * V3 Claude-Flow Vitest Configuration
 *
 * London School TDD Configuration
 * - Mock-first testing approach
 * - Behavior verification over state testing
 * - Clear isolation between units
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

// Suites that call process.chdir(), which Node forbids in worker threads.
// They must run in forked processes. __tests__/vitest-pool-config.test.ts
// fails if a collected test file calls chdir without being listed here.
export const INCLUDE = [
  '__tests__/**/*.test.ts',
  '__tests__/**/*.spec.ts',
  '@claude-flow/**/__tests__/**/*.test.ts',
  '@claude-flow/**/__tests__/**/*.spec.ts',
  'mcp/__tests__/**/*.test.ts',
  'mcp/__tests__/**/*.spec.ts',
];

export const CHDIR_SUITES = [
  '@claude-flow/cli/__tests__/issue-2250-2251-regression.test.ts',
  '@claude-flow/cli/__tests__/neural-status-training-backend-2549.test.ts',
  '@claude-flow/cli/__tests__/pretrain-from-github.test.ts',
  '@claude-flow/cli/__tests__/round-b-wiring-2245.test.ts',
  '@claude-flow/cli/__tests__/router-bandit.test.ts',
  '@claude-flow/cli/__tests__/self-learning-2245.test.ts',
  '@claude-flow/cli/__tests__/unified-stats-2245.test.ts',
];

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Global test setup
    setupFiles: ['./__tests__/setup.ts'],

    // Include patterns live on the projects below, not here: with
    // `extends: true` a project's `include` is concatenated with the root's,
    // so a root `include` would make the chdir-forks project collect every
    // file again.

    // Exclude patterns. These replace vitest's defaults, so they must be
    // recursive globs: a bare 'node_modules' only matches the top-level
    // folder, and the '@claude-flow/**' include above then walks into pnpm
    // workspace symlinks (e.g. @claude-flow/codex/node_modules/@claude-flow/cli)
    // and collects every linked package's tests again (564 of 815 files).
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      // node:test suites, not vitest ("No test suite found" here). Run with:
      //   npx tsx --test __tests__/appliance/*.test.ts
      '__tests__/appliance/**',
    ],

    // Coverage configuration - London School targets
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './__tests__/coverage',

      // Coverage thresholds disabled for alpha (London School TDD uses mocks)
      // TODO: Re-enable for stable release with proper coverage instrumentation
      // thresholds: {
      //   lines: 60,
      //   functions: 60,
      //   branches: 50,
      //   statements: 60,
      // },

      // Files to include in coverage
      include: [
        'src/**/*.ts',
        'modules/**/*.ts',
      ],

      // Files to exclude from coverage
      exclude: [
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/index.ts',
        '**/__tests__/**',
        '**/fixtures/**',
        '**/mocks/**',
      ],
    },

    // Mock configuration for London School approach
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,

    // Timeout for async operations.
    // Bumped from 10s → 30s because CI runners cold-load HuggingFace models
    // and ONNX runtimes that take 5-20s on first call, causing timeout
    // failures in guidance-provider and reasoningbank tests. Local runs
    // with cached models still finish in <1s; the headroom only matters
    // on cold environments.
    testTimeout: 30000,
    hookTimeout: 30000,

    // Reporter configuration
    reporters: ['default'],

    // Parallel execution.
    // Use 'threads' as the default. Briefly tried 'forks' because of
    // exit-time segfaults from native bindings (onnxruntime-node /
    // ruvector / agentic-flow) — but forks expose module-load
    // unhandled rejections more aggressively, causing 12 test files
    // (transformers transitive-importers) to fail with 'No test suite
    // found'. Threads tolerate the rejection and let tests report,
    // and the segfault happens only at process shutdown. CI handles
    // exit code 139 as success when results were reported (see test job).
    pool: 'threads',
    isolate: true,
    // Vitest 4 removed `poolOptions` and `poolMatchGlobs`, so both were
    // silently ignored here, and every process.chdir() suite ran in a worker
    // thread, where chdir throws. Those suites now run in their own forks
    // project; the rest keep the threads pool.
    projects: [
      { extends: true, test: { name: 'threads', include: INCLUDE, exclude: CHDIR_SUITES } },
      { extends: true, test: { name: 'chdir-forks', include: CHDIR_SUITES, pool: 'forks' } },
    ],

    // Globals for easier testing
    globals: true,

    // Type checking disabled - it.each syntax not supported in type testing
    // Use separate `npm run typecheck` for type validation
    typecheck: {
      enabled: false,
    },
  },

  // Path aliases for clean imports
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './__tests__'),
      '@fixtures': path.resolve(__dirname, './__tests__/fixtures'),
      '@helpers': path.resolve(__dirname, './__tests__/helpers'),
      '@mocks': path.resolve(__dirname, './__tests__/mocks'),
      '@security': path.resolve(__dirname, './modules/security'),
      '@memory': path.resolve(__dirname, './modules/memory'),
      '@swarm': path.resolve(__dirname, './modules/swarm'),
      '@core': path.resolve(__dirname, './modules/core'),
    },
  },
});
