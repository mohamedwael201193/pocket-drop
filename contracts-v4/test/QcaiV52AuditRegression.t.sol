// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4Base} from "./Base.t.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {PocketDrop} from "../src/PocketDrop.sol";
import {Payout} from "../src/Payout.sol";
import {PqcLib} from "../src/PqcLib.sol";
import {HostileReceiver} from "./mocks/Hostile.sol";

/// @dev Exposes `_pay` under the lock, so a receiver can try to re-enter the payout path itself.
contract QcaiPayoutHarness is Payout {
    function payWithoutLock(address to, uint256 value) external payable {
        _pay(to, value);
    }

    function payLocked(address to, uint256 value) external payable nonReentrant {
        _pay(to, value);
    }
}

/// @dev A receiver that answers a payment with a large return payload (return-bomb attempt).
contract ReturnBombReceiver {
    receive() external payable {
        assembly ("memory-safe") {
            return(0, 30000)
        }
    }
}

/// @notice Evidence for the triage of the QCAI report on the v5.2 source (78/100, MEDIUM, 7 findings). Each test is
///         named after the finding it answers (f1 .. f7). All tests run against the deployed v5.2 `src/` unchanged.
///         See docs/audit/stage5/QCAI_V5_2_TRIAGE.md.
contract QcaiV52VaultTest is V4Base {
    PocketVault internal v;

    function setUp() public override {
        super.setUp();
        v = pocketA();
    }

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

    function _proposeT() internal {
        v.proposeRecovery(OB, keccak256(_pk("OB")), DL, _pair(G0, G1), _b2(V("rec_G0_0"), V("rec_G1_0")));
    }

    function _proposeU() internal {
        v.proposeRecoveryUnanimous(
            OB, keccak256(_pk("OB")), DL, _trio(), _b3(V("unan_G0_0"), V("unan_G1_0"), V("unan_G2_0"))
        );
    }

    /*====================================================================================================
        F1 (HIGH) "Potential Reentrancy in Payout Contract": `_pay` has no guard of its own
    ====================================================================================================*/

    /// @dev F1: `_pay` is not reachable outside the lock. Called without `nonReentrant` it reverts; called under it, it
    ///      pays. A receiver that re-enters the locked payout path from inside its own payout is refused, and is
    ///      paid exactly once.
    function test_qcai52_f1_pay_reverts_outside_lock_and_receiver_cannot_reenter_the_locked_path() public {
        QcaiPayoutHarness h = new QcaiPayoutHarness();
        vm.deal(address(this), 10 ether);
        vm.expectRevert(Payout.PayoutOutsideLock.selector);
        h.payWithoutLock{value: 1 ether}(SINK, 1 ether);

        address rcv = address(0xbeef01);
        vm.etch(rcv, address(new HostileReceiver()).code);
        HostileReceiver(payable(rcv))
            .configure(HostileReceiver.B.Reenter, address(h), abi.encodeCall(h.payLocked, (rcv, 1 ether)));
        uint256 before = rcv.balance;
        h.payLocked{value: 1 ether}(rcv, 1 ether);
        assertEq(rcv.balance - before, 1 ether, "paid once");
        assertEq(HostileReceiver(payable(rcv)).hits(), 1);
        assertFalse(HostileReceiver(payable(rcv)).lastOk(), "re-entry failed");
        assertEq(HostileReceiver(payable(rcv)).lastSel(), Payout.Reentrancy.selector);
        assertEq(address(h).balance, 0);
        // the lock is released after the call
        h.payLocked{value: 1 ether}(SINK, 1 ether);
        assertEq(SINK.balance, 1 ether);
    }

    /// @dev F1 (vault side): a receiver of `spend` that re-enters `spend` gets `Reentrancy`; the owner's intent is
    ///      used once and the receiver gets the amount once.
    function test_qcai52_f1_vault_spend_receiver_cannot_reenter_spend() public {
        vm.etch(SINK, address(new HostileReceiver()).code);
        HostileReceiver(payable(SINK))
            .configure(
                HostileReceiver.B.Reenter,
                address(v),
                abi.encodeCall(PocketVault.spend, (SINK, uint256(0.8 ether), DL, bytes("")))
            );
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        assertEq(SINK.balance, 0.8 ether, "paid once");
        assertEq(HostileReceiver(payable(SINK)).hits(), 1);
        assertFalse(HostileReceiver(payable(SINK)).lastOk());
        assertEq(HostileReceiver(payable(SINK)).lastSel(), PocketVault.Reentrancy.selector);
        assertEq(v.nonce(), 1);
        assertEq(v.spentToday(), 0.8 ether);
    }

    /// @dev F1 (vault side): the same for the queued path: a receiver of `executeQueued` cannot re-run it.
    function test_qcai52_f1_vault_executeQueued_receiver_cannot_reenter() public {
        assertEq(v.spend(SINK, 5 ether, DL, V("spendB_0")), 1);
        vm.etch(SINK, address(new HostileReceiver()).code);
        HostileReceiver(payable(SINK))
            .configure(HostileReceiver.B.Reenter, address(v), abi.encodeCall(PocketVault.executeQueued, (uint256(1))));
        vm.warp(block.timestamp + TIMELOCK);
        v.executeQueued(1);
        assertEq(SINK.balance, 5 ether, "paid once");
        assertEq(HostileReceiver(payable(SINK)).lastSel(), PocketVault.Reentrancy.selector);
        assertEq(uint8(v.getQueued(1).state), uint8(PocketVault.QState.Executed));
    }

    /*====================================================================================================
        F2 (MEDIUM) "Missing Access Control in Recovery Finalization": the old owner and a veto
    ====================================================================================================*/

    /// @dev F2: a vetoed recovery cannot be finalized by anyone, including the old owner with a valid signature.
    function test_qcai52_f2_old_owner_cannot_finalize_a_recovery_it_vetoed() public {
        _proposeT();
        v.vetoRecovery(DL, V("vetoRec_0"));
        assertEq(v.recoveryAt(), 0);
        vm.warp(block.timestamp + RECOVERY_DELAY);
        bytes memory s = _finSigBy(v, false, OA, "OA", DL); // a genuine owner signature
        vm.expectRevert(PocketVault.NoRecoveryPending.selector);
        v.finalizeRecovery(OA, DL, s);
        assertEq(v.owner(), OA);
        assertEq(v.epoch(), 0);
    }

    /// @dev F2: on the unanimous path the old owner is never an accepted authorizer, with or without a valid signature
    ///      and at any time (before or after the delay).
    function test_qcai52_f2_unanimous_path_never_accepts_the_old_owner() public {
        _proposeU();
        bytes memory sOld = _finSigBy(v, true, OA, "OA", DL);
        vm.expectRevert(PocketVault.TooEarly.selector);
        v.finalizeRecoveryUnanimous(OA, DL, sOld);
        vm.warp(block.timestamp + UNANIMOUS_DELAY);
        vm.expectRevert(PocketVault.NotAuthorized.selector);
        v.finalizeRecoveryUnanimous(OA, DL, sOld);
        vm.prank(OA);
        vm.expectRevert(PocketVault.NotAuthorized.selector);
        v.finalizeRecoveryUnanimous(OA, DL, sOld);
        assertEq(v.owner(), OA);
        assertEq(v.uRecoveryAt() != 0, true, "still pending, nothing consumed");
    }

    /// @dev F2: no account other than owner (threshold path only), a guardian or the approved new owner can finalize,
    ///      and the account that submits the transaction (msg.sender) does not matter.
    function testFuzz_qcai52_f2_unrelated_authorizer_is_refused(address authorizer, address submitter) public {
        vm.assume(authorizer != OA && authorizer != OB && authorizer != G0 && authorizer != G1 && authorizer != G2);
        _proposeT();
        vm.warp(block.timestamp + RECOVERY_DELAY);
        bytes memory sig = new bytes(PqcLib.ML_DSA_87_SIG_LEN);
        vm.prank(submitter);
        vm.expectRevert(PocketVault.NotAuthorized.selector);
        v.finalizeRecovery(authorizer, DL, sig);
        assertEq(v.owner(), OA);
        assertEq(v.epoch(), 0);
    }

    /// @dev F2 (honest boundary): on the THRESHOLD path the current owner is an accepted authorizer on purpose
    ///      (it can only complete what the guardians approved, after the delay, and it can veto instead). The outcome is
    ///      identical to a guardian finalizing: the guardian-approved owner and key, nobody else.
    function test_qcai52_f2_threshold_owner_finalize_only_completes_the_guardian_approved_target() public {
        _proposeT();
        vm.warp(block.timestamp + RECOVERY_DELAY);
        bytes memory s = _finSigBy(v, false, OA, "OA", DL);
        vm.prank(mallory);
        v.finalizeRecovery(OA, DL, s);
        assertEq(v.owner(), OB, "the guardian-approved owner, not the old owner or the submitter");
        assertEq(v.ownerKeyHash(), keccak256(_pk("OB")));
        assertEq(v.epoch(), 1);
        // the authorization is spent with the proposal: the same signature cannot run again
        vm.expectRevert(PocketVault.NoRecoveryPending.selector);
        v.finalizeRecovery(OA, DL, s);
    }

    /*====================================================================================================
        F4 (LOW) "Unchecked Return Values in External Calls" in PocketVault.sol
    ====================================================================================================*/

    /// @dev F4: the vault's only value call is `_send`, which checks the result. A receiver that rejects the payment
    ///      makes `spend` revert `SendFailed` and the whole call rolls back: no nonce use, no allowance used, no value lost.
    function test_qcai52_f4_failed_send_reverts_spend_and_changes_nothing() public {
        vm.etch(SINK, address(new HostileReceiver()).code);
        HostileReceiver(payable(SINK)).configure(HostileReceiver.B.Revert, address(0), "");
        uint256 bal = address(v).balance;
        vm.expectRevert(PocketVault.SendFailed.selector);
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        assertEq(address(v).balance, bal);
        assertEq(v.nonce(), 0);
        assertEq(v.spentToday(), 0);
        assertEq(SINK.balance, 0);
        // the same signed intent works once the receiver accepts (nothing was consumed)
        HostileReceiver(payable(SINK)).setBehavior(HostileReceiver.B.Accept);
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        assertEq(SINK.balance, 0.8 ether);
    }

    /// @dev F4: `executeQueued` marks the entry executed and then checks the send; if the send fails the state change
    ///      is rolled back, so the queued spend stays pending and can be executed later..
    function test_qcai52_f4_failed_send_keeps_the_queued_spend_pending() public {
        // queue a 5 QOR spend to SINK, then point the stored receiver at a contract that refuses ETH
        assertEq(v.spend(SINK, 5 ether, DL, V("spendB_0")), 1);
        vm.etch(SINK, address(new HostileReceiver()).code);
        HostileReceiver(payable(SINK)).configure(HostileReceiver.B.Revert, address(0), "");
        vm.warp(block.timestamp + TIMELOCK);
        uint256 bal = address(v).balance;
        vm.expectRevert(PocketVault.SendFailed.selector);
        v.executeQueued(1);
        assertEq(address(v).balance, bal);
        assertEq(uint8(v.getQueued(1).state), uint8(PocketVault.QState.Pending));
        HostileReceiver(payable(SINK)).setBehavior(HostileReceiver.B.Accept);
        v.executeQueued(1);
        assertEq(SINK.balance, 5 ether);
        assertEq(uint8(v.getQueued(1).state), uint8(PocketVault.QState.Executed));
    }

    /*====================================================================================================
        F5 (MEDIUM) "Potential Front-Running in Guardian Freeze": predictable freezeNonce
    ====================================================================================================*/

    /// @dev F5: knowing `freezeNonce` is no advantage. Without the guardians' ML-DSA signatures over the digest that
    ///      binds the nonce, an attacker's freeze reverts; nothing changes.
    function test_qcai52_f5_attacker_who_knows_the_nonce_cannot_freeze() public {
        uint256 n = v.freezeNonce();
        bytes memory junk = new bytes(PqcLib.ML_DSA_87_SIG_LEN);
        junk[0] = 0x66;
        vm.prank(mallory);
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.guardianFreeze(_pair(G0, G1), _b2(junk, junk), n, DL);
        assertFalse(v.frozen());
        assertEq(v.freezeNonce(), n);
    }

    /// @dev F5: a front-runner who copies the guardians' signed freeze from the mempool only causes the freeze the
    ///      guardians asked for: same end time, same nonce bump, nothing about the Pocket's funds or owner changes. The
    ///      guardians' own copy then reverts `BadNonce` (the goal is already reached) and cannot be replayed later.
    function test_qcai52_f5_front_running_the_signed_freeze_only_delivers_the_intended_freeze() public {
        bytes memory g0 = V("frz_G0_0");
        bytes memory g1 = V("frz_G1_0");
        uint256 bal = address(v).balance;
        address ownerBefore = v.owner();
        vm.prank(mallory); // front-runner
        v.guardianFreeze(_pair(G0, G1), _b2(g0, g1), 0, DL);
        assertTrue(v.frozen());
        assertEq(v.freezeNonce(), 1);
        assertEq(v.frozenUntil(), block.timestamp + FREEZE_PERIOD);
        assertEq(address(v).balance, bal);
        assertEq(v.owner(), ownerBefore);
        // the guardians' own submission is a no-op revert, not a different freeze
        vm.expectRevert(PocketVault.BadNonce.selector);
        v.guardianFreeze(_pair(G0, G1), _b2(g0, g1), 0, DL);
        // after the freeze ends, the old signatures stay dead (bound to nonce 0, which is spent)
        vm.warp(block.timestamp + FREEZE_PERIOD + 1);
        assertFalse(v.frozen());
        vm.prank(mallory);
        vm.expectRevert(PocketVault.BadNonce.selector);
        v.guardianFreeze(_pair(G0, G1), _b2(g0, g1), 0, DL);
    }

    /// @dev F5: any nonce other than the current one is refused before any signature work, so an attacker cannot pre-burn
    ///      or skip nonces to disturb legitimate freezes.
    function testFuzz_qcai52_f5_wrong_nonce_is_refused_and_changes_nothing(uint256 wrong) public {
        vm.assume(wrong != v.freezeNonce());
        vm.prank(mallory);
        vm.expectRevert(PocketVault.BadNonce.selector);
        v.guardianFreeze(_pair(G0, G1), _b2(V("frz_G0_0"), V("frz_G1_0")), wrong, DL);
        assertEq(v.freezeNonce(), 0);
        assertFalse(v.frozen());
    }

    /// @dev F5: the freeze digest binds chain, Pocket, nonce and deadline, so a signature for the next nonce, another
    ///      Pocket or another deadline is not accepted at nonce 0.
    function test_qcai52_f5_freeze_signature_is_bound_to_nonce_and_pocket() public {
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.guardianFreeze(_pair(G0, G1), _b2(V("frz_G0_0"), V("frz_G1_1")), 0, DL); // G1's nonce-1 signature
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.guardianFreeze(_pair(G0, G1), _b2(V("frz_G0_0"), V("frzPA2_G1_0")), 0, DL); // another Pocket's signature
        assertNotEq(v.freezeDigest(0, DL), v.freezeDigest(1, DL));
        assertNotEq(v.freezeDigest(0, DL), v.freezeDigest(0, DL + 1));
        assertFalse(v.frozen());
    }

    /*====================================================================================================
        F6 (LOW) "Potential Gas Limit Issues in Guardian Validation": `_checkGuardianSigs`
    ====================================================================================================*/

    /// @dev F6: more than MAX_GUARDIANS signers is refused up front, before any signature work (cheap to reject).
    function test_qcai52_f6_six_signers_revert_before_any_signature_work() public {
        address[] memory g6 = new address[](6);
        bytes[] memory s6 = new bytes[](6);
        for (uint256 i; i < 6; i++) {
            g6[i] = G0;
            s6[i] = "";
        }
        uint256 g = gasleft();
        vm.expectRevert(PocketVault.NotGuardian.selector);
        v.guardianFreeze(g6, s6, 0, DL);
        assertLt(g - gasleft(), 100_000);
        assertEq(v.MAX_GUARDIANS(), 5);
    }

    /// @dev F6: the guardian set cannot exceed 5, at deployment.
    function test_qcai52_f6_guardian_set_is_capped_at_deploy() public {
        address[] memory g6 = new address[](6);
        g6[0] = G0;
        g6[1] = G1;
        g6[2] = G2;
        g6[3] = G3;
        g6[4] = r(0);
        g6[5] = r(1);
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        factory.deploy(OA, g6, 2, 2 ether, bytes32(uint256(78)));
    }

    /// @dev F6: worst case for the widest check (unanimous recovery, 5 of 5 guardians, bitmap duplicate scan) measured.
    function test_qcai52_f6_five_of_five_unanimous_check_gas_is_bounded() public {
        address[] memory g5 = new address[](5);
        g5[0] = G0;
        g5[1] = G1;
        g5[2] = G2;
        g5[3] = G3;
        g5[4] = r(0);
        PocketVault v5 =
            deployPocket(Cfg({owner: OA, guardians: g5, threshold: 5, limit: 2 ether, salt: bytes32(uint256(97))}));
        bytes32 kh = keccak256(_pk("OB"));
        bytes memory m = PqcLib.pqMessage(v5.unanimousDigest(OB, kh, DL));
        bytes memory sig = new bytes(PqcLib.ML_DSA_87_SIG_LEN);
        string[5] memory names = ["G0", "G1", "G2", "G3", "R0"];
        bytes[] memory sigs = new bytes[](5);
        for (uint256 i; i < 5; i++) {
            verifier.accept(keccak256(abi.encode(_pk(names[i]), sig, m)));
            sigs[i] = sig;
        }
        // a duplicate signer in the set is refused (bitmap), in any position
        address[] memory dup = new address[](5);
        for (uint256 i; i < 5; i++) {
            dup[i] = g5[i == 4 ? 0 : i];
        }
        vm.expectRevert(PocketVault.DuplicateSigner.selector);
        v5.proposeRecoveryUnanimous(OB, kh, DL, dup, sigs);
        uint256 g = gasleft();
        v5.proposeRecoveryUnanimous(OB, kh, DL, g5, sigs);
        uint256 used = g - gasleft();
        emit log_named_uint("proposeRecoveryUnanimous gas, 5 of 5 signers (mock verifier)", used);
        assertLt(used, 2_000_000);
    }

    /*====================================================================================================
        F7 (INFO) "ERC-1271 Implementation": the report calls it correct; confirm it stays tight
    ====================================================================================================*/

    /// @dev F7: only the owner's tagged, Pocket- and chain-bound approval returns the magic value; everything else
    ///      returns 0xffffffff and does not revert.
    function test_qcai52_f7_erc1271_accepts_only_the_owners_bound_approval() public {
        bytes32 h = keccak256("erc1271 test");
        assertEq(v.isValidSignature(h, V("e1271_OA")), bytes4(0x1626ba7e));
        assertEq(v.isValidSignature(h, V("e1271_OB")), bytes4(0xffffffff));
        assertEq(v.isValidSignature(bytes32(uint256(h) + 1), V("e1271_OA")), bytes4(0xffffffff));
        assertEq(v.isValidSignature(h, V("e1271PA2_OA")), bytes4(0xffffffff), "another Pocket's approval");
        assertEq(v.isValidSignature(h, V("e1271Untagged_OA")), bytes4(0xffffffff), "untagged approval");
        assertEq(v.isValidSignature(h, V("e1271Chain_OA")), bytes4(0xffffffff), "another chain's approval");
        assertEq(v.isValidSignature(h, ""), bytes4(0xffffffff), "empty signature");
    }
}

