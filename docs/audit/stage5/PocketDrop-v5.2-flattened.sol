// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ===== src/interfaces/IPocket.sol =====
/// @notice The slice of PocketFactory that other contracts depend on.
interface IPocketFactory {
    /// @notice Whether `account` was deployed by this factory.
    /// @param account Address to check.
    /// @return True for factory-deployed Pockets.
    function isPocket(address account) external view returns (bool);

    /// @notice Address the Pocket for this config has (or will have).
    /// @param owner Pocket owner.
    /// @param guardians Guardian set.
    /// @param threshold Guardian threshold.
    /// @param dailyLimit Daily allowance in wei.
    /// @param userSalt User salt.
    /// @return The CREATE2 address.
    function predict(address owner, address[] calldata guardians, uint8 threshold, uint256 dailyLimit, bytes32 userSalt)
        external
        view
        returns (address);

    /// @notice Deploy and initialize the Pocket for this config.
    /// @param owner Pocket owner.
    /// @param guardians Guardian set.
    /// @param threshold Guardian threshold.
    /// @param dailyLimit Daily allowance in wei.
    /// @param userSalt User salt.
    /// @return The new Pocket.
    function deploy(address owner, address[] calldata guardians, uint8 threshold, uint256 dailyLimit, bytes32 userSalt)
        external
        returns (address);
}

/// @notice The slice of PocketDrop that a Pocket calls as the sender.
interface IPocketDropSender {
    /// @notice Create and fund a link with `msg.sender` as the sender.
    /// @param linkKeyHash keccak256 of the link's ML-DSA-87 key.
    /// @param mode 0 = Confirmed, 1 = Open.
    /// @param expiry Link expiry.
    /// @param drip Drip paid to the recipient on the first bind.
    /// @param relayerFee Relayer fee paid on the first bind.
    /// @return The new link id.
    function create(bytes32 linkKeyHash, uint8 mode, uint64 expiry, uint96 drip, uint96 relayerFee)
        external
        payable
        returns (uint256);

    /// @notice Sender confirms the recipient key of a Confirmed-mode link.
    /// @param linkId Link id.
    /// @param expectedRecipientKeyHash The key hash the sender checked.
    function confirmRecipient(uint256 linkId, bytes32 expectedRecipientKeyHash) external;

    /// @notice Sender cancels a link; the escrow returns to the sender.
    /// @param linkId Link id.
    function cancel(uint256 linkId) external;
}

/// @notice The slice of DropPool that a Pocket calls as the host.
interface IDropPoolHost {
    /// @notice Create and fund a pool with `msg.sender` as the host.
    /// @param linkKeyHash keccak256 of the pool's link key.
    /// @param slots Slot count.
    /// @param perSlot Amount per slot.
    /// @param expiry Pool expiry.
    /// @return The new pool id.
    function create(bytes32 linkKeyHash, uint32 slots, uint96 perSlot, uint64 expiry) external payable returns (uint256);

    /// @notice Close a pool; the unclaimed remainder returns to the host.
    /// @param poolId Pool id.
    function close(uint256 poolId) external;
}

