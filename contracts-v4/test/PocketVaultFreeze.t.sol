// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4Base} from "./Base.t.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {PqcLib} from "../src/PqcLib.sol";

/// @notice Guardian freeze + unanimous recovery (the stolen-key defence). All signatures are real ML-DSA-87 fixtures.
contract PocketVaultFreezeTest is V4Base {
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

    function _n(uint256 i) internal pure returns (string memory) {
        return i == 0 ? "0" : i == 1 ? "1" : i == 2 ? "2" : i == 3 ? "3" : "4";
    }

    function _freeze(uint256 n) internal {
        v.guardianFreeze(
            _two(G0, G1), _b2(V(string.concat("frz_G0_", _n(n))), V(string.concat("frz_G1_", _n(n)))), n, DL
        );
    }

    function _unan(uint256 rn) internal {
        v.proposeRecoveryUnanimous(
            OB,
            _hOB(),
            DL,
            _three(),
            _b3(
                V(string.concat("unan_G0_", _n(rn))),
                V(string.concat("unan_G1_", _n(rn))),
                V(string.concat("unan_G2_", _n(rn)))
            )
        );
    }

    /*====================== guardian freeze ======================*/

    function test_freeze_happy_path_and_auto_expiry() public {
        assertFalse(v.frozen());
        vm.expectEmit(false, false, false, true);
        emit PocketVault.GuardianFrozen(uint64(block.timestamp + FREEZE_PERIOD), 0, 1);
        _freeze(0);
        assertTrue(v.frozen());
        assertEq(v.frozenUntil(), block.timestamp + FREEZE_PERIOD);
        assertEq(v.freezeNonce(), 1);
        assertEq(v.freezeStreak(), 1);
        vm.warp(block.timestamp + FREEZE_PERIOD - 1);
        assertTrue(v.frozen());
        vm.warp(block.timestamp + 1);
        assertFalse(v.frozen(), "ends by itself");
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        assertEq(SINK.balance, 0.8 ether);
    }

    function test_frozen_blocks_spend_queue_execute_applies_creates_and_raises() public {
        // state the thief prepared BEFORE the freeze
        v.spend(SINK, 5 ether, DL, V("spendB_0")); // queued id 1
        v.setLimit(9 ether, DL, V("limHigh_1")); // pending raise
        v.setGuardians(_two(G0, G1), 2, DL, V("gSet_2")); // pending guardian swap
        vm.warp(block.timestamp + TIMELOCK); // everything is ripe
        _freeze(0);
        vm.expectRevert(PocketVault.Frozen.selector);
        v.spend(SINK, 0.1 ether, DL, V("spendS_3")); // within the allowance
        vm.expectRevert(PocketVault.Frozen.selector);
        v.spend(SINK, 5 ether, DL, V("spendB_3")); // would queue
        vm.expectRevert(PocketVault.Frozen.selector);
        v.executeQueued(1);
        vm.expectRevert(PocketVault.Frozen.selector);
        v.applyLimit();
        vm.expectRevert(PocketVault.Frozen.selector);
        v.applyGuardians();
        vm.expectRevert(PocketVault.Frozen.selector);
        v.setLimit(9 ether, DL, V("limHigh_3")); // new raise
        vm.expectRevert(PocketVault.Frozen.selector);
        v.setGuardians(_two(G0, G1), 2, DL, V("gSet_3"));
        vm.expectRevert(PocketVault.Frozen.selector);
        v.createDrop(DROP, keccak256(_pk("LK1")), 0, uint64(EXP), 0.2 ether, 0.05 ether, 1.25 ether, DL, D("cdConf_1_3"));
        vm.expectRevert(PocketVault.Frozen.selector);
        v.createPool(POOL, keccak256(_pk("PK")), 3, 0.3 ether, uint64(EXP), DL, D("cp_3"));
        assertEq(v.nonce(), 3, "no nonce consumed by the blocked intents");
        assertEq(SINK.balance, 0);
        // the freeze ends by itself; the thief's ripe queue is then executable again unless a recovery killed it
        vm.warp(block.timestamp + FREEZE_PERIOD);
        v.executeQueued(1);
        assertEq(SINK.balance, 5 ether);
    }

    function test_defensive_actions_still_work_while_frozen() public {
        v.createDrop(DROP, keccak256(_pk("LK1")), 0, uint64(EXP), 0.2 ether, 0.05 ether, 1.25 ether, DL, D("cdConf_1_0"));
        v.spend(SINK, 5 ether, DL, V("spendB_1")); // queued id 1
        v.setLimit(9 ether, DL, V("limHigh_2"));
        _freeze(0);
        v.cancelPending(DL, V("cancelPending_3"));
        v.vetoQueued(1, DL, V("vetoQ1_4"));
        v.cancelDrop(DROP, 1, DL, D("cn_1_5")); // escrow returns to the Pocket
        assertEq(v.nonce(), 6);
        assertEq(v.pendingLimitAt(), 0);
        assertTrue(v.frozen());
    }

    function test_lowering_the_limit_is_allowed_while_frozen() public {
        _freeze(0);
        v.setLimit(1 ether, DL, V("limLow_0"));
        assertEq(v.dailyLimit(), 1 ether);
        vm.expectRevert(PocketVault.Frozen.selector);
        v.setLimit(9 ether, DL, V("limHigh_1"));
    }

    function test_freeze_bad_inputs() public {
        // no guardians at all
        PocketVault pb = deployPocket(cfgPB());
        vm.expectRevert(PocketVault.NoGuardians.selector);
        pb.guardianFreeze(new address[](0), new bytes[](0), 0, DL);
        // expired
        bytes memory g0 = V("frz_G0_0");
        bytes memory g1 = V("frz_G1_0");
        vm.warp(DL + 1);
        vm.expectRevert(PocketVault.Expired.selector);
        v.guardianFreeze(_two(G0, G1), _b2(g0, g1), 0, DL);
        vm.warp(1_800_000_000);
        // wrong nonce
        vm.expectRevert(PocketVault.BadNonce.selector);
        v.guardianFreeze(_two(G0, G1), _b2(g0, g1), 1, DL);
        // one signer of a 2-of-3
        address[] memory one = new address[](1);
        one[0] = G0;
        bytes[] memory oneS = new bytes[](1);
        oneS[0] = g0;
        vm.expectRevert(PocketVault.NotEnoughSigners.selector);
        v.guardianFreeze(one, oneS, 0, DL);
        // length mismatch
        vm.expectRevert(PocketVault.NotEnoughSigners.selector);
        v.guardianFreeze(_three(), _b2(g0, g1), 0, DL);
        // non-guardian (G3) and duplicate
        vm.expectRevert(PocketVault.NotGuardian.selector);
        v.guardianFreeze(_two(G0, G3), _b2(g0, V("frz_G3_0")), 0, DL);
        vm.expectRevert(PocketVault.DuplicateSigner.selector);
        v.guardianFreeze(_two(G0, G0), _b2(g0, g0), 0, DL);
        // the owner key is not a guardian, and a signature for another vault or nonce is no signature
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.guardianFreeze(_two(G0, G1), _b2(g0, V("frzPA2_G1_0")), 0, DL);
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.guardianFreeze(_two(G0, G1), _b2(g0, V("frz_G1_1")), 0, DL);
        assertFalse(v.frozen());
        assertEq(v.freezeNonce(), 0);
    }

    function test_freeze_signatures_cannot_be_replayed_and_cannot_stack_while_frozen() public {
        bytes memory g0 = V("frz_G0_0");
        bytes memory g1 = V("frz_G1_0");
        v.guardianFreeze(_two(G0, G1), _b2(g0, g1), 0, DL);
        vm.expectRevert(PocketVault.BadNonce.selector);
        v.guardianFreeze(_two(G0, G1), _b2(g0, g1), 0, DL); // replay
        vm.expectRevert(PocketVault.AlreadyFrozen.selector);
        _freeze(1); // cannot extend a running freeze
        assertEq(v.frozenUntil(), block.timestamp + FREEZE_PERIOD);
    }

    function test_owner_key_cannot_lift_a_freeze() public {
        _freeze(0);
        // every owner path that moves value stays closed with the genuine owner signature
        vm.expectRevert(PocketVault.Frozen.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        vm.expectRevert(PocketVault.NoRecoveryPending.selector);
        v.vetoRecovery(DL, V("vetoRec_0")); // nothing to veto and nothing else unfreezes
        assertTrue(v.frozen());
    }

    function test_freeze_streak_caps_back_to_back_renewals() public {
        _freeze(0);
        vm.warp(block.timestamp + FREEZE_PERIOD);
        vm.warp(block.timestamp + 1 hours); // gap shorter than the cooldown
        _freeze(1);
        assertEq(v.freezeStreak(), 2);
        vm.warp(block.timestamp + FREEZE_PERIOD);
        // a third in a row by the same guardian set is refused
        bytes memory g0 = V("frz_G0_2");
        bytes memory g1 = V("frz_G1_2");
        vm.expectRevert(PocketVault.FreezeCapped.selector);
        v.guardianFreeze(_two(G0, G1), _b2(g0, g1), 2, DL);
        // so the owner gets a window: total denial of service was ~2 periods
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        // after a long quiet time the same guardians can freeze again
        vm.warp(block.timestamp + 4 * FREEZE_PERIOD);
        v.guardianFreeze(_two(G0, G1), _b2(g0, g1), 2, DL);
        assertEq(v.freezeStreak(), 1);
    }

    function test_guardian_set_change_resets_the_streak() public {
        _freeze(0);
        vm.warp(block.timestamp + FREEZE_PERIOD);
        _freeze(1);
        vm.warp(block.timestamp + FREEZE_PERIOD);
        assertEq(v.freezeStreak(), 2);
        v.setGuardians(_two(G0, G1), 2, DL, V("gSet_0"));
        vm.warp(block.timestamp + TIMELOCK);
        v.applyGuardians();
        assertEq(v.freezeStreak(), 0);
        _freeze(2);
        assertEq(v.freezeStreak(), 1);
    }

    /*====================== unanimous recovery ======================*/

    function test_unanimous_recovery_old_key_cannot_veto() public {
        vm.expectEmit(true, false, false, true);
        emit PocketVault.UnanimousRecoveryProposed(OB, _hOB(), uint64(block.timestamp + UNANIMOUS_DELAY), 0);
        _unan(0);
        assertEq(v.uRecoveryOwner(), OB);
        assertEq(v.uRecoveryAt(), block.timestamp + UNANIMOUS_DELAY);
        assertEq(v.recoveryNonce(), 1);
        assertTrue(v.frozen(), "pending unanimous recovery freezes the Pocket");
        // the (stolen) old key tries everything
        vm.expectRevert(PocketVault.NoRecoveryPending.selector);
        v.vetoRecovery(DL, V("vetoRec_0"));
        vm.expectRevert(PocketVault.Frozen.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        vm.expectRevert(PocketVault.TooEarly.selector);
        v.finalizeRecoveryUnanimous(G0, DL, "");
        vm.expectRevert(PocketVault.NoRecoveryPending.selector);
        v.finalizeRecovery(G0, DL, ""); // the threshold path has nothing pending
        vm.warp(block.timestamp + UNANIMOUS_DELAY);
        v.finalizeRecoveryUnanimous(G0, DL, _finSig(v, true));
        assertEq(v.owner(), OB);
        assertEq(v.ownerKeyHash(), _hOB());
        assertEq(v.epoch(), 1);
        assertEq(v.uRecoveryAt(), 0);
        assertFalse(v.frozen());
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_0")); // the thief's key is dead
        v.spend(SINK, 0.8 ether, DL, V("spendS_OB_0")); // the new owner spends
        assertEq(SINK.balance, 0.8 ether);
    }

    function test_stolen_key_scenario_end_to_end() public {
        v.spend(SINK, 0.8 ether, DL, V("spendS_0")); // the thief drains up to the limit first (residual risk)
        v.spend(SINK, 5 ether, DL, V("spendB_1")); // and queues a bigger spend
        _freeze(0);
        vm.expectRevert(PocketVault.Frozen.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_2"));
        _unan(0);
        vm.expectRevert(PocketVault.NoRecoveryPending.selector);
        v.vetoRecovery(DL, V("vetoRec_2"));
        vm.warp(block.timestamp + UNANIMOUS_DELAY); // the freeze has also ended by now
        assertTrue(v.frozen(), "still held by the pending recovery, not by the clock");
        v.finalizeRecoveryUnanimous(G0, DL, _finSig(v, true));
        vm.expectRevert(PocketVault.StaleEpoch.selector);
        v.executeQueued(1); // the thief's queue is dead
        v.spend(SINK, 0.8 ether, DL, V("spendS_OB_2"));
        assertEq(SINK.balance, 1.6 ether);
    }

    function test_unanimous_bad_inputs() public {
        bytes memory u0 = V("unan_G0_0");
        bytes memory u1 = V("unan_G1_0");
        bytes memory u2 = V("unan_G2_0");
        // threshold of signers is not enough
        vm.expectRevert(PocketVault.NotEnoughSigners.selector);
        v.proposeRecoveryUnanimous(OB, _hOB(), DL, _two(G0, G1), _b2(u0, u1));
        // length mismatch
        vm.expectRevert(PocketVault.NotEnoughSigners.selector);
        v.proposeRecoveryUnanimous(OB, _hOB(), DL, _three(), _b2(u0, u1));
        // a non-guardian in place of one
        address[] memory s = _three();
        s[2] = G3;
        vm.expectRevert(PocketVault.NotGuardian.selector);
        v.proposeRecoveryUnanimous(OB, _hOB(), DL, s, _b3(u0, u1, V("unan_G3_0")));
        // duplicate in place of one
        s[2] = G0;
        vm.expectRevert(PocketVault.DuplicateSigner.selector);
        v.proposeRecoveryUnanimous(OB, _hOB(), DL, s, _b3(u0, u1, u0));
        // threshold-recovery signatures do not authorise a unanimous recovery (own action tag)
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.proposeRecoveryUnanimous(OB, _hOB(), DL, _three(), _b3(u0, u1, V("rec_G2_0")));
        // other vault, bad key hash, bad owner params
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.proposeRecoveryUnanimous(OB, _hOB(), DL, _three(), _b3(u0, u1, V("unanPA2_G2_0")));
        bytes32 bad = 0xbabababababababababababababababababababababababababababababababa;
        vm.expectRevert(PqcLib.KeyMismatch.selector);
        v.proposeRecoveryUnanimous(
            OB, bad, DL, _three(), _b3(V("unanBadHash_G0_0"), V("unanBadHash_G1_0"), V("unanBadHash_G2_0"))
        );
        vm.expectRevert(PocketVault.BadParams.selector);
        v.proposeRecoveryUnanimous(G0, _hOB(), DL, _three(), _b3(u0, u1, u2));
        // expired
        vm.warp(DL + 1);
        vm.expectRevert(PocketVault.Expired.selector);
        v.proposeRecoveryUnanimous(OB, _hOB(), DL, _three(), _b3(u0, u1, u2));
        vm.warp(1_800_000_000);
        // no guardians: no recovery of either kind
        PocketVault pb = deployPocket(cfgPB());
        vm.expectRevert(PocketVault.NoGuardians.selector);
        pb.proposeRecoveryUnanimous(OB, _hOB(), DL, new address[](0), new bytes[](0));
        assertEq(v.uRecoveryAt(), 0);
        assertEq(v.recoveryNonce(), 0);
    }

    function test_unanimous_needs_all_guardians_after_a_set_change() public {
        v.setGuardians(_two(G0, G1), 2, DL, V("gSet_0"));
        vm.warp(block.timestamp + TIMELOCK);
        v.applyGuardians();
        // the set is now {G0, G1}: both must sign, two is "all"
        v.proposeRecoveryUnanimous(OB, _hOB(), DL, _two(G0, G1), _b2(V("unan_G0_0"), V("unan_G1_0")));
        assertGt(v.uRecoveryAt(), 0);
    }

    function test_unanimous_overrides_a_pending_threshold_recovery() public {
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G1), _b2(V("rec_G0_0"), V("rec_G1_0")));
        assertGt(v.recoveryAt(), 0);
        _unan(1); // recovery nonce moved on to 1
        assertEq(v.recoveryAt(), 0, "threshold proposal dropped");
        assertGt(v.uRecoveryAt(), 0);
        vm.warp(block.timestamp + RECOVERY_DELAY);
        vm.expectRevert(PocketVault.NoRecoveryPending.selector);
        v.finalizeRecovery(G0, DL, "");
        // and no threshold proposal while the unanimous one is pending
        vm.expectRevert(PocketVault.RecoveryPending.selector);
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G1), _b2(V("rec_G0_1"), V("rec_G1_1")));
    }

    function test_threshold_recovery_stays_vetoable_by_the_owner() public {
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G1), _b2(V("rec_G0_0"), V("rec_G1_0")));
        v.vetoRecovery(DL, V("vetoRec_0"));
        assertEq(v.recoveryAt(), 0);
        assertFalse(v.frozen());
    }

    function test_unanimous_can_be_replaced_and_fails_closed_if_key_disappears() public {
        _unan(0);
        keys.set(OB, false, 0, "", false);
        vm.warp(block.timestamp + UNANIMOUS_DELAY);
        vm.expectRevert(PqcLib.NotRegistered.selector);
        v.finalizeRecoveryUnanimous(G0, DL, "");
        assertEq(v.owner(), OA);
        assertTrue(v.frozen());
        // the guardians repair it with a fresh unanimous proposal (restarts the delay)
        keys.set(OB, true, 1, _pk("OB"), true);
        _unan(1);
        assertEq(v.uRecoveryAt(), block.timestamp + UNANIMOUS_DELAY);
        vm.warp(block.timestamp + UNANIMOUS_DELAY);
        v.finalizeRecoveryUnanimous(G0, DL, _finSig(v, true));
        assertEq(v.owner(), OB);
    }

    function test_unanimous_finalize_kills_queue_and_pending_changes() public {
        v.spend(SINK, 5 ether, DL, V("spendB_0"));
        v.setLimit(9 ether, DL, V("limHigh_1"));
        v.setGuardians(_two(G0, G1), 2, DL, V("gSet_2"));
        _unan(0);
        vm.warp(block.timestamp + UNANIMOUS_DELAY);
        v.finalizeRecoveryUnanimous(G0, DL, _finSig(v, true));
        vm.expectRevert(PocketVault.StaleEpoch.selector);
        v.executeQueued(1);
        assertEq(v.pendingLimitAt(), 0);
        assertEq(v.pendingGuardiansAt(), 0);
    }

    function test_freeze_cannot_be_started_while_unanimous_pending_and_threshold_pending_does_not_block() public {
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G1), _b2(V("rec_G0_0"), V("rec_G1_0")));
        _freeze(0); // a threshold recovery pending does not stop a freeze
        assertTrue(v.frozen());
        vm.warp(block.timestamp + FREEZE_PERIOD);
        v.vetoRecovery(DL, V("vetoRec_0"));
        _unan(1);
        vm.warp(block.timestamp + 1);
        vm.expectRevert(PocketVault.AlreadyFrozen.selector);
        _freeze(1);
    }

    function test_freeze_and_unanimous_digests_match_independent_encoding() public {
        // the fixtures were signed over the JS (viem) digests; a signature only verifies if the contract's digest agrees
        _freeze(0);
        assertTrue(v.frozenUntil() > 0);
        assertEq(v.ACT_FREEZE(), keccak256("POCKET_GUARDIAN_FREEZE_V1"));
        assertEq(v.ACT_RECOVER_UNANIMOUS(), keccak256("POCKET_RECOVER_UNANIMOUS_V1"));
        assertEq(v.freezeDigest(0, DL), keccak256(abi.encode(v.ACT_FREEZE(), uint256(9800), address(v), uint256(0), DL)));
        assertEq(
            v.unanimousDigest(OB, _hOB(), DL),
            keccak256(abi.encode(v.ACT_RECOVER_UNANIMOUS(), uint256(9800), address(v), uint256(0), DL, OB, _hOB()))
        );
    }
}
