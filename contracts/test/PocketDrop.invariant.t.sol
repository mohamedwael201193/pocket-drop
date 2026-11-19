// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {console2} from "forge-std/console2.sol";
import {IPocketDrop} from "../src/interfaces/IPocketDrop.sol";
import {HostileActor} from "./mocks/Actors.sol";
import {PocketDrop} from "../src/PocketDrop.sol";

/// @notice Handler mixing create, bind, rebind, confirm, claim, cancel, refund, withdraw, time warps and precompile
///         state changes. Every successful action is checked against the SPEC invariants by balance accounting.
contract Handler is Base {
    address internal bob = address(uint160(0xb0b)); // hostile-capable sender (contract), etched by the test
    uint256 internal constant N = 8;

    // ghost state
    mapping(uint256 => uint256) public claimCount;
    mapping(uint256 => uint256) public paidAmount;
    mapping(uint256 => IPocketDrop.State) public terminalState;
    mapping(uint256 => address) public confirmedRecipient;
    mapping(uint256 => bytes32) public confirmedKeyHash;

    bool public vClaimTarget; // inv 3: amount went somewhere other than the bound recipient
    bool public vClaimState; // claim succeeded outside its allowed state / time window
    bool public vKeyState; // inv 5: claim paid although key not (registered, algo 1, proven, hash match)
    bool public vRefundTarget; // inv 4: cancel/refund paid someone other than the sender (or wrong caller)
    bool public vBadSigAccepted; // a bind/claim with a wrong signature succeeded
    bool public vBindPayout; // bind paid something other than drip to recipient and fee to the caller
    bool public vWithdraw; // withdraw paid the wrong amount
    bool public vTerminalMutated;

    // metrics
    uint256 public nCreate;
    uint256 public nBind;
    uint256 public nRebind;
    uint256 public nConfirm;
    uint256 public nClaim;
    uint256 public nCancel;
    uint256 public nRefund;
    uint256 public nWithdraw;
    uint256 public nDeferred;

    constructor(address pd_) {
        pd = PocketDrop(payable(pd_));
    }

    /*---------------- helpers ----------------*/

    function _actor(uint256 i) internal view returns (address) {
        if (i == 0) return alice;
        if (i == 1) return bob;
        if (i == 2) return relayer;
        if (i == 3) return mallory;
        return recip(i - 4); // 4,5,6 -> recipients 0..2 (7 unused)
    }

    function _idx(address a) internal view returns (uint256) {
        for (uint256 i; i < N; i++) {
            if (_actor(i) == a) return i;
        }
        return type(uint256).max;
    }

    function _vals() internal view returns (uint256[8] memory v) {
        for (uint256 i; i < N; i++) {
            address a = _actor(i);
            v[i] = a.balance + pd.pending(a);
        }
    }

    function _pickLink(uint256 seed) internal view returns (uint256) {
        uint256 c = pd.linkCount();
        if (c == 0) return 0;
        return 1 + (seed % c);
    }

    function _caller(uint256 seed) internal view returns (address) {
        uint256 k = seed % 4;
        return k == 0 ? alice : k == 1 ? bob : k == 2 ? relayer : mallory;
    }

    /// @dev Require the value change of every tracked actor to equal `expected`.
    function _sameDiff(uint256[8] memory before_, uint256[8] memory expected) internal view returns (bool) {
        uint256[8] memory now_ = _vals();
        for (uint256 i; i < N; i++) {
            if (now_[i] != before_[i] + expected[i]) return false;
        }
        return true;
    }

    function _afterAction() internal {
        uint256 c = pd.linkCount();
        for (uint256 id = 1; id <= c; id++) {
            IPocketDrop.State s = pd.getLink(id).state;
            bool terminal = s == IPocketDrop.State.Claimed || s == IPocketDrop.State.Cancelled
                || s == IPocketDrop.State.Refunded;
            if (terminal) {
                if (terminalState[id] == IPocketDrop.State.None) terminalState[id] = s;
                else if (terminalState[id] != s) vTerminalMutated = true;
            } else if (terminalState[id] != IPocketDrop.State.None) {
                vTerminalMutated = true;
            }
        }
    }

    /*---------------- actions ----------------*/

    struct CreateArgs {
        bool viaAlice;
        uint8 mode;
        uint256 val;
        uint64 expiry;
        uint96 drip;
        uint96 fee;
        bytes32 lkh;
    }

    function create(uint256 who, uint8 modeSeed, uint256 amountSeed, uint256 dripSeed, uint256 feeSeed, uint256 ttlSeed)
        external
    {
        if (pd.linkCount() >= NUM_LINKS) return;
        CreateArgs memory a;
        a.viaAlice = who % 2 == 0;
        a.mode = modeSeed % 2;
        a.drip = uint96(bound(dripSeed, 0, MAX_DRIP));
        a.fee = uint96(bound(feeSeed, 0, 0.3 ether));
        a.val = bound(amountSeed, MIN_ESCROW, 5 ether) + a.drip + a.fee;
        a.expiry = uint64(block.timestamp + bound(ttlSeed, 1, MAX_EXPIRY));
        a.lkh = linkKeyHash(pd.linkCount() + 1);
        _create(a);
        _afterAction();
    }

    function _create(CreateArgs memory a) internal {
        if (a.viaAlice) {
            vm.prank(alice);
            try pd.create{value: a.val}(a.lkh, a.mode, a.expiry, a.drip, a.fee) {
                nCreate++;
            } catch {}
        } else {
            try HostileActor(payable(bob)).doCreate{value: a.val}(a.lkh, a.mode, a.expiry, a.drip, a.fee) {
                nCreate++;
            } catch {}
        }
    }

    function bind(uint256 linkSeed, uint256 rSeed, uint256 callerSeed, uint256 mutate) external {
        uint256 id = _pickLink(linkSeed);
        if (id == 0) return;
        _bind(id, rSeed % 3, mutate % 5 == 0, _caller(callerSeed));
    }

    function _bind(uint256 id, uint256 r, bool wrong, address caller) internal {
        uint256 shown = wrong ? (r + 1) % 3 : r; // wrong: swap the recipient after the link key signed for r
        IPocketDrop.Link memory b = pd.getLink(id);
        uint256[8] memory v0 = _vals();
        vm.prank(caller);
        try pd.bind(id, recip(shown), recipHash(shown), linkPk(id), bindSig(id, r)) {
            if (wrong) vBadSigAccepted = true;
            bool first = !b.dripPaid;
            if (b.state == IPocketDrop.State.Bound) nRebind++;
            else nBind++;
            // legal only from Open, or Bound after the deadline, before expiry
            bool legal = (b.state == IPocketDrop.State.Open
                    || (b.state == IPocketDrop.State.Bound && block.timestamp > b.bindDeadline))
                && block.timestamp < b.expiry;
            if (!legal) vBindPayout = true;
            uint256[8] memory exp;
            if (first) {
                exp[_idx(recip(shown))] += b.drip;
                exp[_idx(caller)] += b.relayerFee;
            }
            if (!_sameDiff(v0, exp)) vBindPayout = true;
        } catch {}
        _afterAction();
    }

    function confirm(uint256 linkSeed, uint256 callerSeed) external {
        uint256 id = _pickLink(linkSeed);
        if (id == 0) return;
        _confirm(id, callerSeed % 3 == 0 ? mallory : pd.getLink(id).sender);
    }

    function _confirm(uint256 id, address caller) internal {
        vm.prank(caller);
        try pd.confirm(id) {
            nConfirm++;
            IPocketDrop.Link memory l = pd.getLink(id);
            if (caller != l.sender || l.mode != IPocketDrop.Mode.Confirmed || l.state != IPocketDrop.State.Confirmed) {
                vClaimState = true;
            }
            confirmedRecipient[id] = l.recipient;
            confirmedKeyHash[id] = l.recipientKeyHash;
        } catch {}
        _afterAction();
    }

    function claim(uint256 linkSeed, uint256 sigSeed, uint256 callerSeed) external {
        uint256 id = _pickLink(linkSeed);
        if (id == 0) return;
        _claim(id, sigSeed % 3, _caller(callerSeed));
    }

    /// @dev Goal-directed step: advance a link by its next legal action, with the right signatures most of the time.
    function progress(uint256 linkSeed, uint256 noise) external {
        uint256 id = _pickLink(linkSeed);
        if (id == 0) return;
        IPocketDrop.Link memory l = pd.getLink(id);
        if (l.state == IPocketDrop.State.Open) {
            _bind(id, noise % 3, noise % 11 == 0, _caller(noise >> 8));
        } else if (l.state == IPocketDrop.State.Bound && l.mode == IPocketDrop.Mode.Confirmed) {
            _confirm(id, noise % 9 == 0 ? mallory : l.sender);
        } else if (l.state == IPocketDrop.State.Bound || l.state == IPocketDrop.State.Confirmed) {
            uint256 r = recipHash(0) == l.recipientKeyHash ? 0 : recipHash(1) == l.recipientKeyHash ? 1 : 2;
            _claim(id, noise % 7 == 0 ? (r + 1) % 3 : r, _caller(noise >> 8));
        }
    }

    function _claim(uint256 id, uint256 sigIdx, address caller) internal {
        IPocketDrop.Link memory b = pd.getLink(id);
        uint256[8] memory v0 = _vals();
        (bool reg, uint8 algo, bytes memory pk, bool pop) = keys.status(b.recipient);
        vm.prank(caller);
        try pd.claim(id, claimSig(id, sigIdx)) {
            nClaim++;
            claimCount[id]++;
            paidAmount[id] += b.amount;
            bool stateOk = b.mode == IPocketDrop.Mode.Confirmed
                ? b.state == IPocketDrop.State.Confirmed
                : (b.state == IPocketDrop.State.Bound && block.timestamp <= b.bindDeadline);
            if (!stateOk || block.timestamp >= b.expiry) vClaimState = true;
            if (!(reg && algo == 1 && pop && keccak256(pk) == b.recipientKeyHash)) vKeyState = true;
            if (pd.getLink(id).recipient != b.recipient) vClaimTarget = true;
            uint256[8] memory exp;
            exp[_idx(b.recipient)] = b.amount;
            if (!_sameDiff(v0, exp)) vClaimTarget = true;
        } catch {}
        _afterAction();
    }

    function cancel(uint256 linkSeed, uint256 callerSeed) external {
        uint256 id = _pickLink(linkSeed);
        if (id == 0) return;
        IPocketDrop.Link memory b = pd.getLink(id);
        uint256 owed = pd.unpaidOf(id);
        uint256[8] memory v0 = _vals();
        address caller = callerSeed % 4 == 0 ? mallory : b.sender;
        vm.prank(caller);
        try pd.cancel(id) {
            nCancel++;
            if (caller != b.sender) vRefundTarget = true;
            uint256[8] memory exp;
            exp[_idx(b.sender)] = owed;
            if (!_sameDiff(v0, exp)) vRefundTarget = true;
        } catch {}
        _afterAction();
    }

    function refund(uint256 linkSeed, uint256 callerSeed) external {
        uint256 id = _pickLink(linkSeed);
        if (id == 0) return;
        IPocketDrop.Link memory b = pd.getLink(id);
        uint256 owed = pd.unpaidOf(id);
        uint256[8] memory v0 = _vals();
        vm.prank(_caller(callerSeed));
        try pd.refund(id) {
            nRefund++;
            if (block.timestamp < b.expiry) vRefundTarget = true;
            uint256[8] memory exp;
            exp[_idx(b.sender)] = owed;
            if (!_sameDiff(v0, exp)) vRefundTarget = true;
        } catch {}
        _afterAction();
    }

    function withdraw(uint256 who) external {
        address a = _actor(who % N);
        uint256 p = pd.pending(a);
        uint256 balBefore = a.balance;
        if (a == bob || a == recip(2)) {
            try HostileActor(payable(a)).doWithdraw{gas: 2_000_000}() {
                nWithdraw++;
                if (a.balance != balBefore + p) vWithdraw = true;
            } catch {}
        } else {
            vm.prank(a);
            try pd.withdraw{gas: 2_000_000}() {
                nWithdraw++;
                if (a.balance != balBefore + p) vWithdraw = true;
            } catch {}
        }
        _afterAction();
    }

    function warp(uint256 seed) external {
        uint256 s = seed % 4 == 0 ? seed % 10 days : seed % 2 hours;
        vm.warp(block.timestamp + s);
        _afterAction();
    }

    function setKey(uint256 rSeed, uint256 mix) external {
        uint256 r = rSeed % 3;
        if (mix % 4 != 0) {
            registerKey(r); // mostly valid
        } else {
            keys.set(recip(r), mix % 3 != 0, uint8((mix >> 8) % 3), recipPk((mix >> 16) % 3), (mix >> 24) % 2 == 0);
        }
    }

    function hostile(uint256 who, uint256 b) external {
        HostileActor.Behavior beh = HostileActor.Behavior(b % 3); // Accept, Revert, BurnGas
        HostileActor(payable(who % 2 == 0 ? bob : recip(2))).setBehavior(beh);
        if (beh != HostileActor.Behavior.Accept) nDeferred++;
    }
}

