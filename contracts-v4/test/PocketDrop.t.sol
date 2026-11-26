// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4Base} from "./Base.t.sol";
import {PocketDrop} from "../src/PocketDrop.sol";
import {Payout} from "../src/Payout.sol";
import {PqcLib} from "../src/PqcLib.sol";
import {HostileReceiver} from "./mocks/Hostile.sol";
import {RawMock} from "./mocks/MockPqc.sol";

contract PocketDropTest is V4Base {
    address internal alice = makeAddr("alice");

    function setUp() public override {
        super.setUp();
        vm.deal(alice, 1000 ether);
        vm.deal(relayer, 1 ether);
    }

    /*---------------- helpers ----------------*/

    function lkName(uint256 id) internal pure returns (string memory) {
        return string.concat("LK", vm.toString(id % 3));
    }

    function linkPk(uint256 id) internal view returns (bytes memory) {
        return _pk(lkName(id));
    }

    function rName(uint256 i) internal pure returns (string memory) {
        return string.concat("R", vm.toString(i));
    }

    function rHash(uint256 i) internal view returns (bytes32) {
        return keccak256(_pk(rName(i)));
    }

    function payTo(uint256 i) internal view returns (address) {
        return predict(cfgPR(i));
    }

    function id_(uint256 id, uint256 i) internal pure returns (string memory) {
        return string.concat(vm.toString(id), "_", vm.toString(i));
    }

    function create(uint8 mode, uint96 drip, uint96 fee) internal returns (uint256 id) {
        id = drop.linkCount() + 1;
        vm.prank(alice);
        drop.create{value: 1 ether + drip + fee}(keccak256(linkPk(id)), mode, uint64(block.timestamp + 7 days), drip, fee);
    }

    function createC() internal returns (uint256) {
        return create(0, 0.2 ether, 0.05 ether);
    }

    function createO() internal returns (uint256) {
        return create(1, 0.2 ether, 0.05 ether);
    }

    function bind(uint256 id, uint256 i) internal {
        bytes memory s = D(string.concat("bind_", id_(id, i)));
        address pt = payTo(i);
        bytes memory lpk = linkPk(id);
        bytes32 rh = rHash(i);
        vm.prank(relayer);
        drop.bind(id, r(i), rh, pt, FEE, lpk, s);
    }

    function confirm(uint256 id, uint256 i) internal {
        vm.prank(alice);
        drop.confirmRecipient(id, rHash(i));
    }

    function claim(uint256 id, uint256 i) internal {
        bytes memory s = D(string.concat("claim_", id_(id, i)));
        vm.prank(relayer);
        drop.claim(id, s);
    }

    /*---------------- constructor ----------------*/

    function test_constructor_validation() public {
        vm.expectRevert(PocketDrop.InvalidConfig.selector);
        maker.drop(0, 1, 0, 0, 1, 1);
        vm.expectRevert(PocketDrop.InvalidConfig.selector);
        maker.drop(2, 1, 0, 0, 1, 1);
        vm.expectRevert(PocketDrop.InvalidConfig.selector);
        maker.drop(1, uint256(type(uint96).max) + 1, 0, 0, 1, 1);
        vm.expectRevert(PocketDrop.InvalidConfig.selector);
        maker.drop(1, 2, uint256(type(uint96).max) + 1, type(uint256).max, 1, 1);
        vm.expectRevert(PocketDrop.InvalidConfig.selector);
        maker.drop(1, 2, 2, 1, 1, 1);
        vm.expectRevert(PocketDrop.InvalidConfig.selector);
        maker.drop(1, 2, 0, 0, 0, 1);
        vm.expectRevert(PocketDrop.InvalidConfig.selector);
        maker.drop(1, 2, 0, 0, uint256(type(uint32).max) + 1, 1);
        vm.expectRevert(PocketDrop.InvalidConfig.selector);
        maker.drop(1, 2, 0, 0, 1, 0);
        vm.expectRevert(PocketDrop.InvalidConfig.selector);
        maker.drop(1, 2, 0, 0, 1, uint256(type(uint32).max) + 1);
        PocketDrop ok = maker.drop(1, 2, 0, 0, 1, 1);
        assertEq(ok.MIN_ESCROW(), 1);
    }

    /*---------------- create ----------------*/

    function test_create_validation() public {
        bytes32 k = keccak256("k");
        uint64 exp = uint64(block.timestamp + 7 days);
        vm.startPrank(alice);
        vm.expectRevert(PocketDrop.ZeroLinkKey.selector);
        drop.create{value: 1 ether}(bytes32(0), 0, exp, 0, 0);
        vm.expectRevert(PocketDrop.InvalidMode.selector);
        drop.create{value: 1 ether}(k, 2, exp, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(PocketDrop.AmountOutOfRange.selector, 0));
        drop.create{value: 0.1 ether}(k, 0, exp, 0.2 ether, 0);
        vm.expectRevert(abi.encodeWithSelector(PocketDrop.AmountOutOfRange.selector, 0.05 ether));
        drop.create{value: 0.05 ether}(k, 0, exp, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(PocketDrop.AmountOutOfRange.selector, 51 ether));
        drop.create{value: 51 ether}(k, 0, exp, 0, 0);
        vm.expectRevert(PocketDrop.DripTooHigh.selector);
        drop.create{value: 2 ether}(k, 0, exp, 0.7 ether, 0);
        vm.expectRevert(PocketDrop.InvalidExpiry.selector);
        drop.create{value: 1 ether}(k, 0, uint64(block.timestamp), 0, 0);
        vm.expectRevert(PocketDrop.InvalidExpiry.selector);
        drop.create{value: 1 ether}(k, 0, uint64(block.timestamp + 30 days + 1), 0, 0);
        vm.stopPrank();
    }

    function test_daily_drip_cap() public {
        bytes32 k = keccak256("k");
        uint64 exp = uint64(block.timestamp + 7 days);
        vm.startPrank(alice);
        for (uint256 i; i < 16; i++) {
            drop.create{value: 1.6 ether}(k, 0, exp, 0.6 ether, 0);
        }
        assertEq(drop.dripUsedToday(alice), 9.6 ether);
        vm.expectRevert(PocketDrop.DailyDripCapExceeded.selector);
        drop.create{value: 1.6 ether}(k, 0, exp, 0.6 ether, 0);
        vm.warp(block.timestamp + 1 days);
        drop.create{value: 1.6 ether}(k, 0, exp, 0.6 ether, 0);
        vm.stopPrank();
    }

    function test_create_records_link() public {
        uint256 id = createC();
        PocketDrop.Link memory l = drop.getLink(id);
        assertEq(l.sender, alice);
        assertEq(uint8(l.state), uint8(PocketDrop.State.Open));
        assertEq(l.amount, 1 ether);
        assertEq(l.drip, 0.2 ether);
        assertEq(l.relayerFee, 0.05 ether);
        assertEq(l.expiry, EXP);
        assertEq(drop.unpaidOf(id), 1.25 ether);
        assertEq(address(drop).balance, 1.25 ether);
    }

    /*---------------- bind ----------------*/

    function test_bind_pays_drip_to_pocket_and_fee_to_relayer() public {
        uint256 id = createC();
        uint256 r0 = FEE.balance;
        bind(id, 0);
        PocketDrop.Link memory l = drop.getLink(id);
        assertEq(uint8(l.state), uint8(PocketDrop.State.Bound));
        assertEq(l.recipient, r(0));
        assertEq(l.payTo, payTo(0));
        assertEq(l.recipientKeyHash, rHash(0));
        assertEq(l.bindDeadline, block.timestamp + BIND_TIMEOUT);
        assertEq(r(0).balance, 0.2 ether, "drip lands in the recipient ACCOUNT (gas money for its PQ registration)");
        assertEq(payTo(0).balance, 0);
        assertEq(FEE.balance, r0 + 0.05 ether, "v5.1: the fee goes to the signed feeTo");
        assertEq(drop.unpaidOf(id), 1 ether);
    }

    /// @dev v5.1 F1 regression: a front-runner who copies a pending first bind cannot take the relayer fee. The fee
    ///      goes to the `feeTo` the link key signed, whoever submits; changing `feeTo` breaks the link signature.
    function test_v51_F1_frontrunner_cannot_take_the_relayer_fee() public {
        uint256 id = createC();
        bytes memory s = D("bind_1_0");
        bytes memory lpk = linkPk(id);
        address pt = payTo(0);
        bytes32 rh = rHash(0);
        // the thief swaps feeTo to itself: the link signature no longer matches
        vm.prank(mallory);
        vm.expectRevert(PocketDrop.BadLinkSignature.selector);
        drop.bind(id, r(0), rh, pt, mallory, lpk, s);
        // a link-key signature over another feeTo is not valid for FEE either
        vm.prank(mallory);
        vm.expectRevert(PocketDrop.BadLinkSignature.selector);
        drop.bind(id, r(0), rh, pt, FEE, lpk, D("bindFeeSink_1_0"));
        // the v5 bind form (no feeTo in the digest) is refused
        vm.prank(mallory);
        vm.expectRevert(PocketDrop.BadLinkSignature.selector);
        drop.bind(id, r(0), rh, pt, FEE, lpk, D("wBindV2"));
        // the thief submits the exact copy: the bind lands, but the fee goes to FEE, not to the thief
        uint256 mb = mallory.balance;
        uint256 fb = FEE.balance;
        vm.prank(mallory);
        drop.bind(id, r(0), rh, pt, FEE, lpk, s);
        assertEq(mallory.balance, mb, "front-runner gains nothing");
        assertEq(FEE.balance, fb + 0.05 ether);
    }

    function test_v51_F1_feeTo_must_be_a_real_address() public {
        uint256 id = createC();
        bytes memory s = D("bind_1_0");
        bytes memory lpk = linkPk(id);
        address pt = payTo(0);
        bytes32 rh = rHash(0);
        vm.expectRevert(PocketDrop.BadFeeTo.selector);
        drop.bind(id, r(0), rh, pt, address(0), lpk, s);
        vm.expectRevert(PocketDrop.BadFeeTo.selector);
        drop.bind(id, r(0), rh, pt, address(drop), lpk, s);
    }

    function test_bind_rejects() public {
        bytes memory lpk1 = linkPk(1);
        bytes memory s1 = D("bind_1_0");
        address pt1 = payTo(0);
        bytes32 rh1 = rHash(0);
        vm.expectRevert(PocketDrop.LinkNotFound.selector);
        drop.bind(1, r(0), rh1, pt1, FEE, lpk1, s1);
        uint256 id = createC();
        address pt = payTo(0);
        bytes32 rh = rHash(0);
        bytes32 rhB = rHash(1);
        address paAddr = predict(cfgPA());
        bytes memory lpk = linkPk(id);
        bytes memory s = D("bind_1_0");
        vm.expectRevert(PocketDrop.BadRecipient.selector);
        drop.bind(id, address(0), rh, pt, FEE, lpk, s);
        vm.expectRevert(PocketDrop.BadRecipient.selector);
        drop.bind(id, address(drop), rh, pt, FEE, lpk, s);
        vm.expectRevert(PocketDrop.BadRecipient.selector);
        drop.bind(id, r(0), rh, address(0), FEE, lpk, s);
        vm.expectRevert(PocketDrop.BadRecipient.selector);
        drop.bind(id, r(0), rh, address(drop), FEE, lpk, s);
        vm.expectRevert(PocketDrop.ZeroRecipientKey.selector);
        drop.bind(id, r(0), bytes32(0), pt, FEE, lpk, s);
        vm.expectRevert(PocketDrop.LinkKeyMismatch.selector);
        drop.bind(id, r(0), rh, pt, FEE, _pk("LK0"), s);
        // swapped recipient / payTo after the link key signed (the mempool-thief attack)
        vm.expectRevert(PocketDrop.BadLinkSignature.selector);
        drop.bind(id, r(1), rhB, pt, FEE, lpk, s);
        vm.expectRevert(PocketDrop.BadLinkSignature.selector);
        drop.bind(id, r(0), rh, paAddr, FEE, lpk, s);
        vm.expectRevert(PocketDrop.BadLinkSignature.selector);
        drop.bind(id, r(0), rh, pt, FEE, lpk, D("wBindWrongKey"));
        vm.expectRevert(PocketDrop.BadLinkSignature.selector);
        drop.bind(id, r(0), rh, pt, FEE, lpk, D("wBindDomain"));
        vm.expectRevert(PocketDrop.BadLinkSignature.selector);
        drop.bind(id, r(0), rh, pt, FEE, lpk, D("wBindChain"));
        vm.expectRevert(PocketDrop.BadLinkSignature.selector);
        drop.bind(id, r(0), rh, pt, FEE, lpk, D("wBindContract"));
        vm.expectRevert(PocketDrop.BadLinkSignature.selector);
        drop.bind(id, r(0), rh, pt, FEE, lpk, D("bindRaw_1_0")); // real sig, no QoreX prefix
        vm.expectRevert(PocketDrop.BadLinkSignature.selector);
        drop.bind(id, r(0), rh, pt, FEE, lpk, D("claim_1_0")); // a claim sig is not a bind sig
    }

    function test_bind_state_expiry_and_rebind() public {
        uint256 id = createC();
        bind(id, 0);
        bytes memory s = D("bind_1_1");
        bytes memory lpk = linkPk(id);
        address pt1 = payTo(1);
        bytes32 rh1 = rHash(1);
        // still exclusive
        vm.expectRevert(abi.encodeWithSelector(PocketDrop.InvalidState.selector, PocketDrop.State.Bound));
        drop.bind(id, r(1), rh1, pt1, FEE, lpk, s);
        vm.warp(block.timestamp + BIND_TIMEOUT + 1);
        uint256 rb = FEE.balance;
        drop.bind(id, r(1), rh1, pt1, FEE, lpk, s);
        assertEq(drop.getLink(id).recipient, r(1));
        assertEq(FEE.balance, rb, "no second drip or fee");
        assertEq(r(1).balance, 0);
        // expiry
        vm.warp(EXP);
        bytes memory s0 = D("bind_1_0");
        address pt0 = payTo(0);
        bytes32 rh0 = rHash(0);
        vm.warp(block.timestamp + BIND_TIMEOUT + 1);
        vm.expectRevert(PocketDrop.Expired.selector);
        drop.bind(id, r(0), rh0, pt0, FEE, lpk, s0);
    }

    /*---------------- confirm ----------------*/

    function test_confirm_rules() public {
        uint256 id = createC();
        vm.expectRevert(abi.encodeWithSelector(PocketDrop.InvalidState.selector, PocketDrop.State.Open));
        vm.prank(alice);
        drop.confirmRecipient(id, bytes32(0));
        bind(id, 0);
        vm.expectRevert(PocketDrop.RecipientChanged.selector);
        vm.prank(alice);
        drop.confirmRecipient(id, rHash(1));
        vm.expectRevert(PocketDrop.NotSender.selector);
        vm.prank(mallory);
        drop.confirmRecipient(id, rHash(0));
        confirm(id, 0);
        assertEq(uint8(drop.getLink(id).state), uint8(PocketDrop.State.Confirmed));
        vm.expectRevert(abi.encodeWithSelector(PocketDrop.InvalidState.selector, PocketDrop.State.Confirmed));
        vm.prank(alice);
        drop.confirmRecipient(id, rHash(0));
    }

    function test_confirm_wrong_mode_and_deadline_and_expiry() public {
        uint256 o = createO();
        bind(o, 0);
        vm.expectRevert(PocketDrop.WrongMode.selector);
        vm.prank(alice);
        drop.confirmRecipient(o, rHash(0));
        uint256 c1 = createC();
        bind(c1, 1);
        vm.warp(block.timestamp + BIND_TIMEOUT + 1);
        vm.expectRevert(PocketDrop.BindDeadlinePassed.selector);
        vm.prank(alice);
        drop.confirmRecipient(c1, rHash(1));
        vm.warp(EXP);
        vm.expectRevert(PocketDrop.Expired.selector);
        vm.prank(alice);
        drop.confirmRecipient(c1, rHash(1));
    }

    /*---------------- claim ----------------*/

    function test_confirmed_claim_pays_the_pocket() public {
        uint256 id = createC();
        bind(id, 0);
        confirm(id, 0);
        claim(id, 0);
        assertEq(uint8(drop.getLink(id).state), uint8(PocketDrop.State.Claimed));
        assertEq(payTo(0).balance, 1 ether);
        assertEq(r(0).balance, 0.2 ether);
        assertEq(address(drop).balance, 0);
        vm.expectRevert(abi.encodeWithSelector(PocketDrop.InvalidState.selector, PocketDrop.State.Claimed));
        drop.claim(id, hex"00");
    }

    function test_confirmed_mode_cannot_claim_before_confirm() public {
        uint256 id = createC();
        bind(id, 0);
        bytes memory s = D("claim_1_0");
        vm.expectRevert(abi.encodeWithSelector(PocketDrop.InvalidState.selector, PocketDrop.State.Bound));
        drop.claim(id, s);
    }

    function test_open_mode_claim_window() public {
        uint256 id = createO();
        bytes memory s = D("claim_1_0");
        vm.expectRevert(abi.encodeWithSelector(PocketDrop.InvalidState.selector, PocketDrop.State.Open));
        drop.claim(id, s);
        bind(id, 0);
        vm.warp(block.timestamp + BIND_TIMEOUT + 1);
        vm.expectRevert(PocketDrop.BindDeadlinePassed.selector);
        drop.claim(id, s);
        vm.warp(block.timestamp - BIND_TIMEOUT - 1);
        claim(id, 0);
        assertEq(payTo(0).balance, 1 ether);
    }

    function test_claim_expired() public {
        uint256 id = createO();
        bind(id, 0);
        bytes memory s = D("claim_1_0");
        vm.warp(EXP);
        // the bind deadline passes first in Open mode; make the deadline irrelevant by checking Confirmed mode
        uint256 c1 = createC();
        vm.expectRevert(PocketDrop.BindDeadlinePassed.selector);
        drop.claim(id, s);
        assertEq(c1, 2);
    }

    function test_claim_expired_in_confirmed_mode() public {
        uint256 id = createC();
        bind(id, 0);
        confirm(id, 0);
        bytes memory s = D("claim_1_0");
        vm.warp(EXP);
        vm.expectRevert(PocketDrop.Expired.selector);
        drop.claim(id, s);
    }

    function test_claim_key_requirements() public {
        uint256 id = createO();
        bind(id, 0);
        bytes memory s = D("claim_1_0");
        keys.set(r(0), false, 0, "", false);
        vm.expectRevert(PqcLib.NotRegistered.selector);
        drop.claim(id, s);
        keys.set(r(0), true, 1, _pk("R0"), false);
        vm.expectRevert(PqcLib.PossessionNotProven.selector);
        drop.claim(id, s);
        keys.set(r(0), true, 2, _pk("R0"), true);
        vm.expectRevert(PqcLib.UnsupportedAlgo.selector);
        drop.claim(id, s);
        keys.set(r(0), true, 1, _pk("R1"), true);
        vm.expectRevert(PqcLib.KeyMismatch.selector);
        drop.claim(id, s);
        vm.etch(KEYS_ADDR, address(new RawMock()).code);
        RawMock(KEYS_ADDR).set("", true);
        vm.expectRevert(PqcLib.KeyUnavailable.selector);
        drop.claim(id, s);
    }

    function test_claim_signature_checks() public {
        uint256 id = createO();
        bind(id, 0);
        vm.expectRevert(PocketDrop.BadRecipientSignature.selector);
        drop.claim(id, D("claim_1_1")); // someone else's claim signature
        vm.expectRevert(PocketDrop.BadRecipientSignature.selector);
        drop.claim(id, D("wClaimDomain"));
        vm.expectRevert(PocketDrop.BadRecipientSignature.selector);
        drop.claim(id, D("wClaimChain"));
        vm.expectRevert(PocketDrop.BadRecipientSignature.selector);
        drop.claim(id, D("wClaimContract"));
        vm.expectRevert(PocketDrop.BadRecipientSignature.selector);
        drop.claim(id, D("bind_1_0")); // a bind signature (link key) is not a claim signature
    }

    function test_claim_to_plain_account_payto() public {
        uint256 id = createO();
        bytes memory lpk = linkPk(id);
        bytes memory bs = D("bindPlain_1_0");
        drop.bind(id, r(0), rHash(0), r(0), FEE, lpk, bs);
        drop.claim(id, D("claimPlain_1_0"));
        assertEq(r(0).balance, 1.2 ether);
    }

    /*---------------- cancel / refund ----------------*/

    function test_cancel_open_returns_everything() public {
        uint256 id = createC();
        uint256 b = alice.balance;
        vm.expectRevert(PocketDrop.NotSender.selector);
        drop.cancel(id);
        vm.prank(alice);
        drop.cancel(id);
        assertEq(alice.balance, b + 1.25 ether);
        assertEq(uint8(drop.getLink(id).state), uint8(PocketDrop.State.Cancelled));
        assertEq(drop.unpaidOf(id), 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PocketDrop.InvalidState.selector, PocketDrop.State.Cancelled));
        drop.cancel(id);
    }

    function test_cancel_bound_confirmed_mode_but_not_open_mode() public {
        uint256 c1 = createC();
        bind(c1, 0);
        uint256 b = alice.balance;
        vm.prank(alice);
        drop.cancel(c1);
        assertEq(alice.balance, b + 1 ether, "drip already paid out");
        uint256 o = createO();
        bind(o, 0);
        vm.expectRevert(abi.encodeWithSelector(PocketDrop.InvalidState.selector, PocketDrop.State.Bound));
        vm.prank(alice);
        drop.cancel(o);
    }

    function test_refund_after_expiry_by_anyone() public {
        uint256 id = createC();
        vm.expectRevert(PocketDrop.NotExpired.selector);
        drop.refund(id);
        vm.warp(EXP);
        uint256 b = alice.balance;
        vm.prank(mallory);
        drop.refund(id);
        assertEq(alice.balance, b + 1.25 ether);
        vm.expectRevert(abi.encodeWithSelector(PocketDrop.InvalidState.selector, PocketDrop.State.Refunded));
        drop.refund(id);
        vm.expectRevert(PocketDrop.LinkNotFound.selector);
        drop.refund(99);
    }

    /*---------------- hostile receivers ----------------*/

    function _etchHostile(address at, HostileReceiver.B b, address target, bytes memory data) internal {
        vm.etch(at, address(new HostileReceiver()).code);
        HostileReceiver(payable(at)).configure(b, target, data);
    }

    function test_reverting_pocket_defers_payout_and_withdraw_works_later() public {
        uint256 id = createO();
        address pt = payTo(0);
        bind(id, 0); // drip to pt (EOA at this point)
        _etchHostile(pt, HostileReceiver.B.Revert, address(0), "");
        claim(id, 0);
        assertEq(drop.pending(pt), 1 ether);
        assertEq(drop.totalPending(), 1 ether);
        assertEq(uint8(drop.getLink(id).state), uint8(PocketDrop.State.Claimed));
        vm.prank(pt);
        vm.expectRevert(Payout.WithdrawFailed.selector);
        drop.withdraw();
        HostileReceiver(payable(pt)).setBehavior(HostileReceiver.B.Accept);
        vm.prank(pt);
        drop.withdraw();
        assertEq(drop.pending(pt), 0);
        assertEq(drop.totalPending(), 0);
        vm.prank(pt);
        vm.expectRevert(Payout.NothingToWithdraw.selector);
        drop.withdraw();
    }

    function test_gas_burning_pocket_cannot_block_claim() public {
        uint256 id = createO();
        bind(id, 0);
        _etchHostile(payTo(0), HostileReceiver.B.Burn, address(0), "");
        claim(id, 0);
        assertEq(drop.pending(payTo(0)), 1 ether);
    }

    function test_reentrant_pocket_is_blocked_by_the_lock() public {
        uint256 id = createO();
        bind(id, 0);
        address pt = payTo(0);
        _etchHostile(pt, HostileReceiver.B.Reenter, address(drop), abi.encodeCall(drop.withdraw, ()));
        claim(id, 0);
        assertEq(HostileReceiver(payable(pt)).hits(), 1);
        assertFalse(HostileReceiver(payable(pt)).lastOk());
        assertEq(HostileReceiver(payable(pt)).lastSel(), Payout.Reentrancy.selector);
        assertEq(uint8(drop.getLink(id).state), uint8(PocketDrop.State.Claimed));
    }

    function test_hostile_sender_cancel_is_deferred() public {
        address h = makeAddr("hostileSender");
        vm.etch(h, address(new HostileReceiver()).code);
        vm.deal(h, 5 ether);
        uint64 exp = uint64(block.timestamp + 7 days);
        (bool ok,) = HostileReceiver(payable(h)).exec(
            address(drop), abi.encodeCall(drop.create, (keccak256(linkPk(1)), 0, exp, 0, 0)), 1 ether
        );
        assertTrue(ok);
        HostileReceiver(payable(h)).setBehavior(HostileReceiver.B.Revert);
        (ok,) = HostileReceiver(payable(h)).exec(address(drop), abi.encodeCall(drop.cancel, (1)), 0);
        assertTrue(ok, "cancel itself succeeds");
        assertEq(drop.pending(h), 1 ether);
    }

    /*---------------- views ----------------*/

    function test_digests_commit_to_everything() public view {
        bytes32 b = drop.bindDigest(1, r(0), rHash(0), payTo(0), FEE);
        assertEq(
            b,
            keccak256(
                abi.encode("POCKETDROP_BIND_V3", block.chainid, address(drop), uint256(1), r(0), rHash(0), payTo(0), FEE)
            )
        );
        assertTrue(b != drop.bindDigest(1, r(0), rHash(0), payTo(0), SINK), "v5.1 F1: feeTo is signed");
        assertTrue(b != drop.bindDigest(2, r(0), rHash(0), payTo(0), FEE));
        assertTrue(b != drop.bindDigest(1, r(1), rHash(0), payTo(0), FEE));
        assertTrue(b != drop.bindDigest(1, r(0), rHash(1), payTo(0), FEE));
        assertTrue(b != drop.bindDigest(1, r(0), rHash(0), payTo(1), FEE));
        bytes32 cl = drop.claimDigest(1, r(0), payTo(0));
        assertEq(
            cl, keccak256(abi.encode("POCKETDROP_CLAIM_V2", block.chainid, address(drop), uint256(1), r(0), payTo(0)))
        );
    }

    function test_zero_drip_and_fee_pay_nothing_at_bind_and_cancel() public {
        uint256 id = create(1, 0, 0);
        uint256 b = r(0).balance;
        bind(id, 0);
        assertEq(r(0).balance, b);
        vm.warp(EXP);
        vm.prank(mallory);
        drop.refund(id);
        assertEq(drop.unpaidOf(id), 0);
    }
}
