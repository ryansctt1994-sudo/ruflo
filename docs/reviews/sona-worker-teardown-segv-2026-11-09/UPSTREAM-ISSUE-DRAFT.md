# Draft upstream issue: `@ruvector/sona` segfaults when a worker thread that loaded it exits

> **Not filed.** Prepared for the `@ruvector/sona` maintainers from the evidence in this directory. Review it, then file it from the account that should own the report.

---

**Title:** SIGSEGV (exit 139) when a `worker_thread` that loaded `@ruvector/sona` exits: TLS destructor runs after the addon is unloaded

**Versions affected (tested):** `@ruvector/sona` 0.1.5 and 0.1.7 (`linux-x64-gnu`). Node v22.23.4, glibc 2.39, x86_64 Linux. Other platforms are untested.

### Reproduce

```sh
npm i @ruvector/sona@0.1.7
node -e "new (require('node:worker_threads').Worker)(\"require('@ruvector/sona')\", { eval: true })"
echo $?   # 139
```

Verified 3/3 exactly as written, from a fresh install into an empty directory; the installed `index.linux-x64-gnu.node` has sha256 `6402e1f9…`. Loading the module on the main thread exits 0. Loading `@ruvector/router`, `@ruvector/attention` or `@ruvector/rvf-node` in a worker the same way also exits 0.

### What happens

Under gdb, with ASLR off and `node --disable-wasm-trap-handler` so every SIGSEGV is a real fault:
- **Node unloads the addon during worker teardown:**
  ```
  __dlclose ← node::binding::DLib::Close ← node::Environment::~Environment
            ← node::FreeEnvironment ← node::worker::Worker::Run
  ```
- **The exiting worker thread then faults:**
  ```
  #0  0x...a450 in ?? ()        ← si_addr == pc; address no longer mapped
  #1  __GI___nptl_deallocate_tsd () at ./nptl/nptl_deallocate_tsd.c:73
  #2  start_thread () at ./nptl/pthread_create.c:455
  ```
- **The faulting address lies inside the former `.text` of `index.linux-x64-gnu.node`**, ELF vaddr `0x74450` in the 0.1.7 binary (sha256 `6402e1f9c15febfbaf04b3c1bd83e4b7ee15afce607553ef6c46a80a9e71f5e9`).

The binary is stripped, but it embeds Rust std's `thread_local` implementation and imports `pthread_key_create`. That's consistent with a TLS destructor registered by the addon, run by glibc at thread exit, after Node has already unmapped the library.

### Evidence that unloading is the cause

| Experiment (3 runs each) | Exit codes |
|---|---|
| Unmodified 0.1.7 binary, loaded in a worker | 139 139 139 |
| Same binary with **one byte** changed, setting `DF_1_NODELETE` in `DT_FLAGS_1` (`0x1` → `0x9`) | 0 0 0 |
| Unmodified binary, also loaded on the main thread first, so the worker's `dlclose` doesn't unmap it | 0 0 0 |

Sibling addons `@ruvector/router`, `attention`, `gnn` and `graph-node` already have `FLAGS_1: NOW NODELETE`. `@ruvector/sona` 0.1.5 and 0.1.7 have only `NOW`.

### Suggested fix

Link the sona addon with `-z nodelete`, for example `-C link-arg=-Wl,-z,nodelete`, matching the sibling crates. Or avoid registering pthread-key TLS destructors from code that can be unloaded. Please confirm this against your other supported targets, since only linux-x64-gnu was tested here.

### Impact

Any process that loads sona inside a `worker_thread` crashes when that worker exits. Vitest's default `threads` pool is one example: a test file that imports a module depending on sona kills the whole test run.
