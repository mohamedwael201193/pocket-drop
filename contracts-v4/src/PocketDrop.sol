// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PqcLib} from "./PqcLib.sol";
import {Payout} from "./Payout.sol";
import {IPocketDropSender} from "./interfaces/IPocket.sol";

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
