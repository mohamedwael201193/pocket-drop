// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPocketDrop} from "../../src/interfaces/IPocketDrop.sol";

/// @notice A recipient/sender contract with configurable hostile behaviour on receiving ETH.
/// @dev Etched at fixture recipient addresses (see Base.t.sol) so the pre-signed bind/claim fixtures still match.
contract HostileActor {
    enum Behavior {
        Accept, // plain receive
        Revert, // revert on receive
        BurnGas, // loop forever
        Reenter // try to re-enter PocketDrop and record the result
    }

    IPocketDrop public pd;
    Behavior public behavior;
    uint256 public reenterAction;
    uint256 public reenterLinkId;
    bytes4 public lastReenterSelector;
    uint256 public reenterAttempts;
    uint256 public received;

    function configure(IPocketDrop _pd, Behavior b, uint256 action, uint256 linkId) external {
        pd = _pd;
        behavior = b;
        reenterAction = action;
        reenterLinkId = linkId;
        reenterAttempts = 0;
        received = 0;
        lastReenterSelector = bytes4(0);
    }

    function setBehavior(Behavior b) external {
        behavior = b;
    }

    receive() external payable {
        Behavior b = behavior;
        if (b == Behavior.Revert) revert("no thanks");
        if (b == Behavior.BurnGas) {
            while (true) {}
        }
        received += msg.value;
        if (b == Behavior.Reenter) {
            reenterAttempts++;
            uint256 a = reenterAction;
            uint256 id = reenterLinkId;
            bytes memory empty;
            if (a == 0) {
                try pd.withdraw() {} catch (bytes memory r) {
                    lastReenterSelector = bytes4(r);
                }
            } else if (a == 1) {
                try pd.cancel(id) {} catch (bytes memory r) {
                    lastReenterSelector = bytes4(r);
                }
            } else if (a == 2) {
                try pd.claim(id, empty) {} catch (bytes memory r) {
                    lastReenterSelector = bytes4(r);
                }
            } else if (a == 3) {
                try pd.refund(id) {} catch (bytes memory r) {
                    lastReenterSelector = bytes4(r);
                }
            } else if (a == 4) {
                try pd.confirm(id) {} catch (bytes memory r) {
                    lastReenterSelector = bytes4(r);
                }
            } else if (a == 5) {
                try pd.bind(id, address(this), bytes32(uint256(1)), empty, empty) {} catch (bytes memory r) {
                    lastReenterSelector = bytes4(r);
                }
            } else {
                try pd.create{value: 0}(bytes32(uint256(1)), 0, 0, 0, 0) {} catch (bytes memory r) {
                    lastReenterSelector = bytes4(r);
                }
            }
        }
    }

    function doCreate(bytes32 keyHash, uint8 mode, uint64 expiry, uint96 drip, uint96 fee) external payable returns (uint256) {
        return pd.create{value: msg.value}(keyHash, mode, expiry, drip, fee);
    }

    function doCancel(uint256 id) external {
        pd.cancel(id);
    }

    function doRefund(uint256 id) external {
        pd.refund(id);
    }

    function doWithdraw() external {
        pd.withdraw();
    }
}
