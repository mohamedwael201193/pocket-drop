# Crypto-agility statement (draft)

> **Disclaimer.** QoreScan output is an inventory aid. It is not a certification, an audit or a legal opinion, and it does not establish conformity with any regulation or standard. This draft is pre-filled only with facts the scan recorded; the organisation is responsible for completing, checking and adopting it.

Prepared from CBOM `urn:uuid:54b1740e-b061-5b37-a457-9e78a456a520` (2026-11-25T20:11:09Z). Statements are limited to what the scan recorded; everything else is marked to be completed.

## 1. Scope

Network: `qorechain-diana`.

Scanned: live network state via REST (https://api-testnet.qore.host); Solidity sources; TLS endpoints.

Systems outside this scan: _To be completed._

## 2. Algorithms in use

| Algorithm | Classification | Where it was found |
|---|---|---|
| ECDSA P-256 | quantum-vulnerable | presented by the server (2 occurrences in the CBOM) |
| ECDSA P-384 | quantum-vulnerable | presented by the server |
| ECDSA secp256k1 | quantum-vulnerable | EVM lane: transactions signed with ECDSA secp256k1 over Keccak-256; ecrecover (0x01), sha256 (0x02) and ripemd160 (0x03) precompiles; classical key of qor1326uun7dghxxnlhrr6nwne3z9s0p3w7a6frcus (7 occurrences in the CBOM) |
| ECDSA with SHA-256 | quantum-vulnerable | presented by the server |
| ECDSA with SHA-384 | quantum-vulnerable | presented by the server |
| Ed25519 | quantum-vulnerable | 4 active validators with /cosmos.crypto.ed25519.PubKey consensus keys at height 10747201 |
| RSA PKCS#1 v1.5 with SHA-256 | quantum-vulnerable | presented by the server (7 occurrences in the CBOM) |
| RSA-2048 | quantum-vulnerable | presented by the server (4 occurrences in the CBOM) |
| RSA-4096 | quantum-vulnerable | presented by the server (2 occurrences in the CBOM) |
| X25519MLKEM768 | hybrid | hybrid key exchange X25519MLKEM768 (3 occurrences in the CBOM) |
| ML-DSA-87 | post-quantum | QoreChain pqcVerify precompile (0x0A01): ML-DSA-87 signature verification; QoreChain pqcKeyStatus precompile (0x0A02): reads an account's registered ML-DSA-87 key (9 occurrences in the CBOM) |
| ML-KEM-1024 | post-quantum | KEM public key published by qor18yh4pvv4t2p8gk9ryqs9uxdv7lrxfugkaksdhq |
| AES-128-GCM | symmetric | TLS_AES_128_GCM_SHA256 (3 occurrences in the CBOM) |
| HKDF-SHA256 | symmetric | TLS_AES_128_GCM_SHA256 (3 occurrences in the CBOM) |
| Keccak-256 | symmetric | Keccak-256 hash; EVM lane: transactions signed with ECDSA secp256k1 over Keccak-256; ecrecover (0x01), sha256 (0x02) and ripemd160 (0x03) precompiles (33 occurrences in the CBOM) |
| SHA-256 | symmetric | TLS_AES_128_GCM_SHA256 (3 occurrences in the CBOM) |

## 3. Ability to replace algorithms

- Native-lane transactions: hybrid signature mode `required` (classical secp256k1 signature plus the registry's default post-quantum signature).
- Default post-quantum signature algorithm for new keys: ML-DSA-87.
- An algorithm migration runs with a dual-signature period of 1000000 blocks (module parameter `default_migration_blocks`).
- PQC-related protocol switches recorded as enabled: evm-pqc-authorisation-window, evm-pqc-window-targets, pqc-algorithm-governance-guards, pqc-consent-authz-limiter, pqc-consent-outer-signer, pqc-consent-own-message, pqc-degenerate-key-refused, pqc-ecdsa-pubkey-validation, pqc-hybrid-embedded-key-degenerate, pqc-hybrid-single-extension, pqc-kem-registry, pqc-key-change-clears-evm-delegation, pqc-key-registration-own-message, pqc-keyed-account-maintenance-hybrid, pqc-keyless-extension-closed, pqc-multisig, pqc-possession-flag, pqc-registration-ends-evm-consent, pqc-registration-ends-svm-window, pqc-registration-integrity, pqc-rotate-key-size-check, pqc-rotation-ends-evm-consent, pqc-rotation-replay-guard, pqc-sign-bytes-v2, pqc-svm-window-key-proof, pqc-verify-empty-message, pqc-verify-gas-calibrated, pqc-verify-once-per-signer, qcb-pqc-submitter, qcb-pqc-submitter-own-message, svm-pqc-authorisation-window, svm-pqc-key-for-wallets, svm-pqc-key-lane-gated.
- Solidity sources have 2 signature-related occurrences; replacing their algorithms requires a contract change and redeployment.

Procedure, approvals and testing for an algorithm change: _To be completed._

## 4. Transition plan

Quantum-vulnerable algorithms in scope: ECDSA P-256, ECDSA P-384, ECDSA secp256k1, ECDSA with SHA-256, ECDSA with SHA-384, Ed25519, RSA PKCS#1 v1.5 with SHA-256, RSA-2048, RSA-4096. NIST IR 8547 deprecates these families after 2030 and disallows them after 2035.

Target dates per system and use case: _To be completed._

## 5. Responsibilities and review

Owner: _To be completed._

Review cycle: _To be completed._
