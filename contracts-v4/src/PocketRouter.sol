// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPocketFactory} from "./interfaces/IPocket.sol";

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
