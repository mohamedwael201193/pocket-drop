// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPocketFactory} from "./interfaces/IPocket.sol";

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
