// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4Base} from "./Base.t.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {PqcLib} from "../src/PqcLib.sol";

/// @notice Precompile hygiene and key-rule properties of a deployed Pocket, all with real ML-DSA-87 fixture signatures:
///         the owner key is re-read from pqcKeyStatus on EVERY intent (possession, algorithm, pinned hash), a missing
///         precompile fails closed, a new owner key must be possession-proven at proposal AND at finalization, and
///         expired or replayed intents never execute.
contract HardeningTest is V4Base {
    PocketVault internal v;

    function setUp() public override {
        super.setUp();
        v = pocketA();
    }

    function _two(address a, address b) internal pure returns (address[] memory s) {
        s = new address[](2);
        s[0] = a;
        s[1] = b;
    }

    function _three() internal pure returns (address[] memory s) {
        s = new address[](3);
        s[0] = G0;
        s[1] = G1;
        s[2] = G2;
    }

    function _b2(bytes memory a, bytes memory b) internal pure returns (bytes[] memory s) {
        s = new bytes[](2);
        s[0] = a;
        s[1] = b;
    }

    function _b3(bytes memory a, bytes memory b, bytes memory c_) internal pure returns (bytes[] memory s) {
        s = new bytes[](3);
        s[0] = a;
        s[1] = b;
        s[2] = c_;
    }

    function _hOB() internal view returns (bytes32) {
        return keccak256(_pk("OB"));
    }

    function _unan() internal {
        v.proposeRecoveryUnanimous(OB, _hOB(), DL, _three(), _b3(V("unan_G0_0"), V("unan_G1_0"), V("unan_G2_0")));
    }

    /*---------------- owner key re-read on every authorization ----------------*/

    function test_owner_key_status_is_re_read_on_every_intent() public {
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        assertEq(v.nonce(), 1);

        // possession proof withdrawn in the registry -> the very next intent is refused
        keys.set(OA, true, 1, _pk("OA"), false);
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_1"));

        // algorithm no longer ML-DSA-87 -> refused
        keys.set(OA, true, 2, _pk("OA"), true);
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_1"));

        // key unregistered -> refused
        keys.set(OA, false, 0, "", false);
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_1"));

        // registry rotated to another (proven) key -> refused: the Pocket pins the key hash from initialization
        keys.set(OA, true, 1, _pk("OB"), true);
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_1"));

        // restored -> the same signature now works; nothing was consumed by the refusals
        keys.set(OA, true, 1, _pk("OA"), true);
        assertEq(v.nonce(), 1);
        v.spend(SINK, 0.8 ether, DL, V("spendS_1"));
        assertEq(v.nonce(), 2);
        assertEq(SINK.balance, 1.6 ether);
    }

    function test_erc1271_applies_the_same_key_rules() public {
        bytes32 h = keccak256("erc1271 test");
        assertEq(v.isValidSignature(h, V("e1271_OA")), bytes4(0x1626ba7e));
        keys.set(OA, true, 1, _pk("OA"), false);
        assertEq(v.isValidSignature(h, V("e1271_OA")), bytes4(0xffffffff));
    }

    function test_missing_key_precompile_fails_closed() public {
        bytes memory code = KEYS_ADDR.code;
        vm.etch(KEYS_ADDR, "");
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        vm.etch(KEYS_ADDR, code); // storage kept: the registered keys come back
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        assertEq(v.nonce(), 1);
    }

    function test_missing_verify_precompile_fails_closed() public {
        bytes memory sig = V("spendS_0");
        vm.etch(VERIFY_ADDR, "");
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, sig);
        assertEq(v.nonce(), 0);
        assertEq(SINK.balance, 0);
    }

    /*---------------- a new owner key must prove possession ----------------*/

    function test_threshold_recovery_needs_a_proven_new_key_at_proposal_and_finalization() public {
        keys.set(OB, true, 1, _pk("OB"), false);
        vm.expectRevert(PqcLib.PossessionNotProven.selector);
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G1), _b2(V("rec_G0_0"), V("rec_G1_0")));

        keys.set(OB, true, 1, _pk("OB"), true);
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G1), _b2(V("rec_G0_0"), V("rec_G1_0")));
        keys.set(OB, true, 1, _pk("OB"), false); // proof withdrawn while pending
        vm.warp(block.timestamp + RECOVERY_DELAY);
        vm.expectRevert(PqcLib.PossessionNotProven.selector);
        v.finalizeRecovery(G0, DL, "");
        assertEq(v.owner(), OA);

        keys.set(OB, true, 1, _pk("OB"), true);
        v.finalizeRecovery(G0, DL, _finSig(v, false));
        assertEq(v.owner(), OB);
    }

    function test_unanimous_recovery_needs_a_proven_new_key_at_proposal_and_finalization() public {
        keys.set(OB, true, 1, _pk("OB"), false);
        vm.expectRevert(PqcLib.PossessionNotProven.selector);
        _unan();

        keys.set(OB, true, 1, _pk("OB"), true);
        _unan();
        keys.set(OB, true, 1, _pk("OA"), true); // registry now holds a different key for OB
        vm.warp(block.timestamp + UNANIMOUS_DELAY);
        vm.expectRevert(PqcLib.KeyMismatch.selector);
        v.finalizeRecoveryUnanimous(G0, DL, "");
        keys.set(OB, true, 1, _pk("OB"), false);
        vm.expectRevert(PqcLib.PossessionNotProven.selector);
        v.finalizeRecoveryUnanimous(G0, DL, "");
        assertEq(v.owner(), OA);

        keys.set(OB, true, 1, _pk("OB"), true);
        v.finalizeRecoveryUnanimous(G0, DL, _finSig(v, true));
        assertEq(v.owner(), OB);
        assertEq(v.ownerKeyHash(), _hOB());
    }

    /*---------------- expiry and replay ----------------*/

    function testFuzz_expired_intent_never_executes(uint256 dt) public {
        dt = bound(dt, 1, 3650 days);
        bytes memory sig = V("spendS_0");
        vm.warp(DL + dt);
        vm.expectRevert(PocketVault.Expired.selector);
        v.spend(SINK, 0.8 ether, DL, sig);
        assertEq(v.nonce(), 0);
        assertEq(address(v).balance, 100 ether);
    }

    function testFuzz_replayed_intent_never_executes(uint256 dt) public {
        bytes memory sig = V("spendS_0");
        v.spend(SINK, 0.8 ether, DL, sig);
        dt = bound(dt, 0, DL - block.timestamp);
        vm.warp(block.timestamp + dt); // any later time before the deadline, including a new UTC day
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, sig);
        assertEq(v.nonce(), 1);
        assertEq(SINK.balance, 0.8 ether);
    }
}
