// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4Base} from "./Base.t.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {PocketRouter} from "../src/PocketRouter.sol";

/// @notice Property tests. Signatures are real fixtures, so properties that need valid signatures use the fixture grid
///         and properties about forgery use random bytes (which the signature-real mock can never accept).
contract V4FuzzTest is V4Base {
    address internal alice = makeAddr("alice");
    PocketVault internal v;

    function setUp() public override {
        super.setUp();
        vm.deal(alice, 1_000_000 ether);
        v = pocketA();
    }

    /*---------------- vault ----------------*/

    /// The daily allowance model: a spend pays now iff it fits today's remaining allowance, otherwise it queues; the
    /// vault balance always equals funding minus what was actually paid.
    function testFuzz_vault_daily_allowance_model(uint256 seed) public {
        uint256 day = block.timestamp / 1 days;
        uint256 used;
        uint256 paid;
        for (uint256 n; n < 14; n++) {
            seed = uint256(keccak256(abi.encode(seed, n)));
            vm.warp(block.timestamp + (seed % 20 hours));
            bool big = (seed >> 8) & 1 == 1;
            uint256 amt = big ? 5 ether : 0.8 ether;
            bytes memory sig = _sg("fuzz", string.concat(big ? "spendB_" : "spendS_", vm.toString(n)));
            if (block.timestamp / 1 days != day) {
                day = block.timestamp / 1 days;
                used = 0;
            }
            uint256 id = v.spend(SINK, amt, DL, sig);
            if (amt <= 2 ether - used) {
                assertEq(id, 0, "fits => paid now");
                used += amt;
                paid += amt;
            } else {
                assertGt(id, 0, "does not fit => queued");
            }
            assertEq(SINK.balance, paid);
            assertEq(address(v).balance, 100 ether - paid);
            assertEq(v.allowanceLeft(), 2 ether - used);
        }
        assertEq(v.nonce(), 14);
    }

    /// Anything that is not an exact real signature is refused by every owner intent.
    function testFuzz_forged_owner_intents_never_execute(uint8 which, bytes memory sig, uint256 a, address who) public {
        bytes memory data;
        uint256 w = which % 9;
        if (w == 0) data = abi.encodeCall(v.spend, (who, a, DL, sig));
        else if (w == 1) data = abi.encodeCall(v.vetoQueued, (a, DL, sig));
        else if (w == 2) data = abi.encodeCall(v.setLimit, (a, DL, sig));
        else if (w == 3) data = abi.encodeCall(v.setGuardians, (new address[](0), 0, DL, sig));
        else if (w == 4) data = abi.encodeCall(v.cancelPending, (DL, sig));
        else if (w == 5) data = abi.encodeCall(v.vetoRecovery, (DL, sig));
        else if (w == 6) data = abi.encodeCall(v.createDrop, (DROP, bytes32(a), 0, uint64(EXP), 0, 0, 1 ether, DL, sig));
        else if (w == 7) data = abi.encodeCall(v.confirmDrop, (DROP, a, bytes32(a), DL, sig));
        else data = abi.encodeCall(v.closePool, (POOL, a, DL, sig));
        (bool ok,) = address(v).call(data);
        assertFalse(ok);
        assertEq(v.nonce(), 0);
        assertEq(address(v).balance, 100 ether);
    }

    function testFuzz_forged_recovery_never_proposes(bytes memory s0, bytes memory s1, address newOwner, bytes32 kh)
        public
    {
        address[] memory signers = new address[](2);
        signers[0] = G0;
        signers[1] = G1;
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = s0;
        sigs[1] = s1;
        (bool ok,) = address(v).call(abi.encodeCall(v.proposeRecovery, (newOwner, kh, DL, signers, sigs)));
        assertFalse(ok);
        assertEq(v.recoveryAt(), 0);
    }

    function testFuzz_executeQueued_never_pays_early(uint256 dt) public {
        v.spend(SINK, 5 ether, DL, V("spendB_0"));
        dt = bound(dt, 0, TIMELOCK - 1);
        vm.warp(block.timestamp + dt);
        vm.expectRevert(PocketVault.TooEarly.selector);
        v.executeQueued(1);
        assertEq(SINK.balance, 0);
    }

    /*---------------- drop ----------------*/

    function testFuzz_drop_create_accounting(uint256 val, uint96 drip, uint96 fee, uint64 ttl, uint8 mode) public {
        val = bound(val, 0, 100 ether);
        ttl = uint64(bound(ttl, 0, 40 days));
        uint256 extras = uint256(drip) + fee;
        bool ok = val >= extras && val - extras >= 0.1 ether && val - extras <= 50 ether && drip <= 0.6 ether
            && ttl > 0 && ttl <= 30 days && mode <= 1 && drip <= 10 ether;
        vm.prank(alice);
        try drop.create{value: val}(keccak256("lk"), mode, uint64(block.timestamp) + ttl, drip, fee) returns (uint256 id) {
            assertTrue(ok, "accepted an invalid create");
            assertEq(drop.getLink(id).amount, val - extras);
            assertEq(address(drop).balance, val);
            assertEq(drop.unpaidOf(id), val);
        } catch {
            assertFalse(ok, "rejected a valid create");
            assertEq(address(drop).balance, 0);
        }
    }

    /*---------------- pool ----------------*/

    function testFuzz_pool_create_accounting(uint32 slots, uint96 perSlot, uint256 extra, uint64 ttl) public {
        slots = uint32(bound(slots, 0, 25));
        perSlot = uint96(bound(perSlot, 0, 6 ether));
        extra = bound(extra, 0, 2);
        ttl = uint64(bound(ttl, 0, 40 days));
        uint256 value = uint256(slots) * perSlot + (extra == 2 ? 1 : 0);
        bool ok = slots > 0 && slots <= 20 && perSlot >= 0.01 ether && perSlot <= 5 ether && extra != 2 && ttl > 0
            && ttl <= 30 days;
        vm.prank(alice);
        try pool.create{value: value}(keccak256("pk"), slots, perSlot, uint64(block.timestamp) + ttl) returns (uint256 id) {
            assertTrue(ok);
            assertEq(pool.unclaimedOf(id), value);
            assertEq(address(pool).balance, value);
        } catch {
            assertFalse(ok);
        }
    }

    /*---------------- router ----------------*/

    function testFuzz_router_forwards_only_to_allowlisted_targets(address target) public {
        bool allowed = target == DROP || target == POOL || factory.isPocket(target);
        if (allowed) {
            assertTrue(router.isAllowed(target));
        } else {
            vm.expectRevert(abi.encodeWithSelector(PocketRouter.NotAllowed.selector, target));
            router.relay(target, "");
        }
    }
}
