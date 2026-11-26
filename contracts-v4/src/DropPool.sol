// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PqcLib} from "./PqcLib.sol";
import {Payout} from "./Payout.sol";
import {IDropPoolHost} from "./interfaces/IPocket.sol";

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
