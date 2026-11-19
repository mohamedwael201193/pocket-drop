// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PocketVault} from "./PocketVault.sol";

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
