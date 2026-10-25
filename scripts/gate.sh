#!/usr/bin/env bash
# Usage: scripts/gate.sh [fast|std|full]
# Prints PASS/FAIL/SKIP per check; exits non-zero if any FAIL. SKIP is never a pass.
LEVEL="${1:-fast}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN="${GATE_MAIN:-/d/Oxhack/OxHackMacroPaths}"
cd "$ROOT" || exit 2
ENV="$MAIN/.pixi/envs/default"
PY="$ENV/python.exe"; [ -x "$PY" ] || PY="$ENV/bin/python"
[ -x "$PY" ] || PY="$(command -v python3 || command -v python)"
export PATH="$ENV/Library/bin:$ENV/bin:$ENV:$PATH"
export PYTHONIOENCODING=utf-8
NPX="npx"; command -v node >/dev/null && node --version | grep -q '^v20' || echo "note: node is not v20 ($(node --version 2>&1))"

PASS=0; FAILN=0; SKIPN=0
ok()   { echo "PASS $1"; PASS=$((PASS+1)); }
bad()  { echo "FAIL $1"; FAILN=$((FAILN+1)); }
skip() { echo "SKIP $1 ($2)"; SKIPN=$((SKIPN+1)); }
run() { # name, cmd...
  local n="$1"; shift
  local out; out="$("$@" 2>&1)"; local rc=$?
  if [ $rc -eq 0 ]; then ok "$n"; else bad "$n"; echo "$out" | tail -15 | sed 's/^/    /'; fi
  LAST="$out"
}

# step 5: gitignored data
for d in snapshots raw; do
  if [ ! -d "data/$d" ] && [ -d "$MAIN/data/$d" ]; then
    cp -r "$MAIN/data/$d" "data/$d" && echo "copied data/$d from $MAIN/data/$d"
  fi
done

pytest_file() { # path
  if [ -f "$1" ]; then run "py:$1" "$PY" "$1"; else skip "py:$1" "file absent"; fi
}
for t in data/test_presentation.py research/test_planner.py forecast/test_link.py forecast/test_walkforward.py data/test_fetch.py; do
  pytest_file "$t"
done

if [ -f tests/make_vectors.py ]; then
  run vectors-regen "$PY" tests/make_vectors.py
  if echo "$LAST" | grep -qi unchanged; then ok vectors-unchanged; else bad vectors-unchanged; fi
  run vectors-diff git diff --exit-code tests/vectors.json
else
  skip vectors "tests/make_vectors.py absent"
fi

if [ "$LEVEL" = std ] || [ "$LEVEL" = full ]; then
  if [ -d keeper/node_modules ]; then
    run keeper-chain bash -c 'cd keeper && npx tsx src/prepare.ts --check ../tests/vectors.json'
    echo "$LAST" | grep -q 'chain ok 49/49' || { bad keeper-chain-49; }
    run keeper-tsc bash -c 'cd keeper && npx tsc --noEmit'
  else
    skip keeper-chain "keeper/node_modules missing"; skip keeper-tsc "keeper/node_modules missing"
  fi
  if [ -f web/package.json ] && [ -d web/node_modules ]; then
    run web-typecheck bash -c 'cd web && npm run typecheck --if-present'
    run web-build bash -c 'cd web && npm run build'
  else
    skip web-typecheck "web/package.json or node_modules missing"; skip web-build "web/package.json or node_modules missing"
  fi
fi

if [ "$LEVEL" = full ]; then
  if command -v wsl >/dev/null 2>&1; then
    WP="$(wsl wslpath -a "$ROOT" 2>/dev/null | tr -d '\r')"
    (wsl bash -lc "cd '$WP' && cargo test -p macropaths" > "$ROOT/gate-cargo.log" 2>&1; echo "exit $?" >> "$ROOT/gate-cargo.log") &
    echo "cargo test running in background; result in $ROOT/gate-cargo.log"
    skip cargo-test "background, see gate-cargo.log"
  else
    skip cargo-test "wsl absent"
  fi
fi

echo "SUMMARY level=$LEVEL pass=$PASS fail=$FAILN skip=$SKIPN"
[ $FAILN -eq 0 ]
