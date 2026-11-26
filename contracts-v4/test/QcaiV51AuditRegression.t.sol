// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4Base} from "./Base.t.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {PocketDrop} from "../src/PocketDrop.sol";
import {Payout} from "../src/Payout.sol";
import {PqcLib} from "../src/PqcLib.sol";
import {HostileReceiver} from "./mocks/Hostile.sol";

/// @notice Evidence for the triage of the QCAI report on the v5.1 source (QCAIA-1795655356279-BA1C1020, 82/100).
///         Each test is named after the finding it answers (h1, m2, m3, l4). The tests run against the deployed v5.1
///         src/ unchanged. See docs/audit/stage4/QCAI_V5_1_TRIAGE.md.
contract QcaiV51VaultTest is V4Base {
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

    function _proposeThreshold(PocketVault v) internal {
        v.proposeRecovery(OB, keccak256(_pk("OB")), DL, _pair(G0, G1), _sigs2(V("rec_G0_0"), V("rec_G1_0")));
    }

    function _proposeUnanimous(PocketVault v) internal {
        v.proposeRecoveryUnanimous(
            OB, keccak256(_pk("OB")), DL, _trio(), _sigs3(V("unan_G0_0"), V("unan_G1_0"), V("unan_G2_0"))
        );
    }

    /// @dev H1: a third party cannot choose the new owner. Guardian signatures that approve OB do not approve the
    ///      attacker (the digest binds newOwner and newKeyHash), so the attacker cannot even open a proposal.
    function test_qcai51_h1_attacker_cannot_propose_itself_with_guardian_sigs() public {
        PocketVault v = pocketA();
        bytes32 hMallory = keccak256("mallory-key");
        vm.prank(mallory);
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.proposeRecovery(mallory, hMallory, DL, _pair(G0, G1), _sigs2(V("rec_G0_0"), V("rec_G1_0")));
        assertEq(v.recoveryAt(), 0);
        assertEq(v.owner(), OA);
    }

    /// @dev H1: finalizeRecovery by a third party reverts with nothing pending, before the timelock, and after an owner
    ///      veto. Nothing changes in any of these cases.
    function test_qcai51_h1_third_party_finalize_reverts_without_pending_before_timelock_and_after_veto() public {
        PocketVault v = pocketA();
        vm.prank(mallory);
        vm.expectRevert(PocketVault.NoRecoveryPending.selector);
        v.finalizeRecovery(G0, DL, "");

        _proposeThreshold(v);
        vm.warp(block.timestamp + RECOVERY_DELAY - 1);
        vm.prank(mallory);
        vm.expectRevert(PocketVault.TooEarly.selector);
        v.finalizeRecovery(G0, DL, "");

        v.vetoRecovery(DL, V("vetoRec_0")); // the current owner key vetoes
        vm.warp(block.timestamp + 1);
        vm.prank(mallory);
        vm.expectRevert(PocketVault.NoRecoveryPending.selector);
        v.finalizeRecovery(G0, DL, "");
        assertEq(v.owner(), OA);
        assertEq(v.epoch(), 0);
    }

    /// @dev H1: after the timelock, the caller of finalizeRecovery chooses nothing. For ANY caller the result is the
    ///      guardian-approved owner and key, the caller receives no value, and the Pocket keeps its balance.
    function testFuzz_qcai51_h1_finalize_outcome_is_independent_of_caller(address caller) public {
        vm.assume(caller != address(0) && caller.code.length == 0);
        PocketVault v = pocketA();
        _proposeThreshold(v);
        vm.warp(block.timestamp + RECOVERY_DELAY);
        uint256 pocketBal = address(v).balance;
        uint256 callerBal = caller.balance;
        bytes memory fin1 = _finSig(v, false);
        vm.prank(caller);
        v.finalizeRecovery(G0, DL, fin1);
        assertEq(v.owner(), OB);
        assertEq(v.ownerKeyHash(), keccak256(_pk("OB")));
        assertEq(v.epoch(), 1);
        assertEq(address(v).balance, pocketBal);
        assertEq(caller.balance, callerBal);
        assertTrue(v.owner() != caller || caller == OB);
    }

    /// @dev H1: the same holds for finalizeRecoveryUnanimous (all guardians signed; the caller chooses nothing).
    function testFuzz_qcai51_h1_unanimous_finalize_outcome_is_independent_of_caller(address caller) public {
        vm.assume(caller != address(0) && caller.code.length == 0);
        PocketVault v = pocketA();
        vm.prank(caller);
        vm.expectRevert(PocketVault.NoRecoveryPending.selector);
        v.finalizeRecoveryUnanimous(G0, DL, "");
        _proposeUnanimous(v);
        vm.prank(caller);
        vm.expectRevert(PocketVault.TooEarly.selector);
        v.finalizeRecoveryUnanimous(G0, DL, "");
        vm.warp(block.timestamp + UNANIMOUS_DELAY);
        uint256 pocketBal = address(v).balance;
        bytes memory fin2 = _finSig(v, true);
        vm.prank(caller);
        v.finalizeRecoveryUnanimous(G0, DL, fin2);
        assertEq(v.owner(), OB);
        assertEq(v.ownerKeyHash(), keccak256(_pk("OB")));
        assertEq(address(v).balance, pocketBal);
    }

    /// @dev H1: finalize fails closed if the approved key is no longer usable (re-checked at finalize time).
    function test_qcai51_h1_finalize_rechecks_the_approved_key() public {
        PocketVault v = pocketA();
        _proposeThreshold(v);
        keys.set(OB, true, 1, _pk("OB"), false); // possession no longer proven
        vm.warp(block.timestamp + RECOVERY_DELAY);
        vm.prank(mallory);
        vm.expectRevert();
        v.finalizeRecovery(G0, DL, "");
        assertEq(v.owner(), OA);
    }

    /// @dev L4: the guardian set is capped at MAX_GUARDIANS = 5 at deployment, so no Pocket can hold a set large
    ///      enough to make `_checkGuardianSigs` expensive.
    function test_qcai51_l4_six_guardians_rejected_at_deploy() public {
        address[] memory g6 = new address[](6);
        g6[0] = G0;
        g6[1] = G1;
        g6[2] = G2;
        g6[3] = G3;
        g6[4] = r(0);
        g6[5] = r(1);
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        factory.deploy(OA, g6, 2, 2 ether, bytes32(uint256(77)));
        assertEq(impl.MAX_GUARDIANS(), 5);
    }

    /// @dev L4: worst case (5 guardians, 5 signers) measured; the loop part is a few thousand gas plus 5 precompile
    ///      calls, far below the block gas limit.
    function test_qcai51_l4_worst_case_five_signer_check_is_bounded() public {
        address[] memory g5 = new address[](5);
        g5[0] = G0;
        g5[1] = G1;
        g5[2] = G2;
        g5[3] = G3;
        g5[4] = r(0);
        PocketVault v5 =
            deployPocket(Cfg({owner: OA, guardians: g5, threshold: 5, limit: 2 ether, salt: bytes32(uint256(98))}));
        bytes memory m = PqcLib.pqMessage(v5.freezeDigest(0, DL));
        bytes memory sig = new bytes(PqcLib.ML_DSA_87_SIG_LEN);
        string[5] memory names = ["G0", "G1", "G2", "G3", "R0"];
        bytes[] memory sigs = new bytes[](5);
        for (uint256 i; i < 5; i++) {
            verifier.accept(keccak256(abi.encode(_pk(names[i]), sig, m)));
            sigs[i] = sig;
        }
        uint256 g = gasleft();
        v5.guardianFreeze(g5, sigs, 0, DL);
        uint256 used = g - gasleft();
        emit log_named_uint("guardianFreeze gas, 5 of 5 signers (mock verifier)", used);
        assertTrue(v5.frozen());
        assertLt(used, 2_000_000);
    }
}

