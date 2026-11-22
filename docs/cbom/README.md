# Cryptographic inventory (CBOM)

`cbom.json` is a CycloneDX 1.6 CBOM written by QoreScan Community 0.1.0 (`@qorechain/qorescan`, the official launcher) on 22 Nov 2026 at 05:14 Cairo (03:14 UTC). `agility.md` is QoreScan's crypto-agility draft generated from it. Re-create both with `sh docs/cbom/scan.sh` from the repository root. QoreScan only reads; it is an inventory aid, not a certification or an audit.

What was scanned: live Diana testnet state over REST (chain parameters, the relayer account `qor17mn0ktfnhmesgd5zvk8zk60n5tuxzmxdc8ymnl`), the Solidity sources in `contracts-v4/src` and `contracts/src`, and the TLS endpoints of the app, the API and the EVM RPC.

## What it found, and what it means for Pocket Drop

| Algorithm | QoreScan class | Where | Our reading |
|---|---|---|---|
| ML-DSA-87 (FIPS 204) | post-quantum | `PqcLib.sol` calls `pqcVerify` (0x0A01) and `pqcKeyStatus` (0x0A02); the chain's default PQ algorithm; the relayer's registered key | every Pocket action, bind, claim, freeze and recovery is checked with it by the contracts |
| ECDSA secp256k1 | quantum-vulnerable | the EVM lane; the classical half of native hybrid signatures; the relayer's classical key | Pocket Drop accepts no action on a classical signature alone: Pocket intents need ML-DSA-87, and the relayer's own EVM window is closed, so its relays carry secp256k1 + ML-DSA-87 (hybrid). A user's key account still pays its own registration with a hybrid native tx |
| X25519MLKEM768 | hybrid | TLS 1.3 key exchange of all three endpoints | the browser-to-API and browser-to-RPC traffic already uses a hybrid post-quantum key exchange |
| RSA / ECDSA P-256, P-384 | quantum-vulnerable | the web PKI certificates of the endpoints (Vercel, qore.host) | outside the project's control (certificate authorities) |
| Ed25519 | quantum-vulnerable | the 4 active validators' consensus keys | chain consensus, outside the project's control |
| Keccak-256, SHA-256, AES-128-GCM, HKDF-SHA256 | symmetric | digests in the contracts, TLS | not scheduled for deprecation by NIST IR 8547 |