/// @notice ERC-1271.
interface IERC1271 {
    /// @notice Whether `signature` is a valid approval of `hash` by this account.
    /// @param hash The approved hash.
    /// @param signature The signature.
    /// @return 0x1626ba7e when valid.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

// ===== src/PqcLib.sol =====
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

// ===== src/Payout.sol =====
/// @title Payout
/// @notice Shared payout plumbing for PocketDrop and DropPool: a reentrancy lock, bounded-gas pushes that fall back to a
///         pull balance, and `withdraw`. A hostile receiver can never block a state transition.
/// @dev Reentrancy model (v5.2, explicit):
///      - every external function of PocketDrop and DropPool that can move value carries `nonReentrant`;
///      - `_pay` can only run while that lock is held (`PayoutOutsideLock` otherwise), so no payout path exists
///        outside the guard;
///      - callers finish all state changes before `_pay` (checks-effects-interactions);
///      - `withdraw` zeroes the balance before its value call;
///      - a re-entrant call from a receiver hits the lock and reverts `Reentrancy`.
abstract contract Payout {
    /// @dev Gas forwarded on direct payouts. Failure falls back to the pull balance.
    uint256 internal constant SEND_GAS = 100_000;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    error Reentrancy();
    error PayoutOutsideLock();
    error NothingToWithdraw();
    error WithdrawFailed();

    /// @notice A direct payout succeeded.
    event PayoutSent(address indexed to, uint256 amount);
    /// @notice A direct payout failed and the amount was credited to the receiver's pull balance.
    event PayoutDeferred(address indexed to, uint256 amount);
    /// @notice A pull balance was withdrawn.
    event Withdrawn(address indexed account, uint256 amount);

    /// @notice Sum of all pull balances.
    uint256 public totalPending;
    /// @notice Pull balance of each account.
    mapping(address => uint256) public pending;
    uint256 private _lock = _NOT_ENTERED;

    /// @dev Standard lock: reverts `Reentrancy` if already entered; released on exit.
    modifier nonReentrant() {
        if (_lock != _NOT_ENTERED) revert Reentrancy();
        _lock = _ENTERED;
        _;
        _lock = _NOT_ENTERED;
    }

    /// @notice Pull a deferred payout. Checks-effects-interactions: the balance is zeroed before the value call, and the
    ///         lock is held for the whole call.
    function withdraw() external nonReentrant {
        uint256 owed = pending[msg.sender];
        if (owed == 0) revert NothingToWithdraw();
        pending[msg.sender] = 0;
        totalPending -= owed;
        emit Withdrawn(msg.sender, owed);
        if (!_rawSend(msg.sender, owed, gasleft())) revert WithdrawFailed();
    }

    /// @dev Push `value` to `to` with at most SEND_GAS gas; on failure credit the pull balance. Must run under the lock
    ///      (`nonReentrant` caller) and after the caller's state changes. `to` is never zero: every caller validates it.
    function _pay(address to, uint256 value) internal {
        if (_lock != _ENTERED) revert PayoutOutsideLock();
        if (value == 0) return;
        if (_rawSend(to, value, SEND_GAS)) {
            emit PayoutSent(to, value);
        } else {
            pending[to] += value;
            totalPending += value;
            emit PayoutDeferred(to, value);
        }
    }

    /// @dev Value call that never copies return data (no return-bomb) and never reverts.
    function _rawSend(address to, uint256 value, uint256 gasLimit) private returns (bool ok) {
        assembly ("memory-safe") {
            ok := call(gasLimit, to, value, 0, 0, 0, 0)
        }
    }
}

// ===== src/PqGuard.sol =====
/// @title PqGuard
/// @notice Drop-in post-quantum approval check for any dApp. `account` may be a Pocket (ERC-1271 contract) or a plain
///         PoP-proven ML-DSA-87 account.
/// @dev Your `digest` must already bind your contract address, chain id, the action, its parameters and a nonce or
///      deadline. PqGuard only answers "did this account's ML-DSA key approve exactly this digest".
///      v5.1 (F2): the approval is domain-separated from every Pocket intent.
///      - Pocket: checked through `isValidSignature(digest, sig)`, which verifies the owner key over
///        `pqMessage(TAG_ERC1271, erc1271Digest(digest))` (bound to that Pocket and the chain id).
///      - Plain account: verified over `pqMessage(TAG_PQGUARD, approvalDigest(account, digest))` (bound to the account
///        and the chain id).
///      Neither form can ever be accepted as an owner intent, a guardian approval, a bind or a claim.
library PqGuard {
    /// @dev ERC-1271 magic value.
    bytes4 internal constant MAGIC = 0x1626ba7e;
    /// @dev Domain of a plain-account approval.
    bytes32 internal constant PQGUARD_DOMAIN = keccak256("PQGUARD_APPROVAL_V1");

    error PqApprovalFailed();

    /// @notice The digest a plain account signs (as `PqcLib.pqMessage(PqcLib.TAG_PQGUARD, ...)`) to approve `digest`.
    /// @param account The approving account.
    /// @param digest The dApp's digest.
    /// @return The account- and chain-bound approval digest.
    function approvalDigest(address account, bytes32 digest) internal view returns (bytes32) {
        return keccak256(abi.encode(PQGUARD_DOMAIN, block.chainid, account, digest));
    }

    /// @notice True when `account` approved `digest` with `sig`.
    /// @param account A Pocket (ERC-1271) or a plain account with a registered, proven ML-DSA-87 key.
    /// @param digest The dApp's digest.
    /// @param sig ML-DSA-87 signature (see the contract notes for the exact message).
    /// @return True only for a valid approval; hostile or failing contracts give false, never a revert.
    function isPqApproved(address account, bytes32 digest, bytes memory sig) internal view returns (bool) {
        if (account.code.length > 0) {
            (bool ok, bytes memory ret) = account.staticcall(abi.encodeCall(IERC1271.isValidSignature, (digest, sig)));
            if (!ok || ret.length != 32) return false;
            return abi.decode(ret, (bytes4)) == MAGIC;
        }
        return PqcLib.verifyFor(account, PqcLib.pqMessage(PqcLib.TAG_PQGUARD, approvalDigest(account, digest)), sig);
    }

    /// @notice Revert unless `account` approved `digest`.
    /// @param account A Pocket or a plain PoP-proven account.
    /// @param digest The dApp's digest.
    /// @param sig ML-DSA-87 signature.
    function requirePqApproval(address account, bytes32 digest, bytes memory sig) internal view {
        if (!isPqApproved(account, digest, sig)) revert PqApprovalFailed();
    }
}

// ===== src/PocketVault.sol =====
/// @title PocketVault
/// @notice A QOR smart account (the "Pocket") whose every sensitive action is an ML-DSA-87 intent verified on chain
///         with `pqcVerify` against the owner's proof-of-possession key. Anyone (in practice one relayer, through
///         PocketRouter) may submit an intent; authority comes only from the signature.
/// @dev Deployed as EIP-1167 clones by PocketFactory. No owner/admin of the contracts themselves, no upgradeability.
///      Delays are immutables of the implementation, so a lab deployment can use short ones.
///
///      Every owner intent signs `keccak256(abi.encode(action, chainid, vault, nonce, deadline, params))` as the
///      QoreX-prefixed message (`PqcLib.pqMessage(digest)`); guardian approvals likewise, under their own action
///      tags and nonces. ERC-1271 approvals are signed as `PqcLib.pqMessage(TAG_ERC1271, erc1271Digest(hash))` over a
///      Pocket- and chain-bound digest (v5.1, F2), a byte layout no intent can have, so no ERC-1271 approval is ever
///      accepted as an intent and vice versa. The nonce is a single sequential counter
///      consumed on success.
///
///      Safety rules beyond the spec text (all tightenings):
///      - the owner key hash is pinned at init and after recovery (a later key rotation does not move the Pocket);
///      - createDrop / createPool debit the daily allowance (they would otherwise bypass it via a link-key claim);
///      - setGuardians is timelocked like a limit raise (a stolen key must not be able to swap guardians instantly);
///      - while a recovery is pending, queued spends, limit raises and guardian changes cannot be executed, and a
///        finalized recovery invalidates everything queued by the old key;
///      - GUARDIAN FREEZE: `threshold` guardians can freeze the Pocket for `FREEZE_PERIOD`. The owner key cannot lift
///        it. While frozen nothing can leave or be committed (spend, executeQueued, createDrop/createPool, applyLimit,
///        applyGuardians, and queueing a limit raise or guardian change); defensive actions still work (veto a queued
///        spend, lower the limit, cancelPending, vetoRecovery, confirm/cancel a drop, close a pool);
///      - UNANIMOUS RECOVERY: ALL guardians (set >= 2) can replace the owner after `UNANIMOUS_RECOVERY_DELAY`. The old
///        key cannot veto it. While it is pending the Pocket counts as frozen. It overrides a pending threshold
///        recovery. The vetoable threshold recovery stays (it covers colluding guardians when the owner key is fine).
contract PocketVault is IERC1271 {
    /*//////////////////////////////////////////////////////////////
                               CONSTANTS
    //////////////////////////////////////////////////////////////*/

    bytes32 public constant ACT_SPEND = keccak256("POCKET_SPEND_V1");
    bytes32 public constant ACT_VETO_QUEUED = keccak256("POCKET_VETO_QUEUED_V1");
    bytes32 public constant ACT_SET_LIMIT = keccak256("POCKET_SET_LIMIT_V1");
    bytes32 public constant ACT_SET_GUARDIANS = keccak256("POCKET_SET_GUARDIANS_V1");
    bytes32 public constant ACT_CANCEL_PENDING = keccak256("POCKET_CANCEL_PENDING_V1");
    bytes32 public constant ACT_VETO_RECOVERY = keccak256("POCKET_VETO_RECOVERY_V1");
    bytes32 public constant ACT_CREATE_DROP = keccak256("POCKET_CREATE_DROP_V1");
    bytes32 public constant ACT_CONFIRM_DROP = keccak256("POCKET_CONFIRM_DROP_V1");
    bytes32 public constant ACT_CANCEL_DROP = keccak256("POCKET_CANCEL_DROP_V1");
    bytes32 public constant ACT_CREATE_POOL = keccak256("POCKET_CREATE_POOL_V1");
    bytes32 public constant ACT_CLOSE_POOL = keccak256("POCKET_CLOSE_POOL_V1");
    /// @dev Guardian recovery intents use their own action tag and the separate `recoveryNonce`.
    bytes32 public constant ACT_RECOVER = keccak256("POCKET_RECOVER_V1");

    /// @dev Guardian freeze intent (own action tag, own `freezeNonce`).
    bytes32 public constant ACT_FREEZE = keccak256("POCKET_GUARDIAN_FREEZE_V1");
    /// @dev Unanimous guardian recovery intent (own action tag, shares `recoveryNonce`).
    bytes32 public constant ACT_RECOVER_UNANIMOUS = keccak256("POCKET_RECOVER_UNANIMOUS_V1");
    /// @dev Domain of an ERC-1271 approval (v5.1): binds the approved hash to this Pocket and the chain id.
    bytes32 public constant ERC1271_DOMAIN = keccak256("POCKET_ERC1271_V1");
    /// @dev v5.2: authorization to finalize a pending threshold recovery (signed by the owner, a guardian or the
    ///      proposed new owner).
    bytes32 public constant ACT_FINALIZE_RECOVERY = keccak256("POCKET_FINALIZE_RECOVERY_V1");
    /// @dev v5.2: authorization to finalize a pending unanimous recovery (signed by a guardian or the proposed new owner).
    bytes32 public constant ACT_FINALIZE_RECOVERY_UNANIMOUS = keccak256("POCKET_FINALIZE_RECOVERY_UNANIMOUS_V1");

    /// @notice Hard cap on the guardian set (and on the signers any guardian check accepts).
    uint256 public constant MAX_GUARDIANS = 5;
    /// @notice After two freezes in a row, a third needs this many FREEZE_PERIODs of quiet (or a guardian-set change).
    uint256 public constant FREEZE_COOLDOWN_PERIODS = 4;
    uint256 public constant MAX_FREEZE_STREAK = 2;
    uint256 public constant MAX_DELAY = 30 days;

    /// @notice Delay before a spend above the daily allowance, a limit raise or a guardian change can execute.
    uint256 public immutable TIMELOCK;
    /// @notice Delay between a guardian recovery proposal and its finalization (owner may veto meanwhile).
    uint256 public immutable RECOVERY_DELAY;
    /// @notice How long one guardian freeze lasts (production 72 h).
    uint256 public immutable FREEZE_PERIOD;
    /// @notice Delay of a unanimous guardian recovery (production 72 h). The old key cannot veto it.
    uint256 public immutable UNANIMOUS_RECOVERY_DELAY;

    /*//////////////////////////////////////////////////////////////
                                 TYPES
    //////////////////////////////////////////////////////////////*/

    enum QState {
        None,
        Pending,
        Executed,
        Vetoed
    }

    struct Queued {
        address to;
        uint64 unlockAt;
        uint32 epoch;
        QState state;
        uint256 amount;
    }

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Factory that initialized this Pocket (0xdead on the implementation).
    address public factory;
    /// @notice Owner account; its ML-DSA-87 key signs every owner intent.
    address public owner;
    /// @notice keccak256 of the owner key, pinned at init and after recovery.
    bytes32 public ownerKeyHash;
    /// @notice Next owner-intent nonce.
    uint256 public nonce;
    /// @notice Next guardian-recovery nonce.
    uint256 public recoveryNonce;
    /// @notice Bumped by every finalized recovery; queued spends from an older epoch are dead.
    uint256 public epoch;

    /// @notice Daily allowance in wei (spends above it are queued for TIMELOCK).
    uint256 public dailyLimit;
    /// @notice UTC day number of `spentToday`.
    uint256 public spentDay;
    /// @notice Wei spent on `spentDay`.
    uint256 public spentToday;

    address[] internal _guardians;
    /// @notice Guardian threshold (0 with no guardians).
    uint8 public threshold;

    /// @notice Number of queued spends (ids start at 1).
    uint256 public queueCount;
    mapping(uint256 => Queued) internal _queue;

    /// @notice Queued daily limit raise.
    uint256 public pendingLimit;
    /// @notice When the queued limit raise can apply (0 = none).
    uint64 public pendingLimitAt;

    address[] internal _pendingGuardians;
    /// @notice Threshold of the queued guardian set.
    uint8 public pendingThreshold;
    /// @notice When the queued guardian set can apply (0 = none).
    uint64 public pendingGuardiansAt;

    /// @notice Proposed owner of the pending threshold recovery.
    address public recoveryOwner;
    /// @notice Approved key hash of the pending threshold recovery.
    bytes32 public recoveryKeyHash;
    /// @notice Threshold recovery can be finalized from this time on (0 = none pending).
    uint64 public recoveryAt;

    /// @notice Next guardian-freeze nonce.
    uint256 public freezeNonce;
    /// @notice The Pocket is frozen while `block.timestamp < frozenUntil` (see `frozen()`).
    uint64 public frozenUntil;
    /// @notice Freezes in a row by the current guardian set (reset by a guardian change or a long quiet period).
    uint8 public freezeStreak;

    /// @notice Proposed owner of the pending unanimous recovery.
    address public uRecoveryOwner;
    /// @notice Approved key hash of the pending unanimous recovery.
    bytes32 public uRecoveryKeyHash;
    /// @notice Unanimous recovery can be finalized from this time on (0 = none pending).
    uint64 public uRecoveryAt;

    /// @dev v5.2 reentrancy lock for the functions that make an external call (0 = unlocked, 1 = locked; clones start
    ///      at 0). `receive` is not locked, so refunds from PocketDrop / DropPool still land during a locked call.
    uint256 private _callLock;

    /*//////////////////////////////////////////////////////////////
                              EVENTS / ERRORS
    //////////////////////////////////////////////////////////////*/

    event Received(address indexed from, uint256 amount);
    event Initialized(address indexed factory, address indexed owner, bytes32 ownerKeyHash, uint256 dailyLimit);
    event Spent(address indexed to, uint256 amount);
    event SpendQueued(uint256 indexed id, address indexed to, uint256 amount, uint64 unlockAt);
    event QueuedExecuted(uint256 indexed id, address indexed to, uint256 amount);
    event QueuedVetoed(uint256 indexed id);
    event LimitSet(uint256 dailyLimit);
    event LimitRaiseQueued(uint256 newLimit, uint64 unlockAt);
    event GuardiansQueued(address[] guardians, uint8 threshold, uint64 unlockAt);
    event GuardiansApplied(address[] guardians, uint8 threshold);
    event PendingCancelled();
    event RecoveryProposed(address indexed newOwner, bytes32 newKeyHash, uint64 finalizeAfter, uint256 recoveryNonce);
    event RecoveryVetoed();
    event GuardianFrozen(uint64 frozenUntil, uint256 freezeNonce, uint8 streak);
    event UnanimousRecoveryProposed(
        address indexed newOwner, bytes32 newKeyHash, uint64 finalizeAfter, uint256 recoveryNonce
    );
    event RecoveryFinalized(address indexed oldOwner, address indexed newOwner, bytes32 newKeyHash);
    /// @notice v5.2: who authorized a finalize (owner, guardian or the proposed new owner), and for which proposal.
    event RecoveryFinalizeAuthorized(address indexed authorizer, uint256 recoveryNonce, bool unanimous);
    event DropCreated(address indexed drop, uint256 indexed linkId, uint256 value);
    event DropConfirmed(address indexed drop, uint256 indexed linkId);
    event DropCancelled(address indexed drop, uint256 indexed linkId);
    event PoolCreated(address indexed pool, uint256 indexed poolId, uint256 value);
    event PoolClosed(address indexed pool, uint256 indexed poolId);

    error AlreadyInitialized();
    error InvalidConfig();
    error Expired();
    error BadSignature();
    error BadParams();
    error SendFailed();
    error OverDailyLimit();
    error NotQueued();
    error TooEarly();
    error NothingPending();
    error RecoveryPending();
    error NoRecoveryPending();
    error NoGuardians();
    error NotGuardian();
    error DuplicateSigner();
    error NotEnoughSigners();
    error StaleEpoch();
    error Frozen();
    error AlreadyFrozen();
    error FreezeCapped();
    error BadNonce();
    error NotAuthorized();
    error Reentrancy();

    /// @dev Reverts `Reentrancy` if a locked function is already running (checks-effects-interactions is kept as well).
    modifier nonReentrant() {
        if (_callLock != 0) revert Reentrancy();
        _callLock = 1;
        _;
        _callLock = 0;
    }

    /*//////////////////////////////////////////////////////////////
                           CONSTRUCTION / INIT
    //////////////////////////////////////////////////////////////*/

    /// @param timelock_ Spend/limit/guardian timelock in seconds (production 24 h).
    /// @param recoveryDelay_ Recovery delay in seconds (production 48 h).
    /// @param freezePeriod_ Guardian freeze duration in seconds (production 72 h, lab 120 s).
    /// @param unanimousDelay_ Unanimous recovery delay in seconds (production 72 h, lab 180 s).
    /// @dev Locks the implementation itself (clones have their own storage).
    constructor(uint256 timelock_, uint256 recoveryDelay_, uint256 freezePeriod_, uint256 unanimousDelay_) {
        if (
            timelock_ == 0 || timelock_ > MAX_DELAY || recoveryDelay_ == 0 || recoveryDelay_ > MAX_DELAY
                || freezePeriod_ == 0 || freezePeriod_ > MAX_DELAY || unanimousDelay_ == 0
                || unanimousDelay_ > MAX_DELAY
        ) {
            revert InvalidConfig();
        }
        TIMELOCK = timelock_;
        RECOVERY_DELAY = recoveryDelay_;
        FREEZE_PERIOD = freezePeriod_;
        UNANIMOUS_RECOVERY_DELAY = unanimousDelay_;
        factory = address(0xdead);
    }

    /// @notice One-shot initialization by the factory. Reads and pins the owner's proven ML-DSA-87 key.
    /// @param owner_ Owner account (registered, proven ML-DSA-87 key).
    /// @param guardians_ Initial guardian set (0, or 2..5).
    /// @param threshold_ Guardian threshold (0 with no guardians, else 2..n).
    /// @param dailyLimit_ Daily allowance in wei.
    function initialize(address owner_, address[] calldata guardians_, uint8 threshold_, uint256 dailyLimit_) external {
        if (factory != address(0)) revert AlreadyInitialized();
        if (owner_ == address(0)) revert InvalidConfig();
        factory = msg.sender;
        _validateGuardians(owner_, guardians_, threshold_);
        bytes memory pk = PqcLib.requireKey(owner_, bytes32(0));
        owner = owner_;
        ownerKeyHash = keccak256(pk);
        dailyLimit = dailyLimit_;
        _guardians = guardians_;
        threshold = threshold_;
        emit Initialized(msg.sender, owner_, ownerKeyHash, dailyLimit_);
    }

    /// @notice Accept QOR (a Pocket can be funded before and after it is deployed).
    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    /*//////////////////////////////////////////////////////////////
                                ERC-1271
    //////////////////////////////////////////////////////////////*/

    /// @notice Valid only for the owner's ML-DSA-87 signature over
    ///         `pqMessage(TAG_ERC1271, erc1271Digest(hash))`.
    /// @dev v5.1 (F2, F4): the approval is bound to this Pocket and the chain id and carries its own tag, so it can never
    ///      be an owner intent, and one approval is not valid for another Pocket of the same owner key.
    /// @param hash The hash being approved.
    /// @param signature The owner's ML-DSA-87 signature.
    /// @return 0x1626ba7e when valid, 0xffffffff otherwise.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (PqcLib.verifyForKey(
                owner, ownerKeyHash, PqcLib.pqMessage(PqcLib.TAG_ERC1271, erc1271Digest(hash)), signature
            )) return 0x1626ba7e;
        return 0xffffffff;
    }

    /// @notice The digest the owner signs (as `PqcLib.pqMessage(PqcLib.TAG_ERC1271, digest)`) to approve `hash`.
    /// @param hash The hash being approved.
    /// @return The Pocket- and chain-bound approval digest.
    function erc1271Digest(bytes32 hash) public view returns (bytes32) {
        return keccak256(abi.encode(ERC1271_DOMAIN, block.chainid, address(this), hash));
    }

    /*//////////////////////////////////////////////////////////////
                              SPEND / QUEUE
    //////////////////////////////////////////////////////////////*/

    /// @notice Pay `to`. Within today's allowance it pays now; above it, the spend is queued for TIMELOCK.
    /// @param to Receiver.
    /// @param amount Wei to pay.
    /// @param deadline Intent deadline (unix time).
    /// @param sig Owner intent signature.
    /// @return queuedId 0 if paid immediately, otherwise the queue id.
    function spend(address to, uint256 amount, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
        returns (uint256 queuedId)
    {
        _requireNotFrozen();
        _auth(ACT_SPEND, abi.encode(to, amount), deadline, sig);
        if (to == address(0) || amount == 0) revert BadParams();
        if (amount <= allowanceLeft()) {
            _debit(amount);
            emit Spent(to, amount);
            _send(to, amount);
            return 0;
        }
        queuedId = ++queueCount;
        uint64 unlockAt = uint64(block.timestamp + TIMELOCK);
        _queue[queuedId] = Queued(to, unlockAt, uint32(epoch), QState.Pending, amount);
        emit SpendQueued(queuedId, to, amount, unlockAt);
    }

    /// @notice Execute a queued spend after its timelock. Anyone may call; the owner already signed.
    /// @param id Queue id.
    function executeQueued(uint256 id) external nonReentrant {
        _requireNotFrozen();
        if (recoveryAt != 0) revert RecoveryPending();
        Queued storage q = _queue[id];
        if (q.state != QState.Pending) revert NotQueued();
        if (q.epoch != epoch) revert StaleEpoch();
        if (block.timestamp < q.unlockAt) revert TooEarly();
        q.state = QState.Executed;
        emit QueuedExecuted(id, q.to, q.amount);
        _send(q.to, q.amount);
    }

    /// @notice Owner veto of a queued spend.
    /// @param id Queue id.
    /// @param deadline Intent deadline.
    /// @param sig Owner intent signature.
    function vetoQueued(uint256 id, uint256 deadline, bytes calldata sig) external {
        _auth(ACT_VETO_QUEUED, abi.encode(id), deadline, sig);
        Queued storage q = _queue[id];
        if (q.state != QState.Pending) revert NotQueued();
        q.state = QState.Vetoed;
        emit QueuedVetoed(id);
    }

    /*//////////////////////////////////////////////////////////////
                         LIMIT AND GUARDIAN CONFIG
    //////////////////////////////////////////////////////////////*/

    /// @notice Lowering (or keeping) the daily limit is immediate; raising it is queued for TIMELOCK.
    /// @param newLimit New daily limit in wei.
    /// @param deadline Intent deadline.
    /// @param sig Owner intent signature.
    function setLimit(uint256 newLimit, uint256 deadline, bytes calldata sig) external {
        _auth(ACT_SET_LIMIT, abi.encode(newLimit), deadline, sig);
        if (newLimit <= dailyLimit) {
            dailyLimit = newLimit;
            pendingLimitAt = 0;
            emit LimitSet(newLimit);
        } else {
            _requireNotFrozen();
            pendingLimit = newLimit;
            pendingLimitAt = uint64(block.timestamp + TIMELOCK);
            emit LimitRaiseQueued(newLimit, pendingLimitAt);
        }
    }

    /// @notice Apply a queued limit raise after its timelock.
    function applyLimit() external {
        _requireNotFrozen();
        if (recoveryAt != 0) revert RecoveryPending();
        uint64 at = pendingLimitAt;
        if (at == 0) revert NothingPending();
        if (block.timestamp < at) revert TooEarly();
        pendingLimitAt = 0;
        dailyLimit = pendingLimit;
        emit LimitSet(pendingLimit);
    }

    /// @notice Queue a new guardian set (0 guardians + threshold 0, or 2..5 guardians with 2 <= threshold <= n).
    /// @param guardians_ New guardian set.
    /// @param threshold_ New threshold.
    /// @param deadline Intent deadline.
    /// @param sig Owner intent signature.
    function setGuardians(address[] calldata guardians_, uint8 threshold_, uint256 deadline, bytes calldata sig)
        external
    {
        _requireNotFrozen();
        _auth(ACT_SET_GUARDIANS, abi.encode(guardians_, threshold_), deadline, sig);
        _validateGuardians(owner, guardians_, threshold_);
        _pendingGuardians = guardians_;
        pendingThreshold = threshold_;
        pendingGuardiansAt = uint64(block.timestamp + TIMELOCK);
        emit GuardiansQueued(guardians_, threshold_, pendingGuardiansAt);
    }

    /// @notice Apply a queued guardian change after its timelock.
    function applyGuardians() external {
        _requireNotFrozen();
        if (recoveryAt != 0) revert RecoveryPending();
        uint64 at = pendingGuardiansAt;
        if (at == 0) revert NothingPending();
        if (block.timestamp < at) revert TooEarly();
        pendingGuardiansAt = 0;
        _guardians = _pendingGuardians;
        threshold = pendingThreshold;
        freezeStreak = 0; // a new guardian set starts with a clean streak
        delete _pendingGuardians;
        emit GuardiansApplied(_guardians, threshold);
    }

    /// @notice Owner cancels a queued limit raise and a queued guardian change.
    /// @param deadline Intent deadline.
    /// @param sig Owner intent signature.
    function cancelPending(uint256 deadline, bytes calldata sig) external {
        _auth(ACT_CANCEL_PENDING, "", deadline, sig);
        _clearPending();
        emit PendingCancelled();
    }

    /*//////////////////////////////////////////////////////////////
                            GUARDIAN RECOVERY
    //////////////////////////////////////////////////////////////*/

    /// @notice Propose replacing the owner key. Needs `threshold` distinct guardians' ML-DSA signatures over the
    ///         recovery digest. The old key may veto until `finalizeRecovery` is possible.
    /// @param newOwner Proposed owner account (registered, proven ML-DSA-87 key; not a guardian).
    /// @param newKeyHash keccak256 of the proposed owner's key.
    /// @param deadline Approval deadline.
    /// @param signers Distinct guardians, at least `threshold`.
    /// @param sigs Their signatures over `recoveryDigest`.
    function proposeRecovery(
        address newOwner,
        bytes32 newKeyHash,
        uint256 deadline,
        address[] calldata signers,
        bytes[] calldata sigs
    ) external {
        if (recoveryAt != 0 || uRecoveryAt != 0) revert RecoveryPending();
        if (block.timestamp > deadline) revert Expired();
        if (threshold == 0) revert NoGuardians();
        _checkNewOwner(newOwner, newKeyHash);
        if (signers.length != sigs.length || signers.length < threshold) revert NotEnoughSigners();
        _checkGuardianSigs(signers, sigs, PqcLib.pqMessage(recoveryDigest(newOwner, newKeyHash, deadline)));
        // Fail early (and fail closed at finalize too) if the new key could not actually act as owner.
        PqcLib.requireKey(newOwner, newKeyHash);
        recoveryNonce++;
        recoveryOwner = newOwner;
        recoveryKeyHash = newKeyHash;
        recoveryAt = uint64(block.timestamp + RECOVERY_DELAY);
        emit RecoveryProposed(newOwner, newKeyHash, recoveryAt, recoveryNonce - 1);
    }

    /// @notice The CURRENT owner key vetoes a pending recovery.
    /// @param deadline Intent deadline.
    /// @param sig Owner intent signature.
    function vetoRecovery(uint256 deadline, bytes calldata sig) external {
        _auth(ACT_VETO_RECOVERY, "", deadline, sig);
        if (recoveryAt == 0) revert NoRecoveryPending();
        recoveryAt = 0;
        emit RecoveryVetoed();
    }

    /// @dev Enforces that a guardian-signed threshold recovery proposal is pending, its timelock has elapsed, and the
    ///      proposed owner key still passes `PqcLib.requireKey`. Callers cannot supply or alter any parameter.
    modifier onlyApprovedThresholdRecovery() {
        uint64 at = recoveryAt;
        if (at == 0) revert NoRecoveryPending();
        if (block.timestamp < at) revert TooEarly();
        PqcLib.requireKey(recoveryOwner, recoveryKeyHash);
        _;
    }

    /// @notice Complete a guardian-approved threshold recovery after its timelock.
    /// @dev Access control (v5.2): `authorizer` must be the current owner, a current guardian, or the proposed new owner
    ///      (`recoveryOwner`), and `sig` must be that account's ML-DSA-87 signature over
    ///      `finalizeDigest(ACT_FINALIZE_RECOVERY, authorizer, deadline)`. The owner is checked against the pinned
    ///      `ownerKeyHash` and the new owner against `recoveryKeyHash`. The digest binds this Pocket, the chain id, the
    ///      current `recoveryNonce` (so it is valid for this proposal only), the approved owner and key, the authorizer
    ///      and the deadline. The caller (`msg.sender`, usually the relayer) gains no authority: everything that changes
    ///      was fixed by the guardians in `proposeRecovery`, and no value moves.
    /// @param authorizer The account that authorizes the finalize (owner, guardian or `recoveryOwner`).
    /// @param deadline Authorization deadline.
    /// @param sig The authorizer's ML-DSA-87 signature.
    function finalizeRecovery(address authorizer, uint256 deadline, bytes calldata sig)
        external
        onlyApprovedThresholdRecovery
    {
        _authorizeFinalize(ACT_FINALIZE_RECOVERY, recoveryOwner, recoveryKeyHash, authorizer, deadline, sig, true);
        address old = owner;
        address newOwner = recoveryOwner;
        bytes32 newKeyHash = recoveryKeyHash;
        recoveryAt = 0;
        owner = newOwner;
        ownerKeyHash = newKeyHash;
        epoch++;
        _clearPending();
        emit RecoveryFinalizeAuthorized(authorizer, recoveryNonce, false);
        emit RecoveryFinalized(old, newOwner, newKeyHash);
    }

    /// @notice Replace the owner key with the signatures of ALL guardians (set size >= 2). The old key cannot veto it:
    ///         this is the lost-or-stolen-key path. It overrides a pending threshold recovery and, while pending,
    ///         the Pocket is frozen. A new unanimous proposal replaces a pending one (restarting the delay), which
    ///         lets the guardians fix a proposal whose new key turned out unusable.
    /// @param newOwner Proposed owner account (registered, proven ML-DSA-87 key; not a guardian).
    /// @param newKeyHash keccak256 of the proposed owner's key.
    /// @param deadline Approval deadline.
    /// @param signers All guardians, each once.
    /// @param sigs Their signatures over `unanimousDigest`.
    function proposeRecoveryUnanimous(
        address newOwner,
        bytes32 newKeyHash,
        uint256 deadline,
        address[] calldata signers,
        bytes[] calldata sigs
    ) external {
        if (block.timestamp > deadline) revert Expired();
        uint256 n = _guardians.length;
        if (n < 2) revert NoGuardians();
        _checkNewOwner(newOwner, newKeyHash);
        if (signers.length != sigs.length || signers.length != n) revert NotEnoughSigners();
        _checkGuardianSigs(signers, sigs, PqcLib.pqMessage(unanimousDigest(newOwner, newKeyHash, deadline)));
        PqcLib.requireKey(newOwner, newKeyHash);
        recoveryNonce++;
        recoveryAt = 0; // the unanimous proposal wins over a pending threshold one
        uRecoveryOwner = newOwner;
        uRecoveryKeyHash = newKeyHash;
        uRecoveryAt = uint64(block.timestamp + UNANIMOUS_RECOVERY_DELAY);
        emit UnanimousRecoveryProposed(newOwner, newKeyHash, uRecoveryAt, recoveryNonce - 1);
    }

    /// @dev Enforces that a guardian-signed unanimous recovery proposal is pending, its timelock has elapsed, and the
    ///      proposed owner key still passes `PqcLib.requireKey`. Callers cannot supply or alter any parameter.
    modifier onlyApprovedUnanimousRecovery() {
        uint64 at = uRecoveryAt;
        if (at == 0) revert NoRecoveryPending();
        if (block.timestamp < at) revert TooEarly();
        PqcLib.requireKey(uRecoveryOwner, uRecoveryKeyHash);
        _;
    }

    /// @notice Complete a guardian-approved unanimous recovery after its timelock.
    /// @dev Access control (v5.2): `authorizer` must be a current guardian or the proposed new owner (`uRecoveryOwner`),
    ///      with an ML-DSA-87 signature over `finalizeDigest(ACT_FINALIZE_RECOVERY_UNANIMOUS, authorizer, deadline)`.
    ///      The old owner key is not accepted here: this is the lost-or-stolen-key path, where the old key has no say.
    ///      The new owner and key were fixed by ALL guardians in `proposeRecoveryUnanimous`; no value moves.
    /// @param authorizer The account that authorizes the finalize (guardian or `uRecoveryOwner`).
    /// @param deadline Authorization deadline.
    /// @param sig The authorizer's ML-DSA-87 signature.
    function finalizeRecoveryUnanimous(address authorizer, uint256 deadline, bytes calldata sig)
        external
        onlyApprovedUnanimousRecovery
    {
        _authorizeFinalize(
            ACT_FINALIZE_RECOVERY_UNANIMOUS, uRecoveryOwner, uRecoveryKeyHash, authorizer, deadline, sig, false
        );
        address old = owner;
        address newOwner = uRecoveryOwner;
        bytes32 newKeyHash = uRecoveryKeyHash;
        uRecoveryAt = 0;
        owner = newOwner;
        ownerKeyHash = newKeyHash;
        epoch++;
        _clearPending();
        emit RecoveryFinalizeAuthorized(authorizer, recoveryNonce, true);
        emit RecoveryFinalized(old, newOwner, newKeyHash);
    }

    /// @notice The digest an authorizer signs (as `PqcLib.pqMessage(digest)`) to finalize the pending recovery.
    /// @param action `ACT_FINALIZE_RECOVERY` or `ACT_FINALIZE_RECOVERY_UNANIMOUS`.
    /// @param authorizer The authorizing account.
    /// @param deadline Authorization deadline.
    /// @return The digest (bound to this Pocket, the chain, `recoveryNonce` and the pending owner and key).
    function finalizeDigest(bytes32 action, address authorizer, uint256 deadline) public view returns (bytes32) {
        bool unanimous = action == ACT_FINALIZE_RECOVERY_UNANIMOUS;
        if (!unanimous && action != ACT_FINALIZE_RECOVERY) revert BadParams();
        return keccak256(
            abi.encode(
                action,
                block.chainid,
                address(this),
                recoveryNonce,
                unanimous ? uRecoveryOwner : recoveryOwner,
                unanimous ? uRecoveryKeyHash : recoveryKeyHash,
                authorizer,
                deadline
            )
        );
    }

    /// @notice The digest each guardian signs (as `PqcLib.pqMessage(digest)`) for the next unanimous recovery.
    /// @param newOwner Proposed owner.
    /// @param newKeyHash keccak256 of the proposed owner's key.
    /// @param deadline Approval deadline.
    /// @return The digest (bound to this Pocket, the chain and `recoveryNonce`).
    function unanimousDigest(address newOwner, bytes32 newKeyHash, uint256 deadline) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                ACT_RECOVER_UNANIMOUS, block.chainid, address(this), recoveryNonce, deadline, newOwner, newKeyHash
            )
        );
    }

    /*//////////////////////////////////////////////////////////////
                             GUARDIAN FREEZE
    //////////////////////////////////////////////////////////////*/

    /// @notice Freeze the Pocket for `FREEZE_PERIOD`. Needs `threshold` distinct guardians' ML-DSA signatures over
    ///         `freezeDigest(nonce_, deadline)`. The owner key cannot lift it. Not allowed while already frozen. After
    ///         `MAX_FREEZE_STREAK` freezes in a row (gaps shorter than `FREEZE_COOLDOWN_PERIODS` periods) the same
    ///         guardian set cannot freeze again until it has been quiet for that long or the set is changed.
    /// @dev Sequential EVM execution and strict nonce/state guards prevent concurrent or duplicate freezes:
    ///      `nonce_ != freezeNonce` reverts `BadNonce` and `frozen()` reverts `AlreadyFrozen` before any state update,
    ///      `freezeNonce` and `frozenUntil` are updated together, and no external call is made.
    /// @param signers Distinct guardians, at least `threshold`.
    /// @param sigs Their signatures over `freezeDigest(nonce_, deadline)`.
    /// @param nonce_ Must equal `freezeNonce`.
    /// @param deadline Approval deadline.
    function guardianFreeze(address[] calldata signers, bytes[] calldata sigs, uint256 nonce_, uint256 deadline)
        external
    {
        if (block.timestamp > deadline) revert Expired();
        if (threshold == 0) revert NoGuardians();
        if (nonce_ != freezeNonce) revert BadNonce();
        if (frozen()) revert AlreadyFrozen();
        if (signers.length != sigs.length || signers.length < threshold) revert NotEnoughSigners();
        _checkGuardianSigs(signers, sigs, PqcLib.pqMessage(freezeDigest(nonce_, deadline)));
        uint8 streak =
            block.timestamp >= uint256(frozenUntil) + FREEZE_COOLDOWN_PERIODS * FREEZE_PERIOD ? 1 : freezeStreak + 1;
        if (streak > MAX_FREEZE_STREAK) revert FreezeCapped();
        // State transition: bump freezeNonce and set frozenUntil before emitting.
        freezeStreak = streak;
        freezeNonce = nonce_ + 1;
        frozenUntil = uint64(block.timestamp + FREEZE_PERIOD);
        assert(frozen() && freezeNonce == nonce_ + 1);
        emit GuardianFrozen(frozenUntil, nonce_, streak);
    }

    /// @notice The digest each guardian signs (as `PqcLib.pqMessage(digest)`) for the freeze with nonce `nonce_`.
    /// @param nonce_ Freeze nonce.
    /// @param deadline Approval deadline.
    /// @return The digest.
    function freezeDigest(uint256 nonce_, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encode(ACT_FREEZE, block.chainid, address(this), nonce_, deadline));
    }

    /// @notice True while a guardian freeze runs or a unanimous recovery is pending.
    /// @return Whether the Pocket is frozen now.
    function frozen() public view returns (bool) {
        return block.timestamp < frozenUntil || uRecoveryAt != 0;
    }

    /// @notice The digest each guardian signs (as `PqcLib.pqMessage(digest)`) for the next recovery proposal.
    /// @param newOwner Proposed owner.
    /// @param newKeyHash keccak256 of the proposed owner's key.
    /// @param deadline Approval deadline.
    /// @return The digest (bound to this Pocket, the chain and `recoveryNonce`).
    function recoveryDigest(address newOwner, bytes32 newKeyHash, uint256 deadline) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(ACT_RECOVER, block.chainid, address(this), recoveryNonce, deadline, newOwner, newKeyHash)
            );
    }

    /*//////////////////////////////////////////////////////////////
                         DROPS AND POOLS (CALLS)
    //////////////////////////////////////////////////////////////*/

    /// @notice Create a PocketDrop link with this Pocket as sender. `value` (= escrow + drip + relayer fee) is debited
    ///         from today's allowance.
    /// @param drop PocketDrop instance.
    /// @param linkKeyHash keccak256 of the link's ML-DSA-87 key.
    /// @param mode 0 = Confirmed, 1 = Open.
    /// @param expiry Link expiry.
    /// @param drip Drip for the recipient.
    /// @param relayerFee Relayer fee paid at the first bind.
    /// @param value escrow + drip + relayerFee.
    /// @param deadline Intent deadline.
    /// @param sig Owner intent signature.
    /// @return linkId The new link id.
    function createDrop(
        address drop,
        bytes32 linkKeyHash,
        uint8 mode,
        uint64 expiry,
        uint96 drip,
        uint96 relayerFee,
        uint256 value,
        uint256 deadline,
        bytes calldata sig
    ) external nonReentrant returns (uint256 linkId) {
        _requireNotFrozen();
        _requireTarget(drop);
        _auth(ACT_CREATE_DROP, abi.encode(drop, linkKeyHash, mode, expiry, drip, relayerFee, value), deadline, sig);
        _debitOrRevert(value);
        linkId = IPocketDropSender(drop).create{value: value}(linkKeyHash, mode, expiry, drip, relayerFee);
        emit DropCreated(drop, linkId, value);
    }

    /// @notice Sender intent: confirm the recipient key the drop is bound to (the "sender check", one tap).
    /// @param drop PocketDrop instance.
    /// @param linkId Link id.
    /// @param expectedRecipientKeyHash The key hash the sender checked.
    /// @param deadline Intent deadline.
    /// @param sig Owner intent signature.
    function confirmDrop(
        address drop,
        uint256 linkId,
        bytes32 expectedRecipientKeyHash,
        uint256 deadline,
        bytes calldata sig
    ) external nonReentrant {
        _requireTarget(drop);
        _auth(ACT_CONFIRM_DROP, abi.encode(drop, linkId, expectedRecipientKeyHash), deadline, sig);
        emit DropConfirmed(drop, linkId);
        IPocketDropSender(drop).confirmRecipient(linkId, expectedRecipientKeyHash);
    }

    /// @notice Sender intent: cancel a drop; the escrow returns to this Pocket.
    /// @param drop PocketDrop instance.
    /// @param linkId Link id.
    /// @param deadline Intent deadline.
    /// @param sig Owner intent signature.
    function cancelDrop(address drop, uint256 linkId, uint256 deadline, bytes calldata sig) external nonReentrant {
        _requireTarget(drop);
        _auth(ACT_CANCEL_DROP, abi.encode(drop, linkId), deadline, sig);
        emit DropCancelled(drop, linkId);
        IPocketDropSender(drop).cancel(linkId);
    }

    /// @notice Host a DropPool from this Pocket; slots * perSlot is debited from today's allowance.
    /// @param pool DropPool instance.
    /// @param linkKeyHash keccak256 of the pool's link key.
    /// @param slots Slot count.
    /// @param perSlot Amount per slot.
    /// @param expiry Pool expiry.
    /// @param deadline Intent deadline.
    /// @param sig Owner intent signature.
    /// @return poolId The new pool id.
    function createPool(
        address pool,
        bytes32 linkKeyHash,
        uint32 slots,
        uint96 perSlot,
        uint64 expiry,
        uint256 deadline,
        bytes calldata sig
    ) external nonReentrant returns (uint256 poolId) {
        _requireNotFrozen();
        _requireTarget(pool);
        _auth(ACT_CREATE_POOL, abi.encode(pool, linkKeyHash, slots, perSlot, expiry), deadline, sig);
        uint256 value = uint256(slots) * perSlot;
        _debitOrRevert(value);
        poolId = IDropPoolHost(pool).create{value: value}(linkKeyHash, slots, perSlot, expiry);
        emit PoolCreated(pool, poolId, value);
    }

    /// @notice Close a hosted pool; the unclaimed remainder returns to this Pocket.
    /// @param pool DropPool instance.
    /// @param poolId Pool id.
    /// @param deadline Intent deadline.
    /// @param sig Owner intent signature.
    function closePool(address pool, uint256 poolId, uint256 deadline, bytes calldata sig) external nonReentrant {
        _requireTarget(pool);
        _auth(ACT_CLOSE_POOL, abi.encode(pool, poolId), deadline, sig);
        emit PoolClosed(pool, poolId);
        IDropPoolHost(pool).close(poolId);
    }

    /*//////////////////////////////////////////////////////////////
                                  VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice The digest an owner intent signs for `action` at `nonce_` (as `PqcLib.pqMessage(digest)`).
    /// @param action One of the `ACT_*` tags.
    /// @param nonce_ Intent nonce.
    /// @param deadline Intent deadline.
    /// @param params ABI-encoded action parameters.
    /// @return The digest.
    function intentDigest(bytes32 action, uint256 nonce_, uint256 deadline, bytes memory params)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(action, block.chainid, address(this), nonce_, deadline, params));
    }

    /// @notice What can still be spent immediately today.
    /// @return Remaining daily allowance in wei.
    function allowanceLeft() public view returns (uint256) {
        uint256 used = spentDay == block.timestamp / 1 days ? spentToday : 0;
        return used >= dailyLimit ? 0 : dailyLimit - used;
    }

    /// @notice Current guardian set.
    /// @return The guardians.
    function guardians() external view returns (address[] memory) {
        return _guardians;
    }

    /// @notice Queued guardian set (empty when none).
    /// @return The queued guardians.
    function pendingGuardians() external view returns (address[] memory) {
        return _pendingGuardians;
    }

    /// @notice Read a queued spend.
    /// @param id Queue id.
    /// @return The queued spend.
    function getQueued(uint256 id) external view returns (Queued memory) {
        return _queue[id];
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNALS
    //////////////////////////////////////////////////////////////*/

    /// @dev Checks deadline and the owner's signature over the next-nonce digest, then consumes the nonce. Called
    ///      before any effect or external call, so a replay (same nonce) or a late intent fails closed.
    function _auth(bytes32 action, bytes memory params, uint256 deadline, bytes calldata sig) internal {
        if (block.timestamp > deadline) revert Expired();
        bytes32 d = intentDigest(action, nonce, deadline, params);
        if (!PqcLib.verifyForKey(owner, ownerKeyHash, PqcLib.pqMessage(d), sig)) revert BadSignature();
        nonce++;
    }

    /// @dev Access control of both finalize paths. `authorizer` must be the proposed new owner (checked against the
    ///      approved key hash), the current owner when `ownerAllowed` (checked against the pinned `ownerKeyHash`), or a
    ///      current guardian (checked against its registered, proven key). Reverts `Expired`, `NotAuthorized` or
    ///      `BadSignature`. View only: called before any effect.
    function _authorizeFinalize(
        bytes32 action,
        address newOwner,
        bytes32 newKeyHash,
        address authorizer,
        uint256 deadline,
        bytes calldata sig,
        bool ownerAllowed
    ) internal view {
        if (block.timestamp > deadline) revert Expired();
        if (authorizer == address(0)) revert NotAuthorized();
        bytes memory message = PqcLib.pqMessage(finalizeDigest(action, authorizer, deadline));
        bool ok = false;
        if (authorizer == newOwner) {
            ok = PqcLib.verifyForKey(newOwner, newKeyHash, message, sig);
        } else if (ownerAllowed && authorizer == owner) {
            ok = PqcLib.verifyForKey(owner, ownerKeyHash, message, sig);
        } else if (_isGuardian(authorizer)) {
            ok = PqcLib.verifyFor(authorizer, message, sig);
        } else {
            revert NotAuthorized();
        }
        if (!ok) revert BadSignature();
    }

    /// @dev A drop or pool target must be a contract address other than zero and this Pocket.
    function _requireTarget(address target) internal view {
        if (target == address(0) || target == address(this) || target.code.length == 0) revert BadParams();
    }

    /// @dev Revert `Frozen` while a freeze or a unanimous recovery is active.
    function _requireNotFrozen() internal view {
        if (frozen()) revert Frozen();
    }

    /// @dev New owner must be sane and not a guardian (a guardian owning the Pocket would collapse the roles).
    function _checkNewOwner(address newOwner, bytes32 newKeyHash) internal view {
        if (newOwner == address(0) || newOwner == address(this) || newKeyHash == bytes32(0) || _isGuardian(newOwner)) {
            revert BadParams();
        }
    }

    /// @dev Every signer must be a distinct configured guardian with a valid ML-DSA signature over `message`. Callers
    ///      check `signers.length == sigs.length` first. Gas bound: at most `MAX_GUARDIANS` (5) signers are accepted (more reverts before any work), the guardian set
    ///      itself is capped at `MAX_GUARDIANS` by `_validateGuardians`, and duplicates are detected with a bitmap of
    ///      guardian indexes, so the work is at most 5 index lookups of at most 5 steps plus 5 precompile calls.
    function _checkGuardianSigs(address[] calldata signers, bytes[] calldata sigs, bytes memory message) internal view {
        uint256 len = signers.length;
        if (len > MAX_GUARDIANS) revert NotGuardian();
        uint256 seen = 0;
        for (uint256 i = 0; i < len; ++i) {
            uint256 bit = uint256(1) << _guardianIndex(signers[i]);
            if (seen & bit != 0) revert DuplicateSigner();
            seen |= bit;
            if (!PqcLib.verifyFor(signers[i], message, sigs[i])) revert BadSignature();
        }
    }

    /// @dev Add `amount` to today's spend (a new UTC day starts from zero).
    function _debit(uint256 amount) internal {
        uint256 day = block.timestamp / 1 days;
        if (spentDay != day) {
            spentDay = day;
            spentToday = amount;
        } else {
            spentToday += amount;
        }
    }

    /// @dev Debit or revert `OverDailyLimit` (drops and pools never queue).
    function _debitOrRevert(uint256 amount) internal {
        if (amount > allowanceLeft()) revert OverDailyLimit();
        _debit(amount);
    }

    /// @dev Pay QOR; revert `SendFailed` if the receiver rejects it.
    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert SendFailed();
    }

    /// @dev Drop a queued limit raise and a queued guardian change.
    function _clearPending() internal {
        pendingLimitAt = 0;
        pendingGuardiansAt = 0;
        delete _pendingGuardians;
    }

    /// @dev Linear scan of at most MAX_GUARDIANS entries.
    function _isGuardian(address who) internal view returns (bool) {
        uint256 n = _guardians.length;
        for (uint256 i = 0; i < n && i < MAX_GUARDIANS; ++i) {
            if (_guardians[i] == who) return true;
        }
        return false;
    }

    /// @dev Index of `who` in the guardian set (at most MAX_GUARDIANS steps); reverts `NotGuardian` if absent.
    function _guardianIndex(address who) internal view returns (uint256) {
        uint256 n = _guardians.length;
        for (uint256 i = 0; i < n && i < MAX_GUARDIANS; ++i) {
            if (_guardians[i] == who) return i;
        }
        revert NotGuardian();
    }

    /// @dev 0 guardians with threshold 0, or 2..MAX guardians with 2 <= threshold <= n; non-zero, distinct, != owner.
    function _validateGuardians(address owner_, address[] memory g, uint8 t) internal pure {
        uint256 n = g.length;
        if (owner_ == address(0) || n > MAX_GUARDIANS || n == 1) revert InvalidConfig();
        if (n == 0) {
            if (t != 0) revert InvalidConfig();
            return;
        }
        if (t < 2 || t > n) revert InvalidConfig();
        for (uint256 i; i < n; i++) {
            if (g[i] == address(0) || g[i] == owner_) revert InvalidConfig();
            for (uint256 j; j < i; j++) {
                if (g[j] == g[i]) revert InvalidConfig();
            }
        }
    }
}

