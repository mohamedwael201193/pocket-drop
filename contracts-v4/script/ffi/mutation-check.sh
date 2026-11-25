#!/usr/bin/env bash
# Proves the real-crypto suite is not vacuous: with the verifier forced to accept everything, most tests MUST fail.
# Restores the script afterwards. Run from contracts-v4/.
set -u
f=script/ffi/mldsa.mjs
cp "$f" "$f.orig"
trap 'mv "$f.orig" "$f"' EXIT
sed -i 's/process.stdout.write(encBool(v1));/process.stdout.write(encBool(true));/' "$f"
grep -q 'encBool(true)' "$f" || { echo "mutation not applied"; exit 1; }
out=$(FOUNDRY_PROFILE=realcrypto forge test 2>&1 | grep 'Suite result')
echo "accept-all verifier: $out"
failed=$(echo "$out" | sed -E 's/.* ([0-9]+) failed.*/\1/')
[ "${failed:-0}" -ge 10 ] || { echo "too few tests caught the accept-all verifier"; exit 1; }
echo "OK: $failed tests fail when the verifier accepts everything"
