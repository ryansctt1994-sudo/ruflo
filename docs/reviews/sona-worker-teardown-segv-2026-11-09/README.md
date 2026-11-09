# `@ruvector/sona` worker-teardown SIGSEGV: evidence bundle

**Date:** 2026-11-09 · **ruflo commit:** `ffc209b` · **Status:** root cause isolated to the upstream `@ruvector/sona` native addon. Not fixed in ruflo, and the vitest pool configuration is unchanged.

This bundle preserves the raw evidence for the `--pool=threads` crash (exit 139) investigated in ruflo PR #1. Every transcript is unedited. `SHA256SUMS` covers every file in the bundle.

## Environment

| | |
|---|---|
| OS / kernel | Linux 6.18.44-fc-v310 x86_64 (container), run as root |
| libc | Ubuntu GLIBC 2.39-0ubuntu8.9 |
| Node | v22.23.4 (V8 12.4.254.21-node.57, N-API 10) |
| Test runner | vitest 4.1.8 with @vitest/coverage-v8 4.1.9, pnpm 8.15.0 |
| Debugger | GNU gdb 15.1 (ASLR disabled, the gdb default) |

| Binary | sha256 | `DT_FLAGS_1` |
|---|---|---|
| `@ruvector/sona@0.1.7` `index.linux-x64-gnu.node` (identical to `@ruvector/sona-linux-x64-gnu@0.1.7`) | `6402e1f9c15febfbaf04b3c1bd83e4b7ee15afce607553ef6c46a80a9e71f5e9` | `NOW` |
| `@ruvector/sona-linux-x64-gnu@0.1.5` `sona.linux-x64-gnu.node` | `d2aa316df4d94ff2de37049bf9db6b3e5ec3ba7853a33b66028dc94b62c74ec8` | `NOW` |
| 0.1.7 copy with `NODELETE` set (1 byte changed, produced by `repro/set_nodelete.py`) | `8a4dbd06be32aeab4dab36c7f974643a891f374da6f301a21fbfc6e970202457` | `NOW NODELETE` |

These are the lockfile (`v3/pnpm-lock.yaml`) integrity values of the published tarballs the binaries came from:

```
@ruvector/sona@0.1.7                sha512-TR112g0QoiwavKGk+bogNm++F7LDZ4ko47pR1L/b0kuWfNi8FiW8CVLI/7GSIAJPS3VEfI86Cm7HYiEedc/dTQ==
@ruvector/sona-linux-x64-gnu@0.1.7  sha512-IqCNJw1fyjkSZkSf2sB/IMKfCxLv5+9aAUo6lEpfnR60vP33pbCxLzcZDVDcIpcaTSbe3DHcH5DYNu+C1v8yvQ==
@ruvector/sona@0.1.5                sha512-XHQbphnWsRzWRWGK/HxK+RreY6OdlggMrOvrfkWlEq8EctHVy2ASwps7hk25Somx8Umj7+CkNuyQEbHcNcl/oQ==
@ruvector/sona-linux-x64-gnu@0.1.5  sha512-fmYlrJx9IQBHxeNX2Tu0ihHr3xsb3NwhgMmasOTOHBv/42fnxuuYrwhfHtMA6J6JtjyVxoBw1XLD6QJy4Y9BsA==
```

## Conclusion

The sona addon registers a pthread-key TLS destructor in the thread that loads it. When a `worker_thread` that loaded sona shuts down, Node `dlclose`s the addon:

```
Worker::Run → FreeEnvironment → ~Environment → DLib::Close
```

That unmaps its code. The thread's exit then runs glibc's `__nptl_deallocate_tsd`, which calls the destructor at the now-unmapped address, so the worker faults with SIGSEGV.

Linking sona with `-z nodelete` prevents the crash: the 1-byte `NODELETE` patch is a direct test of that. Several sibling `@ruvector` addons are already linked that way.

## Minimal reproducer (no vitest)

Run this from a directory where `@ruvector/sona` resolves:

```sh
node -e "new (require('node:worker_threads').Worker)(\"require('@ruvector/sona')\", { eval: true })"
echo $?   # 139
```

It was verified 3/3 in two ways: against sona 0.1.5, resolved from `v3/@claude-flow/neural`, and from a fresh `npm i @ruvector/sona@0.1.7` in an empty directory. The fresh install's `index.linux-x64-gnu.node` sha256 matches the binary analysed here, and the main-thread control exits 0 0 0. `repro/sona-worker-repro.cjs` is the as-run script, with the container's absolute paths.

## Evidence, in the order it was gathered

