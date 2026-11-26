// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Payout
/// @notice Shared payout plumbing for PocketDrop and DropPool: a reentrancy lock, bounded-gas pushes that fall back to a
///         pull balance, and `withdraw`. A hostile receiver can never block a state transition.
/// @dev Reentrancy model (v5.2, explicit):
///      - every external function of PocketDrop and DropPool that can move value carries `nonReentrant`;
///      - `_pay` can only run while that lock is held (`PayoutOutsideLock` otherwise), so no payout path exists
///        outside the guard;
///      - callers finish all state changes before `_pay` (checks-effects-interactions);
///      - `withdraw` zeroes the balance before its value call;
///      - a re-entrant call from a receiver hits the lock and reverts `Reentrancy`.
abstract contract Payout {
    /// @dev Gas forwarded on direct payouts. Failure falls back to the pull balance.
    uint256 internal constant SEND_GAS = 100_000;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    error Reentrancy();
    error PayoutOutsideLock();
    error NothingToWithdraw();
    error WithdrawFailed();

    /// @notice A direct payout succeeded.
    event PayoutSent(address indexed to, uint256 amount);
    /// @notice A direct payout failed and the amount was credited to the receiver's pull balance.
    event PayoutDeferred(address indexed to, uint256 amount);
    /// @notice A pull balance was withdrawn.
    event Withdrawn(address indexed account, uint256 amount);

    /// @notice Sum of all pull balances.
    uint256 public totalPending;
    /// @notice Pull balance of each account.
    mapping(address => uint256) public pending;
    uint256 private _lock = _NOT_ENTERED;

    /// @dev Standard lock: reverts `Reentrancy` if already entered; released on exit.
    modifier nonReentrant() {
        if (_lock != _NOT_ENTERED) revert Reentrancy();
        _lock = _ENTERED;
        _;
        _lock = _NOT_ENTERED;
    }

    /// @notice Pull a deferred payout. Checks-effects-interactions: the balance is zeroed before the value call, and the
    ///         lock is held for the whole call.
    function withdraw() external nonReentrant {
        uint256 owed = pending[msg.sender];
        if (owed == 0) revert NothingToWithdraw();
        pending[msg.sender] = 0;
        totalPending -= owed;
        emit Withdrawn(msg.sender, owed);
        if (!_rawSend(msg.sender, owed, gasleft())) revert WithdrawFailed();
    }

    /// @dev Push `value` to `to` with at most SEND_GAS gas; on failure credit the pull balance. Must run under the lock
    ///      (`nonReentrant` caller) and after the caller's state changes. `to` is never zero: every caller validates it.
    function _pay(address to, uint256 value) internal {
        if (_lock != _ENTERED) revert PayoutOutsideLock();
        if (value == 0) return;
        if (_rawSend(to, value, SEND_GAS)) {
            emit PayoutSent(to, value);
        } else {
            pending[to] += value;
            totalPending += value;
            emit PayoutDeferred(to, value);
        }
    }

    /// @dev Value call that never copies return data (no return-bomb) and never reverts.
    function _rawSend(address to, uint256 value, uint256 gasLimit) private returns (bool ok) {
        assembly ("memory-safe") {
            ok := call(gasLimit, to, value, 0, 0, 0, 0)
        }
    }
}
