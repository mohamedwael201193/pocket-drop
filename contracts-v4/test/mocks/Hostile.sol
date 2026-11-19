// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice A payout receiver with configurable hostile behaviour. Etched at Pocket / recipient addresses in tests.
contract HostileReceiver {
    enum B {
        Accept,
        Revert,
        Burn,
        Reenter
    }

    B public behavior;
    address public target;
    bytes public data;
    /// @dev One packed slot (a single SSTORE) so the reentrancy probe fits in the 100k payout stipend even unoptimized.
    uint256 public result;

    function hits() external view returns (uint256) {
        return result >> 33;
    }

    function lastOk() external view returns (bool) {
        return (result >> 32) & 1 == 1;
    }

    function lastSel() external view returns (bytes4) {
        return bytes4(uint32(result));
    }

    function configure(B b, address target_, bytes calldata data_) external {
        behavior = b;
        target = target_;
        data = data_;
        result = 0;
    }

    function setBehavior(B b) external {
        behavior = b;
    }

    /// @dev Call anything as this contract (used to `withdraw`, `cancel`, ... from a contract caller).
    function exec(address to, bytes calldata d, uint256 value) external returns (bool ok, bytes memory ret) {
        (ok, ret) = to.call{value: value}(d);
    }

    receive() external payable {
        B b = behavior;
        if (b == B.Revert) revert("no thanks");
        if (b == B.Burn) {
            while (true) {}
        }
        if (b == B.Reenter) {
            (bool ok, bytes memory r) = target.call(data);
            result = (uint256(1) << 33) | (ok ? uint256(1) << 32 : 0) | (r.length >= 4 ? uint256(uint32(bytes4(r))) : 0);
        }
    }
}

/// @notice Contract that cannot receive ETH (no receive/fallback).
contract NoReceive {
    function ping() external pure returns (uint256) {
        return 1;
    }
}

import {PocketVault} from "../../src/PocketVault.sol";
import {PocketFactory} from "../../src/PocketFactory.sol";
import {PocketDrop} from "../../src/PocketDrop.sol";
import {DropPool} from "../../src/DropPool.sol";

/// @notice Wraps `new` in external calls so `vm.expectRevert` can observe constructor reverts without ending the test.
contract Maker {
    function vault(uint256 a, uint256 b) external returns (PocketVault) {
        return new PocketVault(a, b);
    }

    function factory(address i) external returns (PocketFactory) {
        return new PocketFactory(i);
    }

    function drop(uint256 a, uint256 b, uint256 c, uint256 d, uint256 e, uint256 f) external returns (PocketDrop) {
        return new PocketDrop(a, b, c, d, e, f);
    }

    function pool(uint256 a, uint256 b, uint256 c, uint256 d) external returns (DropPool) {
        return new DropPool(a, b, c, d);
    }
}
