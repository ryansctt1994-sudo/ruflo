// Vitest reporter that logs each test module's lifecycle to stderr.
// stderr writes are synchronous for files and pipes on Linux, so after a
// native crash the last START without a matching END is the module that was
// running when the process died.
const t0 = Date.now();
const ts = () => String(Date.now() - t0).padStart(7);
const log = (line) => process.stderr.write(`[mod ${ts()}ms] ${line}\n`);

export default class StartLogger {
  onTestModuleStart(m) { log(`START ${m.moduleId}`); }
  onTestModuleEnd(m) { log(`END   ${m.moduleId} ${m.state()}`); }
  onTestRunEnd(_modules, _errors, reason) { log(`RUN-END ${reason}`); }
}
