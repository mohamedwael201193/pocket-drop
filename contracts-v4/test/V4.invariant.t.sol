// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/console2.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Fx, V4Base} from "./Base.t.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {PocketDrop} from "../src/PocketDrop.sol";
import {DropPool} from "../src/DropPool.sol";

address constant SINK_ = address(uint160(0x5151));
uint256 constant DL_ = 1_900_000_000;

/*====================================================================================================================
                                                    VAULT
====================================================================================================================*/

contract VaultHandler is Fx {
    PocketVault public v;
    uint256 public immediatePaid;
    uint256 public executedPaid;
    uint256 public okIntents;
    bool public earlyExecution;
    bool public paidWrongAmount;

    constructor(PocketVault v_) {
        v = v_;
    }

    function spend(uint256 seed) external {
        uint256 n = v.nonce();
        if (n >= 60) return;
        bool big = seed % 2 == 1;
        bytes memory sig = _sg("fuzz", string.concat(big ? "spendB_" : "spendS_", vm.toString(n)));
        uint256 amt = big ? 5 ether : 0.8 ether;
        uint256 dayBefore = v.allowanceLeft();
        try v.spend(SINK_, amt, DL_, sig) returns (uint256 id) {
            okIntents++;
            if (id == 0) {
                immediatePaid += amt;
                if (amt > dayBefore) paidWrongAmount = true; // paid now although it did not fit the allowance
            } else if (amt <= dayBefore) {
                paidWrongAmount = true; // queued although it fit
            }
        } catch {}
    }

    function execute(uint256 seed) external {
        uint256 c = v.queueCount();
        if (c == 0) return;
        uint256 id = 1 + seed % c;
        PocketVault.Queued memory q = v.getQueued(id);
        try v.executeQueued(id) {
            executedPaid += q.amount;
            if (block.timestamp < q.unlockAt || q.state != PocketVault.QState.Pending) earlyExecution = true;
        } catch {}
    }

    function warp(uint256 s) external {
        vm.warp(block.timestamp + (s % 30 hours));
    }
}

contract VaultInvariantTest is StdInvariant, V4Base {
    VaultHandler internal h;
    PocketVault internal v;

    function setUp() public override {
        super.setUp();
        v = pocketA();
        h = new VaultHandler(v);
        targetContract(address(h));
        bytes4[] memory sels = new bytes4[](3);
        sels[0] = VaultHandler.spend.selector;
        sels[1] = VaultHandler.execute.selector;
        sels[2] = VaultHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sels}));
    }

    /// QOR conservation: every wei that left the Pocket was paid by an immediate spend or an executed queued spend.
    function invariant_vault_balance_conservation() public view {
        assertEq(SINK_.balance, h.immediatePaid() + h.executedPaid());
        assertEq(address(v).balance, 100 ether - SINK_.balance);
    }

    function invariant_nonce_counts_successful_intents() public view {
        assertEq(v.nonce(), h.okIntents());
    }

    function invariant_queued_spends_never_execute_early_or_twice() public view {
        assertFalse(h.earlyExecution());
    }

    function invariant_allowance_rule_respected() public view {
        assertFalse(h.paidWrongAmount());
        assertLe(v.spentToday(), v.dailyLimit());
    }
}

/*====================================================================================================================
                                                    DROP
====================================================================================================================*/

