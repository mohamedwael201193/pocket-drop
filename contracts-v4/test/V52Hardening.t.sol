// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4Base} from "./Base.t.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {PocketDrop} from "../src/PocketDrop.sol";
import {PocketRouter} from "../src/PocketRouter.sol";
import {Payout} from "../src/Payout.sol";
import {IPocketFactory} from "../src/interfaces/IPocket.sol";
import {HostileReceiver} from "./mocks/Hostile.sol";

/// @dev Exposes `_pay` with and without the lock, to prove a payout can only run under `nonReentrant`.
contract PayoutHarness is Payout {
    function payWithoutLock(address to, uint256 value) external payable {
        _pay(to, value);
    }

    function payLocked(address to, uint256 value) external payable nonReentrant {
        _pay(to, value);
    }
}

/// @notice v5.2 hardening: explicit finalize authorization, vault reentrancy lock, target checks, Payout lock
///         assertion, drip bounds and router zero-address checks.
contract V52HardeningTest is V4Base {
    PocketVault internal v;

    event RecoveryFinalizeAuthorized(address indexed authorizer, uint256 recoveryNonce, bool unanimous);
    event PayoutSent(address indexed to, uint256 amount);
    event PayoutDeferred(address indexed to, uint256 amount);

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

    /*---------------- finalize access control ----------------*/

    function test_v52_finalize_by_unrelated_account_is_not_authorized() public {
        _proposeT();
        vm.warp(block.timestamp + RECOVERY_DELAY);
        bytes memory s = _finSigBy(v, false, r(0), "R0", DL); // a registered key, but no role in this Pocket
        vm.expectRevert(PocketVault.NotAuthorized.selector);
        v.finalizeRecovery(r(0), DL, s);
        vm.expectRevert(PocketVault.NotAuthorized.selector);
        v.finalizeRecovery(address(0), DL, s);
        assertEq(v.owner(), OA);
    }

    function test_v52_finalize_threshold_by_guardian_owner_or_new_owner() public {
        uint256 snap = vm.snapshotState();
        address[3] memory who = [G0, OA, OB];
        string[3] memory names = ["G0", "OA", "OB"];
        for (uint256 i; i < 3; i++) {
            _proposeT();
            vm.warp(block.timestamp + RECOVERY_DELAY);
            bytes memory s = _finSigBy(v, false, who[i], names[i], DL);
            vm.expectEmit(true, false, false, true, address(v));
            emit RecoveryFinalizeAuthorized(who[i], 1, false);
            vm.prank(mallory); // the submitter is irrelevant
            v.finalizeRecovery(who[i], DL, s);
            assertEq(v.owner(), OB);
            assertEq(v.ownerKeyHash(), keccak256(_pk("OB")));
            assertEq(v.recoveryAt(), 0);
            vm.revertToState(snap);
        }
    }

    function test_v52_finalize_unanimous_rejects_the_old_owner_and_accepts_guardian_or_new_owner() public {
        _proposeU();
        vm.warp(block.timestamp + UNANIMOUS_DELAY);
        bytes memory sOld = _finSigBy(v, true, OA, "OA", DL);
        vm.expectRevert(PocketVault.NotAuthorized.selector);
        v.finalizeRecoveryUnanimous(OA, DL, sOld);

        uint256 snap = vm.snapshotState();
        bytes memory sG = _finSigBy(v, true, G2, "G2", DL);
        v.finalizeRecoveryUnanimous(G2, DL, sG);
        assertEq(v.owner(), OB);
        vm.revertToState(snap);

        bytes memory sNew = _finSigBy(v, true, OB, "OB", DL);
        vm.expectEmit(true, false, false, true, address(v));
        emit RecoveryFinalizeAuthorized(OB, 1, true);
        v.finalizeRecoveryUnanimous(OB, DL, sNew);
        assertEq(v.owner(), OB);
        assertEq(v.uRecoveryAt(), 0);
    }

    function test_v52_finalize_rejects_wrong_signer_expired_and_cross_path_authorizations() public {
        _proposeT();
        vm.warp(block.timestamp + RECOVERY_DELAY);
        // G1's authorization presented as G0's
        bytes memory sG1 = _finSigBy(v, false, G1, "G1", DL);
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.finalizeRecovery(G0, DL, sG1);
        // an authorization for the unanimous action is not one for the threshold action
        bytes memory sU = _finSigBy(v, true, G0, "G0", DL);
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.finalizeRecovery(G0, DL, sU);
        // expired
        uint256 past = block.timestamp - 1;
        bytes memory sPast = _finSigBy(v, false, G0, "G0", past);
        vm.expectRevert(PocketVault.Expired.selector);
        v.finalizeRecovery(G0, past, sPast);
        assertEq(v.owner(), OA);
    }

    function test_v52_finalize_authorization_is_bound_to_one_proposal() public {
        _proposeT();
        bytes memory s0 = _finSig(v, false); // authorization for recovery nonce 1
        v.vetoRecovery(DL, V("vetoRec_0"));
        v.proposeRecovery(OB, keccak256(_pk("OB")), DL, _pair(G0, G1), _b2(V("rec_G0_1"), V("rec_G1_1")));
        vm.warp(block.timestamp + RECOVERY_DELAY);
        vm.expectRevert(PocketVault.BadSignature.selector);
        v.finalizeRecovery(G0, DL, s0);
        bytes memory s1 = _finSig(v, false);
        v.finalizeRecovery(G0, DL, s1);
        assertEq(v.owner(), OB);
    }

    function test_v52_finalize_digest_rejects_unknown_actions_and_binds_the_pending_owner() public {
        vm.expectRevert(PocketVault.BadParams.selector);
        v.finalizeDigest(keccak256("OTHER"), G0, DL);
        bytes32 before = v.finalizeDigest(v.ACT_FINALIZE_RECOVERY(), G0, DL);
        _proposeT();
        bytes32 afterPropose = v.finalizeDigest(v.ACT_FINALIZE_RECOVERY(), G0, DL);
        assertTrue(before != afterPropose);
        assertTrue(afterPropose != v.finalizeDigest(v.ACT_FINALIZE_RECOVERY(), G1, DL));
        assertTrue(afterPropose != v.finalizeDigest(v.ACT_FINALIZE_RECOVERY_UNANIMOUS(), G0, DL));
        assertTrue(afterPropose != v.finalizeDigest(v.ACT_FINALIZE_RECOVERY(), G0, DL + 1));
    }

    /*---------------- vault reentrancy lock and targets ----------------*/

    function test_v52_vault_spend_receiver_cannot_reenter() public {
        vm.etch(SINK, address(new HostileReceiver()).code);
        HostileReceiver(payable(SINK))
            .configure(HostileReceiver.B.Reenter, address(v), abi.encodeCall(PocketVault.executeQueued, (1)));
        v.spend(SINK, 0.8 ether, DL, V("spendS_0"));
        assertEq(SINK.balance, 0.8 ether);
        assertEq(HostileReceiver(payable(SINK)).hits(), 1);
        assertFalse(HostileReceiver(payable(SINK)).lastOk());
        assertEq(HostileReceiver(payable(SINK)).lastSel(), PocketVault.Reentrancy.selector);
        // the lock is released after the call: the next intent works
        v.spend(SINK, 0.8 ether, DL, V("spendS_1"));
        assertEq(SINK.balance, 1.6 ether);
    }

    function test_v52_vault_drop_and_pool_targets_must_be_contracts() public {
        bytes memory sig = new bytes(4627);
        address[3] memory bad = [address(0), address(v), mallory];
        for (uint256 i; i < 3; i++) {
            vm.expectRevert(PocketVault.BadParams.selector);
            v.createDrop(bad[i], keccak256("k"), 0, uint64(block.timestamp + 1 days), 0, 0, 1 ether, DL, sig);
            vm.expectRevert(PocketVault.BadParams.selector);
            v.confirmDrop(bad[i], 1, bytes32(0), DL, sig);
            vm.expectRevert(PocketVault.BadParams.selector);
            v.cancelDrop(bad[i], 1, DL, sig);
            vm.expectRevert(PocketVault.BadParams.selector);
            v.createPool(bad[i], keccak256("k"), 1, 1 ether, uint64(block.timestamp + 1 days), DL, sig);
            vm.expectRevert(PocketVault.BadParams.selector);
            v.closePool(bad[i], 1, DL, sig);
        }
        assertEq(v.nonce(), 0);
    }

    /*---------------- Payout ----------------*/

    function test_v52_payout_only_runs_under_the_lock() public {
        PayoutHarness h = new PayoutHarness();
        vm.deal(address(this), 3 ether);
        vm.expectRevert(Payout.PayoutOutsideLock.selector);
        h.payWithoutLock{value: 1 ether}(alice(), 1 ether);

        vm.expectEmit(true, false, false, true, address(h));
        emit PayoutSent(alice(), 1 ether);
        h.payLocked{value: 1 ether}(alice(), 1 ether);
        assertEq(alice().balance, 1 ether);

        address nr = address(new PayoutHarness()); // no receive(): the push fails and is deferred
        vm.expectEmit(true, false, false, true, address(h));
        emit PayoutDeferred(nr, 1 ether);
        h.payLocked{value: 1 ether}(nr, 1 ether);
        assertEq(h.pending(nr), 1 ether);
        assertEq(h.totalPending(), 1 ether);
    }

    function alice() internal pure returns (address) {
        return address(uint160(0xa11ce5));
    }

    /*---------------- drip bounds ----------------*/

    function test_v52_drip_cap_constructor_bound_and_spent_above_cap_is_refused() public {
        vm.expectRevert(PocketDrop.InvalidConfig.selector);
        maker.drop(1, 2, 1, uint256(type(uint128).max) + 1, 1, 1);
        PocketDrop ok = maker.drop(1, 2, 1, type(uint128).max, 1, 1);
        assertEq(ok.DAILY_DRIP_CAP(), type(uint128).max);

        // `spent` can never exceed the cap through the contract; force it in storage to show the explicit bound holds
        address s = makeAddr("sender");
        vm.deal(s, 10 ether);
        uint256 day = block.timestamp / 1 days;
        bytes32 slot = keccak256(abi.encode(day, keccak256(abi.encode(s, uint256(5))))); // _dripSpent at slot 5
        vm.store(address(drop), slot, bytes32(uint256(10 ether + 1)));
        assertEq(drop.dripUsedToday(s), 10 ether + 1);
        vm.prank(s);
        vm.expectRevert(PocketDrop.DailyDripCapExceeded.selector);
        drop.create{value: 1 ether}(keccak256("k"), 0, uint64(block.timestamp + 1 days), 0, 0);
    }

    /*---------------- router ----------------*/

    function test_v52_router_rejects_zero_addresses() public {
        vm.expectRevert(PocketRouter.ZeroAddress.selector);
        new PocketRouter(IPocketFactory(address(0)), DROP, POOL);
        vm.expectRevert(PocketRouter.ZeroAddress.selector);
        new PocketRouter(IPocketFactory(FACTORY), address(0), POOL);
        vm.expectRevert(PocketRouter.ZeroAddress.selector);
        new PocketRouter(IPocketFactory(FACTORY), DROP, address(0));
    }
}
