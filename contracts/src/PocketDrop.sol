// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPocketDrop} from "./interfaces/IPocketDrop.sol";
import {PqcLib} from "./PqcLib.sol";

/// @title PocketDrop
/// @notice Escrow that lets a sender hand QOR to someone who has no wallet yet. The sender creates a link whose
///         ML-DSA-87 key authorises binding a recipient; the recipient then claims with a signature from the
///         ML-DSA-87 key registered (with proof of possession) for their QoreChain account.
/// @dev No owner, no admin, no upgradeability, no external dependencies. All value movement follows
///      checks-effects-interactions behind a reentrancy lock. Direct sends use a bounded gas stipend and fall back
///      to pull balances (`withdraw`) when they fail, so a hostile receiver can never block a state transition.
///
///      Invariants (see SECURITY.md):
///      1. balance >= sum(unpaid escrow of non-terminal links) + sum(pull balances)
///      2. a link pays its amount at most once
///      3. the amount goes only to the recipient bound at claim time
///      4. refunds and cancels go only to the sender
///      5. no amount payout to an account whose key is not registered, proven and equal to `recipientKeyHash`
contract PocketDrop is IPocketDrop {
    /*//////////////////////////////////////////////////////////////
                               CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @dev Domain tag signed by the link key in `bind`.
    string internal constant BIND_DOMAIN = "POCKETDROP_BIND_V1";
    /// @dev Domain tag signed by the recipient key in `claim`.
    string internal constant CLAIM_DOMAIN = "POCKETDROP_CLAIM_V1";
    /// @dev Gas forwarded on direct payouts. Failure falls back to the pull balance.
    uint256 internal constant SEND_GAS = 100_000;

    /// @inheritdoc IPocketDrop
    uint256 public immutable override MIN_ESCROW;
    /// @inheritdoc IPocketDrop
    uint256 public immutable override MAX_AMOUNT;
    /// @inheritdoc IPocketDrop
    uint256 public immutable override MAX_DRIP;
    /// @inheritdoc IPocketDrop
    uint256 public immutable override DAILY_DRIP_CAP;
    /// @inheritdoc IPocketDrop
    uint256 public immutable override BIND_TIMEOUT;
    /// @inheritdoc IPocketDrop
    uint256 public immutable override MAX_EXPIRY;

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IPocketDrop
    uint256 public override linkCount;
    /// @inheritdoc IPocketDrop
    uint256 public override totalPending;
    /// @inheritdoc IPocketDrop
    mapping(address => uint256) public override pending;

    mapping(uint256 => Link) internal _links;
    /// @dev sender => UTC day number => drip debited that day.
    mapping(address => mapping(uint256 => uint256)) internal _dripSpent;
    /// @dev 1 = unlocked, 2 = locked.
    uint256 private _lock;

    /*//////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @notice Deploy with immutable limits (all amounts in wei, all times in seconds).
    /// @param minEscrow Minimum escrow amount per link; must be > 0.
    /// @param maxAmount Maximum escrow amount per link; must be >= minEscrow.
    /// @param maxDrip Maximum drip per link.
    /// @param dailyDripCap Maximum drip per sender per UTC day; must be >= maxDrip.
    /// @param bindTimeout Seconds a binding stays exclusive; must be > 0.
    /// @param maxExpiry Maximum seconds from create to expiry; must be > 0.
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
        _lock = 1;
    }

    /*//////////////////////////////////////////////////////////////
                             STATE CHANGES
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IPocketDrop
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

    /// @inheritdoc IPocketDrop
    function bind(
        uint256 linkId,
        address recipient,
        bytes32 recipientKeyHash,
        bytes calldata linkPk,
        bytes calldata linkSig
    ) external override nonReentrant {
        Link storage l = _existing(linkId);
        State s = l.state;
        if (s != State.Open && !(s == State.Bound && block.timestamp > l.bindDeadline)) revert InvalidState(s);
        if (block.timestamp >= l.expiry) revert Expired();
        if (recipient == address(0) || recipient == address(this)) revert BadRecipient();
        if (recipientKeyHash == bytes32(0)) revert ZeroRecipientKey();
        if (keccak256(linkPk) != l.linkKeyHash) revert LinkKeyMismatch();
        if (!PqcLib.verify(linkPk, linkSig, _bindDigest(linkId, recipient, recipientKeyHash))) {
            revert BadLinkSignature();
        }

        uint64 deadline = uint64(block.timestamp + BIND_TIMEOUT);
        l.state = State.Bound;
        l.recipient = recipient;
        l.recipientKeyHash = recipientKeyHash;
        l.bindDeadline = deadline;
        bool first = !l.dripPaid;
        uint256 drip = l.drip;
        uint256 fee = l.relayerFee;
        if (first) l.dripPaid = true;

        emit LinkBound(linkId, recipient, recipientKeyHash, deadline, !first, msg.sender);

        if (first) {
            emit DripPaid(linkId, recipient, drip, msg.sender, fee);
            _pay(recipient, drip);
            _pay(msg.sender, fee);
        }
    }

    /// @inheritdoc IPocketDrop
    function confirm(uint256 linkId) external override nonReentrant {
        _confirm(linkId);
    }

    /// @inheritdoc IPocketDrop
    function confirmRecipient(uint256 linkId, bytes32 expectedRecipientKeyHash) external override nonReentrant {
        if (_existing(linkId).recipientKeyHash != expectedRecipientKeyHash) revert RecipientChanged();
        _confirm(linkId);
    }

    /// @inheritdoc IPocketDrop
    function claim(uint256 linkId, bytes calldata recipientSig) external override nonReentrant {
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
        PqcLib.KeyStatus memory ks = PqcLib.keyStatus(recipient);
        if (!ks.ok) revert KeyStatusUnavailable();
        if (!ks.registered) revert NotRegistered();
        if (ks.algoId != PqcLib.ALGO_ML_DSA_87) revert UnsupportedAlgo();
        if (!ks.possessionProven) revert PossessionNotProven();
        if (keccak256(ks.pubkey) != l.recipientKeyHash) revert RecipientKeyMismatch();
        if (!PqcLib.verify(ks.pubkey, recipientSig, _claimDigest(linkId, recipient))) revert BadRecipientSignature();

        uint256 amount = l.amount;
        l.state = State.Claimed;
        emit LinkClaimed(linkId, recipient, amount, msg.sender);
        _pay(recipient, amount);
    }

    /// @inheritdoc IPocketDrop
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

    /// @inheritdoc IPocketDrop
    function refund(uint256 linkId) external override nonReentrant {
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

    /// @inheritdoc IPocketDrop
    function withdraw() external override nonReentrant {
        uint256 owed = pending[msg.sender];
        if (owed == 0) revert NothingToWithdraw();
        pending[msg.sender] = 0;
        totalPending -= owed;
        emit Withdrawn(msg.sender, owed);
        if (!_rawSend(msg.sender, owed, gasleft())) revert WithdrawFailed();
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IPocketDrop
    function getLink(uint256 linkId) external view override returns (Link memory) {
        return _links[linkId];
    }

    /// @inheritdoc IPocketDrop
    function bindDigest(uint256 linkId, address recipient, bytes32 recipientKeyHash)
        external
        view
        override
        returns (bytes memory)
    {
        return _bindDigest(linkId, recipient, recipientKeyHash);
    }

    /// @inheritdoc IPocketDrop
    function claimDigest(uint256 linkId, address recipient) external view override returns (bytes memory) {
        return _claimDigest(linkId, recipient);
    }

    /// @inheritdoc IPocketDrop
    function unpaidOf(uint256 linkId) external view override returns (uint256) {
        Link storage l = _links[linkId];
        return _isLive(l.state) ? _unpaid(l) : 0;
    }

    /// @inheritdoc IPocketDrop
    function dripUsedToday(address account) external view override returns (uint256) {
        return _dripSpent[account][block.timestamp / 1 days];
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNALS
    //////////////////////////////////////////////////////////////*/

    /// @dev Validates the value split, expiry and daily drip allowance; debits the allowance; returns the escrow amount.
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

    function _confirm(uint256 linkId) internal {
        Link storage l = _existing(linkId);
        if (msg.sender != l.sender) revert NotSender();
        if (l.mode != Mode.Confirmed) revert WrongMode();
        State s = l.state;
        if (s != State.Bound) revert InvalidState(s);
        if (block.timestamp >= l.expiry) revert Expired();
        if (block.timestamp > l.bindDeadline) revert BindDeadlinePassed();
        l.state = State.Confirmed;
        emit LinkConfirmed(linkId, l.recipient, l.recipientKeyHash);
    }

    function _isLive(State s) internal pure returns (bool) {
        return s == State.Open || s == State.Bound || s == State.Confirmed;
    }

    /// @dev Amount plus drip and fee that have not been paid out yet. Only meaningful for live links.
    function _unpaid(Link storage l) internal view returns (uint256) {
        return l.dripPaid ? uint256(l.amount) : uint256(l.amount) + uint256(l.drip) + uint256(l.relayerFee);
    }

    function _bindDigest(uint256 linkId, address recipient, bytes32 recipientKeyHash)
        internal
        view
        returns (bytes memory)
    {
        return abi.encode(BIND_DOMAIN, block.chainid, address(this), linkId, recipient, recipientKeyHash);
    }

    function _claimDigest(uint256 linkId, address recipient) internal view returns (bytes memory) {
        return abi.encode(CLAIM_DOMAIN, block.chainid, address(this), linkId, recipient);
    }

    /// @dev Pay `to` with a bounded-gas call; on failure credit the pull balance. Caller must have finished all
    ///      state updates (CEI) and hold the reentrancy lock.
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