// ===== src/PocketFactory.sol =====
/// @title PocketFactory
/// @notice EIP-1167 clone factory with CREATE2 addresses. The salt commits to the WHOLE config (owner, guardians,
///         threshold, daily limit, user salt), so a Pocket address pins its configuration and can be funded before it
///         is deployed (a plain QOR send to the predicted address lands and is intact after deployment).
contract PocketFactory {
    /// @notice The PocketVault implementation every clone delegates to (its delays are the instance's delays).
    address public immutable implementation;

    /// @notice Whether an address was deployed by this factory.
    mapping(address => bool) public isPocket;

    event PocketDeployed(address indexed pocket, address indexed owner, bytes32 salt);

    error NoImplementation();
    error AlreadyDeployed();

    /// @param implementation_ The PocketVault implementation (must have code).
    constructor(address implementation_) {
        if (implementation_ == address(0) || implementation_.code.length == 0) revert NoImplementation();
        implementation = implementation_;
    }

    /// @notice The CREATE2 salt for a config.
    /// @param owner Pocket owner (needs a registered, proven ML-DSA-87 key).
    /// @param guardians Guardian set (0, or 2..5).
    /// @param threshold Guardian threshold.
    /// @param dailyLimit Daily allowance in wei.
    /// @param userSalt User salt.
    /// @return The salt (commits to the whole config).
    function saltOf(address owner, address[] calldata guardians, uint8 threshold, uint256 dailyLimit, bytes32 userSalt)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(owner, guardians, threshold, dailyLimit, userSalt));
    }

    /// @notice Address the Pocket for this config has (or will have).
    /// @param owner Pocket owner (needs a registered, proven ML-DSA-87 key).
    /// @param guardians Guardian set (0, or 2..5).
    /// @param threshold Guardian threshold.
    /// @param dailyLimit Daily allowance in wei.
    /// @param userSalt User salt.
    /// @return The CREATE2 address.
    function predict(address owner, address[] calldata guardians, uint8 threshold, uint256 dailyLimit, bytes32 userSalt)
        external
        view
        returns (address)
    {
        bytes32 salt = saltOf(owner, guardians, threshold, dailyLimit, userSalt);
        bytes32 h = keccak256(
            abi.encodePacked(
                hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", implementation, hex"5af43d82803e903d91602b57fd5bf3"
            )
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, h)))));
    }

    /// @notice Deploy (and initialize) the Pocket for this config. Anyone may call; the owner's registered key is read
    ///         and pinned by `initialize`.
    /// @param owner Pocket owner (needs a registered, proven ML-DSA-87 key).
    /// @param guardians Guardian set (0, or 2..5).
    /// @param threshold Guardian threshold.
    /// @param dailyLimit Daily allowance in wei.
    /// @param userSalt User salt.
    /// @return pocket The new Pocket.
    function deploy(address owner, address[] calldata guardians, uint8 threshold, uint256 dailyLimit, bytes32 userSalt)
        external
        returns (address pocket)
    {
        bytes32 salt = saltOf(owner, guardians, threshold, dailyLimit, userSalt);
        address impl = implementation;
        assembly ("memory-safe") {
            mstore(0x00, or(shr(0xe8, shl(0x60, impl)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000))
            mstore(0x20, or(shl(0x78, impl), 0x5af43d82803e903d91602b57fd5bf3))
            pocket := create2(0, 0x09, 0x37, salt)
        }
        if (pocket == address(0)) revert AlreadyDeployed();
        isPocket[pocket] = true;
        PocketVault(payable(pocket)).initialize(owner, guardians, threshold, dailyLimit);
        emit PocketDeployed(pocket, owner, salt);
    }
}

