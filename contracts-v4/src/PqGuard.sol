// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PqcLib} from "./PqcLib.sol";
import {IERC1271} from "./interfaces/IPocket.sol";

/// @title PqGuard
/// @notice Drop-in post-quantum approval check for any dApp. `account` may be a Pocket (ERC-1271 contract) or a plain
///         PoP-proven ML-DSA-87 account.
/// @dev Your `digest` must already bind your contract address, chain id, the action, its parameters and a nonce or
///      deadline. PqGuard only answers "did this account's ML-DSA key approve exactly this digest".
///      v5.1 (F2): the approval is domain-separated from every Pocket intent.
///      - Pocket: checked through `isValidSignature(digest, sig)`, which verifies the owner key over
///        `pqMessage(TAG_ERC1271, erc1271Digest(digest))` (bound to that Pocket and the chain id).
///      - Plain account: verified over `pqMessage(TAG_PQGUARD, approvalDigest(account, digest))` (bound to the account
///        and the chain id).
///      Neither form can ever be accepted as an owner intent, a guardian approval, a bind or a claim.
library PqGuard {
    /// @dev ERC-1271 magic value.
    bytes4 internal constant MAGIC = 0x1626ba7e;
    /// @dev Domain of a plain-account approval.
    bytes32 internal constant PQGUARD_DOMAIN = keccak256("PQGUARD_APPROVAL_V1");

    error PqApprovalFailed();

    /// @notice The digest a plain account signs (as `PqcLib.pqMessage(PqcLib.TAG_PQGUARD, ...)`) to approve `digest`.
    /// @param account The approving account.
    /// @param digest The dApp's digest.
    /// @return The account- and chain-bound approval digest.
    function approvalDigest(address account, bytes32 digest) internal view returns (bytes32) {
        return keccak256(abi.encode(PQGUARD_DOMAIN, block.chainid, account, digest));
    }

    /// @notice True when `account` approved `digest` with `sig`.
    /// @param account A Pocket (ERC-1271) or a plain account with a registered, proven ML-DSA-87 key.
    /// @param digest The dApp's digest.
    /// @param sig ML-DSA-87 signature (see the contract notes for the exact message).
    /// @return True only for a valid approval; hostile or failing contracts give false, never a revert.
    function isPqApproved(address account, bytes32 digest, bytes memory sig) internal view returns (bool) {
        if (account.code.length > 0) {
            (bool ok, bytes memory ret) = account.staticcall(abi.encodeCall(IERC1271.isValidSignature, (digest, sig)));
            if (!ok || ret.length != 32) return false;
            return abi.decode(ret, (bytes4)) == MAGIC;
        }
        return PqcLib.verifyFor(account, PqcLib.pqMessage(PqcLib.TAG_PQGUARD, approvalDigest(account, digest)), sig);
    }

    /// @notice Revert unless `account` approved `digest`.
    /// @param account A Pocket or a plain PoP-proven account.
    /// @param digest The dApp's digest.
    /// @param sig ML-DSA-87 signature.
    function requirePqApproval(address account, bytes32 digest, bytes memory sig) internal view {
        if (!isPqApproved(account, digest, sig)) revert PqApprovalFailed();
    }
}
