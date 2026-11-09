// Causal experiments for the sona worker-teardown crash.
// Usage: node nodelete-experiment.cjs <mode> <path-to-.node>
//   worker       : load the addon only inside a worker, let it exit
//   main+worker  : load it on the main thread first, then in a worker
const { Worker } = require('node:worker_threads');
const [mode, addon] = process.argv.slice(2);
if (mode === 'main+worker') require(addon);
const w = new Worker(`require(${JSON.stringify(addon)});`, { eval: true });
w.on('error', (e) => console.log('worker error:', e.message));
w.on('exit', (code) => console.log('worker exit', code));
