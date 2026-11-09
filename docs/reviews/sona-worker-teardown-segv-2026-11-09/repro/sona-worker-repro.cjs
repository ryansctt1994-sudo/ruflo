// Minimal reproducer, no vitest: load @ruvector/sona in a worker_thread,
// optionally construct a SonaEngine, then let the worker exit.
// Usage: node sona-worker-repro.cjs <require|construct> [workers]
const { Worker } = require('node:worker_threads');

const SONA = '/home/user/ruflo/v3/node_modules/.pnpm/@ruvector+sona@0.1.7/node_modules/@ruvector/sona';
const mode = process.argv[2] || 'require';
const n = Number(process.argv[3] || 1);

const body = mode === 'construct'
  ? `const { SonaEngine } = require(${JSON.stringify(SONA)});
     const e = new SonaEngine(64);
     globalThis.__keep = e;`
  : `require(${JSON.stringify(SONA)});`;

let done = 0;
for (let i = 0; i < n; i++) {
  const w = new Worker(body, { eval: true });
  w.on('error', (e) => console.log('worker error:', e.message));
  w.on('exit', (code) => {
    console.log('worker', i, 'exit', code);
    if (++done === n) console.log('ALL WORKERS EXITED');
  });
}
