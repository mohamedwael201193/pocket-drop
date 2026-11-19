// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ===== src/interfaces/IPocket.sol =====
/// @notice The slice of PocketFactory that other contracts depend on.
interface IPocketFactory {
    function isPocket(address account) external view returns (bool);

    function predict(address owner, address[] calldata guardians, uint8 threshold, uint256 dailyLimit, bytes32 userSalt)
        external
        view
        returns (address);

    function deploy(address owner, address[] calldata guardians, uint8 threshold, uint256 dailyLimit, bytes32 userSalt)
        external
        returns (address);
}

/// @notice The slice of PocketDrop that a Pocket calls as the sender.
interface IPocketDropSender {
    function create(bytes32 linkKeyHash, uint8 mode, uint64 expiry, uint96 drip, uint96 relayerFee)
        external
        payable
        returns (uint256);

    function confirmRecipient(uint256 linkId, bytes32 expectedRecipientKeyHash) external;

    function cancel(uint256 linkId) external;
}

/// @notice The slice of DropPool that a Pocket calls as the host.
interface IDropPoolHost {
    function create(bytes32 linkKeyHash, uint32 slots, uint96 perSlot, uint64 expiry)
        external
        payable
        returns (uint256);

    function close(uint256 poolId) external;
}

/// @notice ERC-1271.
interface IERC1271 {
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

// ===== src/Payout.sol =====
/// @title Payout
/// @notice Shared payout plumbing for PocketDrop and DropPool: a reentrancy lock, bounded-gas pushes that fall back to a
///         pull balance, and `withdraw`. A hostile receiver can never block a state transition.
abstract contract Payout {
    /// @dev Gas forwarded on direct payouts. Failure falls back to the pull balance.
    uint256 internal constant SEND_GAS = 100_000;

    error Reentrancy();
    error NothingToWithdraw();
    error WithdrawFailed();

    event PayoutDeferred(address indexed to, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    uint256 public totalPending;
    mapping(address => uint256) public pending;
    /// @dev 1 = unlocked, 2 = locked.
    uint256 private _lock = 1;

    modifier nonReentrant() {
        _enter();
        _;
        _lock = 1;
    }

    function _enter() private {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
    }

    /// @notice Pull a deferred payout.
    function withdraw() external nonReentrant {
        uint256 owed = pending[msg.sender];
        if (owed == 0) revert NothingToWithdraw();
        pending[msg.sender] = 0;
        totalPending -= owed;
        emit Withdrawn(msg.sender, owed);
        if (!_rawSend(msg.sender, owed, gasleft())) revert WithdrawFailed();
    }

    /// @dev Caller must have finished all state updates (CEI) and hold the lock.
    function _pay(address to, uint256 value) internal {
        if (value == 0) return;
        if (!_rawSend(to, value, SEND_GAS)) {
            pending[to] += value;
            totalPending += value;
            emit PayoutDeferred(to, value);
        }
    }

    /// @dev Value call that never copies return data (no return-bomb) and never reverts.
    function _rawSend(address to, uint256 value, uint256 gasLimit) internal returns (bool ok) {
        assembly ("memory-safe") {
            ok := call(gasLimit, to, value, 0, 0, 0, 0)
        }
    }
}

// ===== src/PqGuard.sol =====
/// @title PqGuard
/// @notice Drop-in post-quantum approval check for any dApp. `account` may be a Pocket (ERC-1271 contract) or a plain
///         PoP-proven ML-DSA-87 account. The approved bytes are `"qorechain-msg-v1|" + chainId + "|" + hex(digest)`.
/// @dev Your `digest` must already bind your contract address, chain id, the action, its parameters and a nonce or
///      deadline. PqGuard only answers "did this account's ML-DSA key approve exactly this digest".
library PqGuard {
    /// @dev ERC-1271 magic value.
    bytes4 internal constant MAGIC = 0x1626ba7e;

    error PqApprovalFailed();

    /// @notice True when `account` approved `digest` with `sig`.
    function isPqApproved(address account, bytes32 digest, bytes memory sig) internal view returns (bool) {
        if (account.code.length > 0) {
            (bool ok, bytes memory ret) = account.staticcall(abi.encodeCall(IERC1271.isValidSignature, (digest, sig)));
            if (!ok || ret.length != 32) return false;
            return abi.decode(ret, (bytes4)) == MAGIC;
        }
        return PqcLib.verifyFor(account, PqcLib.pqMessage(digest), sig);
    }

    /// @notice Revert unless `account` approved `digest`.
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
///      QoreX-prefixed message (`PqcLib.pqMessage`). The nonce is a single sequential counter consumed on success.
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

    address public factory;
    address public owner;
    bytes32 public ownerKeyHash;
    /// @notice Next owner-intent nonce.
    uint256 public nonce;
    /// @notice Next guardian-recovery nonce.
    uint256 public recoveryNonce;
    /// @notice Bumped by every finalized recovery; queued spends from an older epoch are dead.
    uint256 public epoch;

    uint256 public dailyLimit;
    uint256 public spentDay;
    uint256 public spentToday;

    address[] internal _guardians;
    uint8 public threshold;

    uint256 public queueCount;
    mapping(uint256 => Queued) internal _queue;

    uint256 public pendingLimit;
    uint64 public pendingLimitAt;

    address[] internal _pendingGuardians;
    uint8 public pendingThreshold;
    uint64 public pendingGuardiansAt;

    address public recoveryOwner;
    bytes32 public recoveryKeyHash;
    uint64 public recoveryAt;

    /// @notice Next guardian-freeze nonce.
    uint256 public freezeNonce;
    /// @notice The Pocket is frozen while `block.timestamp < frozenUntil` (see `frozen()`).
    uint64 public frozenUntil;
    /// @notice Freezes in a row by the current guardian set (reset by a guardian change or a long quiet period).
    uint8 public freezeStreak;

    address public uRecoveryOwner;
    bytes32 public uRecoveryKeyHash;
    /// @notice Unanimous recovery can be finalized from this time on (0 = none pending).
    uint64 public uRecoveryAt;

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
    function initialize(address owner_, address[] calldata guardians_, uint8 threshold_, uint256 dailyLimit_) external {
        if (factory != address(0)) revert AlreadyInitialized();
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

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    /*//////////////////////////////////////////////////////////////
                                ERC-1271
    //////////////////////////////////////////////////////////////*/

    /// @notice Valid only for the owner's ML-DSA-87 signature over the QoreX-prefixed message of `hash`.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (PqcLib.verifyForKey(owner, ownerKeyHash, PqcLib.pqMessage(hash), signature)) return 0x1626ba7e;
        return 0xffffffff;
    }

    /*//////////////////////////////////////////////////////////////
                              SPEND / QUEUE
    //////////////////////////////////////////////////////////////*/

    /// @notice Pay `to`. Within today's allowance it pays now; above it, the spend is queued for TIMELOCK.
    /// @return queuedId 0 if paid immediately, otherwise the queue id.
    function spend(address to, uint256 amount, uint256 deadline, bytes calldata sig) external returns (uint256 queuedId) {
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
    function executeQueued(uint256 id) external {
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
    function vetoRecovery(uint256 deadline, bytes calldata sig) external {
        _auth(ACT_VETO_RECOVERY, "", deadline, sig);
        if (recoveryAt == 0) revert NoRecoveryPending();
        recoveryAt = 0;
        emit RecoveryVetoed();
    }

    /// @notice Complete a recovery after its delay. Anyone may call.
    function finalizeRecovery() external {
        uint64 at = recoveryAt;
        if (at == 0) revert NoRecoveryPending();
        if (block.timestamp < at) revert TooEarly();
        PqcLib.requireKey(recoveryOwner, recoveryKeyHash);
        address old = owner;
        owner = recoveryOwner;
        ownerKeyHash = recoveryKeyHash;
        recoveryAt = 0;
        epoch++;
        _clearPending();
        emit RecoveryFinalized(old, owner, ownerKeyHash);
    }

    /// @notice Replace the owner key with the signatures of ALL guardians (set size >= 2). The old key cannot veto it:
    ///         this is the lost-or-stolen-key path. It overrides a pending threshold recovery and, while pending,
    ///         the Pocket is frozen. A new unanimous proposal replaces a pending one (restarting the delay), which
    ///         lets the guardians fix a proposal whose new key turned out unusable.
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

    /// @notice Complete a unanimous recovery after its delay. Anyone may call.
    function finalizeRecoveryUnanimous() external {
        uint64 at = uRecoveryAt;
        if (at == 0) revert NoRecoveryPending();
        if (block.timestamp < at) revert TooEarly();
        PqcLib.requireKey(uRecoveryOwner, uRecoveryKeyHash);
        address old = owner;
        owner = uRecoveryOwner;
        ownerKeyHash = uRecoveryKeyHash;
        uRecoveryAt = 0;
        epoch++;
        _clearPending();
        emit RecoveryFinalized(old, owner, ownerKeyHash);
    }

    /// @notice The digest each guardian signs (as the QoreX-prefixed message) for the next unanimous recovery.
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
    function guardianFreeze(address[] calldata signers, bytes[] calldata sigs, uint256 nonce_, uint256 deadline)
        external
    {
        if (block.timestamp > deadline) revert Expired();
        if (threshold == 0) revert NoGuardians();
        if (nonce_ != freezeNonce) revert BadNonce();
        if (frozen()) revert AlreadyFrozen();
        if (signers.length != sigs.length || signers.length < threshold) revert NotEnoughSigners();
        _checkGuardianSigs(signers, sigs, PqcLib.pqMessage(freezeDigest(nonce_, deadline)));
        uint8 streak = block.timestamp >= uint256(frozenUntil) + FREEZE_COOLDOWN_PERIODS * FREEZE_PERIOD
            ? 1
            : freezeStreak + 1;
        if (streak > MAX_FREEZE_STREAK) revert FreezeCapped();
        freezeStreak = streak;
        freezeNonce = nonce_ + 1;
        frozenUntil = uint64(block.timestamp + FREEZE_PERIOD);
        emit GuardianFrozen(frozenUntil, nonce_, streak);
    }

    /// @notice The digest each guardian signs (as the QoreX-prefixed message) for the freeze with nonce `nonce_`.
    function freezeDigest(uint256 nonce_, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encode(ACT_FREEZE, block.chainid, address(this), nonce_, deadline));
    }

    /// @notice True while a guardian freeze runs or a unanimous recovery is pending.
    function frozen() public view returns (bool) {
        return block.timestamp < frozenUntil || uRecoveryAt != 0;
    }

    /// @notice The digest each guardian signs (as the QoreX-prefixed message) for the next recovery proposal.
    function recoveryDigest(address newOwner, bytes32 newKeyHash, uint256 deadline) public view returns (bytes32) {
        return keccak256(
            abi.encode(ACT_RECOVER, block.chainid, address(this), recoveryNonce, deadline, newOwner, newKeyHash)
        );
    }

    /*//////////////////////////////////////////////////////////////
                         DROPS AND POOLS (CALLS)
    //////////////////////////////////////////////////////////////*/

    /// @notice Create a PocketDrop link with this Pocket as sender. `value` (= escrow + drip + relayer fee) is debited
    ///         from today's allowance.
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
    ) external returns (uint256 linkId) {
        _requireNotFrozen();
        _auth(ACT_CREATE_DROP, abi.encode(drop, linkKeyHash, mode, expiry, drip, relayerFee, value), deadline, sig);
        _debitOrRevert(value);
        linkId = IPocketDropSender(drop).create{value: value}(linkKeyHash, mode, expiry, drip, relayerFee);
        emit DropCreated(drop, linkId, value);
    }

    /// @notice Sender intent: confirm the recipient key the drop is bound to (the "sender check", one tap).
    function confirmDrop(
        address drop,
        uint256 linkId,
        bytes32 expectedRecipientKeyHash,
        uint256 deadline,
        bytes calldata sig
    ) external {
        _auth(ACT_CONFIRM_DROP, abi.encode(drop, linkId, expectedRecipientKeyHash), deadline, sig);
        IPocketDropSender(drop).confirmRecipient(linkId, expectedRecipientKeyHash);
        emit DropConfirmed(drop, linkId);
    }

    /// @notice Sender intent: cancel a drop; the escrow returns to this Pocket.
    function cancelDrop(address drop, uint256 linkId, uint256 deadline, bytes calldata sig) external {
        _auth(ACT_CANCEL_DROP, abi.encode(drop, linkId), deadline, sig);
        IPocketDropSender(drop).cancel(linkId);
        emit DropCancelled(drop, linkId);
    }

    /// @notice Host a DropPool from this Pocket; slots * perSlot is debited from today's allowance.
    function createPool(
        address pool,
        bytes32 linkKeyHash,
        uint32 slots,
        uint96 perSlot,
        uint64 expiry,
        uint256 deadline,
        bytes calldata sig
    ) external returns (uint256 poolId) {
        _requireNotFrozen();
        _auth(ACT_CREATE_POOL, abi.encode(pool, linkKeyHash, slots, perSlot, expiry), deadline, sig);
        uint256 value = uint256(slots) * perSlot;
        _debitOrRevert(value);
        poolId = IDropPoolHost(pool).create{value: value}(linkKeyHash, slots, perSlot, expiry);
        emit PoolCreated(pool, poolId, value);
    }

    /// @notice Close a hosted pool; the unclaimed remainder returns to this Pocket.
    function closePool(address pool, uint256 poolId, uint256 deadline, bytes calldata sig) external {
        _auth(ACT_CLOSE_POOL, abi.encode(pool, poolId), deadline, sig);
        IDropPoolHost(pool).close(poolId);
        emit PoolClosed(pool, poolId);
    }

    /*//////////////////////////////////////////////////////////////
                                  VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice The digest an owner intent signs for `action` at `nonce_` (sign it as `PqcLib.pqMessage(digest)`).
    function intentDigest(bytes32 action, uint256 nonce_, uint256 deadline, bytes memory params)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(action, block.chainid, address(this), nonce_, deadline, params));
    }

    /// @notice What can still be spent immediately today.
    function allowanceLeft() public view returns (uint256) {
        uint256 used = spentDay == block.timestamp / 1 days ? spentToday : 0;
        return used >= dailyLimit ? 0 : dailyLimit - used;
    }

    function guardians() external view returns (address[] memory) {
        return _guardians;
    }

    function pendingGuardians() external view returns (address[] memory) {
        return _pendingGuardians;
    }

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

    function _requireNotFrozen() internal view {
        if (frozen()) revert Frozen();
    }

    /// @dev New owner must be sane and not a guardian (a guardian owning the Pocket would collapse the roles).
    function _checkNewOwner(address newOwner, bytes32 newKeyHash) internal view {
        if (newOwner == address(0) || newOwner == address(this) || newKeyHash == bytes32(0) || _isGuardian(newOwner)) {
            revert BadParams();
        }
    }

    /// @dev Every signer must be a distinct configured guardian with a valid ML-DSA signature over `message`.
    function _checkGuardianSigs(address[] calldata signers, bytes[] calldata sigs, bytes memory message)
        internal
        view
    {
        for (uint256 i; i < signers.length; i++) {
            if (!_isGuardian(signers[i])) revert NotGuardian();
            for (uint256 j; j < i; j++) {
                if (signers[j] == signers[i]) revert DuplicateSigner();
            }
            if (!PqcLib.verifyFor(signers[i], message, sigs[i])) revert BadSignature();
        }
    }

    function _debit(uint256 amount) internal {
        uint256 day = block.timestamp / 1 days;
        if (spentDay != day) {
            spentDay = day;
            spentToday = amount;
        } else {
            spentToday += amount;
        }
    }

    function _debitOrRevert(uint256 amount) internal {
        if (amount > allowanceLeft()) revert OverDailyLimit();
        _debit(amount);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert SendFailed();
    }

    function _clearPending() internal {
        pendingLimitAt = 0;
        pendingGuardiansAt = 0;
        delete _pendingGuardians;
    }

    function _isGuardian(address who) internal view returns (bool) {
        uint256 n = _guardians.length;
        for (uint256 i; i < n; i++) {
            if (_guardians[i] == who) return true;
        }
        return false;
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

    mapping(address => bool) public isPocket;

    event PocketDeployed(address indexed pocket, address indexed owner, bytes32 salt);

    error NoImplementation();
    error AlreadyDeployed();

    constructor(address implementation_) {
        if (implementation_.code.length == 0) revert NoImplementation();
        implementation = implementation_;
    }

    /// @notice The CREATE2 salt for a config.
    function saltOf(address owner, address[] calldata guardians, uint8 threshold, uint256 dailyLimit, bytes32 userSalt)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(owner, guardians, threshold, dailyLimit, userSalt));
    }

    /// @notice Address the Pocket for this config has (or will have).
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
///      Any balance the router holds (PocketDrop pays `relayerFee` to its caller, which is the router) is swept to
///      the caller of the router after each call, i.e. to the relayer.
contract PocketRouter {
    IPocketFactory public immutable factory;
    address public immutable drop;
    address public immutable pool;

    error NotAllowed(address target);
    error SweepFailed();

    event Relayed(address indexed target, bool lazyDeployed);

    constructor(IPocketFactory factory_, address drop_, address pool_) {
        factory = factory_;
        drop = drop_;
        pool = pool_;
    }

    receive() external payable {}

    /// @notice Whether `target` may be called through this router.
    function isAllowed(address target) public view returns (bool) {
        return target == drop || target == pool || factory.isPocket(target);
    }

    /// @notice Forward `data` to an allowed target. Reverts bubble up unchanged.
    function relay(address target, bytes calldata data) external returns (bytes memory ret) {
        if (!isAllowed(target)) revert NotAllowed(target);
        ret = _call(target, data);
        emit Relayed(target, false);
        _sweep();
    }

    /// @notice Deploy the Pocket for this config if needed (it must be the factory's CREATE2 address), then forward
    ///         `data` to it. Empty `data` only deploys.
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
        _sweep();
    }

    function _call(address target, bytes calldata data) internal returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }

    function _sweep() internal {
        uint256 bal = address(this).balance;
        if (bal == 0) return;
        (bool ok,) = msg.sender.call{value: bal}("");
        if (!ok) revert SweepFailed();
    }
}

// ===== src/PocketDrop.sol =====
/// @title PocketDrop (v4)
/// @notice Escrow that hands QOR to someone who has no wallet yet. The sender (a Pocket) creates a link whose
///         ML-DSA-87 key authorises binding a recipient; the recipient claims with a signature from the key registered
///         (with proof of possession) for their QoreChain account; the money lands in the recipient's POCKET
///         (`payTo`, a counterfactual address is fine).
/// @dev Same bind/confirm/claim semantics as v3 plus: all signatures use the QoreX-prefixed message
///      (`PqcLib.pqMessage`), the bind and claim digests commit to `payTo`, the claim signature is checked through
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

    string internal constant BIND_DOMAIN = "POCKETDROP_BIND_V2";
    string internal constant CLAIM_DOMAIN = "POCKETDROP_CLAIM_V2";

    uint256 public immutable MIN_ESCROW;
    uint256 public immutable MAX_AMOUNT;
    uint256 public immutable MAX_DRIP;
    uint256 public immutable DAILY_DRIP_CAP;
    uint256 public immutable BIND_TIMEOUT;
    uint256 public immutable MAX_EXPIRY;

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
    event LinkClaimed(uint256 indexed linkId, address indexed recipient, address payTo, uint256 amount, address relayer);
    event LinkCancelled(uint256 indexed linkId, address indexed sender, uint256 refunded);
    event LinkRefunded(uint256 indexed linkId, address indexed sender, uint256 refunded, address caller);
    event DripPaid(uint256 indexed linkId, address indexed recipient, uint256 drip, address indexed relayer, uint256 relayerFee);

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
                || dailyDripCap < maxDrip || bindTimeout == 0 || bindTimeout > type(uint32).max || maxExpiry == 0
                || maxExpiry > type(uint32).max
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

    /// @notice Bind a recipient account, its key and its payout Pocket to a link. Anyone may submit; the link key's
    ///         signature over the bind digest is the authority.
    function bind(
        uint256 linkId,
        address recipient,
        bytes32 recipientKeyHash,
        address payTo,
        bytes calldata linkPk,
        bytes calldata linkSig
    ) external nonReentrant {
        Link storage l = _existing(linkId);
        State s = l.state;
        if (s != State.Open && !(s == State.Bound && block.timestamp > l.bindDeadline)) revert InvalidState(s);
        if (block.timestamp >= l.expiry) revert Expired();
        if (recipient == address(0) || recipient == address(this) || payTo == address(0) || payTo == address(this)) {
            revert BadRecipient();
        }
        if (recipientKeyHash == bytes32(0)) revert ZeroRecipientKey();
        if (keccak256(linkPk) != l.linkKeyHash) revert LinkKeyMismatch();
        if (!PqcLib.verify(linkPk, linkSig, PqcLib.pqMessage(bindDigest(linkId, recipient, recipientKeyHash, payTo)))) {
            revert BadLinkSignature();
        }

        uint64 deadline = uint64(block.timestamp + BIND_TIMEOUT);
        l.state = State.Bound;
        l.recipient = recipient;
        l.payTo = payTo;
        l.recipientKeyHash = recipientKeyHash;
        l.bindDeadline = deadline;
        bool first = !l.dripPaid;
        uint256 drip = l.drip;
        uint256 fee = l.relayerFee;
        if (first) l.dripPaid = true;

        emit LinkBound(linkId, recipient, payTo, recipientKeyHash, deadline, !first, msg.sender);

        if (first) {
            emit DripPaid(linkId, recipient, drip, msg.sender, fee);
            _pay(recipient, drip);
            _pay(msg.sender, fee);
        }
    }

    /// @notice Sender confirms the bound recipient key (Confirmed mode). Called by the sender's Pocket.
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

    function getLink(uint256 linkId) external view returns (Link memory) {
        return _links[linkId];
    }

    /// @notice Digest the link key signs (as `PqcLib.pqMessage(digest)`) to bind a recipient.
    function bindDigest(uint256 linkId, address recipient, bytes32 recipientKeyHash, address payTo)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(BIND_DOMAIN, block.chainid, address(this), linkId, recipient, recipientKeyHash, payTo));
    }

    /// @notice Digest the recipient signs (as `PqcLib.pqMessage(digest)`) to claim.
    function claimDigest(uint256 linkId, address recipient, address payTo) public view returns (bytes32) {
        return keccak256(abi.encode(CLAIM_DOMAIN, block.chainid, address(this), linkId, recipient, payTo));
    }

    function unpaidOf(uint256 linkId) external view returns (uint256) {
        Link storage l = _links[linkId];
        return _isLive(l.state) ? _unpaid(l) : 0;
    }

    function dripUsedToday(address account) external view returns (uint256) {
        return _dripSpent[account][block.timestamp / 1 days];
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNALS
    //////////////////////////////////////////////////////////////*/

    function _validateCreate(uint64 expiry, uint96 drip, uint96 relayerFee) internal returns (uint256 amount) {
        uint256 extras = uint256(drip) + uint256(relayerFee);
        if (msg.value < extras) revert AmountOutOfRange(0);
        amount = msg.value - extras;
        if (amount < MIN_ESCROW || amount > MAX_AMOUNT) revert AmountOutOfRange(amount);
        if (drip > MAX_DRIP) revert DripTooHigh();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_EXPIRY) revert InvalidExpiry();

        uint256 day = block.timestamp / 1 days;
        uint256 used = _dripSpent[msg.sender][day] + drip;
        if (used > DAILY_DRIP_CAP) revert DailyDripCapExceeded();
        _dripSpent[msg.sender][day] = used;
    }

    function _existing(uint256 linkId) internal view returns (Link storage l) {
        l = _links[linkId];
        if (l.state == State.None) revert LinkNotFound();
    }

    function _isLive(State s) internal pure returns (bool) {
        return s == State.Open || s == State.Bound || s == State.Confirmed;
    }

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
        if (keccak256(linkPk) != p.linkKeyHash) revert LinkKeyMismatch();
        if (!PqcLib.verify(linkPk, linkSig, PqcLib.pqMessage(linkDigest(poolId, recipient, payTo)))) {
            revert BadLinkSignature();
        }
        bytes memory pk = PqcLib.requireKey(recipient, bytes32(0));
        if (!PqcLib.verify(pk, recipientSig, PqcLib.pqMessage(claimDigest(poolId, recipient, payTo)))) {
            revert BadRecipientSignature();
        }

        claimed[poolId][recipient] = true;
        uint32 taken = ++p.taken;
        uint256 amount = p.perSlot;
        emit PoolClaimed(poolId, recipient, payTo, taken, msg.sender);
        _pay(payTo, amount);
    }

    /// @notice Return the unclaimed slots to the host. The host may close any time; anyone may after expiry.
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

    function getPool(uint256 poolId) external view returns (Pool memory) {
        return _pools[poolId];
    }

    /// @notice Digest the pool's link key signs for a claim (as `PqcLib.pqMessage(digest)`).
    function linkDigest(uint256 poolId, address recipient, address payTo) public view returns (bytes32) {
        return keccak256(abi.encode(LINK_DOMAIN, block.chainid, address(this), poolId, recipient, payTo));
    }

    /// @notice Digest the recipient signs for a claim (as `PqcLib.pqMessage(digest)`).
    function claimDigest(uint256 poolId, address recipient, address payTo) public view returns (bytes32) {
        return keccak256(abi.encode(CLAIM_DOMAIN, block.chainid, address(this), poolId, recipient, payTo));
    }

    /// @notice Unclaimed escrow of an open pool.
    function unclaimedOf(uint256 poolId) external view returns (uint256) {
        Pool storage p = _pools[poolId];
        return p.closed ? 0 : uint256(p.slots - p.taken) * p.perSlot;
    }
}

