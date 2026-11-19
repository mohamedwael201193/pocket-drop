// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Payout
/// @notice Shared payout plumbing for PocketDrop and DropPool: a reentrancy lock, bounded-gas pushes that fall back to a
///         pull balance, and `withdraw`. A hostile receiver can never block a state transition.
abstract contract Payout {
    /// @dev Gas forwarded on direct payouts. Failure falls back to the pull balance.
    uint256 internal constant SEND_GAS = 100_000;

    error Reentrancy();
    error NothingToWithdraw();
    error WithdrawFailed();

    event PayoutDeferred(address indexed to, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    uint256 public totalPending;
    mapping(address => uint256) public pending;
    /// @dev 1 = unlocked, 2 = locked.
    uint256 private _lock = 1;

    modifier nonReentrant() {
        _enter();
        _;
        _lock = 1;
    }

    function _enter() private {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
    }

    /// @notice Pull a deferred payout.
    function withdraw() external nonReentrant {
        uint256 owed = pending[msg.sender];
        if (owed == 0) revert NothingToWithdraw();
        pending[msg.sender] = 0;
        totalPending -= owed;
        emit Withdrawn(msg.sender, owed);
        if (!_rawSend(msg.sender, owed, gasleft())) revert WithdrawFailed();
    }

    /// @dev Caller must have finished all state updates (CEI) and hold the lock.
    function _pay(address to, uint256 value) internal {
        if (value == 0) return;
        if (!_rawSend(to, value, SEND_GAS)) {
            pending[to] += value;
            totalPending += value;
            emit PayoutDeferred(to, value);
        }
    }

    /// @dev Value call that never copies return data (no return-bomb) and never reverts.
    function _rawSend(address to, uint256 value, uint256 gasLimit) internal returns (bool ok) {
        assembly ("memory-safe") {
            ok := call(gasLimit, to, value, 0, 0, 0, 0)
        }
    }
}
