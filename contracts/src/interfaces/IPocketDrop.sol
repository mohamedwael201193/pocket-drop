// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPocketDrop
/// @notice Interface of Pocket Drop: send QOR to a friend who has no wallet. The friend opens a link,
///         creates a quantum-safe (ML-DSA-87) QoreChain account, and the escrowed money lands in it.
/// @dev No owner, no admin, no upgradeability. Testnet (QoreChain Diana, EVM chain id 9800) only.
interface IPocketDrop {
    /*//////////////////////////////////////////////////////////////
                                 TYPES
    //////////////////////////////////////////////////////////////*/

    /// @notice Claim mode of a link.
    /// @dev Confirmed: the sender must confirm the recipient's key fingerprint before the claim works.
    ///      Open: the recipient may claim as soon as the link is bound (until `bindDeadline`).
    enum Mode {
        Confirmed,
        Open
    }

    /// @notice Lifecycle state of a link. `Claimed`, `Cancelled` and `Refunded` are terminal.
    enum State {
        None,
        Open,
        Bound,
        Confirmed,
        Claimed,
        Cancelled,
        Refunded
    }

    /// @notice Full record of a link.
    /// @dev Packed into 5 storage slots. `amount`, `drip` and `relayerFee` are in wei.
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
        bytes32 linkKeyHash;
        bytes32 recipientKeyHash;
    }

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice A link was created and funded.
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

    /// @notice A recipient was bound to a link (`rebind` is true when it replaced a timed-out binding).
    event LinkBound(
        uint256 indexed linkId,
        address indexed recipient,
        bytes32 recipientKeyHash,
        uint64 bindDeadline,
        bool rebind,
        address relayer
    );

    /// @notice The sender confirmed the bound recipient (Confirmed mode only).
    event LinkConfirmed(uint256 indexed linkId, address indexed recipient, bytes32 recipientKeyHash);

    /// @notice The recipient received the escrowed amount.
    event LinkClaimed(uint256 indexed linkId, address indexed recipient, uint256 amount, address relayer);

    /// @notice The sender cancelled the link and was refunded `refunded` wei.
    event LinkCancelled(uint256 indexed linkId, address indexed sender, uint256 refunded);

    /// @notice The link expired unclaimed and `refunded` wei went back to the sender.
    event LinkRefunded(uint256 indexed linkId, address indexed sender, uint256 refunded, address caller);

    /// @notice The drip and relayer fee were paid out at the first bind.
    event DripPaid(uint256 indexed linkId, address indexed recipient, uint256 drip, address indexed relayer, uint256 relayerFee);

    /// @notice A payout could not be sent and was credited to the pull balance of `account`.
    event PayoutDeferred(address indexed account, uint256 amount);

    /// @notice A pull balance was withdrawn.
    event Withdrawn(address indexed account, uint256 amount);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @notice Constructor constants are inconsistent.
    error InvalidConfig();
    /// @notice `mode` is not 0 (Confirmed) or 1 (Open).
    error InvalidMode();
    /// @notice The escrow amount (msg.value - drip - relayerFee) is outside [MIN_ESCROW, MAX_AMOUNT].
    error AmountOutOfRange(uint256 amount);
    /// @notice `drip` exceeds MAX_DRIP.
    error DripTooHigh();
    /// @notice The sender's daily drip cap would be exceeded.
    error DailyDripCapExceeded();
    /// @notice `expiry` is not in the future or is beyond now + MAX_EXPIRY.
    error InvalidExpiry();
    /// @notice `linkKeyHash` is zero.
    error ZeroLinkKey();
    /// @notice No link with this id exists.
    error LinkNotFound();
    /// @notice Caller is not the link's sender.
    error NotSender();
    /// @notice The action is not allowed in the link's current state.
    error InvalidState(State current);
    /// @notice The action is not available in the link's mode.
    error WrongMode();
    /// @notice The link has expired.
    error Expired();
    /// @notice The link has not expired yet.
    error NotExpired();
    /// @notice The bind deadline has passed.
    error BindDeadlinePassed();
    /// @notice The recipient address is zero or this contract.
    error BadRecipient();
    /// @notice The recipient key hash is zero.
    error ZeroRecipientKey();
    /// @notice `keccak256(linkPk)` does not equal the link key hash.
    error LinkKeyMismatch();
    /// @notice The link key's ML-DSA-87 signature over the bind digest is invalid.
    error BadLinkSignature();
    /// @notice The key-status precompile failed or returned data that could not be decoded safely.
    error KeyStatusUnavailable();
    /// @notice The recipient has no registered PQC key.
    error NotRegistered();
    /// @notice The recipient's key is not ML-DSA-87.
    error UnsupportedAlgo();
    /// @notice The recipient's key has no proof of possession on chain.
    error PossessionNotProven();
    /// @notice The recipient's registered key does not hash to the bound `recipientKeyHash`.
    error RecipientKeyMismatch();
    /// @notice The recipient's ML-DSA-87 signature over the claim digest is invalid.
    error BadRecipientSignature();
    /// @notice The bound recipient key changed since the sender looked.
    error RecipientChanged();
    /// @notice Nothing to withdraw.
    error NothingToWithdraw();
    /// @notice The withdrawal transfer failed.
    error WithdrawFailed();
    /// @notice Reentrant call.
    error Reentrancy();

    /*//////////////////////////////////////////////////////////////
                               FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Create and fund a link.
    /// @dev `msg.value = amount + drip + relayerFee` where `amount` is derived as the remainder.
    ///      The sender's daily drip allowance (UTC day) is debited here and never credited back.
    /// @param linkKeyHash keccak256 of the link's ML-DSA-87 public key (the key whose signature authorises `bind`).
    /// @param mode 0 = Confirmed, 1 = Open.
    /// @param expiry Unix time after which anyone can refund the sender; must be in the future and <= now + MAX_EXPIRY.
    /// @param drip Wei paid to the recipient at the first bind so a fresh account can pay for its first transactions.
    /// @param relayerFee Wei paid to whoever submits the first bind.
    /// @return linkId Incrementing id starting at 1.
    function create(bytes32 linkKeyHash, uint8 mode, uint64 expiry, uint96 drip, uint96 relayerFee)
        external
        payable
        returns (uint256 linkId);

    /// @notice Bind a recipient account and key to a link. Callable by anyone (the relayer).
    /// @dev The link key must have signed `bindDigest(linkId, recipient, recipientKeyHash)`. Allowed when the link
    ///      is `Open`, or `Bound` after `bindDeadline` (rebind). Never once `Confirmed`. Not allowed after expiry.
    ///      The first bind pays the drip to the recipient and the relayer fee to the caller.
    /// @param linkId Link to bind.
    /// @param recipient Account that will receive the escrow.
    /// @param recipientKeyHash keccak256 of the recipient's ML-DSA-87 public key.
    /// @param linkPk The link's ML-DSA-87 public key (must hash to the link key hash).
    /// @param linkSig ML-DSA-87 signature by the link key over `bindDigest(...)`.
    function bind(
        uint256 linkId,
        address recipient,
        bytes32 recipientKeyHash,
        bytes calldata linkPk,
        bytes calldata linkSig
    ) external;

    /// @notice Sender confirms the bound recipient (Confirmed mode only).
    /// @dev Only before `bindDeadline`, so a stale binding cannot be confirmed after it became re-bindable.
    /// @param linkId Link to confirm.
    function confirm(uint256 linkId) external;

    /// @notice Like `confirm`, but reverts if the bound recipient key is not the one the sender checked.
    /// @param linkId Link to confirm.
    /// @param expectedRecipientKeyHash The recipient key hash the sender verified off-chain.
    function confirmRecipient(uint256 linkId, bytes32 expectedRecipientKeyHash) external;

    /// @notice Pay the escrowed amount to the bound recipient. Callable by anyone (the relayer).
    /// @dev Requires state `Confirmed` (Confirmed mode) or `Bound` within `bindDeadline` (Open mode), not expired,
    ///      the recipient's key registered as ML-DSA-87 with proof of possession and matching `recipientKeyHash`,
    ///      and a valid recipient signature over `claimDigest(linkId, recipient)`.
    /// @param linkId Link to claim.
    /// @param recipientSig ML-DSA-87 signature by the recipient key over the claim digest.
    function claim(uint256 linkId, bytes calldata recipientSig) external;

    /// @notice Sender cancels a link that has not been claimed and gets back the amount plus any unpaid drip and fee.
    /// @dev Allowed in `Open`, or in `Bound` in Confirmed mode (before confirm).
    /// @param linkId Link to cancel.
    function cancel(uint256 linkId) external;

    /// @notice Anyone returns an expired, unclaimed link's unpaid funds to its sender.
    /// @param linkId Link to refund.
    function refund(uint256 linkId) external;

    /// @notice Withdraw the caller's pull balance (payouts whose direct transfer failed).
    function withdraw() external;

    /// @notice Read a link.
    /// @param linkId Link id.
    /// @return The link record; `state == None` if it does not exist.
    function getLink(uint256 linkId) external view returns (Link memory);

    /// @notice The exact bytes the link key must sign for `bind`.
    /// @param linkId Link id.
    /// @param recipient Recipient account.
    /// @param recipientKeyHash keccak256 of the recipient's ML-DSA-87 public key.
    /// @return abi.encode("POCKETDROP_BIND_V1", chainid, this, linkId, recipient, recipientKeyHash)
    function bindDigest(uint256 linkId, address recipient, bytes32 recipientKeyHash)
        external
        view
        returns (bytes memory);

    /// @notice The exact bytes the recipient key must sign for `claim`.
    /// @param linkId Link id.
    /// @param recipient Recipient account.
    /// @return abi.encode("POCKETDROP_CLAIM_V1", chainid, this, linkId, recipient)
    function claimDigest(uint256 linkId, address recipient) external view returns (bytes memory);

    /// @notice Wei still held in escrow for a link (0 for terminal or unknown links).
    /// @param linkId Link id.
    /// @return Amount plus any not-yet-paid drip and relayer fee.
    function unpaidOf(uint256 linkId) external view returns (uint256);

    /// @notice Number of links created so far (the latest link id).
    /// @return The highest link id.
    function linkCount() external view returns (uint256);

    /// @notice Pull balance of an account.
    /// @param account Account to query.
    /// @return Wei withdrawable via `withdraw`.
    function pending(address account) external view returns (uint256);

    /// @notice Sum of all pull balances.
    /// @return Wei owed through `withdraw`.
    function totalPending() external view returns (uint256);

    /// @notice Drip already debited for `account` on the current UTC day.
    /// @param account Sender to query.
    /// @return Wei of drip used today.
    function dripUsedToday(address account) external view returns (uint256);

    /// @notice Minimum escrow amount per link (wei).
    /// @return Wei.
    function MIN_ESCROW() external view returns (uint256);

    /// @notice Maximum escrow amount per link (wei).
    /// @return Wei.
    function MAX_AMOUNT() external view returns (uint256);

    /// @notice Maximum drip per link (wei).
    /// @return Wei.
    function MAX_DRIP() external view returns (uint256);

    /// @notice Maximum drip a sender may debit per UTC day (wei).
    /// @return Wei.
    function DAILY_DRIP_CAP() external view returns (uint256);

    /// @notice Seconds a binding stays exclusive before it can be replaced.
    /// @return Seconds.
    function BIND_TIMEOUT() external view returns (uint256);

    /// @notice Maximum seconds between `create` and `expiry`.
    /// @return Seconds.
    function MAX_EXPIRY() external view returns (uint256);
}
