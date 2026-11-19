// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4Base} from "./Base.t.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {PocketDrop} from "../src/PocketDrop.sol";
import {DropPool} from "../src/DropPool.sol";

/// @notice Pocket -> PocketDrop / DropPool flows and the full relayed journey, all with real ML-DSA-87 signatures.
contract PocketFlowsTest is V4Base {
    PocketVault internal v;

    function setUp() public override {
        super.setUp();
        v = pocketA();
    }

    function _lk1() internal view returns (bytes memory) {
        return _pk("LK1");
    }

    function _bindCall(uint256 id, uint256 i) internal returns (bytes memory) {
        return abi.encodeCall(
            drop.bind,
            (
                id,
                r(i),
                keccak256(_pk(string.concat("R", vm.toString(i)))),
                predict(cfgPR(i)),
                _pk(string.concat("LK", vm.toString(id % 3))),
                D(string.concat("bind_", vm.toString(id), "_", vm.toString(i)))
            )
        );
    }

    /*---------------- createDrop / confirmDrop / cancelDrop ----------------*/

    function test_createDrop_makes_the_pocket_the_sender_and_debits_allowance() public {
        uint256 id = v.createDrop(DROP, keccak256(_lk1()), 0, uint64(EXP), 0.2 ether, 0.05 ether, 1.25 ether, DL, D("cdConf_1_0"));
        assertEq(id, 1);
        assertEq(drop.getLink(1).sender, address(v));
        assertEq(address(drop).balance, 1.25 ether);
        assertEq(address(v).balance, 100 ether - 1.25 ether);
        assertEq(v.spentToday(), 1.25 ether);
        assertEq(v.nonce(), 1);
    }

    function test_createDrop_over_allowance_or_rejected_by_drop_reverts_cleanly() public {
        bytes32 lk = keccak256(_lk1());
        vm.expectRevert(PocketVault.OverDailyLimit.selector);
        v.createDrop(DROP, lk, 0, uint64(EXP), 0, 0, 3 ether, DL, D("cdBig_0"));
        vm.expectRevert(PocketDrop.InvalidMode.selector);
        v.createDrop(DROP, lk, 5, uint64(EXP), 0, 0, 1 ether, DL, D("cdBadMode_0"));
        assertEq(v.nonce(), 0);
        assertEq(v.spentToday(), 0);
    }

    function test_allowance_is_shared_by_spend_and_createDrop() public {
        v.spend(SINK, 0.8 ether, DL, V("spendS_0")); // 1.2 left
        bytes32 lk = keccak256(_lk1());
        bytes memory s1 = D("cdConf_1_1");
        vm.expectRevert(PocketVault.OverDailyLimit.selector);
        v.createDrop(DROP, lk, 0, uint64(EXP), 0.2 ether, 0.05 ether, 1.25 ether, DL, s1);
        v.spend(SINK, 0.8 ether, DL, V("spendS_1")); // the failed createDrop consumed neither nonce nor allowance
        assertEq(v.spentToday(), 1.6 ether);
    }

    function test_confirmDrop_is_a_sender_intent_and_cancelDrop_refunds_the_pocket() public {
        v.createDrop(DROP, keccak256(_lk1()), 0, uint64(EXP), 0.2 ether, 0.05 ether, 1.25 ether, DL, D("cdConf_1_0"));
        bytes memory bindData = _bindCall(1, 0);
        vm.prank(relayer); // an EOA caller: the router sweeps the relayer fee to it
        router.relay(DROP, bindData);
        // wrong recipient key hash: the sender did not check THIS key
        vm.expectRevert(PocketDrop.RecipientChanged.selector);
        v.confirmDrop(DROP, 1, keccak256(_pk("R1")), DL, D("cfWrong_1_1"));
        v.confirmDrop(DROP, 1, keccak256(_pk("R0")), DL, D("cf_1_1"));
        assertEq(uint8(drop.getLink(1).state), uint8(PocketDrop.State.Confirmed));

        // second link (next day, fresh allowance): cancelled by the Pocket, escrow returns to the Pocket
        vm.warp(block.timestamp + 1 days);
        v.createDrop(DROP, keccak256(_pk("LK2")), 0, uint64(EXP), 0.2 ether, 0.05 ether, 1.25 ether, DL, D("cdConf_2_2"));
        uint256 before_ = address(v).balance;
        v.cancelDrop(DROP, 2, DL, D("cn_2_3"));
        assertEq(address(v).balance, before_ + 1.25 ether);
    }

    /*---------------- pools ----------------*/

    function test_pool_hosted_by_a_pocket_with_two_claimers_then_closed() public {
        uint256 pid = v.createPool(POOL, keccak256(_pk("PK")), 3, 0.3 ether, uint64(EXP), DL, D("cp_0"));
        assertEq(pid, 1);
        assertEq(pool.getPool(1).host, address(v));
        assertEq(v.spentToday(), 0.9 ether);
        for (uint256 i; i < 2; i++) {
            router.relay(
                POOL,
                abi.encodeCall(
                    pool.claim,
                    (
                        1,
                        c(i),
                        predict(cfgPC(i)),
                        _pk("PK"),
                        P(string.concat("link_1_", vm.toString(i))),
                        P(string.concat("claim_1_", vm.toString(i)))
                    )
                )
            );
        }
        assertEq(predict(cfgPC(0)).balance, 0.3 ether);
        assertEq(predict(cfgPC(1)).balance, 0.3 ether);
        uint256 b = address(v).balance;
        v.closePool(POOL, 1, DL, D("cl_1"));
        assertEq(address(v).balance, b + 0.3 ether);
    }

    function test_pool_debits_allowance_too() public {
        v.createDrop(DROP, keccak256(_lk1()), 0, uint64(EXP), 0.2 ether, 0.05 ether, 1.25 ether, DL, D("cdConf_1_0"));
        vm.expectRevert(PocketVault.OverDailyLimit.selector);
        v.createPool(POOL, keccak256(_pk("PK")), 3, 0.3 ether, uint64(EXP), DL, D("cp_1")); // 0.9 > 0.75 left
        vm.expectRevert(PocketVault.OverDailyLimit.selector);
        v.createPool(POOL, keccak256(_pk("PK")), 3, 1 ether, uint64(EXP), DL, D("cpBig_1"));
    }

    /*---------------- the whole journey ----------------*/

    function test_full_journey_sender_pocket_to_recipient_pocket_through_the_router() public {
        // 1. sender Pocket creates a Confirmed link (intent relayed through the router)
        router.relay(
            address(v),
            abi.encodeCall(
                v.createDrop, (DROP, keccak256(_lk1()), 0, uint64(EXP), 0.2 ether, 0.05 ether, 1.25 ether, DL, D("cdConf_1_0"))
            )
        );
        // 2. the recipient's browser binds (link-key signature), relayer collects the fee through the router sweep
        bytes memory bindData = _bindCall(1, 0);
        uint256 rb = relayer.balance;
        vm.prank(relayer);
        router.relay(DROP, bindData);
        assertEq(relayer.balance, rb + 0.05 ether, "relayerFee reaches the relayer, not the router");
        assertEq(address(router).balance, 0);
        assertEq(predict(cfgPR(0)).balance, 0.2 ether, "drip landed in the recipient's counterfactual Pocket");
        // 3. the sender confirms in one tap (intent), no second device
        router.relay(address(v), abi.encodeCall(v.confirmDrop, (DROP, 1, keccak256(_pk("R0")), DL, D("cf_1_1"))));
        // 4. the recipient claims into their Pocket (still undeployed)
        router.relay(DROP, abi.encodeCall(drop.claim, (1, D("claim_1_0"))));
        address pr0 = predict(cfgPR(0));
        assertEq(pr0.balance, 1.2 ether);
        assertEq(pr0.code.length, 0);
        // 5. the recipient's first action lazily deploys the Pocket and spends from it
        Cfg memory k = cfgPR(0);
        router.deployAndRelay(
            k.owner, k.guardians, k.threshold, k.limit, k.salt,
            abi.encodeCall(PocketVault.spend, (SINK, 0.1 ether, DL, V("spendPR0_0")))
        );
        assertEq(pr0.balance, 1.1 ether);
        assertEq(SINK.balance, 0.1 ether);
        assertEq(address(drop).balance, 0);
    }
}
