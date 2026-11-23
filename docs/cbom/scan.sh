#!/bin/sh
# Re-create the CBOM (CycloneDX 1.6) of Pocket Drop on Diana testnet with the official QoreScan launcher (read-only, no keys).
# Run from the repository root (or `npm --prefix tools run cbom`). The launcher is pinned in tools/package.json
# (@qorechain/qorescan 0.1.0); it downloads the qorescan binary and checks its SHA-256 before running it.
# Addresses: the five qor1 accounts listed on the project page (main wallet, deployer, relayer, sponsor, QoreX test wallet).
set -e
[ -x tools/node_modules/.bin/qorescan ] || npm --prefix tools ci --no-audit --no-fund
QS=tools/node_modules/.bin/qorescan
$QS scan --network testnet --name "Pocket Drop (Diana testnet)" \
  --address qor1326uun7dghxxnlhrr6nwne3z9s0p3w7a6frcus \
  --address qor18yh4pvv4t2p8gk9ryqs9uxdv7lrxfugkaksdhq \
  --address qor17mn0ktfnhmesgd5zvk8zk60n5tuxzmxdc8ymnl \
  --address qor1rcew9w8qf4y2twytmcna05g89gas4q3p429uwh \
  --address qor1ppxmr9ek5yex76uy4x4j726029he0zg5kcfe2e \
  --tls pocketdrop-app.vercel.app:443 --tls pocketdrop-api.vercel.app:443 --tls evm-testnet.qore.host:443 \
  --solidity contracts-v4/src --solidity contracts/src \
  --out docs/cbom/cbom.json
$QS template agility --cbom docs/cbom/cbom.json --out docs/cbom/agility.md
