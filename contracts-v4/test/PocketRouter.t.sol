// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4Base} from "./Base.t.sol";
import {PocketRouter} from "../src/PocketRouter.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {HostileReceiver} from "./mocks/Hostile.sol";

contract PocketRouterTest is V4Base {
    PocketVault internal v;

    function setUp() public override {
        super.setUp();
        v = pocketA();
    }

    function _spendData(string memory name) internal returns (bytes memory) {
        return abi.encodeCall(v.spend, (SINK, 0.8 ether, DL, V(name)));
    }

    function test_immutables_and_allowlist() public {
        assertEq(address(router.factory()), FACTORY);
        assertEq(router.drop(), DROP);
        assertEq(router.pool(), POOL);
        assertTrue(router.isAllowed(DROP));
        assertTrue(router.isAllowed(POOL));
        assertTrue(router.isAllowed(address(v)));
        assertFalse(router.isAllowed(predict(cfgPB())), "predicted but not deployed");
        assertFalse(router.isAllowed(mallory));
        assertFalse(router.isAllowed(COUNTER));
        assertFalse(router.isAllowed(address(router)));
    }

    function test_relay_to_pocket_executes_intent() public {
        bytes memory d = _spendData("spendS_0");
        router.relay(address(v), d);
        assertEq(SINK.balance, 0.8 ether);
    }

    function test_relay_refuses_non_pocket_targets() public {
        bytes memory d = _spendData("spendS_0");
        vm.expectRevert(abi.encodeWithSelector(PocketRouter.NotAllowed.selector, mallory));
        router.relay(mallory, d);
        vm.expectRevert(abi.encodeWithSelector(PocketRouter.NotAllowed.selector, COUNTER));
        router.relay(COUNTER, "");
        vm.expectRevert(abi.encodeWithSelector(PocketRouter.NotAllowed.selector, IMPL));
        router.relay(IMPL, "");
        address undeployed = predict(cfgPB());
        vm.expectRevert(abi.encodeWithSelector(PocketRouter.NotAllowed.selector, undeployed));
        router.relay(undeployed, "");
    }

    function test_relay_bubbles_inner_reverts() public {
        bytes memory d = _spendData("wrongKey_spendS_0");
        vm.expectRevert(PocketVault.BadSignature.selector);
        router.relay(address(v), d);
    }

    function test_lazy_deploy_funded_before_deploy_then_executes() public {
        Cfg memory k = cfgPR(0);
        address p = predict(k);
        vm.deal(p, 1 ether); // plain send to the counterfactual address
        assertEq(p.code.length, 0);
        bytes memory d = abi.encodeCall(PocketVault.spend, (SINK, 0.1 ether, DL, V("spendPR0_0")));
        (address got,) = router.deployAndRelay(k.owner, k.guardians, k.threshold, k.limit, k.salt, d);
        assertEq(got, p);
        assertTrue(factory.isPocket(p));
        assertEq(SINK.balance, 0.1 ether);
        assertEq(p.balance, 0.9 ether);
    }

    function test_deployAndRelay_on_existing_pocket_and_deploy_only() public {
        Cfg memory k = cfgPA();
        bytes memory d = _spendData("spendS_0");
        (address got,) = router.deployAndRelay(k.owner, k.guardians, k.threshold, k.limit, k.salt, d);
        assertEq(got, address(v));
        assertEq(SINK.balance, 0.8 ether);
        // deploy-only (empty data)
        Cfg memory k2 = cfgPB();
        (address p2, bytes memory ret) = router.deployAndRelay(k2.owner, k2.guardians, k2.threshold, k2.limit, k2.salt, "");
        assertTrue(factory.isPocket(p2));
        assertEq(ret.length, 0);
    }

    function test_deployAndRelay_bubbles_and_rolls_back_deploy() public {
        Cfg memory k = cfgPR(0);
        bytes memory d = abi.encodeCall(PocketVault.spend, (SINK, 0.1 ether, DL, V("wrongKey_spendS_0")));
        vm.expectRevert(PocketVault.BadSignature.selector);
        router.deployAndRelay(k.owner, k.guardians, k.threshold, k.limit, k.salt, d);
        assertFalse(factory.isPocket(predict(k)));
    }

    function test_sweep_failure_reverts() public {
        vm.deal(address(router), 1 ether);
        HostileReceiver h = new HostileReceiver();
        h.setBehavior(HostileReceiver.B.Revert);
        // relaying empty calldata to a Pocket hits receive() and succeeds; the sweep to a reverting caller then fails
        bytes memory d = abi.encodeCall(router.relay, (address(v), ""));
        (bool ok, bytes memory ret) = h.exec(address(router), d, 0);
        assertFalse(ok);
        assertEq(bytes4(ret), PocketRouter.SweepFailed.selector);
        // an EOA caller receives the stray balance
        uint256 b = relayer.balance;
        vm.prank(relayer);
        router.relay(address(v), "");
        assertEq(relayer.balance, b + 1 ether);
        assertEq(address(router).balance, 0);
    }

    function test_router_accepts_plain_sends() public {
        (bool ok,) = address(router).call{value: 0}("");
        assertTrue(ok);
    }
}
