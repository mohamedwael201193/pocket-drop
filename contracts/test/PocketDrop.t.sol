// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {PocketDrop} from "../src/PocketDrop.sol";
import {IPocketDrop} from "../src/interfaces/IPocketDrop.sol";
import {RawMock} from "./mocks/MockPqc.sol";
import {HostileActor} from "./mocks/Actors.sol";

/// @notice Unit tests: every function, every branch and every custom error.
contract PocketDropTest is Base {
    event LinkCreated(
        uint256 indexed linkId,
        address indexed sender,
        IPocketDrop.Mode mode,
        uint256 amount,
        uint256 drip,
        uint256 relayerFee,
        uint64 expiry,
        bytes32 linkKeyHash
    );
    event LinkBound(
        uint256 indexed linkId,
        address indexed recipient,
        bytes32 recipientKeyHash,
        uint64 bindDeadline,
        bool rebind,
        address relayer
    );
    event LinkConfirmed(uint256 indexed linkId, address indexed recipient, bytes32 recipientKeyHash);
    event LinkClaimed(uint256 indexed linkId, address indexed recipient, uint256 amount, address relayer);
    event LinkCancelled(uint256 indexed linkId, address indexed sender, uint256 refunded);
    event LinkRefunded(uint256 indexed linkId, address indexed sender, uint256 refunded, address caller);
    event DripPaid(uint256 indexed linkId, address indexed recipient, uint256 drip, address indexed relayer, uint256 relayerFee);
    event PayoutDeferred(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    function _revertWith(bytes4 sel) internal {
        vm.expectRevert(sel);
    }

    function _revertState(IPocketDrop.State s) internal {
        vm.expectRevert(abi.encodeWithSelector(IPocketDrop.InvalidState.selector, s));
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    function test_constructor_sets_constants() public view {
        assertEq(pd.MIN_ESCROW(), MIN_ESCROW);
        assertEq(pd.MAX_AMOUNT(), MAX_AMOUNT);
        assertEq(pd.MAX_DRIP(), MAX_DRIP);
        assertEq(pd.DAILY_DRIP_CAP(), DAILY_DRIP_CAP);
        assertEq(pd.BIND_TIMEOUT(), BIND_TIMEOUT);
        assertEq(pd.MAX_EXPIRY(), MAX_EXPIRY);
        assertEq(pd.linkCount(), 0);
    }

    function test_constructor_rejects_bad_config() public {
        uint256 big = uint256(type(uint96).max) + 1;
        uint256 bigT = uint256(type(uint32).max) + 1;
        // minEscrow == 0
        vm.expectRevert(IPocketDrop.InvalidConfig.selector);
        new PocketDrop(0, 10, 1, 2, 1, 1);
        // maxAmount < minEscrow
        vm.expectRevert(IPocketDrop.InvalidConfig.selector);
        new PocketDrop(10, 9, 1, 2, 1, 1);
        // maxAmount > uint96
        vm.expectRevert(IPocketDrop.InvalidConfig.selector);
        new PocketDrop(1, big, 1, 2, 1, 1);
        // maxDrip > uint96
        vm.expectRevert(IPocketDrop.InvalidConfig.selector);
        new PocketDrop(1, 10, big, big + 1, 1, 1);
        // dailyDripCap < maxDrip
        vm.expectRevert(IPocketDrop.InvalidConfig.selector);
        new PocketDrop(1, 10, 5, 4, 1, 1);
        // bindTimeout == 0 / too large
        vm.expectRevert(IPocketDrop.InvalidConfig.selector);
        new PocketDrop(1, 10, 1, 2, 0, 1);
        vm.expectRevert(IPocketDrop.InvalidConfig.selector);
        new PocketDrop(1, 10, 1, 2, bigT, 1);
        // maxExpiry == 0 / too large
        vm.expectRevert(IPocketDrop.InvalidConfig.selector);
        new PocketDrop(1, 10, 1, 2, 1, 0);
        vm.expectRevert(IPocketDrop.InvalidConfig.selector);
        new PocketDrop(1, 10, 1, 2, 1, bigT);
        // boundary values are accepted
        new PocketDrop(1, type(uint96).max, type(uint96).max, type(uint96).max, type(uint32).max, type(uint32).max);
    }

    /*//////////////////////////////////////////////////////////////
                                CREATE
    //////////////////////////////////////////////////////////////*/

    function test_create_stores_link_and_emits() public {
        uint256 id = nextId();
        bytes32 lkh = linkKeyHash(id);
        uint64 expiry = uint64(block.timestamp + 7 days);
        vm.expectEmit(true, true, false, true, address(pd));
        emit LinkCreated(id, alice, IPocketDrop.Mode.Confirmed, 1 ether, 0.2 ether, 0.05 ether, expiry, lkh);
        vm.prank(alice);
        uint256 got = pd.create{value: 1.25 ether}(lkh, CONFIRMED, expiry, 0.2 ether, 0.05 ether);
        assertEq(got, 1);
        IPocketDrop.Link memory l = pd.getLink(1);
        assertEq(l.sender, alice);
        assertEq(uint8(l.mode), CONFIRMED);
        assertEq(uint8(l.state), uint8(IPocketDrop.State.Open));
        assertEq(l.amount, 1 ether);
        assertEq(l.drip, 0.2 ether);
        assertEq(l.relayerFee, 0.05 ether);
        assertEq(l.expiry, expiry);
        assertEq(l.linkKeyHash, lkh);
        assertEq(l.recipient, address(0));
        assertEq(l.recipientKeyHash, bytes32(0));
        assertEq(l.bindDeadline, 0);
        assertFalse(l.dripPaid);
        assertEq(address(pd).balance, 1.25 ether);
        assertEq(pd.unpaidOf(1), 1.25 ether);
        assertEq(pd.dripUsedToday(alice), 0.2 ether);
    }

    function test_create_ids_increment_from_one() public {
        assertEq(createDefault(OPEN), 1);
        assertEq(createDefault(OPEN), 2);
        assertEq(createDefault(CONFIRMED), 3);
        assertEq(pd.linkCount(), 3);
    }

    function test_create_zero_drip_zero_fee() public {
        uint256 id = create(OPEN, MIN_ESCROW, 0, 0, 1 days);
        assertEq(pd.unpaidOf(id), MIN_ESCROW);
    }

    function test_create_revert_zero_link_key() public {
        vm.prank(alice);
        _revertWith(IPocketDrop.ZeroLinkKey.selector);
        pd.create{value: 1 ether}(bytes32(0), OPEN, uint64(block.timestamp + 1 days), 0, 0);
    }

    function test_create_revert_invalid_mode() public {
        bytes32 h = linkKeyHash(1);
        uint64 e = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        _revertWith(IPocketDrop.InvalidMode.selector);
        pd.create{value: 1 ether}(h, 2, e, 0, 0);
    }

    function test_create_revert_value_below_drip_plus_fee() public {
        bytes32 h = linkKeyHash(1);
        uint64 e = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IPocketDrop.AmountOutOfRange.selector, 0));
        pd.create{value: 0.4 ether}(h, OPEN, e, 0.3 ether, 0.2 ether);
    }

    function test_create_revert_amount_below_min() public {
        bytes32 h = linkKeyHash(1);
        uint64 e = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IPocketDrop.AmountOutOfRange.selector, MIN_ESCROW - 1));
        pd.create{value: MIN_ESCROW - 1}(h, OPEN, e, 0, 0);
    }

    function test_create_revert_amount_above_max() public {
        bytes32 h = linkKeyHash(1);
        uint64 e = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IPocketDrop.AmountOutOfRange.selector, MAX_AMOUNT + 1));
        pd.create{value: MAX_AMOUNT + 1}(h, OPEN, e, 0, 0);
    }

    function test_create_amount_bounds_inclusive() public {
        create(OPEN, MIN_ESCROW, 0, 0, 1 days);
        create(OPEN, MAX_AMOUNT, 0, 0, 1 days);
        assertEq(pd.linkCount(), 2);
    }

    function test_create_revert_drip_too_high() public {
        bytes32 h = linkKeyHash(1);
        uint64 e = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        _revertWith(IPocketDrop.DripTooHigh.selector);
        pd.create{value: 2 ether}(h, OPEN, e, uint96(MAX_DRIP + 1), 0);
    }

    function test_create_revert_expiry_not_in_future() public {
        bytes32 h = linkKeyHash(1);
        vm.prank(alice);
        _revertWith(IPocketDrop.InvalidExpiry.selector);
        pd.create{value: 1 ether}(h, OPEN, uint64(block.timestamp), 0, 0);
        vm.prank(alice);
        _revertWith(IPocketDrop.InvalidExpiry.selector);
        pd.create{value: 1 ether}(h, OPEN, uint64(block.timestamp - 1), 0, 0);
    }

    function test_create_revert_expiry_too_far() public {
        bytes32 h = linkKeyHash(1);
        vm.prank(alice);
        _revertWith(IPocketDrop.InvalidExpiry.selector);
        pd.create{value: 1 ether}(h, OPEN, uint64(block.timestamp + MAX_EXPIRY + 1), 0, 0);
        // exactly MAX_EXPIRY is fine
        vm.prank(alice);
        pd.create{value: 1 ether}(h, OPEN, uint64(block.timestamp + MAX_EXPIRY), 0, 0);
    }

    function test_create_daily_drip_cap_and_utc_reset() public {
        create(OPEN, 1 ether, 0.6 ether, 0, 1 days);
        create(OPEN, 1 ether, 0.4 ether, 0, 1 days); // exactly at the cap (1 ether)
        assertEq(pd.dripUsedToday(alice), 1 ether);
        bytes32 h = linkKeyHash(3);
        uint64 e = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        _revertWith(IPocketDrop.DailyDripCapExceeded.selector);
        pd.create{value: 1.1 ether}(h, OPEN, e, 1, 0);
        // a zero-drip link is still allowed
        create(OPEN, 1 ether, 0, 0, 1 days);
        // another sender has its own allowance
        vm.deal(mallory, 10 ether);
        vm.prank(mallory);
        pd.create{value: 1 ether}(linkKeyHash(4), OPEN, e, 0.6 ether, 0);
        // next UTC day the allowance resets
        vm.warp(block.timestamp + 1 days);
        assertEq(pd.dripUsedToday(alice), 0);
        uint256 id = nextId();
        vm.prank(alice);
        pd.create{value: 1.6 ether}(linkKeyHash(id), OPEN, uint64(block.timestamp + 1 days), 0.6 ether, 0);
        assertEq(pd.dripUsedToday(alice), 0.6 ether);
    }

    function test_create_cap_is_not_credited_back_on_cancel() public {
        uint256 id = create(OPEN, 1 ether, 0.6 ether, 0, 1 days);
        vm.prank(alice);
        pd.cancel(id);
        assertEq(pd.dripUsedToday(alice), 0.6 ether);
    }

    /*//////////////////////////////////////////////////////////////
                                 BIND
    //////////////////////////////////////////////////////////////*/

    function test_bind_first_pays_drip_and_fee_and_emits() public {
        uint256 id = createDefault(OPEN);
        uint256 rBefore = recip(0).balance;
        uint256 relBefore = relayer.balance;
        vm.expectEmit(true, true, false, true, address(pd));
        emit LinkBound(id, recip(0), recipHash(0), uint64(block.timestamp + BIND_TIMEOUT), false, relayer);
        vm.expectEmit(true, true, true, true, address(pd));
        emit DripPaid(id, recip(0), 0.2 ether, relayer, 0.05 ether);
        bindTo(id, 0);
        IPocketDrop.Link memory l = pd.getLink(id);
        assertEq(uint8(l.state), uint8(IPocketDrop.State.Bound));
        assertEq(l.recipient, recip(0));
        assertEq(l.recipientKeyHash, recipHash(0));
        assertEq(l.bindDeadline, block.timestamp + BIND_TIMEOUT);
        assertTrue(l.dripPaid);
        assertEq(recip(0).balance - rBefore, 0.2 ether);
        assertEq(relayer.balance - relBefore, 0.05 ether);
        assertEq(pd.unpaidOf(id), 1 ether);
        assertEq(address(pd).balance, 1 ether);
    }

    function test_bind_with_zero_drip_and_fee() public {
        uint256 id = create(OPEN, 1 ether, 0, 0, 1 days);
        uint256 before_ = address(pd).balance;
        bindTo(id, 0);
        assertEq(address(pd).balance, before_);
        assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Bound));
    }

    function test_bind_revert_unknown_link() public {
        _revertWith(IPocketDrop.LinkNotFound.selector);
        pd.bind(99, recip(0), recipHash(0), linkPk(1), bindSig(1, 0));
    }

    function test_bind_revert_zero_link_id() public {
        _revertWith(IPocketDrop.LinkNotFound.selector);
        pd.bind(0, recip(0), recipHash(0), linkPk(1), bindSig(1, 0));
    }

    function test_bind_revert_already_bound_before_deadline() public {
        uint256 id = createDefault(OPEN);
        bindTo(id, 0);
        bytes memory pk = linkPk(id);
        bytes memory sig = bindSig(id, 1);
        bytes32 h = recipHash(1);
        address r1 = recip(1);
        _revertState(IPocketDrop.State.Bound);
        pd.bind(id, r1, h, pk, sig);
        // exactly at the deadline it is still exclusive
        vm.warp(block.timestamp + BIND_TIMEOUT);
        _revertState(IPocketDrop.State.Bound);
        pd.bind(id, r1, h, pk, sig);
    }

    function test_bind_revert_expired() public {
        uint256 id = create(OPEN, 1 ether, 0, 0, 100);
        vm.warp(block.timestamp + 100);
        bytes memory pk = linkPk(id);
        bytes memory sig = bindSig(id, 0);
        bytes32 h = recipHash(0);
        address r0 = recip(0);
        _revertWith(IPocketDrop.Expired.selector);
        pd.bind(id, r0, h, pk, sig);
    }

    function test_bind_revert_bad_recipient() public {
        uint256 id = createDefault(OPEN);
        bytes memory pk = linkPk(id);
        bytes memory sig = bindSig(id, 0);
        bytes32 h = recipHash(0);
        _revertWith(IPocketDrop.BadRecipient.selector);
        pd.bind(id, address(0), h, pk, sig);
        _revertWith(IPocketDrop.BadRecipient.selector);
        pd.bind(id, address(pd), h, pk, sig);
    }

    function test_bind_revert_zero_recipient_key() public {
        uint256 id = createDefault(OPEN);
        bytes memory pk = linkPk(id);
        bytes memory sig = bindSig(id, 0);
        _revertWith(IPocketDrop.ZeroRecipientKey.selector);
        pd.bind(id, recip(0), bytes32(0), pk, sig);
    }

    function test_bind_revert_link_key_mismatch() public {
        uint256 id = createDefault(OPEN); // link 1 -> key index 1
        bytes memory otherPk = linkPk(2); // key index 2
        bytes memory sig = bindSig(id, 0);
        bytes32 h = recipHash(0);
        address r0 = recip(0);
        _revertWith(IPocketDrop.LinkKeyMismatch.selector);
        pd.bind(id, r0, h, otherPk, sig);
    }

    /// Lab attack 1: a mempool thief swaps the recipient (and key) of a signed bind.
    function test_bind_revert_recipient_swapped() public {
        uint256 id = createDefault(OPEN);
        bytes memory pk = linkPk(id);
        bytes memory sigForR0 = bindSig(id, 0);
        bytes32 h1 = recipHash(1);
        address r1 = recip(1);
        bytes32 h0 = recipHash(0);
        address r0 = recip(0);
        _revertWith(IPocketDrop.BadLinkSignature.selector);
        pd.bind(id, r1, h1, pk, sigForR0); // both swapped
        _revertWith(IPocketDrop.BadLinkSignature.selector);
        pd.bind(id, r1, h0, pk, sigForR0); // address swapped only
        _revertWith(IPocketDrop.BadLinkSignature.selector);
        pd.bind(id, r0, h1, pk, sigForR0); // key hash swapped only
    }

    function test_bind_revert_signature_for_other_link_or_garbage() public {
        uint256 id = createDefault(OPEN);
        bytes memory pk = linkPk(id);
        bytes32 h = recipHash(0);
        address r0 = recip(0);
        // link 4 uses the same key as link 1 (4 % 3 == 1 % 3) but signs a different linkId
        bytes memory sigOtherLink = bindSig(4, 0);
        _revertWith(IPocketDrop.BadLinkSignature.selector);
        pd.bind(id, r0, h, pk, sigOtherLink);
        _revertWith(IPocketDrop.BadLinkSignature.selector);
        pd.bind(id, r0, h, pk, hex"");
        _revertWith(IPocketDrop.BadLinkSignature.selector);
        pd.bind(id, r0, h, pk, hex"deadbeef");
    }

    function test_bind_revert_wrong_domain_chain_contract() public {
        uint256 id = createDefault(OPEN);
        bytes memory pk = linkPk(id);
        bytes32 h = recipHash(0);
        address r0 = recip(0);
        for (uint256 i; i < 3; i++) {
            bytes memory s = wrongSig(i);
            _revertWith(IPocketDrop.BadLinkSignature.selector);
            pd.bind(id, r0, h, pk, s);
        }
    }

    function test_bind_rebind_after_timeout_replaces_recipient_without_second_drip() public {
        uint256 id = createDefault(OPEN);
        bindTo(id, 0);
        uint256 r1Before = recip(1).balance;
        uint256 relBefore = relayer.balance;
        vm.warp(block.timestamp + BIND_TIMEOUT + 1);
        vm.expectEmit(true, true, false, true, address(pd));
        emit LinkBound(id, recip(1), recipHash(1), uint64(block.timestamp + BIND_TIMEOUT), true, relayer);
        bindTo(id, 1);
        IPocketDrop.Link memory l = pd.getLink(id);
        assertEq(l.recipient, recip(1));
        assertEq(l.recipientKeyHash, recipHash(1));
        assertEq(l.bindDeadline, block.timestamp + BIND_TIMEOUT);
        assertEq(recip(1).balance, r1Before, "no second drip");
        assertEq(relayer.balance, relBefore, "no second fee");
    }

    function test_bind_not_allowed_once_confirmed() public {
        uint256 id = createDefault(CONFIRMED);
        bindTo(id, 0);
        vm.prank(alice);
        pd.confirm(id);
        vm.warp(block.timestamp + BIND_TIMEOUT + 1);
        bytes memory pk = linkPk(id);
        bytes memory sig = bindSig(id, 1);
        bytes32 h = recipHash(1);
        address r1 = recip(1);
        _revertState(IPocketDrop.State.Confirmed);
        pd.bind(id, r1, h, pk, sig);
    }

    function test_bind_not_allowed_after_terminal() public {
        uint256 id = createDefault(OPEN);
        vm.prank(alice);
        pd.cancel(id);
        bytes memory pk = linkPk(id);
        bytes memory sig = bindSig(id, 0);
        bytes32 h = recipHash(0);
        address r0 = recip(0);
        _revertState(IPocketDrop.State.Cancelled);
        pd.bind(id, r0, h, pk, sig);
    }

    /*//////////////////////////////////////////////////////////////
                                CONFIRM
    //////////////////////////////////////////////////////////////*/

    function test_confirm_success_and_event() public {
        uint256 id = createDefault(CONFIRMED);
        bindTo(id, 0);
        vm.expectEmit(true, true, false, true, address(pd));
        emit LinkConfirmed(id, recip(0), recipHash(0));
        vm.prank(alice);
        pd.confirm(id);
        assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Confirmed));
    }

    function test_confirm_reverts() public {
        uint256 id = createDefault(CONFIRMED);
        // not bound yet
        vm.startPrank(alice);
        _revertState(IPocketDrop.State.Open);
        pd.confirm(id);
        vm.stopPrank();
        bindTo(id, 0);
        // not sender
        vm.prank(mallory);
        _revertWith(IPocketDrop.NotSender.selector);
        pd.confirm(id);
        // unknown
        vm.prank(alice);
        _revertWith(IPocketDrop.LinkNotFound.selector);
        pd.confirm(777);
        // after the bind deadline
        vm.warp(block.timestamp + BIND_TIMEOUT + 1);
        vm.prank(alice);
        _revertWith(IPocketDrop.BindDeadlinePassed.selector);
        pd.confirm(id);
        // after expiry
        vm.warp(block.timestamp + 8 days);
        vm.prank(alice);
        _revertWith(IPocketDrop.Expired.selector);
        pd.confirm(id);
    }

    function test_confirm_revert_wrong_mode() public {
        uint256 id = createDefault(OPEN);
        bindTo(id, 0);
        vm.prank(alice);
        _revertWith(IPocketDrop.WrongMode.selector);
        pd.confirm(id);
    }

    function test_confirm_twice_reverts() public {
        uint256 id = createDefault(CONFIRMED);
        bindTo(id, 0);
        vm.startPrank(alice);
        pd.confirm(id);
        _revertState(IPocketDrop.State.Confirmed);
        pd.confirm(id);
        vm.stopPrank();
    }

    function test_confirm_at_deadline_still_allowed() public {
        uint256 id = createDefault(CONFIRMED);
        bindTo(id, 0);
        vm.warp(block.timestamp + BIND_TIMEOUT);
        vm.prank(alice);
        pd.confirm(id);
    }

    function test_confirmRecipient() public {
        uint256 id = createDefault(CONFIRMED);
        bindTo(id, 0);
        vm.startPrank(alice);
        _revertWith(IPocketDrop.RecipientChanged.selector);
        pd.confirmRecipient(id, recipHash(1));
        pd.confirmRecipient(id, recipHash(0));
        vm.stopPrank();
        assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Confirmed));
    }

    function test_confirmRecipient_unknown_link() public {
        vm.prank(alice);
        _revertWith(IPocketDrop.LinkNotFound.selector);
        pd.confirmRecipient(5, bytes32(0));
    }

    /// The race the extra overload closes: the recipient is re-bound while the sender's confirm is in flight.
    function test_confirmRecipient_blocks_rebind_race() public {
        uint256 id = createDefault(CONFIRMED);
        bindTo(id, 0);
        vm.warp(block.timestamp + BIND_TIMEOUT + 1);
        bindTo(id, 1); // re-bound to someone else with a fresh deadline
        vm.prank(alice);
        _revertWith(IPocketDrop.RecipientChanged.selector);
        pd.confirmRecipient(id, recipHash(0));
    }

    /*//////////////////////////////////////////////////////////////
                                 CLAIM
    //////////////////////////////////////////////////////////////*/

    function test_claim_confirmed_mode_full_flow() public {
        uint256 id = createDefault(CONFIRMED);
        registerKey(0);
        bindTo(id, 0);
        vm.prank(alice);
        pd.confirm(id);
        uint256 before_ = recip(0).balance;
        vm.expectEmit(true, true, false, true, address(pd));
        emit LinkClaimed(id, recip(0), 1 ether, relayer);
        claimAs(id, 0);
        assertEq(recip(0).balance - before_, 1 ether);
        assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Claimed));
        assertEq(address(pd).balance, 0);
        assertEq(pd.unpaidOf(id), 0);
    }

    function test_claim_open_mode_full_flow() public {
        uint256 id = createDefault(OPEN);
        registerKey(0);
        bindTo(id, 0);
        uint256 before_ = recip(0).balance;
        claimAs(id, 0);
        assertEq(recip(0).balance - before_, 1 ether);
        assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Claimed));
    }

    function test_claim_by_anyone_not_only_relayer() public {
        uint256 id = createDefault(OPEN);
        registerKey(0);
        bindTo(id, 0);
        bytes memory sig = claimSig(id, 0);
        vm.prank(mallory);
        pd.claim(id, sig);
        assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Claimed));
    }

    function test_claim_revert_unknown_link() public {
        _revertWith(IPocketDrop.LinkNotFound.selector);
        pd.claim(1, hex"");
    }

    function test_claim_revert_state_confirmed_mode() public {
        uint256 id = createDefault(CONFIRMED);
        registerKey(0);
        bytes memory sig = claimSig(id, 0);
        _revertState(IPocketDrop.State.Open);
        pd.claim(id, sig);
        bindTo(id, 0);
        _revertState(IPocketDrop.State.Bound); // bound but not confirmed
        pd.claim(id, sig);
    }

    function test_claim_revert_state_open_mode() public {
        uint256 id = createDefault(OPEN);
        registerKey(0);
        bytes memory sig = claimSig(id, 0);
        _revertState(IPocketDrop.State.Open); // not bound yet
        pd.claim(id, sig);
    }

    function test_claim_open_mode_revert_after_bind_deadline() public {
        uint256 id = createDefault(OPEN);
        registerKey(0);
        bindTo(id, 0);
        bytes memory sig = claimSig(id, 0);
        vm.warp(block.timestamp + BIND_TIMEOUT + 1);
        _revertWith(IPocketDrop.BindDeadlinePassed.selector);
        pd.claim(id, sig);
    }

    function test_claim_open_mode_at_exact_deadline_ok() public {
        uint256 id = createDefault(OPEN);
        registerKey(0);
        bindTo(id, 0);
        vm.warp(block.timestamp + BIND_TIMEOUT);
        claimAs(id, 0);
        assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Claimed));
    }

    function test_claim_revert_expired() public {
        uint256 id = create(CONFIRMED, 1 ether, 0, 0, uint64(2 * BIND_TIMEOUT));
        registerKey(0);
        bindTo(id, 0);
        vm.prank(alice);
        pd.confirm(id);
        bytes memory sig = claimSig(id, 0);
        vm.warp(block.timestamp + 2 * BIND_TIMEOUT);
        _revertWith(IPocketDrop.Expired.selector);
        pd.claim(id, sig);
    }

    function test_claim_revert_key_status_unavailable() public {
        uint256 id = createDefault(OPEN);
        registerKey(0);
        bindTo(id, 0);
        bytes memory sig = claimSig(id, 0);
        vm.etch(KEYS_ADDR, address(new RawMock()).code);
        RawMock(KEYS_ADDR).set(hex"", true); // precompile reverts
        _revertWith(IPocketDrop.KeyStatusUnavailable.selector);
        pd.claim(id, sig);
        RawMock(KEYS_ADDR).set(hex"1234", false); // malformed (short) data
        _revertWith(IPocketDrop.KeyStatusUnavailable.selector);
        pd.claim(id, sig);
    }

    /// Lab attack 4: claim into an account with no PQ key.
    function test_claim_revert_not_registered() public {
        uint256 id = createDefault(OPEN);
        bindTo(id, 0); // key never registered in the mock
        bytes memory sig = claimSig(id, 0);
        _revertWith(IPocketDrop.NotRegistered.selector);
        pd.claim(id, sig);
    }

    function test_claim_revert_unsupported_algo() public {
        uint256 id = createDefault(OPEN);
        bindTo(id, 0);
        keys.set(recip(0), true, 2, recipPk(0), true);
        bytes memory sig = claimSig(id, 0);
        _revertWith(IPocketDrop.UnsupportedAlgo.selector);
        pd.claim(id, sig);
    }

    /// Lab attack 3: key registered but possessionProven == false (legacy account).
    function test_claim_revert_possession_not_proven() public {
        uint256 id = createDefault(OPEN);
        bindTo(id, 0);
        keys.set(recip(0), true, 1, recipPk(0), false);
        bytes memory sig = claimSig(id, 0);
        _revertWith(IPocketDrop.PossessionNotProven.selector);
        pd.claim(id, sig);
    }

    function test_claim_revert_registered_key_differs_from_bound_hash() public {
        uint256 id = createDefault(OPEN);
        bindTo(id, 0); // bound to key hash of recipient key 0
        keys.set(recip(0), true, 1, recipPk(1), true); // account rotated / different key on chain
        bytes memory sig = claimSig(id, 0);
        _revertWith(IPocketDrop.RecipientKeyMismatch.selector);
        pd.claim(id, sig);
    }

    /// Lab attack 2: a signature from a key other than the recipient's registered key.
    function test_claim_revert_signature_from_other_key() public {
        uint256 id = createDefault(OPEN);
        registerKey(0);
        bindTo(id, 0);
        bytes memory sigByKey1 = claimSig(id, 1);
        bytes memory sigByKey2 = claimSig(id, 2);
        _revertWith(IPocketDrop.BadRecipientSignature.selector);
        pd.claim(id, sigByKey1);
        _revertWith(IPocketDrop.BadRecipientSignature.selector);
        pd.claim(id, sigByKey2);
        _revertWith(IPocketDrop.BadRecipientSignature.selector);
        pd.claim(id, hex"");
        assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Bound));
    }

    function test_claim_revert_signature_for_other_link() public {
        uint256 id = createDefault(OPEN);
        registerKey(0);
        bindTo(id, 0);
        bytes memory sigOtherLink = claimSig(2, 0); // right key, wrong linkId
        _revertWith(IPocketDrop.BadRecipientSignature.selector);
        pd.claim(id, sigOtherLink);
    }

    function test_claim_revert_wrong_domain_chain_contract() public {
        uint256 id = createDefault(OPEN);
        registerKey(0);
        bindTo(id, 0);
        for (uint256 i = 3; i < 6; i++) {
            bytes memory s = wrongSig(i);
            _revertWith(IPocketDrop.BadRecipientSignature.selector);
            pd.claim(id, s);
        }
    }

    /// Lab attack 5: a second person tries to claim a Confirmed link.
    function test_claim_second_person_cannot_steal_confirmed_link() public {
        uint256 id = createDefault(CONFIRMED);
        registerKey(0);
        registerKey(1); // mallory controls a fully valid, proven PQ key of their own
        bindTo(id, 0);
        vm.prank(alice);
        pd.confirm(id);
        bytes memory sigByMalloryKey = claimSig(id, 1);
        vm.prank(mallory);
        _revertWith(IPocketDrop.BadRecipientSignature.selector);
        pd.claim(id, sigByMalloryKey);
        // and mallory cannot bind themselves now either
        bytes memory pk = linkPk(id);
        bytes memory bsig = bindSig(id, 1);
        bytes32 h1 = recipHash(1);
        address r1 = recip(1);
        vm.prank(mallory);
        _revertState(IPocketDrop.State.Confirmed);
        pd.bind(id, r1, h1, pk, bsig);
    }

    function test_claim_twice_reverts_and_pays_once() public {
        uint256 id = createDefault(OPEN);
        registerKey(0);
        bindTo(id, 0);
        claimAs(id, 0);
        bytes memory sig = claimSig(id, 0);
        _revertState(IPocketDrop.State.Claimed);
        pd.claim(id, sig);
        assertEq(address(pd).balance, 0);
    }

    function test_claim_after_rebind_pays_new_recipient_only() public {
        uint256 id = createDefault(OPEN);
        registerKey(0);
        registerKey(1);
        bindTo(id, 0);
        vm.warp(block.timestamp + BIND_TIMEOUT + 1);
        bytes memory oldSig = claimSig(id, 0);
        _revertWith(IPocketDrop.BindDeadlinePassed.selector);
        pd.claim(id, oldSig);
        bindTo(id, 1);
        uint256 r0 = recip(0).balance;
        uint256 r1 = recip(1).balance;
        // the old recipient's signature no longer works: the bound recipient is r1
        _revertWith(IPocketDrop.BadRecipientSignature.selector);
        pd.claim(id, oldSig);
        claimAs(id, 1);
        assertEq(recip(0).balance, r0);
        assertEq(recip(1).balance - r1, 1 ether);
    }

    function test_claim_cannot_be_cancelled_afterwards_nor_refunded() public {
        uint256 id = createDefault(OPEN);
        registerKey(0);
        bindTo(id, 0);
        claimAs(id, 0);
        vm.prank(alice);
        _revertState(IPocketDrop.State.Claimed);
        pd.cancel(id);
        vm.warp(block.timestamp + 8 days);
        _revertState(IPocketDrop.State.Claimed);
        pd.refund(id);
    }

    /*//////////////////////////////////////////////////////////////
                                 CANCEL
    //////////////////////////////////////////////////////////////*/

    function test_cancel_open_refunds_amount_drip_and_fee() public {
        uint256 id = createDefault(CONFIRMED);
        uint256 before_ = alice.balance;
        vm.expectEmit(true, true, false, true, address(pd));
        emit LinkCancelled(id, alice, 1.25 ether);
        vm.prank(alice);
        pd.cancel(id);
        assertEq(alice.balance - before_, 1.25 ether);
        assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Cancelled));
        assertEq(address(pd).balance, 0);
        assertEq(pd.unpaidOf(id), 0);
    }

    function test_cancel_open_mode_open_state() public {
        uint256 id = createDefault(OPEN);
        vm.prank(alice);
        pd.cancel(id);
        assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Cancelled));
    }

    function test_cancel_bound_confirmed_mode_refunds_only_amount_after_drip_paid() public {
        uint256 id = createDefault(CONFIRMED);
        bindTo(id, 0);
        uint256 before_ = alice.balance;
        vm.prank(alice);
        pd.cancel(id);
        assertEq(alice.balance - before_, 1 ether);
        assertEq(address(pd).balance, 0);
    }

    function test_cancel_reverts() public {
        uint256 id = createDefault(OPEN);
        vm.prank(mallory);
        _revertWith(IPocketDrop.NotSender.selector);
        pd.cancel(id);
        vm.prank(alice);
        _revertWith(IPocketDrop.LinkNotFound.selector);
        pd.cancel(42);
        // Open mode, Bound: not cancellable (recipient may claim any moment)
        bindTo(id, 0);
        vm.prank(alice);
        _revertState(IPocketDrop.State.Bound);
        pd.cancel(id);
        // cancelled twice
        uint256 id2 = createDefault(CONFIRMED);
        vm.startPrank(alice);
        pd.cancel(id2);
        _revertState(IPocketDrop.State.Cancelled);
        pd.cancel(id2);
        vm.stopPrank();
    }

    /// Lab attack 6: sender cancels after confirm.
    function test_cancel_after_confirm_reverts() public {
        uint256 id = createDefault(CONFIRMED);
        bindTo(id, 0);
        vm.startPrank(alice);
        pd.confirm(id);
        _revertState(IPocketDrop.State.Confirmed);
        pd.cancel(id);
        vm.stopPrank();
    }

    function test_cancel_after_refund_reverts() public {
        uint256 id = createDefault(OPEN);
        vm.warp(block.timestamp + 8 days);
        pd.refund(id);
        vm.prank(alice);
        _revertState(IPocketDrop.State.Refunded);
        pd.cancel(id);
    }

    /*//////////////////////////////////////////////////////////////
                                 REFUND
    //////////////////////////////////////////////////////////////*/

    function test_refund_open_after_expiry_by_anyone() public {
        uint256 id = createDefault(OPEN);
        uint256 before_ = alice.balance;
        vm.warp(block.timestamp + 7 days);
        vm.expectEmit(true, true, false, true, address(pd));
        emit LinkRefunded(id, alice, 1.25 ether, mallory);
        vm.prank(mallory);
        pd.refund(id);
        assertEq(alice.balance - before_, 1.25 ether);
        assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Refunded));
        assertEq(address(pd).balance, 0);
    }

    function test_refund_bound_and_confirmed() public {
        uint256 a = createDefault(OPEN);
        uint256 b = createDefault(CONFIRMED);
        bindTo(a, 0);
        bindTo(b, 1);
        vm.prank(alice);
        pd.confirm(b);
        uint256 before_ = alice.balance;
        vm.warp(block.timestamp + 7 days);
        pd.refund(a);
        pd.refund(b);
        assertEq(alice.balance - before_, 2 ether); // drip/fee already paid at bind
        assertEq(address(pd).balance, 0);
    }

    function test_refund_reverts() public {
        uint256 id = createDefault(OPEN);
        _revertWith(IPocketDrop.NotExpired.selector);
        pd.refund(id);
        vm.warp(block.timestamp + 7 days - 1);
        _revertWith(IPocketDrop.NotExpired.selector);
        pd.refund(id);
        _revertWith(IPocketDrop.LinkNotFound.selector);
        pd.refund(9);
        vm.warp(block.timestamp + 1);
        pd.refund(id);
        _revertState(IPocketDrop.State.Refunded);
        pd.refund(id);
        uint256 id2 = createDefault(OPEN);
        vm.prank(alice);
        pd.cancel(id2);
        vm.warp(block.timestamp + 8 days);
        _revertState(IPocketDrop.State.Cancelled);
        pd.refund(id2);
    }

    function test_refund_and_active_windows_do_not_overlap_at_expiry() public {
        uint256 id = create(OPEN, 1 ether, 0, 0, 1000);
        registerKey(0);
        bindTo(id, 0);
        bytes memory sig = claimSig(id, 0);
        vm.warp(block.timestamp + 1000); // now == expiry
        _revertWith(IPocketDrop.Expired.selector);
        pd.claim(id, sig);
        pd.refund(id);
    }

    /*//////////////////////////////////////////////////////////////
                         PULL PAYMENTS / HOSTILE RECEIVERS
    //////////////////////////////////////////////////////////////*/

    function _hostileRecipient(HostileActor.Behavior b, uint256 action, uint256 linkId) internal returns (HostileActor a) {
        vm.etch(recip(0), address(new HostileActor()).code);
        a = HostileActor(payable(recip(0)));
        a.configure(pd, b, action, linkId);
    }

    function test_hostile_recipient_revert_goes_to_pull_balance() public {
        uint256 id = createDefault(OPEN);
        HostileActor a = _hostileRecipient(HostileActor.Behavior.Revert, 0, id);
        registerKey(0);
        vm.expectEmit(true, false, false, true, address(pd));
        emit PayoutDeferred(recip(0), 0.2 ether);
        bindTo(id, 0);
        assertEq(pd.pending(recip(0)), 0.2 ether);
        assertEq(pd.totalPending(), 0.2 ether);
        claimAs(id, 0);
        assertEq(pd.pending(recip(0)), 1.2 ether);
        assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Claimed), "claim cannot be blocked");
        assertEq(address(pd).balance, 1.2 ether);
        a.setBehavior(HostileActor.Behavior.Accept);
        vm.expectEmit(true, false, false, true, address(pd));
        emit Withdrawn(recip(0), 1.2 ether);
        a.doWithdraw();
        assertEq(address(a).balance, 1.2 ether);
        assertEq(pd.pending(recip(0)), 0);
        assertEq(pd.totalPending(), 0);
        assertEq(address(pd).balance, 0);
    }

    function test_hostile_recipient_burning_gas_cannot_block_claim() public {
        uint256 id = createDefault(OPEN);
        _hostileRecipient(HostileActor.Behavior.BurnGas, 0, id);
        registerKey(0);
        bindTo(id, 0);
        claimAs(id, 0);
        assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Claimed));
        assertEq(pd.pending(recip(0)), 1.2 ether);
    }

    function test_hostile_sender_cannot_block_cancel_or_refund() public {
        HostileActor s = new HostileActor();
        s.configure(pd, HostileActor.Behavior.Revert, 0, 0);
        vm.deal(address(s), 10 ether);
        uint256 id = nextId();
        s.doCreate{value: 1 ether}(linkKeyHash(id), OPEN, uint64(block.timestamp + 1 days), 0, 0);
        s.doCancel(id);
        assertEq(pd.pending(address(s)), 1 ether);
        uint256 id2 = nextId();
        s.doCreate{value: 1 ether}(linkKeyHash(id2), OPEN, uint64(block.timestamp + 1 days), 0, 0);
        vm.warp(block.timestamp + 2 days);
        pd.refund(id2);
        assertEq(pd.pending(address(s)), 2 ether);
        assertEq(pd.totalPending(), 2 ether);
        // withdraw into a still-hostile account fails and keeps the balance
        vm.expectRevert(IPocketDrop.WithdrawFailed.selector);
        s.doWithdraw();
        assertEq(pd.pending(address(s)), 2 ether);
        s.setBehavior(HostileActor.Behavior.Accept);
        uint256 balBefore = address(s).balance;
        s.doWithdraw();
        assertEq(address(s).balance - balBefore, 2 ether);
        assertEq(pd.totalPending(), 0);
    }

    function test_hostile_relayer_fee_receiver_goes_to_pull() public {
        uint256 id = createDefault(OPEN);
        HostileActor r = new HostileActor();
        r.configure(pd, HostileActor.Behavior.Revert, 0, 0);
        vm.etch(relayer, address(r).code);
        HostileActor(payable(relayer)).configure(pd, HostileActor.Behavior.Revert, 0, 0);
        bindTo(id, 0);
        assertEq(pd.pending(relayer), 0.05 ether);
    }

    function test_withdraw_nothing_reverts() public {
        vm.expectRevert(IPocketDrop.NothingToWithdraw.selector);
        pd.withdraw();
    }

    function test_reentrancy_blocked_from_every_entry_point() public {
        // Each iteration: payout to a recipient whose receive() tries to re-enter PocketDrop.
        for (uint256 action; action < 7; action++) {
            vm.warp(block.timestamp + 1 days); // fresh UTC day => fresh daily drip allowance
            uint256 id;
            vm.etch(recip(0), address(new HostileActor()).code);
            HostileActor a = HostileActor(payable(recip(0)));
            id = create(OPEN, 1 ether, 0.2 ether, 0, 1 days);
            a.configure(pd, HostileActor.Behavior.Reenter, action, id);
            registerKey(0);
            // drip payout re-enters during bind
            bindTo(id, 0);
            assertEq(a.reenterAttempts(), 1, "reentered on drip");
            assertEq(a.lastReenterSelector(), IPocketDrop.Reentrancy.selector, "drip reentry blocked");
            // amount payout re-enters during claim
            claimAs(id, 0);
            assertEq(a.reenterAttempts(), 2, "reentered on claim");
            assertEq(a.lastReenterSelector(), IPocketDrop.Reentrancy.selector, "claim reentry blocked");
            assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Claimed));
            assertEq(address(a).balance, 1.2 ether);
            assertEq(pd.pending(address(a)), 0);
            // reset the mock's key registration and balances for the next iteration
            vm.etch(recip(0), hex"");
            vm.deal(recip(0), 0);
            vm.deal(address(pd), 0);
        }
    }

    function test_reentrancy_during_withdraw_blocked() public {
        uint256 id = createDefault(OPEN);
        HostileActor a = _hostileRecipient(HostileActor.Behavior.Revert, 0, id);
        registerKey(0);
        bindTo(id, 0); // drip deferred
        a.setBehavior(HostileActor.Behavior.Reenter);
        a.doWithdraw();
        assertEq(a.lastReenterSelector(), IPocketDrop.Reentrancy.selector);
        assertEq(address(a).balance, 0.2 ether);
        assertEq(pd.pending(address(a)), 0);
    }

    function test_reentrancy_during_cancel_and_refund_payouts_blocked() public {
        HostileActor s = new HostileActor();
        vm.deal(address(s), 10 ether);
        uint256 id = nextId();
        s.configure(pd, HostileActor.Behavior.Reenter, 1, id);
        s.doCreate{value: 1 ether}(linkKeyHash(id), OPEN, uint64(block.timestamp + 1 days), 0, 0);
        uint256 b0 = address(s).balance;
        s.doCancel(id);
        assertEq(s.lastReenterSelector(), IPocketDrop.Reentrancy.selector);
        assertEq(address(s).balance - b0, 1 ether);
        uint256 id2 = nextId();
        s.configure(pd, HostileActor.Behavior.Reenter, 3, id2);
        s.doCreate{value: 1 ether}(linkKeyHash(id2), OPEN, uint64(block.timestamp + 1 days), 0, 0);
        vm.warp(block.timestamp + 2 days);
        b0 = address(s).balance;
        s.doRefund(id2);
        assertEq(s.lastReenterSelector(), IPocketDrop.Reentrancy.selector);
        assertEq(address(s).balance - b0, 1 ether);
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    function test_digests_match_spec_encoding() public view {
        bytes memory b = pd.bindDigest(7, recip(1), recipHash(1));
        assertEq(b, abi.encode("POCKETDROP_BIND_V1", uint256(9800), address(pd), uint256(7), recip(1), recipHash(1)));
        bytes memory c = pd.claimDigest(7, recip(1));
        assertEq(c, abi.encode("POCKETDROP_CLAIM_V1", uint256(9800), address(pd), uint256(7), recip(1)));
    }

    function test_getLink_unknown_is_none() public view {
        IPocketDrop.Link memory l = pd.getLink(123);
        assertEq(uint8(l.state), uint8(IPocketDrop.State.None));
        assertEq(l.sender, address(0));
        assertEq(pd.unpaidOf(123), 0);
    }

    function test_unpaidOf_tracks_drip_payment() public {
        uint256 id = createDefault(OPEN);
        assertEq(pd.unpaidOf(id), 1.25 ether);
        bindTo(id, 0);
        assertEq(pd.unpaidOf(id), 1 ether);
    }

    function test_balance_covers_unpaid_through_lifecycle() public {
        uint256 a = createDefault(OPEN);
        uint256 b = createDefault(CONFIRMED);
        assertEq(address(pd).balance, pd.unpaidOf(a) + pd.unpaidOf(b));
        bindTo(a, 0);
        assertEq(address(pd).balance, pd.unpaidOf(a) + pd.unpaidOf(b));
        vm.prank(alice);
        pd.cancel(b);
        assertEq(address(pd).balance, pd.unpaidOf(a));
    }

    function test_contract_rejects_plain_eth() public {
        (bool ok,) = address(pd).call{value: 1 ether}("");
        assertFalse(ok, "no receive/fallback: stray ETH is rejected");
    }
}
