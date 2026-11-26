// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PqcLib
/// @notice Fail-closed wrappers around the QoreChain post-quantum precompiles.
/// @dev Both precompiles are called with raw `staticcall`. A failed call, short or malformed return data, or any
///      decode doubt yields `false` / `ok == false`. Nothing here ever reverts on bad input; callers decide which
///      custom error to raise. Tuple lengths are never assumed: the key-status return data is bounds-checked by hand.
///
///      - `pqcVerify(bytes pk, bytes sig, bytes msg) returns (bool)` at 0x0A01: pure ML-DSA-87 verification.
///      - `pqcKeyStatus(address) returns (bool registered, uint8 algoId, bytes pubkey, bool possessionProven)` at 0x0A02.
library PqcLib {
    /// @dev ML-DSA-87 verification precompile.
    address internal constant VERIFY_PRECOMPILE = 0x0000000000000000000000000000000000000a01;
    /// @dev PQC key-status precompile.
    address internal constant KEYS_PRECOMPILE = 0x0000000000000000000000000000000000000a02;
    /// @dev Algorithm id of ML-DSA-87 in the key registry.
    uint8 internal constant ALGO_ML_DSA_87 = 1;
    /// @dev Upper bound on a decoded public key (ML-DSA-87 keys are 2592 bytes); larger data is treated as malformed.
    uint256 internal constant MAX_PUBKEY_LEN = 8192;
    /// @dev FIPS 204 ML-DSA-87 sizes. v5: enforced in the contract, not only by the precompile and the pinned key hash.
    uint256 internal constant ML_DSA_87_PK_LEN = 2592;
    uint256 internal constant ML_DSA_87_SIG_LEN = 4627;
    /// @dev The only key-status layout accepted (v5): the bytes field starts right after the 4-word head. Every
    ///      recorded Diana answer uses it (docs/PRECOMPILE_CONFORMANCE.md).
    uint256 internal constant KEY_STATUS_BYTES_OFFSET = 0x80;

    /// @notice Decoded result of `pqcKeyStatus`.
    /// @dev `ok == false` means the precompile call failed or its data was malformed; all other fields are then zero.
    struct KeyStatus {
        bool ok;
        bool registered;
        uint8 algoId;
        bool possessionProven;
        bytes pubkey;
    }

    /// @notice Verify an ML-DSA-87 signature through the precompile.
    /// @param pk Public key.
    /// @param sig Signature.
    /// @param message Signed message.
    /// @return valid True only if `pk` is 2592 bytes, `sig` is 4627 bytes and the precompile returned exactly one word
    ///         equal to 1. Wrong sizes return false without calling the precompile.
    function verify(bytes memory pk, bytes memory sig, bytes memory message) internal view returns (bool valid) {
        if (pk.length != ML_DSA_87_PK_LEN || sig.length != ML_DSA_87_SIG_LEN) return false;
        (bool success, bytes memory ret) =
            VERIFY_PRECOMPILE.staticcall(abi.encodeWithSignature("pqcVerify(bytes,bytes,bytes)", pk, sig, message));
        if (!success || ret.length != 32) return false;
        uint256 word;
        assembly ("memory-safe") {
            word := mload(add(ret, 32))
        }
        return word == 1;
    }

    /// @notice Read and decode an account's PQC key status.
    /// @param account Account to look up.
    /// @return st Decoded status; `st.ok` is false if anything about the call or the data is doubtful.
    function keyStatus(address account) internal view returns (KeyStatus memory st) {
        (bool success, bytes memory ret) =
            KEYS_PRECOMPILE.staticcall(abi.encodeWithSignature("pqcKeyStatus(address)", account));
        if (!success) return st;
        uint256 n = ret.length;
        // 4 head words + the bytes length word.
        if (n < 160) return st;

        uint256 registered;
        uint256 algo;
        uint256 offset;
        uint256 possession;
        assembly ("memory-safe") {
            registered := mload(add(ret, 32))
            algo := mload(add(ret, 64))
            offset := mload(add(ret, 96))
            possession := mload(add(ret, 128))
        }
        if (registered > 1 || possession > 1 || algo > type(uint8).max) return st;
        // v5: the dynamic part must start exactly after the head (canonical ABI layout, no gap, no overlap).
        if (offset != KEY_STATUS_BYTES_OFFSET) return st;

        uint256 len;
        assembly ("memory-safe") {
            len := mload(add(add(ret, 32), offset))
        }
        // v5: the return data must be exactly head + length word + the key padded to a whole word (no trailing data).
        if (len > MAX_PUBKEY_LEN || n != 160 + ((len + 31) / 32) * 32) return st;

        bytes memory pk = new bytes(len);
        assembly ("memory-safe") {
            let src := add(add(ret, 64), offset)
            let dst := add(pk, 32)
            for { let i := 0 } lt(i, len) { i := add(i, 32) } { mstore(add(dst, i), mload(add(src, i))) }
        }
        st.ok = true;
        st.registered = registered == 1;
        st.algoId = uint8(algo);
        st.possessionProven = possession == 1;
        st.pubkey = pk;
    }

    /*//////////////////////////////////////////////////////////////
                 PREFIXED, PURPOSE-TAGGED MESSAGES (v5.1)
    //////////////////////////////////////////////////////////////*/

    /// @dev QoreX signs `"qorechain-msg-v1|" + chainId + "|" + data` (qoresign `messagePqSignBytes`). Every digest the
    ///      contracts check is signed as that byte string, so QoreX users and browser-key users share one path.
    string internal constant MSG_PREFIX = "qorechain-msg-v1|";
    /// @dev Cosmos chain id string used in the prefix (Diana testnet).
    string internal constant CHAIN_ID_STR = "qorechain-diana";

    /// @dev v5.1 (F2): approvals of an OUTSIDE hash are signed as `<tag>:0x<digest hex>`, protocol messages (owner
    ///      intents, guardian approvals, link and claim signatures) as plain `0x<digest hex>`. The two byte layouts can
    ///      never be equal (after the chain id one starts with "0x", the other with a tag), so an ERC-1271 or PqGuard
    ///      approval of a hash chosen by some app can never be replayed as a Pocket intent, and vice versa. Protocol
    ///      digests are separated from each other by their own domain strings and action tags inside the hash.
    /// @dev ERC-1271 approvals of a Pocket (`PocketVault.isValidSignature`, over `erc1271Digest`).
    string internal constant TAG_ERC1271 = "pocket-erc1271-v1";
    /// @dev PqGuard approvals by a plain PoP-proven account (over `PqGuard.approvalDigest`).
    string internal constant TAG_PQGUARD = "pqguard-v1";

    /// @notice Why a key check failed; `Ok` means the account has a usable, proven ML-DSA-87 key.
    enum KeyCheck {
        Ok,
        Unavailable,
        NotRegistered,
        UnsupportedAlgo,
        NotProven,
        KeyMismatch,
        BadKeyLength
    }

    error KeyUnavailable();
    error NotRegistered();
    error UnsupportedAlgo();
    error PossessionNotProven();
    error KeyMismatch();
    error BadKeyLength();

    /// @notice The exact bytes a key signs for a protocol `digest` (owner intent, guardian approval, link or claim).
    /// @dev Layout: `qorechain-msg-v1|qorechain-diana|0x<64 lowercase hex chars>`. The hex is the digest as produced by
    ///      viem `keccak256`. Unchanged since v4.
    /// @param digest The 32-byte digest being approved.
    /// @return The message bytes passed to `pqcVerify`.
    function pqMessage(bytes32 digest) internal pure returns (bytes memory) {
        return bytes.concat(bytes(MSG_PREFIX), bytes(CHAIN_ID_STR), "|", _hex(digest));
    }

    /// @notice The exact bytes a key signs to approve an outside `digest` under purpose `tag` (ERC-1271, PqGuard).
    /// @dev Layout: `qorechain-msg-v1|qorechain-diana|<tag>:0x<64 lowercase hex chars>` (v5.1, F2).
    /// @param tag `TAG_ERC1271` or `TAG_PQGUARD`.
    /// @param digest The 32-byte digest being approved.
    /// @return The message bytes passed to `pqcVerify`.
    function pqMessage(string memory tag, bytes32 digest) internal pure returns (bytes memory) {
        return bytes.concat(bytes(MSG_PREFIX), bytes(CHAIN_ID_STR), "|", bytes(tag), ":", _hex(digest));
    }

    /// @dev `0x` + 64 lowercase hex chars of `digest`.
    function _hex(bytes32 digest) private pure returns (bytes memory out) {
        out = new bytes(66);
        out[0] = "0";
        out[1] = "x";
        bytes16 alphabet = "0123456789abcdef";
        for (uint256 i; i < 32; i++) {
            uint8 b = uint8(digest[i]);
            out[2 + 2 * i] = alphabet[b >> 4];
            out[3 + 2 * i] = alphabet[b & 0x0f];
        }
    }

    /// @notice Check that `account` has a registered, proof-of-possession ML-DSA-87 key (and, if `pinned != 0`, that its
    ///         hash equals `pinned`).
    /// @param account Account whose registry entry is read.
    /// @param pinned Expected keccak256 of the key, or zero for any key.
    /// @return code `KeyCheck.Ok` or the first failing rule.
    /// @return pk The registered key when `code == Ok`, else empty.
    function checkKey(address account, bytes32 pinned) internal view returns (KeyCheck code, bytes memory pk) {
        KeyStatus memory ks = keyStatus(account);
        if (!ks.ok) return (KeyCheck.Unavailable, pk);
        if (!ks.registered) return (KeyCheck.NotRegistered, pk);
        if (ks.algoId != ALGO_ML_DSA_87) return (KeyCheck.UnsupportedAlgo, pk);
        if (ks.pubkey.length != ML_DSA_87_PK_LEN) return (KeyCheck.BadKeyLength, pk);
        if (!ks.possessionProven) return (KeyCheck.NotProven, pk);
        if (pinned != bytes32(0) && keccak256(ks.pubkey) != pinned) return (KeyCheck.KeyMismatch, pk);
        return (KeyCheck.Ok, ks.pubkey);
    }

    /// @notice Same as `checkKey` but reverts with a specific error unless the key is usable.
    /// @param account Account whose registry entry is read.
    /// @param pinned Expected keccak256 of the key, or zero for any key.
    /// @return pk The registered 2592-byte ML-DSA-87 key.
    function requireKey(address account, bytes32 pinned) internal view returns (bytes memory pk) {
        KeyCheck code;
        (code, pk) = checkKey(account, pinned);
        if (code == KeyCheck.Unavailable) revert KeyUnavailable();
        if (code == KeyCheck.NotRegistered) revert NotRegistered();
        if (code == KeyCheck.UnsupportedAlgo) revert UnsupportedAlgo();
        if (code == KeyCheck.NotProven) revert PossessionNotProven();
        if (code == KeyCheck.KeyMismatch) revert KeyMismatch();
        if (code == KeyCheck.BadKeyLength) revert BadKeyLength();
    }

    /// @notice Verify `sig` over `message` with the key currently registered for `account`.
    /// @dev False (never a revert) when the key is missing, unproven, not ML-DSA-87, or the signature is wrong.
    /// @param account Signer account.
    /// @param message Full message bytes (see `pqMessage`).
    /// @param sig ML-DSA-87 signature.
    /// @return True only for a valid signature by a usable key.
    function verifyFor(address account, bytes memory message, bytes memory sig) internal view returns (bool) {
        return verifyForKey(account, bytes32(0), message, sig);
    }

    /// @notice As `verifyFor`, additionally requiring `keccak256(registered key) == pinned` when `pinned != 0`.
    /// @param account Signer account.
    /// @param pinned Expected keccak256 of the key, or zero for any key.
    /// @param message Full message bytes (see `pqMessage`).
    /// @param sig ML-DSA-87 signature.
    /// @return True only for a valid signature by a usable key with the pinned hash.
    function verifyForKey(address account, bytes32 pinned, bytes memory message, bytes memory sig)
        internal
        view
        returns (bool)
    {
        (KeyCheck code, bytes memory pk) = checkKey(account, pinned);
        if (code != KeyCheck.Ok) return false;
        return verify(pk, sig, message);
    }
}
