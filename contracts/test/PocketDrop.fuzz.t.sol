// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {IPocketDrop} from "../src/interfaces/IPocketDrop.sol";

/// @notice Fuzz tests: amounts, expiries, modes, mutated pk/sig/message bytes, wrong domains, timing.
contract PocketDropFuzzTest is Base {
    /*//////////////////////////////////////////////////////////////
                                 CREATE
    //////////////////////////////////////////////////////////////*/

    /// Oracle for create(): exactly the SPEC §2 conditions decide success.
    function testFuzz_create_matches_oracle(
        uint256 value,
        uint96 drip,
        uint96 fee,
        uint64 expiryDelta,
        uint8 mode,
        bytes32 keyHash
    ) public {
        value = bound(value, 0, 80 ether);
        expiryDelta = uint64(bound(expiryDelta, 0, 40 days));
        uint64 expiry = uint64(block.timestamp) + expiryDelta;
        // Sometimes pick expiry in the past or == now.
        if (uint256(expiryDelta) % 5 == 0) expiry = uint64(block.timestamp) - uint64(expiryDelta % 100);
        drip = uint96(bound(drip, 0, 2 ether));
        fee = uint96(bound(fee, 0, 2 ether));

        bytes4 expected = bytes4(0);
        bytes memory expData;
        uint256 extras = uint256(drip) + uint256(fee);
        if (keyHash == bytes32(0)) expected = IPocketDrop.ZeroLinkKey.selector;
        else if (mode > 1) expected = IPocketDrop.InvalidMode.selector;
        else if (value < extras || value - extras < MIN_ESCROW || value - extras > MAX_AMOUNT) {
            expected = IPocketDrop.AmountOutOfRange.selector;
            expData = abi.encodeWithSelector(expected, value < extras ? 0 : value - extras);
        } else if (drip > MAX_DRIP) {
            expected = IPocketDrop.DripTooHigh.selector;
        } else if (expiry <= block.timestamp || expiry > block.timestamp + MAX_EXPIRY) {
            expected = IPocketDrop.InvalidExpiry.selector;
        } else if (drip > DAILY_DRIP_CAP) {
            expected = IPocketDrop.DailyDripCapExceeded.selector;
        }

        vm.prank(alice);
        if (expected != bytes4(0)) vm.expectRevert(expData.length > 0 ? expData : abi.encodePacked(expected));
        uint256 id = pd.create{value: value}(keyHash, mode, expiry, drip, fee);
        if (expected == bytes4(0)) {
            IPocketDrop.Link memory l = pd.getLink(id);
            assertEq(l.sender, alice);
            assertEq(uint256(l.amount) + l.drip + l.relayerFee, value);
            assertEq(l.expiry, expiry);
            assertEq(uint8(l.mode), mode);
            assertEq(l.linkKeyHash, keyHash);
            assertEq(address(pd).balance, value);
            assertEq(pd.unpaidOf(id), value);
        } else {
            assertEq(pd.linkCount(), 0);
            assertEq(address(pd).balance, 0);
        }
    }

    /// Daily cap: sum of drips per UTC day never exceeds the cap; resets on the next day.
    function testFuzz_daily_drip_cap(uint96[6] memory drips, uint32 jump) public {
        uint256 day = block.timestamp / 1 days;
        uint256 spent;
        for (uint256 i; i < drips.length; i++) {
            uint96 d = uint96(bound(drips[i], 0, MAX_DRIP));
            uint256 nowDay = block.timestamp / 1 days;
            if (nowDay != day) {
                day = nowDay;
                spent = 0;
            }
            bool fits = spent + d <= DAILY_DRIP_CAP;
            uint256 id = nextId();
            bytes32 h = linkKeyHash(id <= NUM_LINKS ? id : 1);
            vm.prank(alice);
            if (!fits) vm.expectRevert(IPocketDrop.DailyDripCapExceeded.selector);
            pd.create{value: 1 ether + d}(h, OPEN, uint64(block.timestamp + 1 days), d, 0);
            if (fits) spent += d;
            assertEq(pd.dripUsedToday(alice), spent);
            assertLe(pd.dripUsedToday(alice), DAILY_DRIP_CAP);
            if (i == 2) vm.warp(block.timestamp + bound(jump, 0, 3 days));
        }
    }

    /*//////////////////////////////////////////////////////////////
                  MUTATED pk / sig / message bytes in bind
    //////////////////////////////////////////////////////////////*/

    function _flip(bytes memory b, uint256 idx, uint8 mask) internal pure returns (bytes memory out) {
        out = b;
        if (mask == 0) mask = 1;
        out[idx % b.length] = bytes1(uint8(out[idx % b.length]) ^ mask);
    }

    function testFuzz_bind_mutated_signature_reverts(uint256 idx, uint8 mask) public {
        uint256 id = createDefault(OPEN);
        bytes memory sig = _flip(bindSig(id, 0), idx, mask);
        bytes memory pk = linkPk(id);
        bytes32 h = recipHash(0);
        address r0 = recip(0);
        vm.expectRevert(IPocketDrop.BadLinkSignature.selector);
        pd.bind(id, r0, h, pk, sig);
        assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Open));
    }

    function testFuzz_bind_mutated_pubkey_reverts(uint256 idx, uint8 mask) public {
        uint256 id = createDefault(OPEN);
        bytes memory pk = _flip(linkPk(id), idx, mask);
        bytes memory sig = bindSig(id, 0);
        bytes32 h = recipHash(0);
        address r0 = recip(0);
        vm.expectRevert(IPocketDrop.LinkKeyMismatch.selector);
        pd.bind(id, r0, h, pk, sig);
    }

    /// Mutated message = any (recipient, keyHash, linkId) other than the signed one.
    function testFuzz_bind_mutated_message_reverts(address recipient, bytes32 keyHash, uint256 linkSel) public {
        vm.assume(recipient != address(0) && recipient != address(pd) && keyHash != bytes32(0));
        vm.assume(recipient != recip(0) || keyHash != recipHash(0));
        uint256 id = createDefault(OPEN);
        // link ids that share the key: 1 and 4, 7, 10 (id % 3 == 1)
        uint256 other = 1 + (linkSel % 4) * 3;
        if (other != id) {
            // create the other link too so the call reaches signature verification
            while (pd.linkCount() < other) {
                create(OPEN, 1 ether, 0, 0, 7 days);
            }
        }
        bytes memory pk = linkPk(id);
        bytes memory sig = bindSig(id, 0);
        vm.expectRevert(IPocketDrop.BadLinkSignature.selector);
        pd.bind(id, recipient, keyHash, pk, sig);
        // the signature fixture for another linkId (same key) does not transfer
        if (other != id) {
            bytes memory pk2 = linkPk(other);
            bytes memory sig2 = bindSig(id, 0);
            vm.expectRevert(IPocketDrop.BadLinkSignature.selector);
            pd.bind(other, recip(0), recipHash(0), pk2, sig2);
        }
    }

    function testFuzz_bind_random_bytes_never_succeed(bytes memory sig) public {
        uint256 id = createDefault(OPEN);
        bytes memory pk = linkPk(id);
        bytes32 h = recipHash(0);
        address r0 = recip(0);
        vm.expectRevert(IPocketDrop.BadLinkSignature.selector);
        pd.bind(id, r0, h, pk, sig);
    }

    function testFuzz_bind_random_pubkey_never_matches(bytes memory pk) public {
        uint256 id = createDefault(OPEN);
        vm.assume(keccak256(pk) != linkKeyHash(id));
        bytes memory sig = bindSig(id, 0);
        bytes32 h = recipHash(0);
        address r0 = recip(0);
        vm.expectRevert(IPocketDrop.LinkKeyMismatch.selector);
        pd.bind(id, r0, h, pk, sig);
    }

    /*//////////////////////////////////////////////////////////////
                         MUTATED sig in claim
    //////////////////////////////////////////////////////////////*/

    function testFuzz_claim_mutated_signature_reverts(uint256 idx, uint8 mask, uint8 mode) public {
        mode = mode % 2;
        uint256 id = createDefault(mode);
        registerKey(0);
        bindTo(id, 0);
        if (mode == CONFIRMED) {
            vm.prank(alice);
            pd.confirm(id);
        }
        bytes memory sig = _flip(claimSig(id, 0), idx, mask);
        vm.expectRevert(IPocketDrop.BadRecipientSignature.selector);
        pd.claim(id, sig);
        assertEq(recip(0).balance, 0.2 ether, "only the drip was paid");
    }

    function testFuzz_claim_random_bytes_never_succeed(bytes memory sig) public {
        uint256 id = createDefault(OPEN);
        registerKey(0);
        bindTo(id, 0);
        vm.expectRevert(IPocketDrop.BadRecipientSignature.selector);
        pd.claim(id, sig);
    }

    /// Any registered key state other than (registered, algo 1, proven, matching hash) blocks the payout.
    function testFuzz_claim_requires_exact_key_state(bool registered, uint8 algo, bool pop, uint8 keyPick) public {
        uint256 id = createDefault(OPEN);
        bindTo(id, 0);
        keyPick = keyPick % 3;
        keys.set(recip(0), registered, algo, recipPk(keyPick), pop);
        bytes memory sig = claimSig(id, 0);
        bool good = registered && algo == 1 && pop && keyPick == 0;
        if (good) {
            pd.claim(id, sig);
            assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Claimed));
        } else {
            bytes4 sel = !registered
                ? IPocketDrop.NotRegistered.selector
                : algo != 1 ? IPocketDrop.UnsupportedAlgo.selector
                : !pop ? IPocketDrop.PossessionNotProven.selector
                : IPocketDrop.RecipientKeyMismatch.selector;
            vm.expectRevert(sel);
            pd.claim(id, sig);
            assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Bound));
        }
    }

    /// Wrong-domain signatures (real ML-DSA signatures over other messages) never verify.
    function testFuzz_wrong_domain_signatures_rejected(uint8 which) public {
        which = which % 6;
        uint256 id = createDefault(OPEN);
        registerKey(0);
        bytes memory sig = wrongSig(which);
        if (which < 3) {
            bytes memory pk = linkPk(id);
            bytes32 h = recipHash(0);
            address r0 = recip(0);
            vm.expectRevert(IPocketDrop.BadLinkSignature.selector);
            pd.bind(id, r0, h, pk, sig);
        } else {
            bindTo(id, 0);
            vm.expectRevert(IPocketDrop.BadRecipientSignature.selector);
            pd.claim(id, sig);
        }
    }

    /*//////////////////////////////////////////////////////////////
                               TIMING
    //////////////////////////////////////////////////////////////*/

    /// Open-mode claim/refund windows follow the spec for any warp.
    function testFuzz_open_mode_timing(uint32 ttl, uint32 warpBy) public {
        uint64 t = uint64(bound(ttl, 1, MAX_EXPIRY));
        uint256 w = bound(warpBy, 0, 31 days);
        uint256 id = create(OPEN, 1 ether, 0.2 ether, 0.05 ether, t);
        registerKey(0);
        uint256 start = block.timestamp;
        // bind happens immediately unless the link is already at expiry (ttl>=1 so it is not)
        bindTo(id, 0);
        vm.warp(start + w);
        bool expired = block.timestamp >= start + t;
        bool inDeadline = block.timestamp <= start + BIND_TIMEOUT;
        bytes memory sig = claimSig(id, 0);
        if (!inDeadline) {
            vm.expectRevert(IPocketDrop.BindDeadlinePassed.selector);
            pd.claim(id, sig);
        } else if (expired) {
            vm.expectRevert(IPocketDrop.Expired.selector);
            pd.claim(id, sig);
        } else {
            pd.claim(id, sig);
            assertEq(uint8(pd.getLink(id).state), uint8(IPocketDrop.State.Claimed));
            // claimed => never refundable
            vm.warp(start + 40 days);
            vm.expectRevert(abi.encodeWithSelector(IPocketDrop.InvalidState.selector, IPocketDrop.State.Claimed));
            pd.refund(id);
            return;
        }
        // not claimed: refund is possible exactly when expired
        if (expired) {
            uint256 b = alice.balance;
            pd.refund(id);
            assertEq(alice.balance - b, 1 ether);
        } else {
            vm.expectRevert(IPocketDrop.NotExpired.selector);
            pd.refund(id);
        }
    }

    /// Rebind is possible only strictly after the deadline and never once Confirmed.
    function testFuzz_rebind_window(uint32 warpBy, bool confirmFirst) public {
        uint256 id = createDefault(CONFIRMED);
        bindTo(id, 0);
        uint256 t0 = block.timestamp;
        if (confirmFirst) {
            vm.prank(alice);
            pd.confirm(id);
        }
        uint256 w = bound(warpBy, 0, 6 days);
        vm.warp(t0 + w);
        bytes memory pk = linkPk(id);
        bytes memory sig = bindSig(id, 1);
        bytes32 h = recipHash(1);
        address r1 = recip(1);
        if (confirmFirst) {
            vm.expectRevert(abi.encodeWithSelector(IPocketDrop.InvalidState.selector, IPocketDrop.State.Confirmed));
            vm.prank(relayer);
            pd.bind(id, r1, h, pk, sig);
        } else if (w <= BIND_TIMEOUT) {
            vm.expectRevert(abi.encodeWithSelector(IPocketDrop.InvalidState.selector, IPocketDrop.State.Bound));
            vm.prank(relayer);
            pd.bind(id, r1, h, pk, sig);
        } else {
            vm.prank(relayer);
            pd.bind(id, r1, h, pk, sig);
            assertEq(pd.getLink(id).recipient, r1);
            assertEq(pd.getLink(id).bindDeadline, block.timestamp + BIND_TIMEOUT);
        }
    }

    /*//////////////////////////////////////////////////////////////
                       VALUE CONSERVATION END TO END
    //////////////////////////////////////////////////////////////*/

    function testFuzz_value_flows(uint256 amount, uint96 drip, uint96 fee, uint8 mode, uint8 ending) public {
        amount = bound(amount, MIN_ESCROW, MAX_AMOUNT);
        drip = uint96(bound(drip, 0, MAX_DRIP));
        fee = uint96(bound(fee, 0, 5 ether));
        mode = mode % 2;
        ending = ending % 4; // 0 claim, 1 cancel (unbound), 2 refund (bound), 3 cancel (bound, Confirmed mode only)
        uint256 id = create(mode, amount, drip, fee, 5 days);
        registerKey(0);
        uint256 aliceBefore = alice.balance;
        uint256 total = amount + drip + fee;
        assertEq(address(pd).balance, total);

        if (ending == 1) {
            vm.prank(alice);
            pd.cancel(id);
            assertEq(alice.balance - aliceBefore, total);
            assertEq(address(pd).balance, 0);
            return;
        }
        uint256 rBefore = recip(0).balance;
        uint256 relBefore = relayer.balance;
        bindTo(id, 0);
        assertEq(recip(0).balance - rBefore, drip);
        assertEq(relayer.balance - relBefore, fee);
        assertEq(address(pd).balance, amount);

        if (ending == 3 && mode == CONFIRMED) {
            vm.prank(alice);
            pd.cancel(id);
            assertEq(alice.balance - aliceBefore, amount);
        } else if (ending == 0 || ending == 3) {
            if (mode == CONFIRMED) {
                vm.prank(alice);
                pd.confirm(id);
            }
            claimAs(id, 0);
            assertEq(recip(0).balance - rBefore, drip + amount);
            assertEq(alice.balance, aliceBefore);
        } else {
            vm.warp(block.timestamp + 5 days);
            pd.refund(id);
            assertEq(alice.balance - aliceBefore, amount);
        }
        assertEq(address(pd).balance, 0);
    }
}
