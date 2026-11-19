// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PqcLib} from "./PqcLib.sol";
import {IERC1271} from "./interfaces/IPocket.sol";

/// @title PqGuard
/// @notice Drop-in post-quantum approval check for any dApp. `account` may be a Pocket (ERC-1271 contract) or a plain
///         PoP-proven ML-DSA-87 account. The approved bytes are `"qorechain-msg-v1|" + chainId + "|" + hex(digest)`.
/// @dev Your `digest` must already bind your contract address, chain id, the action, its parameters and a nonce or
///      deadline. PqGuard only answers "did this account's ML-DSA key approve exactly this digest".
library PqGuard {
    /// @dev ERC-1271 magic value.
    bytes4 internal constant MAGIC = 0x1626ba7e;

    error PqApprovalFailed();

    /// @notice True when `account` approved `digest` with `sig`.
    function isPqApproved(address account, bytes32 digest, bytes memory sig) internal view returns (bool) {
        if (account.code.length > 0) {
            (bool ok, bytes memory ret) = account.staticcall(abi.encodeCall(IERC1271.isValidSignature, (digest, sig)));
            if (!ok || ret.length != 32) return false;
            return abi.decode(ret, (bytes4)) == MAGIC;
        }
        return PqcLib.verifyFor(account, PqcLib.pqMessage(digest), sig);
    }

    /// @notice Revert unless `account` approved `digest`.
    function requirePqApproval(address account, bytes32 digest, bytes memory sig) internal view {
        if (!isPqApproved(account, digest, sig)) revert PqApprovalFailed();
    }
}
