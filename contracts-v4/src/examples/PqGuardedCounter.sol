// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PqGuard} from "../PqGuard.sol";

/// @title PqGuardedCounter
/// @notice Example consumer of PqGuard: anyone may submit, but `bump(account)` only counts if `account` (a Pocket or a
///         PoP-proven ML-DSA account) signed the exact digest. Replay is blocked by the per-account counter.
contract PqGuardedCounter {
    string internal constant DOMAIN = "PQ_GUARDED_COUNTER_V1";

    /// @notice Bumps counted per account (also the replay nonce).
    mapping(address => uint256) public count;

    event Bumped(address indexed account, uint256 newCount);

    /// @notice The digest `account` must approve for its next bump.
    /// @param account The approving account.
    /// @return The digest (bound to this contract, the chain, the account and its counter).
    function bumpDigest(address account) public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN, block.chainid, address(this), account, count[account]));
    }

    /// @notice Count one bump for `account` if it approved `bumpDigest(account)`.
    /// @param account A Pocket or a plain PoP-proven account.
    /// @param sig The account's PqGuard approval.
    function bump(address account, bytes calldata sig) external {
        PqGuard.requirePqApproval(account, bumpDigest(account), sig);
        uint256 n = ++count[account];
        emit Bumped(account, n);
    }
}
