// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4Base} from "./Base.t.sol";
import {DropPool} from "../src/DropPool.sol";
import {Payout} from "../src/Payout.sol";
import {PqcLib} from "../src/PqcLib.sol";
import {HostileReceiver} from "./mocks/Hostile.sol";

contract DropPoolTest is V4Base {
    address internal host = makeAddr("host");
    uint256 internal constant PER = 0.3 ether;

    function setUp() public override {
        super.setUp();
        vm.deal(host, 100 ether);
    }

    function mk(uint32 slots) internal returns (uint256 id) {
        bytes32 lk = keccak256(_pk("PK"));
        vm.prank(host);
        id = pool.create{value: uint256(slots) * PER}(lk, slots, uint96(PER), uint64(EXP));
    }

    function pt(uint256 i) internal view returns (address) {
        return predict(cfgPC(i));
    }

    function claim(uint256 pid, uint256 i) internal {
        bytes memory lpk = _pk("PK");
        bytes memory ls = P(string.concat("link_", vm.toString(pid), "_", vm.toString(i)));
        bytes memory cs = P(string.concat("claim_", vm.toString(pid), "_", vm.toString(i)));
        address to = pt(i);
        vm.prank(relayer);
        pool.claim(pid, c(i), to, lpk, ls, cs);
    }

    function test_constructor_validation() public {
        vm.expectRevert(DropPool.InvalidConfig.selector);
        maker.pool(0, 1, 1, 1);
        vm.expectRevert(DropPool.InvalidConfig.selector);
        maker.pool(2, 1, 1, 1);
        vm.expectRevert(DropPool.InvalidConfig.selector);
        maker.pool(1, uint256(type(uint96).max) + 1, 1, 1);
        vm.expectRevert(DropPool.InvalidConfig.selector);
        maker.pool(1, 2, 0, 1);
        vm.expectRevert(DropPool.InvalidConfig.selector);
        maker.pool(1, 2, uint256(type(uint32).max) + 1, 1);
        vm.expectRevert(DropPool.InvalidConfig.selector);
        maker.pool(1, 2, 1, 0);
        vm.expectRevert(DropPool.InvalidConfig.selector);
        maker.pool(1, 2, 1, uint256(type(uint32).max) + 1);
        assertEq(maker.pool(1, 2, 1, 1).MAX_SLOTS(), 1);
    }

    function test_create_validation() public {
        bytes32 lk = keccak256(_pk("PK"));
        vm.startPrank(host);
        vm.expectRevert(DropPool.ZeroLinkKey.selector);
        pool.create{value: 1 ether}(bytes32(0), 3, uint96(PER), uint64(EXP));
        vm.expectRevert(DropPool.BadSlots.selector);
        pool.create(lk, 0, uint96(PER), uint64(EXP));
        vm.expectRevert(DropPool.BadSlots.selector);
        pool.create{value: 21 * PER}(lk, 21, uint96(PER), uint64(EXP));
        vm.expectRevert(DropPool.BadPerSlot.selector);
        pool.create{value: 0.03 ether}(lk, 3, 0.01 ether - 1, uint64(EXP));
        vm.expectRevert(DropPool.BadPerSlot.selector);
        pool.create{value: 18 ether}(lk, 3, 6 ether, uint64(EXP));
        vm.expectRevert(DropPool.BadValue.selector);
        pool.create{value: 0.8 ether}(lk, 3, uint96(PER), uint64(EXP));
        vm.expectRevert(DropPool.InvalidExpiry.selector);
        pool.create{value: 0.9 ether}(lk, 3, uint96(PER), uint64(block.timestamp));
        vm.expectRevert(DropPool.InvalidExpiry.selector);
        pool.create{value: 0.9 ether}(lk, 3, uint96(PER), uint64(block.timestamp + 30 days + 1));
        vm.stopPrank();
    }

    function test_two_distinct_claimers_get_paid_into_pockets() public {
        uint256 id = mk(3);
        assertEq(pool.unclaimedOf(id), 0.9 ether);
        claim(id, 0);
        claim(id, 1);
        assertEq(pt(0).balance, PER);
        assertEq(pt(1).balance, PER);
        assertEq(pool.getPool(id).taken, 2);
        assertEq(pool.unclaimedOf(id), PER);
        assertTrue(pool.claimed(id, c(0)));
        assertFalse(pool.claimed(id, c(2)));
        assertEq(address(pool).balance, PER);
    }

    function test_same_account_cannot_claim_twice() public {
        uint256 id = mk(3);
        claim(id, 0);
        bytes memory lpk = _pk("PK");
        bytes memory ls = P("link_1_0");
        bytes memory cs = P("claim_1_0");
        address to = pt(0);
        vm.expectRevert(DropPool.AlreadyClaimed.selector);
        pool.claim(id, c(0), to, lpk, ls, cs);
        assertEq(pool.getPool(id).taken, 1);
    }

    function test_pool_full_closed_expired_unknown() public {
        uint256 id = mk(2);
        claim(id, 0);
        claim(id, 1);
        bytes memory lpk = _pk("PK");
        bytes memory ls = P("link_1_2");
        bytes memory cs = P("claim_1_2");
        address to = pt(2);
        vm.expectRevert(DropPool.PoolFull.selector);
        pool.claim(id, c(2), to, lpk, ls, cs);
        vm.expectRevert(DropPool.PoolNotFound.selector);
        pool.claim(9, c(2), to, lpk, ls, cs);
        vm.expectRevert(DropPool.PoolNotFound.selector);
        pool.close(9);

        uint256 id2 = mk(2); // pool 2
        vm.prank(host);
        pool.close(id2);
        bytes memory ls2 = P("link_2_0");
        bytes memory cs2 = P("claim_2_0");
        address to0 = pt(0);
        vm.expectRevert(DropPool.PoolClosedError.selector);
        pool.claim(id2, c(0), to0, lpk, ls2, cs2);

        uint256 id3 = mk(2); // pool 3: expires
        assertEq(id3, 3);
        vm.warp(EXP);
        vm.expectRevert(DropPool.PoolExpired.selector);
        pool.claim(id3, c(0), to0, lpk, ls2, cs2);
    }

    function test_claim_rejects_bad_inputs() public {
        uint256 id = mk(3);
        bytes memory lpk = _pk("PK");
        bytes memory ls = P("link_1_0");
        bytes memory cs = P("claim_1_0");
        address to = pt(0);
        address to1 = pt(1);
        vm.expectRevert(DropPool.BadRecipient.selector);
        pool.claim(id, address(0), to, lpk, ls, cs);
        vm.expectRevert(DropPool.BadRecipient.selector);
        pool.claim(id, c(0), address(0), lpk, ls, cs);
        vm.expectRevert(DropPool.BadRecipient.selector);
        pool.claim(id, c(0), address(pool), lpk, ls, cs);
        vm.expectRevert(DropPool.LinkKeyMismatch.selector);
        pool.claim(id, c(0), to, _pk("LK0"), ls, cs);
        // link signature problems
        vm.expectRevert(DropPool.BadLinkSignature.selector);
        pool.claim(id, c(0), to, lpk, P("linkWrongKey_1_0"), cs);
        vm.expectRevert(DropPool.BadLinkSignature.selector);
        pool.claim(id, c(1), to1, lpk, ls, P("claim_1_1")); // link sig bound to c0 reused for c1
        vm.expectRevert(DropPool.BadLinkSignature.selector);
        pool.claim(id, c(0), to1, lpk, ls, cs); // payTo swapped
        vm.expectRevert(DropPool.BadLinkSignature.selector);
        pool.claim(id, c(0), to, lpk, P("claim_1_0"), cs); // a claim sig is not a link sig
        // recipient signature problems
        vm.expectRevert(DropPool.BadRecipientSignature.selector);
        pool.claim(id, c(0), to, lpk, ls, P("claim_1_1"));
        vm.expectRevert(DropPool.BadRecipientSignature.selector);
        pool.claim(id, c(0), to, lpk, ls, P("linkAsClaim_1_0"));
        vm.expectRevert(DropPool.BadRecipientSignature.selector);
        pool.claim(id, c(0), to, lpk, ls, P("link_1_0")); // the link key's sig is not a recipient sig
    }

    function test_account_without_pop_cannot_claim() public {
        uint256 id = mk(3);
        bytes memory lpk = _pk("PK");
        bytes memory ls = P("link_1_0");
        bytes memory cs = P("claim_1_0");
        address to = pt(0);
        keys.set(c(0), true, 1, _pk("C0"), false);
        vm.expectRevert(PqcLib.PossessionNotProven.selector);
        pool.claim(id, c(0), to, lpk, ls, cs);
        keys.set(c(0), false, 0, "", false);
        vm.expectRevert(PqcLib.NotRegistered.selector);
        pool.claim(id, c(0), to, lpk, ls, cs);
    }

    function test_close_by_host_any_time_and_by_anyone_after_expiry() public {
        uint256 id = mk(3);
        claim(id, 0);
        vm.expectRevert(DropPool.NotHostOrNotExpired.selector);
        vm.prank(mallory);
        pool.close(id);
        uint256 b = host.balance;
        vm.prank(host);
        pool.close(id);
        assertEq(host.balance, b + 0.6 ether);
        assertEq(pool.unclaimedOf(id), 0);
        vm.expectRevert(DropPool.PoolClosedError.selector);
        vm.prank(host);
        pool.close(id);

        uint256 id2 = mk(3);
        vm.warp(EXP);
        b = host.balance;
        vm.prank(mallory);
        pool.close(id2);
        assertEq(host.balance, b + 0.9 ether, "refund goes to the host, not the caller");
    }

    function test_reverting_pocket_defers_pool_payout() public {
        uint256 id = mk(3);
        address to = pt(0);
        vm.etch(to, address(new HostileReceiver()).code);
        HostileReceiver(payable(to)).setBehavior(HostileReceiver.B.Revert);
        claim(id, 0);
        assertEq(pool.pending(to), PER);
        HostileReceiver(payable(to)).setBehavior(HostileReceiver.B.Accept);
        vm.prank(to);
        pool.withdraw();
        assertEq(to.balance, PER);
        vm.prank(to);
        vm.expectRevert(Payout.NothingToWithdraw.selector);
        pool.withdraw();
    }

    function test_digests() public view {
        assertEq(
            pool.linkDigest(1, c(0), pt(0)),
            keccak256(abi.encode("POCKET_POOL_LINK_V1", block.chainid, POOL, uint256(1), c(0), pt(0)))
        );
        assertEq(
            pool.claimDigest(1, c(0), pt(0)),
            keccak256(abi.encode("POCKET_POOL_CLAIM_V1", block.chainid, POOL, uint256(1), c(0), pt(0)))
        );
        assertTrue(pool.linkDigest(1, c(0), pt(0)) != pool.claimDigest(1, c(0), pt(0)));
    }
}
