# Precompile conformance: pqcVerify (0x0A01) and pqcKeyStatus (0x0A02) on Diana

RECORDED 2026-11-25 19:49 UTC by `node contracts-v4/script/probe-precompiles.mjs` against `https://evm-testnet.qore.host` (EVM chain id 9800). eth_call only: no transaction, no QOR spent. Raw data: [precompile-conformance.json](precompile-conformance.json). Re-run the script to refresh; the block of every read is in the table.

"Expected" is FIPS 204 ML-DSA-87 (pure, empty context) computed locally with two libraries (@qorechain/pqc and @qorechain/qoresign, which must agree). "PqcLib" is what our contracts conclude from the live answer (true only for exactly one 32-byte word equal to 1; a revert or anything else is false). A row is an anomaly only when PqcLib's conclusion differs from the expectation.

Result: 29 pqcVerify cases, 0 anomalies.

## Findings

1. Signature check: every one of the 28 reached cases matches FIPS 204 ML-DSA-87 (pure, empty context). Wrong-size keys and signatures, all-zero inputs, flipped bits, other parameter sets (ML-DSA-65, ML-DSA-44), a non-empty context and an ML-DSA internal signature all return false. The precompile returns false (it does not revert) for bad sizes.
2. Empty message (chain-level, already fixed): a valid signature over the empty message read false at block 10654799 and true from block 10654800 (archive reads in the table below). The current behaviour is correct. Pocket Drop never signs an empty message (every intent message is 99 bytes), so no Pocket Drop path depended on it.
3. Key status layout: the bytes offset word is 0x80 in every answer; an unregistered account returns 160 bytes (registered false, algoId 0, empty key, PoP false), a registered one 2752 bytes with a 2592-byte key. PqcLib v4 accepts any aligned offset >= 0x80; the v5 strict PqcLib requires exactly 0x80 and a 2592-byte key, which matches every live answer.
4. ABI leniency (observation, not a risk for Pocket Drop): pqcKeyStatus accepts an address word with dirty high bits (Solidity would revert), and pqcVerify ignores 32 trailing calldata bytes. PqcLib always sends canonical abi.encode calldata.
5. Cost and size: a valid check costs about 311250 gas for an empty message and 966400 gas at 16 KiB. Messages up to 49152 bytes were verified live; 65536 bytes did not reach the node (the public RPC gateway answered HTTP 403), so the precompile itself was not tested at that size.

## pqcVerify(bytes pk, bytes sig, bytes msg)

| Case | pk / sig / msg bytes | Expected | Live answer | PqcLib | Gas (valid) | Block |
|---|---|---|---|---|---|---|
| valid: 99-byte intent-shaped message | 2592 / 4627 / 99 | true | true | true | 315020 | 10746287 |
| valid: empty message | 2592 / 4627 / 0 | true | true | true | 311250 | 10746287 |
| valid: 1-byte message 0x00 | 2592 / 4627 / 1 | true | true | true | 311060 | 10746287 |
| empty-message signature checked against 0x00 | 2592 / 4627 / 1 | false | false | false |  | 10746287 |
| wrong key (valid signature by another key) | 2592 / 4627 / 99 | false | false | false |  | 10746287 |
| signature first byte flipped | 2592 / 4627 / 99 | false | false | false |  | 10746287 |
| signature middle byte flipped | 2592 / 4627 / 99 | false | false | false |  | 10746287 |
| signature last byte flipped | 2592 / 4627 / 99 | false | false | false |  | 10746287 |
| public key first byte flipped | 2592 / 4627 / 99 | false | false | false |  | 10746287 |
| public key last byte flipped | 2592 / 4627 / 99 | false | false | false |  | 10746287 |
| message last byte flipped | 2592 / 4627 / 99 | false | false | false |  | 10746287 |
| signature truncated to 4626 bytes | 2592 / 4626 / 99 | false | false | false |  | 10746287 |
| signature + 1 trailing zero byte (4628) | 2592 / 4628 / 99 | false | false | false |  | 10746287 |
| signature + 32 trailing zero bytes (4659) | 2592 / 4659 / 99 | false | false | false |  | 10746287 |
| empty signature | 2592 / 0 / 99 | false | false | false |  | 10746287 |
| all-zero 4627-byte signature | 2592 / 4627 / 99 | false | false | false |  | 10746287 |
| public key truncated to 2591 bytes | 2591 / 4627 / 99 | false | false | false |  | 10746287 |
| public key + 1 trailing zero byte (2593) | 2593 / 4627 / 99 | false | false | false |  | 10746288 |
| empty public key | 0 / 4627 / 99 | false | false | false |  | 10746288 |
| all-zero 2592-byte public key | 2592 / 4627 / 99 | false | false | false |  | 10746288 |
| signature with non-empty context "pd" | 2592 / 4627 / 99 | false | false | false |  | 10746288 |
| ML-DSA internal signature (no FIPS 204 message wrapper) | 2592 / 4627 / 99 | false | false | false |  | 10746288 |
| valid ML-DSA-65 key + signature (1952 / 3309 bytes) | 1952 / 3309 / 99 | false | false | false |  | 10746288 |
| valid ML-DSA-44 key + signature (1312 / 2420 bytes) | 1312 / 2420 / 99 | false | false | false |  | 10746288 |
| valid: 1024-byte message | 2592 / 4627 / 1024 | true | true | true | 351550 | 10746288 |
| valid: 16384-byte message | 2592 / 4627 / 16384 | true | true | true | 966400 | 10746288 |
| valid: 32768-byte message | 2592 / 4627 / 32768 | true | true | true | 1621910 | 10746288 |
| valid: 49152-byte message | 2592 / 4627 / 49152 | true | true | true | 2277270 | 10746288 |
| valid: 65536-byte message | 2592 / 4627 / 65536 | true | not reached (RPC size limit) (RPC gateway answered HTTP 403 (not JSON-RPC)) | null |  | 10746288 |

### Empty message at earlier heights

| Block | Live answer |
|---|---|
| 10654000 | false |
| 10654799 | false |
| 10654800 | true |
| 10655000 | true |

## pqcKeyStatus(address)

| Case | Registered | algoId | Key bytes | PoP | Head offset of bytes | Return bytes | Block |
|---|---|---|---|---|---|---|---|
| registered account (deployer) | true | 1 | 2592 | true | 0x80 | 2752 | 10746288 |
| registered account (relayer) | true | 1 | 2592 | true | 0x80 | 2752 | 10746288 |
| never-registered random address | false | 0 | 0 | false | 0x80 | 160 | 10746288 |
| zero address | false | 0 | 0 | false | 0x80 | 160 | 10746288 |
| the precompile address itself | false | 0 | 0 | false | 0x80 | 160 | 10746288 |

## Malformed calldata (PqcLib never sends these)

| Case | Result | Block |
|---|---|---|
| pqcKeyStatus: empty calldata | revert | 10746288 |
| pqcKeyStatus: selector only | revert | 10746288 |
| pqcKeyStatus: address word with dirty high bits | returned 2752 bytes | 10746288 |
| pqcKeyStatus: 32 trailing bytes | returned 2752 bytes | 10746288 |
| pqcKeyStatus: unknown selector | revert | 10746288 |
| pqcVerify: empty calldata | revert | 10746288 |
| pqcVerify: valid call + 32 trailing bytes | returned 0x0000000000000000000000000000000000000000000000000000000000000001 | 10746288 |
| pqcVerify: calldata cut by 32 bytes | revert | 10746288 |
| pqcVerify: unknown selector | revert | 10746288 |