/// @notice Drip bounds (M2) and Payout reentrancy (M3) on the deployed v5.1 PocketDrop.
contract QcaiV51DropTest is V4Base {
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

    /// @dev M2: at the extreme constructor bounds (every limit = type(uint96).max) any pair of drips either fits under
    ///      the cap and is recorded exactly, or reverts DailyDripCapExceeded. It never wraps and never panics.
    function testFuzz_qcai51_m2_drip_sum_never_wraps_at_extreme_bounds(uint96 a, uint96 b) public {
        uint96 max96 = type(uint96).max;
        PocketDrop x = new PocketDrop(1, max96, max96, max96, BIND_TIMEOUT, 30 days);
        bytes32 lk = keccak256("lk");
        uint64 exp = uint64(block.timestamp + 1 days);
        vm.deal(alice, uint256(max96) * 3);
        vm.startPrank(alice);
        x.create{value: uint256(a) + 1}(lk, 0, exp, a, 0);
        assertEq(x.dripUsedToday(alice), a);
        if (uint256(a) + uint256(b) > max96) {
            vm.expectRevert(PocketDrop.DailyDripCapExceeded.selector);
            x.create{value: uint256(b) + 1}(lk, 0, exp, b, 0);
            assertEq(x.dripUsedToday(alice), a);
        } else {
            x.create{value: uint256(b) + 1}(lk, 0, exp, b, 0);
            assertEq(x.dripUsedToday(alice), uint256(a) + uint256(b));
        }
        vm.stopPrank();
        assertLe(x.dripUsedToday(alice), x.DAILY_DRIP_CAP());
    }

    /// @dev M2: the cap is exact on the production parameters (cap 10 QOR, max drip 0.6 QOR): reaching the cap
    ///      exactly is allowed, one more wei is not, and a drip above MAX_DRIP is refused on its own.
    function test_qcai51_m2_cap_is_exact_and_drip_is_bounded() public {
        bytes32 k = keccak256("k");
        uint64 exp = uint64(block.timestamp + 7 days);
        vm.startPrank(alice);
        for (uint256 i; i < 16; i++) {
            drop.create{value: 1.6 ether}(k, 0, exp, 0.6 ether, 0);
        }
        drop.create{value: 1.4 ether}(k, 0, exp, 0.4 ether, 0);
        assertEq(drop.dripUsedToday(alice), 10 ether);
        vm.expectRevert(PocketDrop.DailyDripCapExceeded.selector);
        drop.create{value: 1 ether + 1}(k, 0, exp, 1, 0);
        vm.expectRevert(PocketDrop.DripTooHigh.selector);
        drop.create{value: 2 ether}(k, 0, exp, 0.6 ether + 1, 0);
        vm.stopPrank();
        assertEq(drop.dripUsedToday(alice), 10 ether);
    }

    /// @dev M3: a receiver that re-enters every value-moving entry point during its payout is refused each time with
    ///      `Reentrancy`; the claim completes once and the contract pays exactly the escrow, once.
    function test_qcai51_m3_reentry_into_every_entry_point_is_refused() public {
        bytes[5] memory calls = [
            abi.encodeCall(drop.withdraw, ()),
            abi.encodeCall(drop.claim, (uint256(1), bytes(""))),
            abi.encodeCall(drop.refund, (uint256(1))),
            abi.encodeCall(drop.cancel, (uint256(1))),
            abi.encodeCall(drop.confirmRecipient, (uint256(1), bytes32(0)))
        ];
        for (uint256 k; k < calls.length; k++) {
            uint256 snap = vm.snapshotState();
            uint256 id = _createO();
            _bind(id, 0);
            address pt = _payTo(0);
            _etch(pt, HostileReceiver.B.Reenter, address(drop), calls[k]);
            uint256 dropBefore = address(drop).balance;
            uint256 ptBefore = pt.balance;
            _claim(id, 0);
            assertEq(HostileReceiver(payable(pt)).hits(), 1);
            assertFalse(HostileReceiver(payable(pt)).lastOk());
            assertEq(HostileReceiver(payable(pt)).lastSel(), Payout.Reentrancy.selector);
            assertEq(pt.balance - ptBefore, 1 ether);
            assertEq(dropBefore - address(drop).balance, 1 ether);
            assertEq(uint8(drop.getLink(id).state), uint8(PocketDrop.State.Claimed));
            assertEq(drop.totalPending(), 0);
            vm.revertToState(snap);
        }
    }

    /// @dev M3: the pull-balance fallback is CEI: `pending` is zeroed before the value call, so a receiver that
    ///      re-enters `withdraw` from its own withdraw gets `Reentrancy` and is paid exactly once.
    function test_qcai51_m3_deferred_balance_is_paid_exactly_once() public {
        uint256 id = _createO();
        _bind(id, 0);
        address pt = _payTo(0);
        _etch(pt, HostileReceiver.B.Revert, address(0), "");
        _claim(id, 0);
        assertEq(drop.pending(pt), 1 ether);
        assertEq(drop.totalPending(), 1 ether);
        assertGe(address(drop).balance, drop.totalPending());

        HostileReceiver(payable(pt)).configure(HostileReceiver.B.Reenter, address(drop), abi.encodeCall(drop.withdraw, ()));
        uint256 before = pt.balance;
        vm.prank(pt);
        drop.withdraw();
        assertEq(pt.balance - before, 1 ether);
        assertEq(HostileReceiver(payable(pt)).lastSel(), Payout.Reentrancy.selector);
        assertEq(drop.pending(pt), 0);
        assertEq(drop.totalPending(), 0);
        vm.prank(pt);
        vm.expectRevert(Payout.NothingToWithdraw.selector);
        drop.withdraw();
    }
}
