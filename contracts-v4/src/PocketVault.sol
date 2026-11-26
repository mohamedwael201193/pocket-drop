// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PqcLib} from "./PqcLib.sol";
import {IERC1271, IPocketDropSender, IDropPoolHost} from "./interfaces/IPocket.sol";

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
        _authorizeFinalize(
            ACT_FINALIZE_RECOVERY, recoveryOwner, recoveryKeyHash, authorizer, deadline, sig, true
        );
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
    ) external returns (uint256 linkId) {
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
    ) external {
        _requireTarget(drop);
        _auth(ACT_CONFIRM_DROP, abi.encode(drop, linkId, expectedRecipientKeyHash), deadline, sig);
        IPocketDropSender(drop).confirmRecipient(linkId, expectedRecipientKeyHash);
        emit DropConfirmed(drop, linkId);
    }

    /// @notice Sender intent: cancel a drop; the escrow returns to this Pocket.
    /// @param drop PocketDrop instance.
    /// @param linkId Link id.
    /// @param deadline Intent deadline.
    /// @param sig Owner intent signature.
    function cancelDrop(address drop, uint256 linkId, uint256 deadline, bytes calldata sig) external {
        _requireTarget(drop);
        _auth(ACT_CANCEL_DROP, abi.encode(drop, linkId), deadline, sig);
        IPocketDropSender(drop).cancel(linkId);
        emit DropCancelled(drop, linkId);
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
    ) external returns (uint256 poolId) {
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
    function closePool(address pool, uint256 poolId, uint256 deadline, bytes calldata sig) external {
        _requireTarget(pool);
        _auth(ACT_CLOSE_POOL, abi.encode(pool, poolId), deadline, sig);
        IDropPoolHost(pool).close(poolId);
        emit PoolClosed(pool, poolId);
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
        bool ok;
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

    /// @dev Every signer must be a distinct configured guardian with a valid ML-DSA signature over `message`.
    ///      Gas bound: at most `MAX_GUARDIANS` (5) signers are accepted (more reverts before any work), the guardian set
    ///      itself is capped at `MAX_GUARDIANS` by `_validateGuardians`, and duplicates are detected with a bitmap of
    ///      guardian indexes, so the work is at most 5 index lookups of at most 5 steps plus 5 precompile calls.
    function _checkGuardianSigs(address[] calldata signers, bytes[] calldata sigs, bytes memory message) internal view {
        uint256 len = signers.length;
        if (len > MAX_GUARDIANS) revert NotGuardian();
        if (len != sigs.length) revert NotEnoughSigners();
        uint256 seen;
        for (uint256 i; i < len; ++i) {
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
        for (uint256 i; i < n && i < MAX_GUARDIANS; ++i) {
            if (_guardians[i] == who) return true;
        }
        return false;
    }

    /// @dev Index of `who` in the guardian set (at most MAX_GUARDIANS steps); reverts `NotGuardian` if absent.
    function _guardianIndex(address who) internal view returns (uint256) {
        uint256 n = _guardians.length;
        for (uint256 i; i < n && i < MAX_GUARDIANS; ++i) {
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