// ===== src/PocketRouter.sol =====
/// @title PocketRouter
/// @notice The single entry point for the relayer. It forwards calls only to factory-deployed Pockets or to the
///         PocketDrop / DropPool contracts, so the relayer's EVM window can be scoped to this one address. Lazy
///         deployment: `deployAndRelay` deploys the Pocket through the factory first if it does not exist yet.
/// @dev Permissionless and stateless: authority always comes from the ML-DSA signatures inside the forwarded calls.
///      v5.1 (F3): the router holds no value. PocketDrop pays the relayer fee to the `feeTo` the link key signed, so
///      the router has no `receive`, no balance and no sweep; a plain QOR send to it reverts.
contract PocketRouter {
    IPocketFactory public immutable factory;
    address public immutable drop;
    address public immutable pool;

    error NotAllowed(address target);
    error ZeroAddress();

    event Relayed(address indexed target, bool lazyDeployed);

    /// @param factory_ The PocketFactory whose Pockets may be called.
    /// @param drop_ The PocketDrop instance.
    /// @param pool_ The DropPool instance.
    constructor(IPocketFactory factory_, address drop_, address pool_) {
        if (address(factory_) == address(0) || drop_ == address(0) || pool_ == address(0)) revert ZeroAddress();
        factory = factory_;
        drop = drop_;
        pool = pool_;
    }

    /// @notice Whether `target` may be called through this router.
    /// @param target Address to check.
    /// @return True for the drop, the pool and factory-deployed Pockets.
    function isAllowed(address target) public view returns (bool) {
        return target == drop || target == pool || factory.isPocket(target);
    }

    /// @notice Forward `data` to an allowed target. Reverts bubble up unchanged.
    /// @param target An allowed target (`isAllowed`).
    /// @param data Calldata forwarded as is.
    /// @return ret The target's return data.
    function relay(address target, bytes calldata data) external returns (bytes memory ret) {
        if (!isAllowed(target)) revert NotAllowed(target);
        ret = _call(target, data);
        emit Relayed(target, false);
    }

    /// @notice Deploy the Pocket for this config if needed (it must be the factory's CREATE2 address), then forward
    ///         `data` to it. Empty `data` only deploys.
    /// @param owner Pocket owner (needs a registered, proven ML-DSA-87 key).
    /// @param guardians Guardian set of the config.
    /// @param threshold Guardian threshold of the config.
    /// @param dailyLimit Daily limit of the config.
    /// @param userSalt User salt of the config.
    /// @param data Calldata forwarded to the Pocket (may be empty).
    /// @return pocket The Pocket address.
    /// @return ret The Pocket's return data.
    function deployAndRelay(
        address owner,
        address[] calldata guardians,
        uint8 threshold,
        uint256 dailyLimit,
        bytes32 userSalt,
        bytes calldata data
    ) external returns (address pocket, bytes memory ret) {
        pocket = factory.predict(owner, guardians, threshold, dailyLimit, userSalt);
        bool lazy = !factory.isPocket(pocket);
        if (lazy) pocket = factory.deploy(owner, guardians, threshold, dailyLimit, userSalt);
        if (data.length > 0) ret = _call(pocket, data);
        emit Relayed(pocket, lazy);
    }

    /// @dev Call `target` and bubble up its revert data unchanged.
    function _call(address target, bytes calldata data) internal returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }
}

