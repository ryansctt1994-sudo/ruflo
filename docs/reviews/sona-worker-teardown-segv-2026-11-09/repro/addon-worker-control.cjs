// Control harness: require one native package either on the main thread or
// inside a worker_thread that then exits.
// Usage: node addon-worker-control.cjs <main|worker> <absolute package dir>
const { Worker } = require('node:worker_threads');
const [where, pkg] = process.argv.slice(2);
if (where === 'main') {
  require(pkg);
  console.log('main-thread require ok');
} else {
  const w = new Worker(`require(${JSON.stringify(pkg)});`, { eval: true });
  w.on('error', (e) => console.log('worker error:', e.message));
  w.on('exit', (code) => console.log('worker exit', code));
}
