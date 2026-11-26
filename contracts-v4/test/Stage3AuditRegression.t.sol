// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4Base} from "./Base.t.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {PocketDrop} from "../src/PocketDrop.sol";
import {PqcLib} from "../src/PqcLib.sol";

/// @notice Regression tests pinning every QCAI Stage 3 finding on PocketDrop v5 without altering deployed src/.
contract Stage3AuditRegressionTest is V4Base {
    function _pair(address a, address b) internal pure returns (address[] memory s) {
        s = new address[](2);
        s[0] = a;
        s[1] = b;
    }

    function _trio() internal pure returns (address[] memory s) {
        s = new address[](3);
        s[0] = G0;
        s[1] = G1;
        s[2] = G2;
    }

    function _sigs2(bytes memory a, bytes memory b) internal pure returns (bytes[] memory s) {
        s = new bytes[](2);
        s[0] = a;
        s[1] = b;
    }

    function _sigs3(bytes memory a, bytes memory b, bytes memory c_) internal pure returns (bytes[] memory s) {
        s = new bytes[](3);
        s[0] = a;
        s[1] = b;
        s[2] = c_;
    }

    /// @dev Stage 3 #1 (HIGH): Random caller cannot trigger unauthorized recovery via finalizeRecovery;
    ///      it reverts with NoRecoveryPending without an approved proposal, reverts TooEarly before delay,
    ///      and can only apply the guardian-signed owner/keyHash after delay.
    function test_stage3_random_caller_cannot_finalize_threshold_recovery_unauthorized() public {
        PocketVault v = pocketA();

        vm.prank(mallory);
        vm.expectRevert(PocketVault.NoRecoveryPending.selector);
        v.finalizeRecovery(G0, DL, "");

        v.proposeRecovery(OB, keccak256(_pk("OB")), DL, _pair(G0, G1), _sigs2(V("rec_G0_0"), V("rec_G1_0")));

        vm.prank(mallory);
        vm.expectRevert(PocketVault.TooEarly.selector);
        v.finalizeRecovery(G0, DL, "");

        vm.warp(block.timestamp + RECOVERY_DELAY);
        bytes memory fin1 = _finSig(v, false);
        vm.prank(mallory);
        v.finalizeRecovery(G0, DL, fin1);
        assertEq(v.owner(), OB);
        assertEq(v.ownerKeyHash(), keccak256(_pk("OB")));

        vm.prank(mallory);
        vm.expectRevert(PocketVault.NoRecoveryPending.selector);
        v.finalizeRecovery(G0, DL, "");
    }

    /// @dev Stage 3 #1 (HIGH): Same guarantee for finalizeRecoveryUnanimous.
    function test_stage3_random_caller_cannot_finalize_unanimous_recovery_unauthorized() public {
        PocketVault v = pocketA();

        vm.prank(mallory);
        vm.expectRevert(PocketVault.NoRecoveryPending.selector);
        v.finalizeRecoveryUnanimous(G0, DL, "");

        v.proposeRecoveryUnanimous(
            OB, keccak256(_pk("OB")), DL, _trio(), _sigs3(V("unan_G0_0"), V("unan_G1_0"), V("unan_G2_0"))
        );

        vm.prank(mallory);
        vm.expectRevert(PocketVault.TooEarly.selector);
        v.finalizeRecoveryUnanimous(G0, DL, "");

        vm.warp(block.timestamp + UNANIMOUS_DELAY);
        bytes memory fin2 = _finSig(v, true);
        vm.prank(mallory);
        v.finalizeRecoveryUnanimous(G0, DL, fin2);
        assertEq(v.owner(), OB);
        assertEq(v.ownerKeyHash(), keccak256(_pk("OB")));

        vm.prank(mallory);
        vm.expectRevert(PocketVault.NoRecoveryPending.selector);
        v.finalizeRecoveryUnanimous(G0, DL, "");
    }

    /// @dev Stage 3 #2 (MEDIUM): Daily drip calculation uses Solidity 0.8 checked math and caps MAX_DRIP / DAILY_DRIP_CAP;
    ///      even at maximum uint96 constructor bounds, adding drips never wraps around and reverts DailyDripCapExceeded.
    function test_stage3_daily_drip_checked_math_cannot_overflow_at_max_bounds() public {
        uint96 max96 = type(uint96).max;
        PocketDrop extremeDrop = new PocketDrop(1, max96, max96, max96, BIND_TIMEOUT, 30 days);
        uint96 halfPlusOne = uint96(uint256(max96) / 2 + 1);
        bytes32 lk = keccak256("lk");
        uint64 exp = uint64(block.timestamp + 1 days);

        vm.deal(r(0), uint256(max96) * 2 + 10);
        vm.startPrank(r(0));
        extremeDrop.create{value: uint256(halfPlusOne) + 1}(lk, 0, exp, halfPlusOne, 0);
        assertEq(extremeDrop.dripUsedToday(r(0)), halfPlusOne);

        vm.expectRevert(PocketDrop.DailyDripCapExceeded.selector);
        extremeDrop.create{value: uint256(halfPlusOne) + 1}(lk, 0, exp, halfPlusOne, 0);
        vm.stopPrank();
    }

    /// @dev Stage 3 #3 (MEDIUM): EVM executes sequentially and guardianFreeze checks nonce_ == freezeNonce and !frozen();
    ///      a second freeze attempt in the same block fails with BadNonce (same nonce) or AlreadyFrozen (next nonce).
    function test_stage3_guardian_freeze_rejects_concurrent_or_second_freeze_same_block() public {
        PocketVault v = pocketA();

        v.guardianFreeze(_pair(G0, G1), _sigs2(V("frz_G0_0"), V("frz_G1_0")), 0, DL);
        assertTrue(v.frozen());
        assertEq(v.freezeNonce(), 1);

        vm.expectRevert(PocketVault.BadNonce.selector);
        v.guardianFreeze(_pair(G0, G1), _sigs2(V("frz_G0_0"), V("frz_G1_0")), 0, DL);

        vm.expectRevert(PocketVault.AlreadyFrozen.selector);
        v.guardianFreeze(_pair(G0, G1), _sigs2(V("frz_G0_1"), V("frz_G1_1")), 1, DL);
    }

    /// @dev Stage 3 #4 (LOW): Guardians are capped at MAX_GUARDIANS = 5, so _checkGuardianSigs loops are strictly bounded;
    ///      passing 6 signers always reverts (v5.1: up front, `len > MAX_GUARDIANS`).
    function test_stage3_six_signers_always_revert_in_checkGuardianSigs() public {
        address g4 = r(0);
        address[] memory g5 = new address[](5);
        g5[0] = G0;
        g5[1] = G1;
        g5[2] = G2;
        g5[3] = G3;
        g5[4] = g4;

        PocketVault v5 = deployPocket(Cfg({owner: OA, guardians: g5, threshold: 2, limit: 2 ether, salt: bytes32(uint256(99))}));
        assertEq(v5.guardians().length, 5);

        bytes memory msgBytes = PqcLib.pqMessage(v5.freezeDigest(0, DL));
        bytes memory dummySig = new bytes(PqcLib.ML_DSA_87_SIG_LEN);
        string[5] memory keyNames = ["G0", "G1", "G2", "G3", "R0"];
        for (uint256 i; i < 5; i++) {
            verifier.accept(keccak256(abi.encode(_pk(keyNames[i]), dummySig, msgBytes)));
        }

        address[] memory sixWithNonGuardian = new address[](6);
        bytes[] memory sixSigs = new bytes[](6);
        for (uint256 i; i < 5; i++) {
            sixWithNonGuardian[i] = g5[i];
            sixSigs[i] = dummySig;
        }
        sixWithNonGuardian[5] = mallory;
        sixSigs[5] = dummySig;

        vm.expectRevert(PocketVault.NotGuardian.selector);
        v5.guardianFreeze(sixWithNonGuardian, sixSigs, 0, DL);

        address[] memory sixWithDuplicate = new address[](6);
        for (uint256 i; i < 5; i++) {
            sixWithDuplicate[i] = g5[i];
        }
        sixWithDuplicate[5] = G0;

        // v5.1 (Stage 4 cleanup): more than MAX_GUARDIANS signers fails fast with NotGuardian, before any check
        vm.expectRevert(PocketVault.NotGuardian.selector);
        v5.guardianFreeze(sixWithDuplicate, sixSigs, 0, DL);
    }
}