// ===== src/PocketDrop.sol =====
/// @title PocketDrop (v5.1)
/// @notice Escrow that hands QOR to someone who has no wallet yet. The sender (a Pocket) creates a link whose
///         ML-DSA-87 key authorises binding a recipient; the recipient claims with a signature from the key registered
///         (with proof of possession) for their QoreChain account; the money lands in the recipient's POCKET
///         (`payTo`, a counterfactual address is fine).
/// @dev Same bind/confirm/claim semantics as v3 plus: all signatures use the QoreX-prefixed, purpose-tagged message
///      (`PqcLib.pqMessage`), the bind and claim digests commit to
///      `payTo`, the bind digest also commits to `feeTo` (v5.1: the relayer fee goes where the link key says), the claim signature is checked through
///      `PqcLib`, and the sender's confirmation is an intent executed by the sender's Pocket (`confirmRecipient`).
///      No owner, no admin, no upgradeability. State changes follow checks-effects-interactions behind a reentrancy
///      lock; payouts fall back to pull balances.
///
///      Invariants: balance >= sum(unpaid escrow of live links) + sum(pull balances); a link pays its amount once,
///      only to the `payTo` bound at claim time; cancel/refund pay only the sender.
contract PocketDrop is Payout, IPocketDropSender {
    enum Mode {
        Confirmed,
        Open
    }

    enum State {
        None,
        Open,
        Bound,
        Confirmed,
        Claimed,
        Cancelled,
        Refunded
    }

    struct Link {
        address sender;
        Mode mode;
        State state;
        bool dripPaid;
        uint64 expiry;
        uint96 amount;
        uint96 drip;
        uint64 bindDeadline;
        uint96 relayerFee;
        address recipient;
        address payTo;
        bytes32 linkKeyHash;
        bytes32 recipientKeyHash;
    }

    /// @dev v5.1: the bind digest adds `feeTo`, so the domain moves to V3.
    string internal constant BIND_DOMAIN = "POCKETDROP_BIND_V3";
    string internal constant CLAIM_DOMAIN = "POCKETDROP_CLAIM_V2";

    uint256 public immutable MIN_ESCROW;
    uint256 public immutable MAX_AMOUNT;
    uint256 public immutable MAX_DRIP;
    uint256 public immutable DAILY_DRIP_CAP;
    uint256 public immutable BIND_TIMEOUT;
    uint256 public immutable MAX_EXPIRY;

    /// @notice Number of links created (ids start at 1).
    uint256 public linkCount;
    mapping(uint256 => Link) internal _links;
    /// @dev sender => UTC day number => drip debited that day.
    mapping(address => mapping(uint256 => uint256)) internal _dripSpent;

    event LinkCreated(
        uint256 indexed linkId,
        address indexed sender,
        Mode mode,
        uint256 amount,
        uint256 drip,
        uint256 relayerFee,
        uint64 expiry,
        bytes32 linkKeyHash
    );
    event LinkBound(
        uint256 indexed linkId,
        address indexed recipient,
        address payTo,
        bytes32 recipientKeyHash,
        uint64 bindDeadline,
        bool rebind,
        address relayer
    );
    event LinkConfirmed(uint256 indexed linkId, address indexed recipient, bytes32 recipientKeyHash);
    event LinkClaimed(
        uint256 indexed linkId, address indexed recipient, address payTo, uint256 amount, address relayer
    );
    event LinkCancelled(uint256 indexed linkId, address indexed sender, uint256 refunded);
    event LinkRefunded(uint256 indexed linkId, address indexed sender, uint256 refunded, address caller);
    /// @dev `feeTo` is the address the link-key signature named for the relayer fee (v5.1), not `msg.sender`.
    event DripPaid(
        uint256 indexed linkId, address indexed recipient, uint256 drip, address indexed feeTo, uint256 relayerFee
    );

    error InvalidConfig();
    error InvalidMode();
    error AmountOutOfRange(uint256 amount);
    error DripTooHigh();
    error DailyDripCapExceeded();
    error InvalidExpiry();
    error ZeroLinkKey();
    error LinkNotFound();
    error NotSender();
    error InvalidState(State current);
    error WrongMode();
    error Expired();
    error NotExpired();
    error BindDeadlinePassed();
    error BadRecipient();
    error ZeroRecipientKey();
    error LinkKeyMismatch();
    error BadLinkSignature();
    error BadRecipientSignature();
    error RecipientChanged();
    error BadFeeTo();

    /// @param minEscrow Smallest allowed escrow amount.
    /// @param maxAmount Largest allowed escrow amount (fits uint96).
    /// @param maxDrip Largest allowed drip per link.
    /// @param dailyDripCap Largest total drip one sender may commit per UTC day.
    /// @param bindTimeout Seconds a bound link stays reserved before it can be re-bound.
    /// @param maxExpiry Longest allowed link lifetime in seconds.
    constructor(
        uint256 minEscrow,
        uint256 maxAmount,
        uint256 maxDrip,
        uint256 dailyDripCap,
        uint256 bindTimeout,
        uint256 maxExpiry
    ) {
        if (
            minEscrow == 0 || maxAmount < minEscrow || maxAmount > type(uint96).max || maxDrip > type(uint96).max
                || dailyDripCap < maxDrip || dailyDripCap > type(uint128).max || bindTimeout == 0
                || bindTimeout > type(uint32).max || maxExpiry == 0 || maxExpiry > type(uint32).max
        ) revert InvalidConfig();
        MIN_ESCROW = minEscrow;
        MAX_AMOUNT = maxAmount;
        MAX_DRIP = maxDrip;
        DAILY_DRIP_CAP = dailyDripCap;
        BIND_TIMEOUT = bindTimeout;
        MAX_EXPIRY = maxExpiry;
    }

    /*//////////////////////////////////////////////////////////////
                             STATE CHANGES
    //////////////////////////////////////////////////////////////*/

    /// @notice Create and fund a link; `msg.sender` (a Pocket) is the sender. msg.value = amount + drip + relayerFee.
    /// @param linkKeyHash keccak256 of the link's ML-DSA-87 public key.
    /// @param mode 0 = Confirmed (sender checks the recipient key), 1 = Open (first bind wins).
    /// @param expiry Unix time after which the link can only be refunded.
    /// @param drip Paid to the recipient account on the first bind (covers its key registration).
    /// @param relayerFee Paid to the bind's signed `feeTo` on the first bind.
    /// @return linkId The new link id.
    function create(bytes32 linkKeyHash, uint8 mode, uint64 expiry, uint96 drip, uint96 relayerFee)
        external
        payable
        override
        nonReentrant
        returns (uint256 linkId)
    {
        if (linkKeyHash == bytes32(0)) revert ZeroLinkKey();
        if (mode > uint8(Mode.Open)) revert InvalidMode();
        uint256 amount = _validateCreate(expiry, drip, relayerFee);

        linkId = ++linkCount;
        Link storage l = _links[linkId];
        l.sender = msg.sender;
        l.mode = Mode(mode);
        l.state = State.Open;
        l.expiry = expiry;
        l.amount = uint96(amount); // amount <= MAX_AMOUNT <= type(uint96).max (constructor)
        l.drip = drip;
        l.relayerFee = relayerFee;
        l.linkKeyHash = linkKeyHash;

        emit LinkCreated(linkId, msg.sender, Mode(mode), amount, drip, relayerFee, expiry, linkKeyHash);
    }

    /// @notice Bind a recipient account, its key, its payout Pocket and the fee receiver to a link. Anyone may submit;
    ///         the link key's signature over the bind digest is the authority.
    /// @dev v5.1 (F1): the relayer fee is paid to the signed `feeTo`, not to `msg.sender`, so whoever copies a pending
    ///      bind and lands it first gains nothing. The drip and fee are paid on the first bind only.
    /// @param linkId Link id.
    /// @param recipient Account that will claim (its registered key must hash to `recipientKeyHash` at claim time).
    /// @param recipientKeyHash keccak256 of the recipient's ML-DSA-87 public key.
    /// @param payTo Pocket the escrow is paid to at claim.
    /// @param feeTo Receiver of the link's relayer fee (the relayer for a relayed bind, the user for a self-relay).
    /// @param linkPk The link's ML-DSA-87 public key (must hash to the link's `linkKeyHash`).
    /// @param linkSig Link-key signature over `bindDigest(...)`.
    function bind(
        uint256 linkId,
        address recipient,
        bytes32 recipientKeyHash,
        address payTo,
        address feeTo,
        bytes calldata linkPk,
        bytes calldata linkSig
    ) external nonReentrant {
        Link storage l = _existing(linkId);
        {
            State s = l.state;
            if (s != State.Open && !(s == State.Bound && block.timestamp > l.bindDeadline)) revert InvalidState(s);
        }
        if (block.timestamp >= l.expiry) revert Expired();
        if (recipient == address(0) || recipient == address(this) || payTo == address(0) || payTo == address(this)) {
            revert BadRecipient();
        }
        if (feeTo == address(0) || feeTo == address(this)) revert BadFeeTo();
        if (recipientKeyHash == bytes32(0)) revert ZeroRecipientKey();
        _checkBindSig(l.linkKeyHash, bindDigest(linkId, recipient, recipientKeyHash, payTo, feeTo), linkPk, linkSig);

        l.state = State.Bound;
        l.recipient = recipient;
        l.payTo = payTo;
        l.recipientKeyHash = recipientKeyHash;
        l.bindDeadline = uint64(block.timestamp + BIND_TIMEOUT);
        bool first = !l.dripPaid;
        if (first) l.dripPaid = true;

        emit LinkBound(linkId, recipient, payTo, recipientKeyHash, l.bindDeadline, !first, msg.sender);

        if (first) _payFirstBind(linkId, recipient, feeTo, l.drip, l.relayerFee);
    }

    /// @dev First bind only: pay the drip to the recipient account and the relayer fee to the signed `feeTo`.
    function _payFirstBind(uint256 linkId, address recipient, address feeTo, uint256 drip, uint256 fee) internal {
        emit DripPaid(linkId, recipient, drip, feeTo, fee);
        _pay(recipient, drip);
        _pay(feeTo, fee);
    }

    /// @notice Sender confirms the bound recipient key (Confirmed mode). Called by the sender's Pocket.
    /// @param linkId Link id.
    /// @param expectedRecipientKeyHash The key hash the sender checked (4 words); must equal the bound one.
    function confirmRecipient(uint256 linkId, bytes32 expectedRecipientKeyHash) external override nonReentrant {
        Link storage l = _existing(linkId);
        if (l.recipientKeyHash != expectedRecipientKeyHash) revert RecipientChanged();
        if (msg.sender != l.sender) revert NotSender();
        if (l.mode != Mode.Confirmed) revert WrongMode();
        State s = l.state;
        if (s != State.Bound) revert InvalidState(s);
        if (block.timestamp >= l.expiry) revert Expired();
        if (block.timestamp > l.bindDeadline) revert BindDeadlinePassed();
        l.state = State.Confirmed;
        emit LinkConfirmed(linkId, l.recipient, l.recipientKeyHash);
    }

    /// @notice Claim: pays the escrow to the bound `payTo` Pocket. Anyone may submit; the recipient's ML-DSA-87
    ///         signature over the claim digest is the authority.
    /// @param linkId Link id.
    /// @param recipientSig Recipient-key signature over `claimDigest(linkId, recipient, payTo)`.
    function claim(uint256 linkId, bytes calldata recipientSig) external nonReentrant {
        Link storage l = _existing(linkId);
        State s = l.state;
        if (l.mode == Mode.Confirmed) {
            if (s != State.Confirmed) revert InvalidState(s);
        } else {
            if (s != State.Bound) revert InvalidState(s);
            if (block.timestamp > l.bindDeadline) revert BindDeadlinePassed();
        }
        if (block.timestamp >= l.expiry) revert Expired();

        address recipient = l.recipient;
        address payTo = l.payTo;
        bytes memory pk = PqcLib.requireKey(recipient, l.recipientKeyHash);
        if (!PqcLib.verify(pk, recipientSig, PqcLib.pqMessage(claimDigest(linkId, recipient, payTo)))) {
            revert BadRecipientSignature();
        }

        uint256 amount = l.amount;
        l.state = State.Claimed;
        emit LinkClaimed(linkId, recipient, payTo, amount, msg.sender);
        _pay(payTo, amount);
    }

    /// @notice Sender cancels (Open, or Bound in Confirmed mode); the unpaid escrow returns to the sender.
    /// @param linkId Link id.
    function cancel(uint256 linkId) external override nonReentrant {
        Link storage l = _existing(linkId);
        if (msg.sender != l.sender) revert NotSender();
        State s = l.state;
        if (s != State.Open && !(s == State.Bound && l.mode == Mode.Confirmed)) revert InvalidState(s);

        uint256 owed = _unpaid(l);
        address sender = l.sender;
        l.state = State.Cancelled;
        emit LinkCancelled(linkId, sender, owed);
        _pay(sender, owed);
    }

    /// @notice After expiry anyone may return the unpaid escrow to the sender.
    /// @param linkId Link id.
    function refund(uint256 linkId) external nonReentrant {
        Link storage l = _existing(linkId);
        State s = l.state;
        if (!_isLive(s)) revert InvalidState(s);
        if (block.timestamp < l.expiry) revert NotExpired();

        uint256 owed = _unpaid(l);
        address sender = l.sender;
        l.state = State.Refunded;
        emit LinkRefunded(linkId, sender, owed, msg.sender);
        _pay(sender, owed);
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice Read a link.
    /// @param linkId Link id.
    /// @return The stored link (state None = not found).
    function getLink(uint256 linkId) external view returns (Link memory) {
        return _links[linkId];
    }

    /// @notice Digest the link key signs (as `PqcLib.pqMessage(digest)`) to bind a recipient.
    /// @param linkId Link id.
    /// @param recipient Recipient account.
    /// @param recipientKeyHash keccak256 of the recipient's ML-DSA-87 key.
    /// @param payTo Payout Pocket.
    /// @param feeTo Receiver of the relayer fee.
    /// @return The digest.
    function bindDigest(uint256 linkId, address recipient, bytes32 recipientKeyHash, address payTo, address feeTo)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(BIND_DOMAIN, block.chainid, address(this), linkId, recipient, recipientKeyHash, payTo, feeTo)
        );
    }

    /// @notice Digest the recipient signs (as `PqcLib.pqMessage(digest)`) to claim.
    /// @param linkId Link id.
    /// @param recipient Recipient account.
    /// @param payTo Payout Pocket.
    /// @return The digest.
    function claimDigest(uint256 linkId, address recipient, address payTo) public view returns (bytes32) {
        return keccak256(abi.encode(CLAIM_DOMAIN, block.chainid, address(this), linkId, recipient, payTo));
    }

    /// @notice Escrow still held for a live link (amount, plus drip and fee before the first bind).
    /// @param linkId Link id.
    /// @return Wei owed back to the sender on cancel or refund (zero for a finished link).
    function unpaidOf(uint256 linkId) external view returns (uint256) {
        Link storage l = _links[linkId];
        return _isLive(l.state) ? _unpaid(l) : 0;
    }

    /// @notice Drip a sender has committed today (UTC day).
    /// @param account Sender (a Pocket).
    /// @return Wei of drip debited today.
    function dripUsedToday(address account) external view returns (uint256) {
        return _dripSpent[account][block.timestamp / 1 days];
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNALS
    //////////////////////////////////////////////////////////////*/

    /// @dev Checks the value split, the limits, the expiry and the sender's daily drip cap; returns the escrow amount.
    function _validateCreate(uint64 expiry, uint96 drip, uint96 relayerFee) internal returns (uint256 amount) {
        uint256 extras = uint256(drip) + uint256(relayerFee);
        if (msg.value < extras) revert AmountOutOfRange(0);
        amount = msg.value - extras;
        if (amount < MIN_ESCROW || amount > MAX_AMOUNT) revert AmountOutOfRange(amount);
        if (drip > MAX_DRIP) revert DripTooHigh();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_EXPIRY) revert InvalidExpiry();

        // Explicit bounds (v5.2): `drip` is a uint96 and at most MAX_DRIP (checked above); MAX_DRIP <= DAILY_DRIP_CAP
        // <= type(uint128).max (constructor); `spent` never exceeds DAILY_DRIP_CAP (it only grows through this
        // function, below). The headroom is computed by subtraction first, so the new total is known to be within the
        // cap before it is computed, and it cannot overflow (checked arithmetic is a second guard).
        uint256 day = block.timestamp / 1 days;
        uint256 spent = _dripSpent[msg.sender][day];
        if (spent > DAILY_DRIP_CAP) revert DailyDripCapExceeded();
        uint256 headroom = DAILY_DRIP_CAP - spent;
        if (uint256(drip) > headroom) revert DailyDripCapExceeded();
        uint256 used = spent + uint256(drip);
        _dripSpent[msg.sender][day] = used;
    }

    /// @dev The link key must hash to `linkKeyHash` and sign `digest`. Split out of `bind` to keep the
    ///      stack shallow.
    function _checkBindSig(bytes32 linkKeyHash, bytes32 digest, bytes calldata linkPk, bytes calldata linkSig)
        internal
        view
    {
        if (keccak256(linkPk) != linkKeyHash) revert LinkKeyMismatch();
        if (!PqcLib.verify(linkPk, linkSig, PqcLib.pqMessage(digest))) revert BadLinkSignature();
    }

    /// @dev The stored link, or revert `LinkNotFound`.
    function _existing(uint256 linkId) internal view returns (Link storage l) {
        l = _links[linkId];
        if (l.state == State.None) revert LinkNotFound();
    }

    /// @dev Open, Bound or Confirmed.
    function _isLive(State s) internal pure returns (bool) {
        return s == State.Open || s == State.Bound || s == State.Confirmed;
    }

    /// @dev Escrow still owed to the sender: amount, plus drip and fee if no bind paid them yet.
    function _unpaid(Link storage l) internal view returns (uint256) {
        return l.dripPaid ? uint256(l.amount) : uint256(l.amount) + uint256(l.drip) + uint256(l.relayerFee);
    }
}

