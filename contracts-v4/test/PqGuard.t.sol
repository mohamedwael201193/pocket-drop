// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4Base} from "./Base.t.sol";
import {PqGuard} from "../src/PqGuard.sol";
import {PqGuardedCounter} from "../src/examples/PqGuardedCounter.sol";
import {RawMock} from "./mocks/MockPqc.sol";
import {NoReceive} from "./mocks/Hostile.sol";

contract GuardHarness {
    function isApproved(address a, bytes32 d, bytes memory s) external view returns (bool) {
        return PqGuard.isPqApproved(a, d, s);
    }
}

contract PqGuardTest is V4Base {
    function test_pocket_and_plain_account_both_approve() public {
        address pa = address(pocketA());
        counter.bump(pa, V("ctrPA_0"));
        counter.bump(OA, V("ctrOA_0"));
        assertEq(counter.count(pa), 1);
        assertEq(counter.count(OA), 1);
        counter.bump(pa, V("ctrPA_1"));
        assertEq(counter.count(pa), 2);
    }

    function test_replay_and_cross_account_signatures_fail() public {
        address pa = address(pocketA());
        counter.bump(pa, V("ctrPA_0"));
        bytes memory again = V("ctrPA_0");
        vm.expectRevert(PqGuard.PqApprovalFailed.selector);
        counter.bump(pa, again);
        bytes memory forOa = V("ctrOA_0");
        vm.expectRevert(PqGuard.PqApprovalFailed.selector);
        counter.bump(pa, forOa); // the plain-account signature is for another digest
        bytes memory forPa = V("ctrPA_1");
        vm.expectRevert(PqGuard.PqApprovalFailed.selector);
        counter.bump(OA, forPa);
    }

    /// @dev v5.1 F2 regression: the v5 untagged plain-account approval is refused; only the tagged, account- and
    ///      chain-bound form passes.
    function test_v51_F2_untagged_plain_approval_refused() public {
        bytes memory old = V("ctrOAUntagged_0");
        vm.expectRevert(PqGuard.PqApprovalFailed.selector);
        counter.bump(OA, old);
        counter.bump(OA, V("ctrOA_0"));
        assertEq(counter.count(OA), 1);
    }

    function test_undeployed_pocket_and_non_pop_account_fail_closed() public {
        address pa = predict(cfgPA()); // counterfactual: no code, no registered key
        bytes memory s = V("ctrPA_0");
        vm.expectRevert(PqGuard.PqApprovalFailed.selector);
        counter.bump(pa, s);
        keys.set(OA, true, 1, _pk("OA"), false);
        bytes memory s2 = V("ctrOA_0");
        vm.expectRevert(PqGuard.PqApprovalFailed.selector);
        counter.bump(OA, s2);
    }

    function test_hostile_contract_accounts_are_false_not_reverts() public {
        GuardHarness g = new GuardHarness();
        bytes32 d = keccak256("d");
        assertFalse(g.isApproved(address(new NoReceive()), d, hex"00"), "no isValidSignature");
        address raw = makeAddr("raw");
        vm.etch(raw, address(new RawMock()).code);
        RawMock(raw).set(hex"01", false);
        assertFalse(g.isApproved(raw, d, hex"00"), "short return data");
        RawMock(raw).set(abi.encode(bytes4(0xdeadbeef)), false);
        assertFalse(g.isApproved(raw, d, hex"00"), "wrong magic");
        RawMock(raw).set(abi.encode(bytes4(0x1626ba7e)), false);
        assertTrue(g.isApproved(raw, d, hex"00"), "right magic");
        RawMock(raw).set("", true);
        assertFalse(g.isApproved(raw, d, hex"00"), "reverting");
    }

    function testFuzz_random_signature_never_approves(bytes memory sig) public {
        address pa = address(pocketA());
        vm.expectRevert(PqGuard.PqApprovalFailed.selector);
        counter.bump(pa, sig);
        vm.expectRevert(PqGuard.PqApprovalFailed.selector);
        counter.bump(OA, sig);
    }

    function test_bumpDigest_view() public view {
        assertEq(
            counter.bumpDigest(OA), keccak256(abi.encode("PQ_GUARDED_COUNTER_V1", block.chainid, COUNTER, OA, uint256(0)))
        );
    }
}
