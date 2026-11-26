// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4Base} from "./Base.t.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {PqcLib} from "../src/PqcLib.sol";
import {NoReceive} from "./mocks/Hostile.sol";

contract PocketVaultTest is V4Base {
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

    function _bytes2(bytes memory a, bytes memory b) internal pure returns (bytes[] memory s) {
        s = new bytes[](2);
        s[0] = a;
        s[1] = b;
    }

    function _hOB() internal view returns (bytes32) {
        return keccak256(_pk("OB"));
    }

    function _propose0() internal {
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G1), _bytes2(V("rec_G0_0"), V("rec_G1_0")));
    }

    /*====================== spend / daily limit ======================*/

    function test_spend_within_limit_pays_now() public {
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        assertEq(SINK.balance, 0.8 ether);
        assertEq(v.nonce(), 1);
        assertEq(v.spentToday(), 0.8 ether);
        assertEq(v.allowanceLeft(), 1.2 ether);
    }

    function test_spend_above_remaining_allowance_queues_with_timelock() public {
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        v.spend(SINK, 0.8 ether, DL, V("spendS_1"));
        uint256 id = v.spend(SINK, 0.8 ether, DL, V("spendS_2")); // only 0.4 left today
        assertEq(id, 1);
        assertEq(SINK.balance, 1.6 ether, "third spend is NOT paid");
        PocketVault.Queued memory q = v.getQueued(1);
        assertEq(q.to, SINK);
        assertEq(q.amount, 0.8 ether);
        assertEq(q.unlockAt, block.timestamp + TIMELOCK);
        assertEq(uint8(q.state), uint8(PocketVault.QState.Pending));
        assertEq(v.queueCount(), 1);
    }

    function test_allowance_resets_next_utc_day() public {
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        v.spend(SINK, 0.8 ether, DL, V("spendS_1"));
        vm.warp(block.timestamp + 1 days);
        assertEq(v.allowanceLeft(), 2 ether);
        assertEq(v.spend(SINK, 0.8 ether, DL, V("spendS_2")), 0);
        assertEq(v.spentToday(), 0.8 ether);
    }

    function test_big_spend_executes_only_after_timelock_and_once() public {
        assertEq(v.spend(SINK, 5 ether, DL, V("spendB_0")), 1);
        vm.expectRevert(PocketVault.TooEarly.selector);
        v.executeQueued(1);
        vm.warp(block.timestamp + TIMELOCK);
        v.executeQueued(1);
        assertEq(SINK.balance, 5 ether);
        vm.expectRevert(PocketVault.NotQueued.selector);
        v.executeQueued(1);
        vm.expectRevert(PocketVault.NotQueued.selector);
        v.executeQueued(77);
    }

    function test_owner_vetoes_queued_spend() public {
        v.spend(SINK, 5 ether, DL, V("spendB_0"));
        v.vetoQueued(1, DL, V("vetoQ1_1"));
        assertEq(uint8(v.getQueued(1).state), uint8(PocketVault.QState.Vetoed));
        vm.warp(block.timestamp + TIMELOCK);
        vm.expectRevert(PocketVault.NotQueued.selector);
        v.executeQueued(1);
        vm.expectRevert(PocketVault.NotQueued.selector);
        v.vetoQueued(1, DL, V("vetoQ1_2")); // already vetoed
        assertEq(SINK.balance, 0);
    }

    function test_veto_unknown_id_reverts() public {
        vm.expectRevert(PocketVault.NotQueued.selector);
        v.vetoQueued(99, DL, V("vetoQ99_0"));
    }

    function test_spend_bad_params() public {
        vm.expectRevert(PocketVault.BadParams.selector);
        v.spend(address(0), 0.1 ether, DL, V("spendZero_0"));
        vm.expectRevert(PocketVault.BadParams.selector);
        v.spend(SINK, 0, DL, V("spendAmt0_0"));
    }

    function test_spend_to_self_and_send_failure() public {
        v.spend(address(v), 0.1 ether, DL, V("spendToPA_0"));
        assertEq(address(v).balance, 100 ether);
        // a recipient that cannot receive QOR makes the spend revert (nonce NOT consumed)
        vm.etch(SINK, address(new NoReceive()).code);
        vm.expectRevert(PocketVault.SendFailed.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_1"));
        assertEq(v.nonce(), 1);
        // same for a queued spend at execution
        v.spend(SINK, 5 ether, DL, V("spendB_1"));
        vm.warp(block.timestamp + TIMELOCK);
        vm.expectRevert(PocketVault.SendFailed.selector);
        v.executeQueued(1);
        assertEq(uint8(v.getQueued(1).state), uint8(PocketVault.QState.Pending));
    }

    function test_receive_accepts_qor_and_emits() public {
        vm.deal(mallory, 1 ether);
        vm.expectEmit(true, false, false, true);
        emit PocketVault.Received(mallory, 1 ether);
        vm.prank(mallory);
        (bool ok,) = address(v).call{value: 1 ether}("");
        assertTrue(ok);
    }

    /*====================== signature / nonce / deadline ======================*/

    function test_wrong_key_wrong_prefix_raw_digest_are_rejected() public {
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, V("wrongKey_spendS_0"));
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, V("wrongPrefix_spendS_0")); // real sig, other chain id in the prefix
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, V("rawDigest_spendS_0")); // real sig, no QoreX prefix
        assertEq(SINK.balance, 0);
        assertEq(v.nonce(), 0);
    }

    function test_wrong_nonce_wrong_params_wrong_deadline_rejected() public {
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_1")); // signed for nonce 1
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.9 ether, DL, V("spendS_0")); // amount changed after signing
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(mallory, 0.8 ether, DL, V("spendS_0")); // recipient swapped
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_dl2_0")); // signed with another deadline
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL + 1, V("spendS_0")); // deadline changed after signing
    }

    function test_expired_intent() public {
        vm.warp(DL + 1);
        vm.expectRevert(PocketVault.Expired.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
    }

    function test_replayed_intent_reverts() public {
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        assertEq(SINK.balance, 0.8 ether);
    }

    function test_intent_for_one_vault_does_not_work_on_another() public {
        PocketVault v2 = deployPocket(cfgPA2());
        vm.deal(address(v2), 10 ether);
        vm.expectRevert(PocketVault.BadSignature.selector);
        v2.spend(SINK, 0.8 ether, DL, V("spendS_0")); // same owner, same params, different vault
    }

    function test_owner_key_is_pinned() public {
        // the owner account rotates its on-chain key: the Pocket does not follow it
        keys.set(OA, true, 1, _pk("OB"), true);
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        // key de-proven: fails closed
        keys.set(OA, true, 1, _pk("OA"), false);
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        keys.set(OA, true, 1, _pk("OA"), true);
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
    }

    function test_erc1271() public {
        bytes32 h = keccak256("erc1271 test");
        assertEq(v.isValidSignature(h, V("e1271_OA")), bytes4(0x1626ba7e));
        assertEq(v.isValidSignature(h, V("e1271_OB")), bytes4(0xffffffff));
        assertEq(v.isValidSignature(bytes32(uint256(h) + 1), V("e1271_OA")), bytes4(0xffffffff));
        // v5.1 F2/F4 regressions
        assertEq(v.isValidSignature(h, V("e1271Untagged_OA")), bytes4(0xffffffff), "v5 untagged approval refused");
        assertEq(v.isValidSignature(h, V("e1271PA2_OA")), bytes4(0xffffffff), "approval for another Pocket refused");
        assertEq(v.isValidSignature(h, V("e1271Chain_OA")), bytes4(0xffffffff), "approval for another chain refused");
        assertEq(
            v.erc1271Digest(h), keccak256(abi.encode(keccak256("POCKET_ERC1271_V1"), block.chainid, address(v), h))
        );
        assertEq(v.isValidSignature(h, hex"00"), bytes4(0xffffffff));
    }

    /// @dev v5.1 F2 regression: approving an intent digest through ERC-1271 or PqGuard (what a hostile dApp could ask
    ///      the owner to "approve") never yields a usable owner intent.
    function test_v51_F2_outside_approvals_are_never_intents() public {
        bytes32 ig = v.intentDigest(v.ACT_SPEND(), 0, DL, abi.encode(SINK, uint256(0.8 ether)));
        bytes memory a = V("e1271OfIntent_OA");
        assertEq(v.isValidSignature(ig, a), bytes4(0x1626ba7e), "a valid ERC-1271 approval of that hash");
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, a);
        bytes memory p = V("pqgOfIntent_OA");
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, p);
        // and an owner intent signature is not an ERC-1271 approval of its digest
        assertEq(v.isValidSignature(ig, V("spendS_0")), bytes4(0xffffffff));
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        assertEq(v.nonce(), 1);
    }

    /*====================== limit ======================*/

    function test_lowering_limit_is_immediate() public {
        v.setLimit(1 ether, DL, V("limLow_0"));
        assertEq(v.dailyLimit(), 1 ether);
        v.setLimit(1 ether, DL, V("limLow_1")); // equal to the current: no-op set
        assertEq(v.dailyLimit(), 1 ether);
    }

    function test_same_limit_cancels_nothing_and_changes_nothing() public {
        v.setLimit(2 ether, DL, V("limSame_0"));
        assertEq(v.dailyLimit(), 2 ether);
        assertEq(v.pendingLimitAt(), 0);
    }

    function test_raising_limit_is_timelocked() public {
        v.setLimit(9 ether, DL, V("limHigh_0"));
        assertEq(v.dailyLimit(), 2 ether);
        assertEq(v.pendingLimit(), 9 ether);
        vm.expectRevert(PocketVault.TooEarly.selector);
        v.applyLimit();
        vm.warp(block.timestamp + TIMELOCK);
        v.applyLimit();
        assertEq(v.dailyLimit(), 9 ether);
        vm.expectRevert(PocketVault.NothingPending.selector);
        v.applyLimit();
    }

    function test_lowering_clears_a_pending_raise_and_cancelPending_too() public {
        v.setLimit(9 ether, DL, V("limHigh_0"));
        v.setLimit(1 ether, DL, V("limLow_1"));
        vm.warp(block.timestamp + TIMELOCK);
        vm.expectRevert(PocketVault.NothingPending.selector);
        v.applyLimit();

        v.setLimit(9 ether, DL, V("limHigh_2"));
        v.cancelPending(DL, V("cancelPending_3"));
        vm.warp(block.timestamp + TIMELOCK);
        vm.expectRevert(PocketVault.NothingPending.selector);
        v.applyLimit();
    }

    function test_limit_lowered_below_spent_leaves_zero_allowance() public {
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        v.spend(SINK, 0.8 ether, DL, V("spendS_1"));
        v.setLimit(1 ether, DL, V("limLow_2"));
        assertEq(v.allowanceLeft(), 0);
        assertEq(v.spend(SINK, 0.8 ether, DL, V("spendS_3")), 1, "queued");
    }

    /*====================== guardians ======================*/

    function test_guardian_change_is_timelocked_then_applied() public {
        v.setGuardians(_two(G0, G1), 2, DL, V("gSet_0"));
        assertEq(v.guardians().length, 3, "old set still active");
        assertEq(v.pendingGuardians().length, 2);
        assertEq(v.pendingThreshold(), 2);
        vm.expectRevert(PocketVault.TooEarly.selector);
        v.applyGuardians();
        vm.warp(block.timestamp + TIMELOCK);
        v.applyGuardians();
        assertEq(v.guardians().length, 2);
        assertEq(v.threshold(), 2);
        assertEq(v.pendingGuardians().length, 0);
        vm.expectRevert(PocketVault.NothingPending.selector);
        v.applyGuardians();
    }

    function test_guardians_can_be_cleared_but_then_recovery_is_off() public {
        v.setGuardians(new address[](0), 0, DL, V("gEmpty_0"));
        vm.warp(block.timestamp + TIMELOCK);
        v.applyGuardians();
        assertEq(v.threshold(), 0);
        vm.expectRevert(PocketVault.NoGuardians.selector);
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G1), _bytes2(V("rec_G0_0"), V("rec_G1_0")));
    }

    function test_max_five_guardians_accepted() public {
        v.setGuardians(_five(), 3, DL, V("gFive_0"));
        assertEq(v.pendingGuardians().length, 5);
    }

    function _five() internal pure returns (address[] memory g) {
        g = new address[](5);
        g[0] = G0;
        g[1] = G1;
        g[2] = G2;
        g[3] = G3;
        g[4] = address(uint160(0xb0b01));
    }

    function test_bad_guardian_configs_revert() public {
        address[] memory g = new address[](1);
        g[0] = G0;
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        v.setGuardians(g, 1, DL, V("gBadOne_0"));
        g = new address[](2);
        g[0] = G0;
        g[1] = G0;
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        v.setGuardians(g, 2, DL, V("gBadDup_0"));
        g[1] = G1;
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        v.setGuardians(g, 1, DL, V("gBadThr_0"));
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        v.setGuardians(g, 3, DL, V("gBadThrHigh_0"));
        g[0] = address(0);
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        v.setGuardians(g, 2, DL, V("gBadZero_0"));
        g[0] = OA;
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        v.setGuardians(g, 2, DL, V("gBadOwner_0"));
        g = new address[](6);
        g[0] = G0;
        g[1] = G1;
        g[2] = G2;
        g[3] = G3;
        g[4] = address(uint160(0xb0b01));
        g[5] = address(uint160(0xb0b02));
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        v.setGuardians(g, 2, DL, V("gBadMany_0"));
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        v.setGuardians(new address[](0), 1, DL, V("gBadEmptyThr_0"));
    }

    function test_cancel_pending_clears_guardian_change() public {
        v.setGuardians(_two(G0, G1), 2, DL, V("gSet_0"));
        v.cancelPending(DL, V("cancelPending_1"));
        assertEq(v.pendingGuardians().length, 0);
        vm.warp(block.timestamp + TIMELOCK);
        vm.expectRevert(PocketVault.NothingPending.selector);
        v.applyGuardians();
    }

    /*====================== recovery ======================*/

    function test_recovery_happy_path_and_old_key_dies() public {
        _propose0();
        assertEq(v.recoveryOwner(), OB);
        assertEq(v.recoveryAt(), block.timestamp + RECOVERY_DELAY);
        assertEq(v.recoveryNonce(), 1);
        vm.expectRevert(PocketVault.TooEarly.selector);
        v.finalizeRecovery(G0, DL, "");
        vm.warp(block.timestamp + RECOVERY_DELAY);
        v.finalizeRecovery(G0, DL, _finSig(v, false));
        assertEq(v.owner(), OB);
        assertEq(v.ownerKeyHash(), _hOB());
        assertEq(v.epoch(), 1);
        assertEq(v.recoveryAt(), 0);
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_0")); // old key
        v.spend(SINK, 0.8 ether, DL, V("spendS_OB_0")); // new key
        assertEq(SINK.balance, 0.8 ether);
        // ERC-1271 follows the new owner
        assertEq(v.isValidSignature(keccak256("erc1271 test"), V("e1271_OB")), bytes4(0x1626ba7e));
        assertEq(v.isValidSignature(keccak256("erc1271 test"), V("e1271_OA")), bytes4(0xffffffff));
    }

    function test_recovery_with_one_of_three_guardians_fails() public {
        address[] memory s = new address[](1);
        s[0] = G0;
        bytes[] memory g = new bytes[](1);
        g[0] = V("rec_G0_0");
        vm.expectRevert(PocketVault.NotEnoughSigners.selector);
        v.proposeRecovery(OB, _hOB(), DL, s, g);
        // mismatched array lengths
        vm.expectRevert(PocketVault.NotEnoughSigners.selector);
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G1), g);
    }

    function test_recovery_same_guardian_twice_and_non_guardian_fail() public {
        vm.expectRevert(PocketVault.DuplicateSigner.selector);
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G0), _bytes2(V("rec_G0_0"), V("rec_G0_0")));
        vm.expectRevert(PocketVault.NotGuardian.selector);
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G3), _bytes2(V("rec_G0_0"), V("rec_G3_0")));
    }

    function test_recovery_wrong_message_and_foreign_vault_signatures_fail() public {
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G1), _bytes2(V("rec_G0_0"), V("recWrong_G1_0")));
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G1), _bytes2(V("recPA2_G0_0"), V("recPA2_G1_0")));
        // right guardian signatures, but over the next-nonce (1) digest
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G1), _bytes2(V("rec_G0_1"), V("rec_G1_1")));
    }

    function test_recovery_three_guardians_any_order() public {
        address[] memory s = new address[](3);
        s[0] = G2;
        s[1] = G0;
        s[2] = G1;
        bytes[] memory g = new bytes[](3);
        g[0] = V("rec_G2_0");
        g[1] = V("rec_G0_0");
        g[2] = V("rec_G1_0");
        v.proposeRecovery(OB, _hOB(), DL, s, g);
        assertEq(v.recoveryOwner(), OB);
    }

    function test_recovery_bad_params_and_expiry() public {
        bytes[] memory g = _bytes2(V("rec_G0_0"), V("rec_G1_0"));
        address[] memory s = _two(G0, G1);
        vm.expectRevert(PocketVault.BadParams.selector);
        v.proposeRecovery(address(0), _hOB(), DL, s, g);
        vm.expectRevert(PocketVault.BadParams.selector);
        v.proposeRecovery(address(v), _hOB(), DL, s, g);
        vm.expectRevert(PocketVault.BadParams.selector);
        v.proposeRecovery(OB, bytes32(0), DL, s, g);
        vm.expectRevert(PocketVault.BadParams.selector);
        v.proposeRecovery(G0, _hOB(), DL, s, g); // a guardian cannot become the owner
        vm.warp(DL + 1);
        vm.expectRevert(PocketVault.Expired.selector);
        v.proposeRecovery(OB, _hOB(), DL, s, g);
    }

    function test_recovery_with_bad_hash_signed_by_guardians() public {
        bytes32 bad = 0xbabababababababababababababababababababababababababababababababa;
        vm.expectRevert(PqcLib.KeyMismatch.selector);
        v.proposeRecovery(OB, bad, DL, _two(G0, G1), _bytes2(V("recBadHash_G0_0"), V("recBadHash_G1_0")));
    }

    function test_cannot_propose_while_pending_then_veto_clears() public {
        _propose0();
        vm.expectRevert(PocketVault.RecoveryPending.selector);
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G1), _bytes2(V("rec_G0_1"), V("rec_G1_1")));
        v.vetoRecovery(DL, V("vetoRec_0")); // the OLD owner key
        assertEq(v.recoveryAt(), 0);
        assertEq(v.owner(), OA);
        vm.expectRevert(PocketVault.NoRecoveryPending.selector);
        v.finalizeRecovery(G0, DL, "");
        vm.expectRevert(PocketVault.NoRecoveryPending.selector);
        v.vetoRecovery(DL, V("vetoRec_1"));
    }

    function test_old_guardian_signatures_cannot_be_replayed_after_veto() public {
        _propose0();
        v.vetoRecovery(DL, V("vetoRec_0"));
        vm.expectRevert(PocketVault.BadSignature.selector);
        _propose0();
        // a fresh proposal at recovery nonce 1 works, finalizes, and the new owner continues at owner nonce 1
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G1), _bytes2(V("rec_G0_1"), V("rec_G1_1")));
        vm.warp(block.timestamp + RECOVERY_DELAY);
        v.finalizeRecovery(G0, DL, _finSig(v, false));
        v.spend(SINK, 0.8 ether, DL, V("spendS_OB_1"));
        assertEq(SINK.balance, 0.8 ether);
    }

    function test_veto_by_non_owner_key_reverts() public {
        _propose0();
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.vetoRecovery(DL, V("vetoRec_OB_0"));
        assertTrue(v.recoveryAt() != 0);
    }

    function test_finalize_fails_closed_if_new_key_disappears() public {
        _propose0();
        keys.set(OB, false, 0, "", false);
        vm.warp(block.timestamp + RECOVERY_DELAY);
        vm.expectRevert(PqcLib.NotRegistered.selector);
        v.finalizeRecovery(G0, DL, "");
        assertEq(v.owner(), OA);
    }

    function test_pending_recovery_blocks_queue_limit_and_guardian_applies() public {
        v.spend(SINK, 5 ether, DL, V("spendB_0")); // queued id 1
        v.setLimit(9 ether, DL, V("limHigh_1"));
        v.setGuardians(_two(G0, G1), 2, DL, V("gSet_2"));
        v.proposeRecovery(OB, _hOB(), DL, _two(G0, G1), _bytes2(V("rec_G0_0"), V("rec_G1_0")));
        vm.warp(block.timestamp + TIMELOCK);
        vm.expectRevert(PocketVault.RecoveryPending.selector);
        v.executeQueued(1);
        vm.expectRevert(PocketVault.RecoveryPending.selector);
        v.applyLimit();
        vm.expectRevert(PocketVault.RecoveryPending.selector);
        v.applyGuardians();
    }

    function test_finalized_recovery_kills_queued_spends_and_pending_changes() public {
        v.spend(SINK, 5 ether, DL, V("spendB_0")); // queued by the old key
        v.setLimit(9 ether, DL, V("limHigh_1"));
        v.setGuardians(_two(G0, G1), 2, DL, V("gSet_2"));
        _propose0();
        vm.warp(block.timestamp + RECOVERY_DELAY);
        v.finalizeRecovery(G0, DL, _finSig(v, false));
        vm.expectRevert(PocketVault.StaleEpoch.selector);
        v.executeQueued(1);
        assertEq(v.pendingLimitAt(), 0);
        assertEq(v.pendingGuardiansAt(), 0);
        assertEq(v.pendingGuardians().length, 0);
        assertEq(SINK.balance, 0);
    }

    function test_owner_cannot_unilaterally_replace_guardians_instantly() public {
        // a stolen owner key queues a guardian swap; guardians can still recover inside the timelock window
        v.setGuardians(_two(G0, G1), 2, DL, V("gSet_0"));
        assertEq(v.guardians().length, 3);
        _propose0();
        vm.warp(block.timestamp + TIMELOCK);
        vm.expectRevert(PocketVault.RecoveryPending.selector);
        v.applyGuardians();
    }

    function test_digest_views_match_independent_encoding() public view {
        bytes memory p = abi.encode(SINK, 0.8 ether);
        assertEq(
            v.intentDigest(v.ACT_SPEND(), 3, DL, p),
            keccak256(abi.encode(keccak256("POCKET_SPEND_V1"), block.chainid, address(v), uint256(3), DL, p))
        );
        assertEq(
            v.recoveryDigest(OB, _hOB(), DL),
            keccak256(abi.encode(keccak256("POCKET_RECOVER_V1"), block.chainid, address(v), uint256(0), DL, OB, _hOB()))
        );
    }
}