contract DropHandler is Fx {
    PocketDrop public drop;
    address public alice;
    address public relayer;
    address public mallory;
    uint256 public constant N = 8;
    mapping(uint256 => uint256) public claimCount;
    bool public badClaim;
    bool public badBind;
    bool public badRefund;
    uint256 public nClaims;

    constructor(PocketDrop d, address a, address rl, address m) {
        drop = d;
        alice = a;
        relayer = rl;
        mallory = m;
    }

    function _payTo(uint256 i) internal view returns (address) {
        // the Pocket address the bind/claim fixtures were signed for (cfgPR(i)); read from the fixture key file
        return vm.parseJsonAddress(_json("keys"), string.concat(".pockets.PR", vm.toString(i)));
    }

    function _lk(uint256 id) internal view returns (bytes memory) {
        return _pk(string.concat("LK", vm.toString(id % 3)));
    }

    function create(uint256 modeSeed, uint256 dripSeed, uint256 feeSeed, uint256 amtSeed, uint256 ttlSeed) external {
        uint256 id = drop.linkCount() + 1;
        if (id > N) return;
        uint96 drip = uint96(bound(dripSeed, 0, 0.6 ether));
        uint96 fee = uint96(bound(feeSeed, 0, 0.3 ether));
        uint256 val = bound(amtSeed, 0.1 ether, 5 ether) + drip + fee;
        uint64 exp = uint64(block.timestamp + bound(ttlSeed, 1, 30 days));
        vm.prank(alice);
        try drop.create{value: val}(keccak256(_lk(id)), uint8(modeSeed % 2), exp, drip, fee) {} catch {}
    }

    function bind(uint256 idSeed, uint256 rSeed, uint256 who) external {
        uint256 c = drop.linkCount();
        if (c == 0) return;
        uint256 id = 1 + idSeed % c;
        uint256 i = rSeed % 3;
        bytes memory s = _sg("drops", string.concat("bind_", vm.toString(id), "_", vm.toString(i)));
        bytes memory lpk = _lk(id);
        bytes32 rh = keccak256(_pk(string.concat("R", vm.toString(i))));
        address pt = _payTo(i);
        PocketDrop.Link memory b = drop.getLink(id);
        vm.prank(who % 2 == 0 ? relayer : mallory);
        try drop.bind(id, address(uint160(0xb0b01 + i)), rh, pt, lpk, s) {
            bool legal = (b.state == PocketDrop.State.Open
                    || (b.state == PocketDrop.State.Bound && block.timestamp > b.bindDeadline))
                && block.timestamp < b.expiry;
            if (!legal) badBind = true;
        } catch {}
    }

    function confirm(uint256 idSeed, uint256 rSeed) external {
        uint256 c = drop.linkCount();
        if (c == 0) return;
        uint256 id = 1 + idSeed % c;
        PocketDrop.Link memory l = drop.getLink(id);
        vm.prank(alice);
        try drop.confirmRecipient(id, l.recipientKeyHash == bytes32(0) ? bytes32(rSeed) : l.recipientKeyHash) {} catch {}
    }

    function claim(uint256 idSeed, uint256 rSeed) external {
        uint256 c = drop.linkCount();
        if (c == 0) return;
        uint256 id = 1 + idSeed % c;
        PocketDrop.Link memory b = drop.getLink(id);
        // usually claim as the bound recipient (so claims actually happen), sometimes as someone else
        uint256 i = (b.recipient != address(0) && rSeed % 4 != 0) ? uint160(b.recipient) - 0xb0b01 : rSeed % 3;
        bytes memory s = _sg("drops", string.concat("claim_", vm.toString(id), "_", vm.toString(i)));
        uint256 pb = b.payTo == address(0) ? 0 : b.payTo.balance;
        vm.prank(relayer);
        try drop.claim(id, s) {
            claimCount[id]++;
            nClaims++;
            bool stateOk = (b.mode == PocketDrop.Mode.Confirmed && b.state == PocketDrop.State.Confirmed)
                || (b.mode == PocketDrop.Mode.Open && b.state == PocketDrop.State.Bound);
            if (!stateOk || block.timestamp >= b.expiry) badClaim = true;
            // the amount went to the bound payTo (a plain account in this suite) and nowhere else
            if (b.payTo.balance != pb + b.amount) badClaim = true;
        } catch {}
    }

    function cancel(uint256 idSeed) external {
        uint256 c = drop.linkCount();
        if (c == 0) return;
        uint256 id = 1 + idSeed % c;
        address sender = drop.getLink(id).sender;
        uint256 b = alice.balance;
        uint256 owed = drop.unpaidOf(id);
        vm.prank(alice);
        try drop.cancel(id) {
            if (sender != alice || alice.balance != b + owed) badRefund = true;
        } catch {}
    }

    function refund(uint256 idSeed) external {
        uint256 c = drop.linkCount();
        if (c == 0) return;
        uint256 id = 1 + idSeed % c;
        uint256 b = alice.balance;
        uint256 owed = drop.unpaidOf(id);
        vm.prank(mallory);
        try drop.refund(id) {
            if (alice.balance != b + owed) badRefund = true;
        } catch {}
    }

    function warp(uint256 s) external {
        vm.warp(block.timestamp + (s % 2 days));
    }
}

contract DropInvariantTest is StdInvariant, V4Base {
    DropHandler internal h;
    address internal alice = makeAddr("alice");

    function setUp() public override {
        super.setUp();
        vm.deal(alice, 10_000 ether);
        h = new DropHandler(drop, alice, relayer, mallory);
        targetContract(address(h));
        bytes4[] memory sels = new bytes4[](7);
        sels[0] = DropHandler.create.selector;
        sels[1] = DropHandler.bind.selector;
        sels[2] = DropHandler.confirm.selector;
        sels[3] = DropHandler.claim.selector;
        sels[4] = DropHandler.cancel.selector;
        sels[5] = DropHandler.refund.selector;
        sels[6] = DropHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sels}));
    }

    /// balance == sum(unpaid escrow of live links) + pull balances (exactly).
    function invariant_drop_balance_equals_unpaid_plus_pending() public view {
        uint256 sum;
        for (uint256 id = 1; id <= drop.linkCount(); id++) {
            sum += drop.unpaidOf(id);
        }
        assertEq(address(drop).balance, sum + drop.totalPending());
    }

    function invariant_a_link_pays_at_most_once() public view {
        for (uint256 id = 1; id <= 8; id++) {
            assertLe(h.claimCount(id), 1);
        }
    }

    function invariant_claims_and_binds_respect_state_machine() public view {
        assertFalse(h.badClaim());
        assertFalse(h.badBind());
        assertFalse(h.badRefund());
    }

    function afterInvariant() public view {
        console2.log("drop links", drop.linkCount(), "claims", h.nClaims());
    }

    function invariant_terminal_links_hold_nothing() public view {
        for (uint256 id = 1; id <= drop.linkCount(); id++) {
            PocketDrop.State s = drop.getLink(id).state;
            if (s == PocketDrop.State.Claimed || s == PocketDrop.State.Cancelled || s == PocketDrop.State.Refunded) {
                assertEq(drop.unpaidOf(id), 0);
            }
        }
    }
}

