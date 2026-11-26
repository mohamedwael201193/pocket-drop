// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
    function create(bytes32 linkKeyHash, uint32 slots, uint96 perSlot, uint64 expiry)
        external
        payable
        returns (uint256);

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
