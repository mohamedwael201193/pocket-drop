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
    /// @return valid True only if the precompile returned exactly one word equal to 1.
    function verify(bytes memory pk, bytes memory sig, bytes memory message) internal view returns (bool valid) {
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
        // The dynamic part must start after the head, be word aligned and leave room for its length word.
        if (offset < 128 || offset % 32 != 0 || offset > n - 32) return st;

        uint256 len;
        assembly ("memory-safe") {
            len := mload(add(add(ret, 32), offset))
        }
        if (len > MAX_PUBKEY_LEN || offset + 32 + len > n) return st;

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
                    v4: PREFIXED MESSAGE + KEY CHECKS
    //////////////////////////////////////////////////////////////*/

    /// @dev QoreX signs `"qorechain-msg-v1|" + chainId + "|" + data` (qoresign `messagePqSignBytes`). Every v4 intent
    ///      digest is signed as that byte string, so the contracts have one verification path for QoreX users and
    ///      browser-key users alike.
    string internal constant MSG_PREFIX = "qorechain-msg-v1|";
    /// @dev Cosmos chain id string used in the prefix (Diana testnet).
    string internal constant CHAIN_ID_STR = "qorechain-diana";

    /// @notice Why a key check failed; `Ok` means the account has a usable, proven ML-DSA-87 key.
    enum KeyCheck {
        Ok,
        Unavailable,
        NotRegistered,
        UnsupportedAlgo,
        NotProven,
        KeyMismatch
    }

    error KeyUnavailable();
    error NotRegistered();
    error UnsupportedAlgo();
    error PossessionNotProven();
    error KeyMismatch();

    /// @notice The exact bytes an owner signs for `digest`. THE ONE PLACE the message format lives.
    /// @dev data = lowercase hex of the digest with a 0x prefix (66 chars), as produced by viem `keccak256`. If QoreX
    ///      encodes the data differently, change only this function.
    function pqMessage(bytes32 digest) internal pure returns (bytes memory) {
        bytes memory out = new bytes(66);
        out[0] = "0";
        out[1] = "x";
        bytes16 alphabet = "0123456789abcdef";
        for (uint256 i; i < 32; i++) {
            uint8 b = uint8(digest[i]);
            out[2 + 2 * i] = alphabet[b >> 4];
            out[3 + 2 * i] = alphabet[b & 0x0f];
        }
        return bytes.concat(bytes(MSG_PREFIX), bytes(CHAIN_ID_STR), "|", out);
    }

    /// @notice Check that `account` has a registered, proof-of-possession ML-DSA-87 key (and, if `pinned != 0`, that its
    ///         hash equals `pinned`).
    function checkKey(address account, bytes32 pinned) internal view returns (KeyCheck code, bytes memory pk) {
        KeyStatus memory ks = keyStatus(account);
        if (!ks.ok) return (KeyCheck.Unavailable, pk);
        if (!ks.registered) return (KeyCheck.NotRegistered, pk);
        if (ks.algoId != ALGO_ML_DSA_87) return (KeyCheck.UnsupportedAlgo, pk);
        if (!ks.possessionProven) return (KeyCheck.NotProven, pk);
        if (pinned != bytes32(0) && keccak256(ks.pubkey) != pinned) return (KeyCheck.KeyMismatch, pk);
        return (KeyCheck.Ok, ks.pubkey);
    }

    /// @notice Same as `checkKey` but reverts with a specific error unless the key is usable.
    function requireKey(address account, bytes32 pinned) internal view returns (bytes memory pk) {
        KeyCheck code;
        (code, pk) = checkKey(account, pinned);
        if (code == KeyCheck.Unavailable) revert KeyUnavailable();
        if (code == KeyCheck.NotRegistered) revert NotRegistered();
        if (code == KeyCheck.UnsupportedAlgo) revert UnsupportedAlgo();
        if (code == KeyCheck.NotProven) revert PossessionNotProven();
        if (code == KeyCheck.KeyMismatch) revert KeyMismatch();
    }

    /// @notice Verify `sig` over `message` with the key currently registered for `account`.
    /// @dev False (never a revert) when the key is missing, unproven, not ML-DSA-87, or the signature is wrong.
    function verifyFor(address account, bytes memory message, bytes memory sig) internal view returns (bool) {
        return verifyForKey(account, bytes32(0), message, sig);
    }

    /// @notice As `verifyFor`, additionally requiring `keccak256(registered key) == pinned` when `pinned != 0`.
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