/*====================================================================================================================
                                                    POOL
====================================================================================================================*/

contract PoolHandler is Fx {
    DropPool public pool;
    address public host;
    address public relayer;
    address public mallory;
    mapping(uint256 => mapping(uint256 => uint256)) public claims; // pid => claimer index => times paid
    bool public badClaim;
    bool public badClose;

    constructor(DropPool p, address h, address rl, address m) {
        pool = p;
        host = h;
        relayer = rl;
        mallory = m;
    }

    function create(uint256 slotSeed, uint256 ttlSeed) external {
        if (pool.poolCount() >= 2) return;
        uint32 slots = uint32(bound(slotSeed, 1, 4));
        uint64 exp = uint64(block.timestamp + bound(ttlSeed, 1, 30 days));
        vm.prank(host);
        try pool.create{value: uint256(slots) * 0.3 ether}(keccak256(_pk("PK")), slots, 0.3 ether, exp) {} catch {}
    }

    function claim(uint256 pidSeed, uint256 cSeed) external {
        uint256 pc = pool.poolCount();
        if (pc == 0) return;
        uint256 pid = 1 + pidSeed % pc;
        uint256 i = cSeed % 4;
        bytes memory lpk = _pk("PK");
        bytes memory ls = _sg("pool", string.concat("link_", vm.toString(pid), "_", vm.toString(i)));
        bytes memory cs = _sg("pool", string.concat("claim_", vm.toString(pid), "_", vm.toString(i)));
        address to = vm.parseJsonAddress(_json("keys"), string.concat(".pockets.PC", vm.toString(i)));
        DropPool.Pool memory b = pool.getPool(pid);
        uint256 tb = to.balance;
        vm.prank(relayer);
        try pool.claim(pid, address(uint160(0xc0c01 + i)), to, lpk, ls, cs) {
            claims[pid][i]++;
            if (b.closed || b.taken >= b.slots || block.timestamp >= b.expiry || to.balance != tb + b.perSlot) badClaim = true;
        } catch {}
    }

    function close(uint256 pidSeed, bool byHost) external {
        uint256 pc = pool.poolCount();
        if (pc == 0) return;
        uint256 pid = 1 + pidSeed % pc;
        DropPool.Pool memory b = pool.getPool(pid);
        uint256 hb = host.balance;
        uint256 owed = pool.unclaimedOf(pid);
        vm.prank(byHost ? host : mallory);
        try pool.close(pid) {
            if (host.balance != hb + owed) badClose = true;
            if (!byHost && block.timestamp < b.expiry) badClose = true;
        } catch {}
    }

    function warp(uint256 s) external {
        vm.warp(block.timestamp + (s % 3 days));
    }
}

contract PoolInvariantTest is StdInvariant, V4Base {
    PoolHandler internal h;
    address internal host = makeAddr("host");

    function setUp() public override {
        super.setUp();
        vm.deal(host, 10_000 ether);
        h = new PoolHandler(pool, host, relayer, mallory);
        targetContract(address(h));
        bytes4[] memory sels = new bytes4[](4);
        sels[0] = PoolHandler.create.selector;
        sels[1] = PoolHandler.claim.selector;
        sels[2] = PoolHandler.close.selector;
        sels[3] = PoolHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sels}));
    }

    function invariant_pool_balance_equals_unclaimed_plus_pending() public view {
        uint256 sum;
        for (uint256 id = 1; id <= pool.poolCount(); id++) {
            sum += pool.unclaimedOf(id);
        }
        assertEq(address(pool).balance, sum + pool.totalPending());
    }

    function invariant_one_slot_per_account_and_never_beyond_slots() public view {
        for (uint256 pid = 1; pid <= 2; pid++) {
            uint256 total;
            for (uint256 i; i < 4; i++) {
                assertLe(h.claims(pid, i), 1, "an account claimed twice");
                total += h.claims(pid, i);
            }
            if (pid <= pool.poolCount()) {
                DropPool.Pool memory p = pool.getPool(pid);
                assertLe(p.taken, p.slots);
                assertEq(p.taken, total);
            }
        }
    }

    function invariant_claims_and_closes_follow_the_rules() public view {
        assertFalse(h.badClaim());
        assertFalse(h.badClose());
    }
}