/// @notice F3 (drip arithmetic) and F1/F4 on the deployed v5.2 PocketDrop (payout lock, deferred payouts).
contract QcaiV52DropTest is V4Base {
    address internal alice = makeAddr("alice");

    function setUp() public override {
        super.setUp();
        vm.deal(alice, 1000 ether);
        vm.deal(relayer, 1 ether);
    }

    function _payTo(uint256 i) internal view returns (address) {
        return predict(cfgPR(i));
    }

    function _createO() internal returns (uint256 id) {
        id = drop.linkCount() + 1;
        bytes memory lpk = _pk(string.concat("LK", vm.toString(id % 3)));
        vm.prank(alice);
        drop.create{value: 1.25 ether}(keccak256(lpk), 1, uint64(block.timestamp + 7 days), 0.2 ether, 0.05 ether);
    }

    function _bind(uint256 id, uint256 i) internal {
        bytes memory s = D(string.concat("bind_", vm.toString(id), "_", vm.toString(i)));
        bytes memory lpk = _pk(string.concat("LK", vm.toString(id % 3)));
        bytes32 rh = keccak256(_pk(string.concat("R", vm.toString(i))));
        address pt = _payTo(i);
        vm.prank(relayer);
        drop.bind(id, r(i), rh, pt, FEE, lpk, s);
    }

    function _claim(uint256 id, uint256 i) internal {
        bytes memory s = D(string.concat("claim_", vm.toString(id), "_", vm.toString(i)));
        vm.prank(relayer);
        drop.claim(id, s);
    }

    function _etch(address at, HostileReceiver.B b, address target, bytes memory data) internal {
        vm.etch(at, address(new HostileReceiver()).code);
        HostileReceiver(payable(at)).configure(b, target, data);
    }

    /*---------------- F3 (MEDIUM): "Potential Overflow in Daily Drip Calculation" ----------------*/

    /// @dev F3: the constructor refuses a cap above uint128 and a max drip above the cap, so the headroom arithmetic
    ///      always works on values that cannot wrap.
    function test_qcai52_f3_constructor_bounds_cap_to_uint128_and_maxdrip_to_cap() public {
        uint256 max96 = type(uint96).max;
        uint256 max128 = type(uint128).max;
        vm.expectRevert(PocketDrop.InvalidConfig.selector);
        maker.drop(1, max96, max96, max128 + 1, BIND_TIMEOUT, 30 days);
        vm.expectRevert(PocketDrop.InvalidConfig.selector);
        maker.drop(1, max96, 2 ether, 1 ether, BIND_TIMEOUT, 30 days); // max drip above the cap
        vm.expectRevert(PocketDrop.InvalidConfig.selector);
        maker.drop(1, max96, max96 + 1, max128, BIND_TIMEOUT, 30 days); // max drip above uint96
        PocketDrop ok = maker.drop(1, max96, max96, max128, BIND_TIMEOUT, 30 days);
        assertEq(ok.DAILY_DRIP_CAP(), max128);
    }

    /// @dev F3: at the widest allowed bounds (cap = uint128 max, max drip = uint96 max) a run of drips is recorded as
    ///      an exact uint256 sum (no truncation, no wrap), and is refused with `DailyDripCapExceeded` exactly when it
    ///      would pass the cap. Cap here = 3 drips of uint96 max, so the fourth must fail.
    function testFuzz_qcai52_f3_exact_sum_up_to_the_cap_and_refusal_above(uint96 a, uint96 b, uint96 c_) public {
        uint256 max96 = type(uint96).max;
        uint256 cap = uint256(a) + uint256(b) + uint256(c_);
        vm.assume(cap > 0 && cap <= type(uint128).max);
        vm.assume(a > 0 && b > 0 && c_ > 0);
        PocketDrop x = new PocketDrop(1, max96, cap < max96 ? cap : max96, cap, BIND_TIMEOUT, 30 days);
        bytes32 lk = keccak256("lk");
        uint64 exp = uint64(block.timestamp + 1 days);
        vm.deal(alice, max96 * 4 + 10);
        vm.startPrank(alice);
        x.create{value: uint256(a) + 1}(lk, 0, exp, a, 0);
        x.create{value: uint256(b) + 1}(lk, 0, exp, b, 0);
        assertEq(x.dripUsedToday(alice), uint256(a) + uint256(b));
        x.create{value: uint256(c_) + 1}(lk, 0, exp, c_, 0);
        assertEq(x.dripUsedToday(alice), cap, "reaches the cap exactly");
        vm.expectRevert(PocketDrop.DailyDripCapExceeded.selector);
        x.create{value: 2}(lk, 0, exp, 1, 0);
        vm.stopPrank();
        assertEq(x.dripUsedToday(alice), cap);
    }

    /// @dev F3: the allowance is per sender and per UTC day; a new day starts from zero and one sender's use never
    ///      reduces another's headroom.
    function test_qcai52_f3_allowance_is_per_sender_and_resets_daily() public {
        bytes32 k = keccak256("k");
        uint64 exp = uint64(block.timestamp + 7 days);
        address bob = makeAddr("bob");
        vm.deal(bob, 100 ether);
        vm.prank(alice);
        drop.create{value: 1.6 ether}(k, 0, exp, 0.6 ether, 0);
        assertEq(drop.dripUsedToday(alice), 0.6 ether);
        assertEq(drop.dripUsedToday(bob), 0);
        vm.warp(block.timestamp + 1 days);
        assertEq(drop.dripUsedToday(alice), 0);
    }

    /*---------------- F1 on the drop contract: payout lock ----------------*/

    /// @dev F1: a recipient that re-enters the claim during its payout is refused; the claim pays once and emits
    ///      `PayoutSent` for exactly the escrow.
    function test_qcai52_f1_claim_receiver_cannot_reenter_and_payout_is_recorded_once() public {
        uint256 id = _createO();
        _bind(id, 0);
        address pt = _payTo(0);
        _etch(pt, HostileReceiver.B.Reenter, address(drop), abi.encodeCall(drop.claim, (id, bytes(""))));
        uint256 dropBefore = address(drop).balance;
        vm.recordLogs();
        _claim(id, 0);
        assertEq(HostileReceiver(payable(pt)).lastSel(), Payout.Reentrancy.selector);
        assertEq(dropBefore - address(drop).balance, 1 ether);
        assertEq(uint8(drop.getLink(id).state), uint8(PocketDrop.State.Claimed));
        assertEq(drop.totalPending(), 0);
    }

    /*---------------- F4 on the drop contract: payouts to hostile receivers ----------------*/

    /// @dev F4: a receiver that refuses the payment never blocks the claim and never loses value: the amount moves
    ///      to the pull balance (`PayoutDeferred`), the books balance, and it is withdrawn exactly once.
    function test_qcai52_f4_refused_payout_is_deferred_not_lost() public {
        uint256 id = _createO();
        _bind(id, 0);
        address pt = _payTo(0);
        _etch(pt, HostileReceiver.B.Revert, address(0), "");
        _claim(id, 0);
        assertEq(uint8(drop.getLink(id).state), uint8(PocketDrop.State.Claimed));
        assertEq(drop.pending(pt), 1 ether);
        assertEq(drop.totalPending(), 1 ether);
        assertGe(address(drop).balance, drop.totalPending());
        HostileReceiver(payable(pt)).setBehavior(HostileReceiver.B.Accept);
        uint256 before = pt.balance;
        vm.prank(pt);
        drop.withdraw();
        assertEq(pt.balance - before, 1 ether);
        assertEq(drop.totalPending(), 0);
        vm.prank(pt);
        vm.expectRevert(Payout.NothingToWithdraw.selector);
        drop.withdraw();
    }

    /// @dev F4: a receiver that answers with a large return payload cannot hurt the payer: no return data is copied,
    ///      the claim completes and the payout is recorded as sent.
    function test_qcai52_f4_return_bomb_receiver_does_not_affect_the_claim() public {
        uint256 id = _createO();
        _bind(id, 0);
        address pt = _payTo(0);
        vm.etch(pt, address(new ReturnBombReceiver()).code);
        uint256 before = pt.balance;
        _claim(id, 0);
        assertEq(pt.balance - before, 1 ether);
        assertEq(uint8(drop.getLink(id).state), uint8(PocketDrop.State.Claimed));
        assertEq(drop.totalPending(), 0);
    }

    /// @dev F4: a receiver that burns all gas is cut off at the 100,000 gas limit and deferred; the claim still completes.
    function test_qcai52_f4_gas_burning_receiver_is_deferred() public {
        uint256 id = _createO();
        _bind(id, 0);
        address pt = _payTo(0);
        _etch(pt, HostileReceiver.B.Burn, address(0), "");
        _claim(id, 0);
        assertEq(uint8(drop.getLink(id).state), uint8(PocketDrop.State.Claimed));
        assertEq(drop.pending(pt), 1 ether);
    }
}