1. **CI's exact command reproduces.** `cd v3 && pnpm test` (the config's `threads` pool, coverage on) exits with SIGSEGV after about 90s. It did so in 2 of 2 runs with the same 14 files completed each time; see `runs/ci_exact_{1,2}.log`.
2. **Active test ≠ cause.** `repro/start-logger.mjs` writes START/END per test module synchronously to stderr; see `runs/ci_logged.log` and `runs/lifecycle.txt`. At the crash, `hooks/guidance-provider` and `hooks/reasoningbank` were in flight. They are bystanders: under threads they pass alone (47/47 and 31/31) and together (78/78); see `runs/combinations/`.
3. **One file reproduces on its own.** `cli/__tests__/memory-ruvector-deep.test.ts` under threads exits 139 in 12 of 12 runs (coverage on/off × wasm trap handler on/off). Under forks it passes 147/147, 3 of 3; see `runs/single-file/`. The same file with both hooks suites also exits 139, in written order and under two `--sequence.shuffle` seeds. With 4 CPUs the three files run concurrently, so ordering mostly affects scheduling.
4. **Native attribution.** `gdb/gdb_notrap.log` was captured with `--disable-wasm-trap-handler`, so every SIGSEGV is a real fault:
   - The faulting thread is a worker in `start_thread → __nptl_deallocate_tsd → <pc>`, with `si_addr == pc == 0x7ffff4fda450`, which is unmapped.
   - The main thread is in `node::worker::Worker::JoinThread`.
   - `gdb/gdb_dlclose.log` places that address inside the `.text` range (`0x7ffff4f8bf60–0x7ffff4ff4858`) of `@ruvector/sona/index.linux-x64-gnu.node`, as mapped at the time of the `dlclose` calls (all from `DLib::Close`).
   - That is ELF vaddr `0x74450` in a stripped binary, so the function can't be named. The binary embeds Rust std `thread_local` and imports `pthread_key_create`.
5. **The original crash is the same fault.** `gdb/gdb_full.log` is `vitest run` with CI's configuration and the wasm trap handler **on**. It recorded exactly 2 SIGSEGVs, both at `0x7ffff4fda450` inside the former sona range with the same frames. The second is the re-fault after node resets its handler. There were 0 wasm-trap signals.
6. **Minimal reproducer.** `gdb/gdb_repro.log` shows the same signature for the 20-line vitest-free reproducer.
7. **Controls and causal interventions**, re-run and recorded in `runs/controls-and-interventions.txt` via `repro/run-controls.sh`, exit codes of 3 runs each:

   | Case | Exit codes |
   |---|---|
   | sona 0.1.7 loaded on the main thread | 0 0 0 |
   | sona 0.1.7 / 0.1.5 loaded in a worker that exits | 139 139 139 / 139 139 139 |
   | `@ruvector/router` 0.1.30, `attention` 0.1.32, `rvf-node` 0.2.0 in a worker | 0 0 0 each |
   | sona 0.1.7, `new SonaEngine(64)` kept alive in the worker | 0 0 0 |
   | unmodified copy of the 0.1.7 binary in a worker | 139 139 139 |
   | **same binary, 1 byte changed: `DT_FLAGS_1` NOW → NOW\|NODELETE** | **0 0 0** |
   | **unmodified copy, also loaded on the main thread first, so `dlclose` can't unmap it** | **0 0 0** |

8. **Linker flags across siblings.** `router`, `attention`, `gnn` and `graph-node` carry `NODELETE`; `sona` (0.1.5, 0.1.7) and `rvf-node` don't. `rvf-node` doesn't crash, so the missing flag is necessary but not sufficient: the crash also needs a TLS destructor registered on the worker thread.

## Corrections made during the investigation

- **Crash timing.** An early reading of the single-file runs said the crash happened "during module load" and that disabling the trap handler "moved it to teardown". Both were wrong, and came from sampling one run per condition. Every gdb trace shows the fault at worker teardown, after the tests ran. Only whether vitest prints its summary before the process dies varies:

  | Condition | Runs that printed "147 passed" first |
  |---|---|
  | Coverage on | 0/6 (coverage reporting runs after worker teardown) |
  | Coverage off, trap handler on | 2/3 |
  | Coverage off, trap handler off | 3/3 |

- **`runs/invalid/` is not product evidence.** The first hooks-pair (rc=1) and all-three runs overlapped with other vitest processes sharing `__tests__/coverage/.tmp`, which deleted each other's coverage files ("Something removed the coverage directory"). They were re-run sequentially with no other vitest running; see `runs/combinations/clean-matrix-summary.txt`.

## Not established

- The name of the faulting function: the binary is stripped.
- Other platforms. Only linux-x64-gnu with glibc 2.39 was tested; musl, macOS and Windows weren't.
- Whether `-z nodelete` has side effects for sona's maintainers. The 1-byte patch tests that it stops the crash, not that it is the right production fix.
- Downstream exposure. No ruflo `@claude-flow/*/src` code uses `worker_threads`, and its four `@ruvector/sona` importers run on the main thread. Embedders that load these modules in a worker would be affected.

## Related, independent: Vitest 4 drops pool options

Every run warns that `test.poolOptions` was removed in Vitest 4, and vitest 4.1.8 has no `poolMatchGlobs`. So `v3/vitest.config.ts`'s isolation settings and its routing of `router-bandit` to forks are ignored. Six test files call `process.chdir()`, which worker threads forbid; for example, `round-b-wiring-2245` fails under threads and passes under forks.

## Upstream report

`UPSTREAM-ISSUE-DRAFT.md` is a ready-to-file report for the `@ruvector/sona` maintainers. It has not been filed.