contract PocketDropInvariantTest is Base {
    Handler internal h;

    function setUp() public override {
        super.setUp();
        address bob = address(uint160(0xb0b));
        // contract-sender and one contract-recipient with switchable hostile behaviour
        vm.etch(bob, address(new HostileActor()).code);
        HostileActor(payable(bob)).configure(pd, HostileActor.Behavior.Accept, 0, 0);
        vm.etch(recip(2), address(new HostileActor()).code);
        HostileActor(payable(recip(2))).configure(pd, HostileActor.Behavior.Accept, 0, 0);

        h = new Handler(address(pd));
        vm.deal(address(h), 100_000 ether);
        vm.deal(alice, 100_000 ether);
        vm.deal(bob, 100_000 ether);
        // the handler's own Base state (mocks, fixtures) is shared via global state; make all keys valid initially
        for (uint256 r; r < 3; r++) {
            registerKey(r);
        }

        targetContract(address(h));
        bytes4[] memory sel = new bytes4[](14);
        sel[0] = Handler.create.selector;
        sel[1] = Handler.bind.selector;
        sel[2] = Handler.confirm.selector;
        sel[3] = Handler.claim.selector;
        sel[4] = Handler.cancel.selector;
        sel[5] = Handler.refund.selector;
        sel[6] = Handler.withdraw.selector;
        sel[7] = Handler.warp.selector;
        sel[8] = Handler.setKey.selector;
        sel[9] = Handler.hostile.selector;
        sel[10] = Handler.progress.selector;
        sel[11] = Handler.progress.selector;
        sel[12] = Handler.progress.selector;
        sel[13] = Handler.create.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
    }

    /// @dev Prints how deep the random walks got (visible with -vv); the deterministic test above asserts reachability.
    function afterInvariant() public view {
        console2.log("create/bind/rebind", h.nCreate(), h.nBind(), h.nRebind());
        console2.log("confirm/claim/cancel", h.nConfirm(), h.nClaim(), h.nCancel());
        console2.log("refund/withdraw", h.nRefund(), h.nWithdraw());
    }

    function _sumUnpaid() internal view returns (uint256 s) {
        uint256 c = pd.linkCount();
        for (uint256 id = 1; id <= c; id++) {
            s += pd.unpaidOf(id);
        }
    }

    function _sumPending() internal view returns (uint256 s) {
        s = pd.pending(alice) + pd.pending(address(uint160(0xb0b))) + pd.pending(relayer) + pd.pending(mallory)
            + pd.pending(recip(0)) + pd.pending(recip(1)) + pd.pending(recip(2));
    }

    /// INV 1: contract balance covers all unpaid escrow plus all pull balances (and, with no other inflow, equals it).
    function invariant_solvency() public view {
        uint256 owed = _sumUnpaid() + pd.totalPending();
        assertGe(address(pd).balance, owed, "insolvent");
        assertEq(address(pd).balance, owed, "unaccounted ETH");
    }

    function invariant_pull_balances_sum_to_total() public view {
        assertEq(_sumPending(), pd.totalPending());
    }

    /// INV 2: a link pays its amount at most once; Claimed <=> exactly one amount payout.
    function invariant_amount_paid_at_most_once() public view {
        uint256 c = pd.linkCount();
        for (uint256 id = 1; id <= c; id++) {
            IPocketDrop.Link memory l = pd.getLink(id);
            assertLe(h.claimCount(id), 1, "double claim");
            assertLe(h.paidAmount(id), l.amount, "overpaid");
            assertEq(l.state == IPocketDrop.State.Claimed ? 1 : 0, h.claimCount(id), "claimed <=> paid once");
            if (l.state == IPocketDrop.State.Claimed || l.state == IPocketDrop.State.Cancelled
                    || l.state == IPocketDrop.State.Refunded) {
                assertEq(pd.unpaidOf(id), 0, "terminal link still holds escrow");
            }
        }
    }

    /// INV 3: the amount goes only to the recipient bound at claim time, only in a legal state/time window.
    function invariant_amount_only_to_bound_recipient() public view {
        assertFalse(h.vClaimTarget(), "claim paid someone else");
        assertFalse(h.vClaimState(), "claim/confirm outside legal state or window");
    }

    /// INV 4: refunds and cancels go only to the sender.
    function invariant_refunds_only_to_sender() public view {
        assertFalse(h.vRefundTarget());
    }

    /// INV 5: no amount payout unless the recipient key was registered, ML-DSA-87, proven and matched the bound hash.
    function invariant_no_payout_without_proven_matching_key() public view {
        assertFalse(h.vKeyState());
    }

    function invariant_bad_signatures_never_accepted() public view {
        assertFalse(h.vBadSigAccepted());
        assertFalse(h.vBindPayout(), "bind legality or payout accounting");
        assertFalse(h.vWithdraw());
    }

    function invariant_terminal_states_are_final() public view {
        assertFalse(h.vTerminalMutated());
    }

    /// A Confirmed link keeps the recipient the sender confirmed (no rebind, no swap).
    function invariant_confirmed_recipient_never_changes() public view {
        uint256 c = pd.linkCount();
        for (uint256 id = 1; id <= c; id++) {
            address cr = h.confirmedRecipient(id);
            if (cr != address(0)) {
                IPocketDrop.Link memory l = pd.getLink(id);
                assertEq(l.recipient, cr);
                assertEq(l.recipientKeyHash, h.confirmedKeyHash(id));
            }
        }
    }

    /// Sanity: a deterministic script reaches every action, so the invariants above are not vacuous.
    function test_handler_script_reaches_every_action() public {
        h.create(0, 0, 1 ether, 0.1 ether, 0.01 ether, 5 days); // 1 Confirmed (alice)
        h.create(0, 1, 1 ether, 0.1 ether, 0.01 ether, 5 days); // 2 Open
        h.create(1, 1, 1 ether, 0.1 ether, 0.01 ether, 5 days); // 3 Open (bob)
        h.create(0, 1, 1 ether, 0.1 ether, 0.01 ether, 5 days); // 4 Open
        h.bind(0, 0, 2, 1); // link 1 bound to r0 by relayer
        h.confirm(0, 1); // link 1 confirmed by sender
        h.claim(0, 0, 2); // link 1 claimed
        h.bind(1, 1, 2, 1); // link 2 -> r1
        h.claim(1, 1, 2); // link 2 claimed
        h.hostile(1, 1); // r2 now reverts on receive
        h.bind(2, 2, 3, 1); // link 3 -> r2 (drip deferred to the pull balance)
        h.bind(3, 0, 2, 1); // link 4 -> r0
        h.warp(3601); // past the bind deadline
        h.bind(3, 1, 2, 1); // rebind link 4 -> r1
        h.cancel(2, 0); // mallory tries to cancel link 3: must fail
        h.withdraw(6); // r2 withdraw into a reverting receiver: fails safely
        h.warp(8 days); // multiple of 4 => full jump; past every expiry
        h.refund(2, 0);
        h.refund(3, 0);
        h.hostile(1, 0); // r2 accepts again
        h.hostile(0, 0); // bob accepts again
        h.withdraw(6);
        assertGe(h.nCreate(), 4);
        assertGe(h.nBind(), 3);
        assertGe(h.nRebind(), 1);
        assertGe(h.nConfirm(), 1);
        assertGe(h.nClaim(), 2);
        assertGe(h.nRefund(), 2);
        assertGe(h.nWithdraw(), 1);
        invariant_solvency();
        invariant_amount_paid_at_most_once();
        assertFalse(h.vBindPayout());
    }
}
