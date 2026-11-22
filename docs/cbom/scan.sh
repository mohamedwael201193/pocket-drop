#!/bin/sh
# Re-create the CBOM (CycloneDX 1.6) of Pocket Drop on Diana testnet with the official QoreScan launcher (read-only, no keys).
# Run from the repository root. The launcher downloads the qorescan binary and checks its SHA-256 before running it.
set -e
npx -y @qorechain/qorescan@0.1.0 scan --network testnet --name "Pocket Drop (Diana testnet)" \
  --address qor17mn0ktfnhmesgd5zvk8zk60n5tuxzmxdc8ymnl \
  --tls pocketdrop-app.vercel.app:443 --tls pocketdrop-api.vercel.app:443 --tls evm-testnet.qore.host:443 \
  --solidity contracts-v4/src --solidity contracts/src \
  --out docs/cbom/cbom.json
npx -y @qorechain/qorescan@0.1.0 template agility --cbom docs/cbom/cbom.json --out docs/cbom/agility.md