// ===== src/DropPool.sol =====
/// @title DropPool
/// @notice One link, N slots, a fixed amount per slot. Each claim needs (1) a distinct PoP-proven recipient account,
///         (2) a signature by the pool's link key over the claim, and (3) the recipient's own signature. The money
///         lands in the recipient's Pocket (`payTo`). The host can close the pool and recover unclaimed slots.
/// @dev Uniqueness is per ACCOUNT, not per human: a sybil can make many PoP accounts. Mitigations are the small slot
///      cap, small amounts and the host's close. Copy this honestly: "distinct PoP accounts, not people".
contract DropPool is Payout, IDropPoolHost {
    struct Pool {
        address host;
        uint96 perSlot;
        uint32 slots;
        uint32 taken;
        uint64 expiry;
        bool closed;
        bytes32 linkKeyHash;
    }

    string internal constant LINK_DOMAIN = "POCKET_POOL_LINK_V1";
    string internal constant CLAIM_DOMAIN = "POCKET_POOL_CLAIM_V1";

    uint256 public immutable MIN_PER_SLOT;
    uint256 public immutable MAX_PER_SLOT;
    uint256 public immutable MAX_SLOTS;
    uint256 public immutable MAX_EXPIRY;

    /// @notice Number of pools created (ids start at 1).
    uint256 public poolCount;
    mapping(uint256 => Pool) internal _pools;
    /// @dev poolId => recipient account => has claimed.
    mapping(uint256 => mapping(address => bool)) public claimed;

    event PoolCreated(uint256 indexed poolId, address indexed host, uint32 slots, uint96 perSlot, uint64 expiry, bytes32 linkKeyHash);
    event PoolClaimed(uint256 indexed poolId, address indexed recipient, address payTo, uint32 taken, address relayer);
    event PoolClosed(uint256 indexed poolId, address indexed host, uint256 refunded, address caller);

    error InvalidConfig();
    error BadSlots();
    error BadPerSlot();
    error BadValue();
    error InvalidExpiry();
    error ZeroLinkKey();
    error PoolNotFound();
    error PoolClosedError();
    error PoolExpired();
    error PoolFull();
    error AlreadyClaimed();
    error BadRecipient();
    error LinkKeyMismatch();
    error BadLinkSignature();
    error BadRecipientSignature();
    error NotHostOrNotExpired();

    /// @param minPerSlot Smallest allowed per-slot amount.
    /// @param maxPerSlot Largest allowed per-slot amount.
    /// @param maxSlots Largest allowed slot count.
    /// @param maxExpiry Longest allowed pool lifetime in seconds.
    constructor(uint256 minPerSlot, uint256 maxPerSlot, uint256 maxSlots, uint256 maxExpiry) {
        if (
            minPerSlot == 0 || maxPerSlot < minPerSlot || maxPerSlot > type(uint96).max || maxSlots == 0
                || maxSlots > type(uint32).max || maxExpiry == 0 || maxExpiry > type(uint32).max
        ) revert InvalidConfig();
        MIN_PER_SLOT = minPerSlot;
        MAX_PER_SLOT = maxPerSlot;
        MAX_SLOTS = maxSlots;
        MAX_EXPIRY = maxExpiry;
    }

    /// @notice Create and fund a pool; `msg.value` must equal `slots * perSlot`. `msg.sender` is the host.
    /// @param linkKeyHash keccak256 of the pool's ML-DSA-87 link public key.
    /// @param slots Number of slots.
    /// @param perSlot Amount paid per slot, in wei.
    /// @param expiry Unix time after which no slot can be claimed and anyone may close.
    /// @return poolId The new pool id.
    function create(bytes32 linkKeyHash, uint32 slots, uint96 perSlot, uint64 expiry)
        external
        payable
        override
        nonReentrant
        returns (uint256 poolId)
    {
        if (linkKeyHash == bytes32(0)) revert ZeroLinkKey();
        if (slots == 0 || slots > MAX_SLOTS) revert BadSlots();
        if (perSlot < MIN_PER_SLOT || perSlot > MAX_PER_SLOT) revert BadPerSlot();
        if (msg.value != uint256(slots) * perSlot) revert BadValue();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_EXPIRY) revert InvalidExpiry();

        poolId = ++poolCount;
        _pools[poolId] = Pool(msg.sender, perSlot, slots, 0, expiry, false, linkKeyHash);
        emit PoolCreated(poolId, msg.sender, slots, perSlot, expiry, linkKeyHash);
    }

    /// @notice Claim one slot for `recipient` (a PoP-proven account), paid to `payTo`. Anyone may submit.
    /// @param poolId Pool id.
    /// @param recipient Claiming account; needs a registered, proven ML-DSA-87 key and may claim once per pool.
    /// @param payTo Where the slot is paid.
    /// @param linkPk The pool's link public key (must hash to `linkKeyHash`).
    /// @param linkSig Link-key signature over `linkDigest`.
    /// @param recipientSig Recipient-key signature over `claimDigest`.
    function claim(
        uint256 poolId,
        address recipient,
        address payTo,
        bytes calldata linkPk,
        bytes calldata linkSig,
        bytes calldata recipientSig
    ) external nonReentrant {
        Pool storage p = _pools[poolId];
        if (p.host == address(0)) revert PoolNotFound();
        if (p.closed) revert PoolClosedError();
        if (block.timestamp >= p.expiry) revert PoolExpired();
        if (p.taken >= p.slots) revert PoolFull();
        if (recipient == address(0) || payTo == address(0) || payTo == address(this)) revert BadRecipient();
        if (claimed[poolId][recipient]) revert AlreadyClaimed();
        _checkClaimSigs(p.linkKeyHash, poolId, recipient, payTo, linkPk, linkSig, recipientSig);

        claimed[poolId][recipient] = true;
        uint32 taken = ++p.taken;
        uint256 amount = p.perSlot;
        emit PoolClaimed(poolId, recipient, payTo, taken, msg.sender);
        _pay(payTo, amount);
    }

    /// @notice Return the unclaimed slots to the host. The host may close any time; anyone may after expiry.
    /// @param poolId Pool id.
    function close(uint256 poolId) external override nonReentrant {
        Pool storage p = _pools[poolId];
        if (p.host == address(0)) revert PoolNotFound();
        if (p.closed) revert PoolClosedError();
        if (msg.sender != p.host && block.timestamp < p.expiry) revert NotHostOrNotExpired();
        p.closed = true;
        address host = p.host;
        uint256 owed = uint256(p.slots - p.taken) * p.perSlot;
        emit PoolClosed(poolId, host, owed, msg.sender);
        _pay(host, owed);
    }

    /// @notice Read a pool.
    /// @param poolId Pool id.
    /// @return The stored pool (host zero = not found).
    function getPool(uint256 poolId) external view returns (Pool memory) {
        return _pools[poolId];
    }

    /// @notice Digest the pool's link key signs for a claim (as `PqcLib.pqMessage(digest)`).
    /// @param poolId Pool id.
    /// @param recipient Claiming account.
    /// @param payTo Pocket the slot is paid to.
    /// @return The digest.
    function linkDigest(uint256 poolId, address recipient, address payTo) public view returns (bytes32) {
        return keccak256(abi.encode(LINK_DOMAIN, block.chainid, address(this), poolId, recipient, payTo));
    }

    /// @notice Digest the recipient signs for a claim (as `PqcLib.pqMessage(digest)`).
    /// @param poolId Pool id.
    /// @param recipient Claiming account.
    /// @param payTo Pocket the slot is paid to.
    /// @return The digest.
    function claimDigest(uint256 poolId, address recipient, address payTo) public view returns (bytes32) {
        return keccak256(abi.encode(CLAIM_DOMAIN, block.chainid, address(this), poolId, recipient, payTo));
    }

    /// @notice Unclaimed escrow of an open pool.
    /// @param poolId Pool id.
    /// @return Wei still held for unclaimed slots (zero once closed).
    function unclaimedOf(uint256 poolId) external view returns (uint256) {
        Pool storage p = _pools[poolId];
        return p.closed ? 0 : uint256(p.slots - p.taken) * p.perSlot;
    }

    /// @dev The link key and the recipient's registered, proven key must both sign
    ///      this exact claim. Split out of `claim` to keep the stack shallow.
    function _checkClaimSigs(
        bytes32 linkKeyHash,
        uint256 poolId,
        address recipient,
        address payTo,
        bytes calldata linkPk,
        bytes calldata linkSig,
        bytes calldata recipientSig
    ) internal view {
        if (keccak256(linkPk) != linkKeyHash) revert LinkKeyMismatch();
        if (!PqcLib.verify(linkPk, linkSig, PqcLib.pqMessage(linkDigest(poolId, recipient, payTo)))) {
            revert BadLinkSignature();
        }
        bytes memory pk = PqcLib.requireKey(recipient, bytes32(0));
        if (!PqcLib.verify(pk, recipientSig, PqcLib.pqMessage(claimDigest(poolId, recipient, payTo)))) {
            revert BadRecipientSignature();
        }
    }
}
