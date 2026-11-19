// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4Base} from "./Base.t.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {PocketFactory} from "../src/PocketFactory.sol";
import {PqcLib} from "../src/PqcLib.sol";

contract PocketFactoryTest is V4Base {
    function _addr(string memory name) internal view returns (address) {
        return vm.parseJsonAddress(_json("keys"), string.concat(".pockets.", name));
    }

    function test_predict_matches_independent_js_computation() public view {
        assertEq(predict(cfgPA()), _addr("PA"));
        assertEq(predict(cfgPA2()), _addr("PA2"));
        assertEq(predict(cfgPB()), _addr("PB"));
        for (uint256 i; i < 3; i++) {
            assertEq(predict(cfgPR(i)), _addr(string.concat("PR", vm.toString(i))));
        }
        for (uint256 i; i < 4; i++) {
            assertEq(predict(cfgPC(i)), _addr(string.concat("PC", vm.toString(i))));
        }
    }

    function test_deploy_creates_pinned_clone() public {
        Cfg memory k = cfgPA();
        address p = predict(k);
        assertFalse(factory.isPocket(p));
        assertEq(p.code.length, 0);
        PocketVault v = deployPocket(k);
        assertEq(address(v), p);
        assertTrue(factory.isPocket(p));
        assertEq(p.code.length, 45, "EIP-1167 runtime is 45 bytes");
        assertEq(v.owner(), OA);
        assertEq(v.ownerKeyHash(), keccak256(_pk("OA")));
        assertEq(v.factory(), FACTORY);
        assertEq(v.dailyLimit(), 2 ether);
        assertEq(v.threshold(), 2);
        assertEq(v.guardians().length, 3);
        assertEq(v.TIMELOCK(), TIMELOCK);
        assertEq(v.RECOVERY_DELAY(), RECOVERY_DELAY);
    }

    function test_funds_sent_before_deploy_survive() public {
        Cfg memory k = cfgPA();
        address p = predict(k);
        vm.deal(p, 0.5 ether);
        assertEq(p.code.length, 0);
        deployPocket(k);
        assertEq(p.balance, 0.5 ether);
    }

    function test_deploy_twice_reverts() public {
        Cfg memory k = cfgPA();
        deployPocket(k);
        vm.expectRevert(PocketFactory.AlreadyDeployed.selector);
        factory.deploy(k.owner, k.guardians, k.threshold, k.limit, k.salt);
    }

    function test_deploy_requires_registered_proven_owner_key() public {
        Cfg memory k = cfgPlain(address(0x1234), 1 ether, 9);
        vm.expectRevert(PqcLib.NotRegistered.selector);
        factory.deploy(k.owner, k.guardians, k.threshold, k.limit, k.salt);
        keys.set(k.owner, true, 1, _pk("OA"), false);
        vm.expectRevert(PqcLib.PossessionNotProven.selector);
        factory.deploy(k.owner, k.guardians, k.threshold, k.limit, k.salt);
        keys.set(k.owner, true, 2, _pk("OA"), true);
        vm.expectRevert(PqcLib.UnsupportedAlgo.selector);
        factory.deploy(k.owner, k.guardians, k.threshold, k.limit, k.salt);
        keys.set(k.owner, true, 1, _pk("OA"), true);
        factory.deploy(k.owner, k.guardians, k.threshold, k.limit, k.salt);
    }

    function test_deploy_rejects_bad_guardian_config() public {
        address[] memory g = new address[](1);
        g[0] = G0;
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        factory.deploy(OA, g, 1, 1 ether, bytes32(0)); // a single guardian is not a recovery quorum
        g = new address[](2);
        g[0] = G0;
        g[1] = G1;
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        factory.deploy(OA, g, 3, 1 ether, bytes32(0));
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        factory.deploy(address(0), g, 2, 1 ether, bytes32(0));
    }

    function test_initialize_cannot_be_called_again_or_on_implementation() public {
        PocketVault v = deployPocket(cfgPA());
        address[] memory none = new address[](0);
        vm.expectRevert(PocketVault.AlreadyInitialized.selector);
        v.initialize(mallory, none, 0, 1 ether);
        vm.expectRevert(PocketVault.AlreadyInitialized.selector);
        impl.initialize(mallory, none, 0, 1 ether);
    }

    function test_constructor_checks() public {
        vm.expectRevert(PocketFactory.NoImplementation.selector);
        maker.factory(address(0xdeadbeef));
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        maker.vault(0, 1, 1, 1);
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        maker.vault(1, 0, 1, 1);
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        maker.vault(31 days, 1, 1, 1);
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        maker.vault(1, 31 days, 1, 1);
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        maker.vault(1, 1, 0, 1);
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        maker.vault(1, 1, 31 days, 1);
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        maker.vault(1, 1, 1, 0);
        vm.expectRevert(PocketVault.InvalidConfig.selector);
        maker.vault(1, 1, 1, 31 days);
        PocketVault lab = maker.vault(60, 60, 120, 180);
        assertEq(lab.FREEZE_PERIOD(), 120);
        assertEq(lab.UNANIMOUS_RECOVERY_DELAY(), 180);
        assertEq(lab.TIMELOCK(), 60);
    }

    function testFuzz_salt_commits_to_whole_config(address owner, uint256 limit, bytes32 salt, uint8 threshold) public view {
        vm.assume(limit < type(uint256).max && uint256(salt) < type(uint256).max && uint160(owner) < type(uint160).max);
        address[] memory none = new address[](0);
        address base = factory.predict(owner, none, 0, limit, salt);
        assertTrue(base != factory.predict(owner, none, 0, limit + 1, salt), "limit");
        assertTrue(base != factory.predict(owner, none, 0, limit, bytes32(uint256(salt) + 1)), "salt");
        assertTrue(base != factory.predict(address(uint160(owner) + 1), none, 0, limit, salt), "owner");
        if (threshold != 0) assertTrue(base != factory.predict(owner, none, threshold, limit, salt), "threshold");
        address[] memory one = new address[](1);
        one[0] = G0;
        assertTrue(base != factory.predict(owner, one, 0, limit, salt), "guardians");
    }

    function testFuzz_predict_equals_deploy(uint256 limit, bytes32 salt) public {
        Cfg memory k = cfgPlain(OB, limit, uint256(salt));
        address p = predict(k);
        assertEq(address(deployPocket(k)), p);
    }

    function test_saltOf_view() public view {
        Cfg memory k = cfgPA();
        assertEq(
            factory.saltOf(k.owner, k.guardians, k.threshold, k.limit, k.salt),
            keccak256(abi.encode(k.owner, k.guardians, k.threshold, k.limit, k.salt))
        );
    }
}
