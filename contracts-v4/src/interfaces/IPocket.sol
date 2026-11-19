// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
