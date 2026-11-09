#!/usr/bin/env bash
# Re-runs every control and causal intervention for the @ruvector/sona
# worker-teardown SIGSEGV, 3 times each, and records each exit code.
# Usage: run-controls.sh <v3-dir> <repro-dir> <out-file>
#   v3-dir    : a ruflo v3/ checkout with node_modules installed (pnpm)
#   repro-dir : directory holding the repro scripts in this bundle
set -u
V3=${1:?v3 dir}; R=${2:?repro dir}; OUT=${3:?output file}
P="$V3/node_modules/.pnpm"
SONA7="$P/@ruvector+sona@0.1.7/node_modules/@ruvector/sona"
SONA5="$P/@ruvector+sona@0.1.5/node_modules/@ruvector/sona"
SO7="$SONA7/index.linux-x64-gnu.node"
WORK=$(mktemp -d)
cp "$SO7" "$WORK/sona-unmodified.node"
python3 "$R/set_nodelete.py" "$SO7" "$WORK/sona-nodelete.node" > "$WORK/patch.txt"
pkg() { ls -d "$P"/$1/node_modules/@ruvector/* 2>/dev/null | grep -v linux-x64 | head -1; }

{
  echo "# controls and interventions: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# node $(node -v), $(ldd --version | head -1), $(uname -srm)"
  echo "# sona 0.1.7 binary sha256: $(sha256sum "$SO7" | cut -c1-64)"
  echo "# patched copy sha256:      $(sha256sum "$WORK/sona-nodelete.node" | cut -c1-64) ($(cat "$WORK/patch.txt"))"
  echo "# bytes differing unmodified vs patched: $(cmp -l "$WORK/sona-unmodified.node" "$WORK/sona-nodelete.node" | wc -l)"
  echo "# columns: case | exit codes of 3 runs (139 = SIGSEGV)"
} > "$OUT"

row() {
  local label="$1"; shift
  local rcs=""
  for _ in 1 2 3; do (cd "$WORK" && "$@" >/dev/null 2>&1); rcs="$rcs $?"; done
  printf "%-62s |%s\n" "$label" "$rcs" >> "$OUT"
}

row "sona 0.1.7: require on main thread"            node "$R/addon-worker-control.cjs" main "$SONA7"
row "sona 0.1.7: require in worker, worker exits"   node "$R/addon-worker-control.cjs" worker "$SONA7"
row "sona 0.1.5: require in worker, worker exits"   node "$R/addon-worker-control.cjs" worker "$SONA5"
row "@ruvector/router 0.1.30 in worker"             node "$R/addon-worker-control.cjs" worker "$(pkg '@ruvector+router@0.1.30*')"
row "@ruvector/attention 0.1.32 in worker"          node "$R/addon-worker-control.cjs" worker "$(pkg '@ruvector+attention@0.1.32*')"
row "@ruvector/rvf-node 0.2.0 in worker"            node "$R/addon-worker-control.cjs" worker "$(pkg '@ruvector+rvf-node@0.2.0*')"
row "sona 0.1.7: construct SonaEngine in worker"    node "$R/sona-worker-repro.cjs" construct
row "intervention: unmodified copy in worker"       node "$R/nodelete-experiment.cjs" worker "$WORK/sona-unmodified.node"
row "intervention: +NODELETE (1 byte) in worker"    node "$R/nodelete-experiment.cjs" worker "$WORK/sona-nodelete.node"
row "intervention: unmodified, main-thread preload" node "$R/nodelete-experiment.cjs" main+worker "$WORK/sona-unmodified.node"
echo "# done" >> "$OUT"
