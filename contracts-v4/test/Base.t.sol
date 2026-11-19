// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {PocketFactory} from "../src/PocketFactory.sol";
import {PocketRouter} from "../src/PocketRouter.sol";
import {PocketDrop} from "../src/PocketDrop.sol";
import {DropPool} from "../src/DropPool.sol";
import {PqGuardedCounter} from "../src/examples/PqGuardedCounter.sol";
import {IPocketFactory} from "../src/interfaces/IPocket.sol";
import {MockPqcVerify, MockPqcKeys} from "./mocks/MockPqc.sol";
import {Maker} from "./mocks/Hostile.sol";

/// @notice Fixture access shared by tests and invariant handlers.
abstract contract Fx is Test {
    address internal constant VERIFY_ADDR = address(uint160(0x0a01));

    function _json(string memory file) internal view returns (string memory) {
        return vm.readFile(string.concat("test/fixtures/", file, ".json"));
    }

    function _pk(string memory name) internal view returns (bytes memory) {
        return vm.parseJsonBytes(_json("keys"), string.concat(".pks.", name));
    }

    /// @dev Load signature `name` from fixture group `group` and tell the mock verifier to accept exactly that triple
    ///      (set through a storage write, so no external call sits between `vm.expectRevert` and the call under test).
    function _sg(string memory group, string memory name) internal returns (bytes memory) {
        string memory f = vm.readFile(string.concat("test/fixtures/", group, "/", name, ".json"));
        bytes32 h = vm.parseJsonBytes32(f, ".h");
        vm.store(VERIFY_ADDR, keccak256(abi.encode(h, uint256(0))), bytes32(uint256(1)));
        return vm.parseJsonBytes(f, ".sig");
    }
}

/// @notice Shared plumbing: deploys every contract at the fixed addresses the fixtures were signed for, etches the
///         signature-real precompile mocks and registers the fixture identities (key, algo 1, PoP) like the chain would.
///         A signature is accepted ONLY if the test explicitly loads its triple from test/fixtures (see `_sg`).
abstract contract V4Base is Fx {
    address internal constant IMPL = address(uint160(0x1110));
    address internal constant FACTORY = address(uint160(0xfac70));
    address internal constant DROP = address(uint160(0xd0d0d0));
    address internal constant POOL = address(uint160(0xb00100));
    address internal constant ROUTER = address(uint160(0x70070));
    address internal constant COUNTER = address(uint160(0xc0de0));
    address internal constant SINK = address(uint160(0x5151));
    address internal constant KEYS_ADDR = address(uint160(0x0a02));
    uint256 internal constant DL = 1_900_000_000;
    uint256 internal constant EXP = 1_800_000_000 + 7 days;

    uint256 internal constant TIMELOCK = 1 days;
    uint256 internal constant RECOVERY_DELAY = 2 days;
    uint256 internal constant BIND_TIMEOUT = 3600;

    address internal constant OA = address(uint160(0xa0a01));
    address internal constant OB = address(uint160(0xa0a02));
    address internal constant G0 = address(uint160(0x6700));
    address internal constant G1 = address(uint160(0x6701));
    address internal constant G2 = address(uint160(0x6702));
    address internal constant G3 = address(uint160(0x6703));

    PocketVault internal impl;
    PocketFactory internal factory;
    PocketRouter internal router;
    PocketDrop internal drop;
    DropPool internal pool;
    PqGuardedCounter internal counter;
    Maker internal maker;
    MockPqcVerify internal verifier = MockPqcVerify(VERIFY_ADDR);
    MockPqcKeys internal keys = MockPqcKeys(KEYS_ADDR);

    address internal relayer = makeAddr("relayer");
    address internal mallory = makeAddr("mallory");

    struct Cfg {
        address owner;
        address[] guardians;
        uint8 threshold;
        uint256 limit;
        bytes32 salt;
    }

    function setUp() public virtual {
        vm.chainId(9800);
        vm.etch(VERIFY_ADDR, address(new MockPqcVerify()).code);
        vm.etch(KEYS_ADDR, address(new MockPqcKeys()).code);
        deployCodeTo("PocketVault.sol:PocketVault", abi.encode(TIMELOCK, RECOVERY_DELAY), IMPL);
        deployCodeTo("PocketFactory.sol:PocketFactory", abi.encode(IMPL), FACTORY);
        deployCodeTo(
            "PocketDrop.sol:PocketDrop",
            abi.encode(0.1 ether, 50 ether, 0.6 ether, 10 ether, BIND_TIMEOUT, 30 days),
            DROP
        );
        deployCodeTo("DropPool.sol:DropPool", abi.encode(0.01 ether, 5 ether, 20, 30 days), POOL);
        deployCodeTo("PocketRouter.sol:PocketRouter", abi.encode(FACTORY, DROP, POOL), ROUTER);
        deployCodeTo("PqGuardedCounter.sol:PqGuardedCounter", "", COUNTER);
        impl = PocketVault(payable(IMPL));
        factory = PocketFactory(FACTORY);
        drop = PocketDrop(payable(DROP));
        pool = DropPool(POOL);
        router = PocketRouter(payable(ROUTER));
        counter = PqGuardedCounter(COUNTER);
        maker = new Maker();
        _registerKeys();
    }

    /*---------------- fixtures ----------------*/

    function _setKey(address who, string memory name) internal {
        keys.set(who, true, 1, _pk(name), true);
    }

    function _registerKeys() internal {
        string memory j = _json("keys");
        string[13] memory names = ["OA", "OB", "G0", "G1", "G2", "G3", "R0", "R1", "R2", "C0", "C1", "C2", "C3"];
        address[13] memory addrs = [OA, OB, G0, G1, G2, G3, r(0), r(1), r(2), c(0), c(1), c(2), c(3)];
        for (uint256 i; i < 13; i++) {
            keys.set(addrs[i], true, 1, vm.parseJsonBytes(j, string.concat(".pks.", names[i])), true);
        }
    }

    function r(uint256 i) internal pure returns (address) {
        return address(uint160(0xb0b01 + i));
    }

    function c(uint256 i) internal pure returns (address) {
        return address(uint160(0xc0c01 + i));
    }

    function V(string memory name) internal returns (bytes memory) {
        return _sg("vault", name);
    }

    function D(string memory name) internal returns (bytes memory) {
        return _sg("drops", name);
    }

    function P(string memory name) internal returns (bytes memory) {
        return _sg("pool", name);
    }

    /*---------------- pocket configs (mirror script/fixtures-lib.mjs POCKET_CFG) ----------------*/

    function cfgPA() internal pure returns (Cfg memory k) {
        k.owner = OA;
        k.guardians = new address[](3);
        k.guardians[0] = G0;
        k.guardians[1] = G1;
        k.guardians[2] = G2;
        k.threshold = 2;
        k.limit = 2 ether;
        k.salt = bytes32(uint256(1));
    }

    function cfgPA2() internal pure returns (Cfg memory k) {
        k = cfgPA();
        k.salt = bytes32(uint256(2));
    }

    function cfgPlain(address owner, uint256 limit, uint256 salt) internal pure returns (Cfg memory k) {
        k.owner = owner;
        k.guardians = new address[](0);
        k.limit = limit;
        k.salt = bytes32(salt);
    }

    function cfgPB() internal pure returns (Cfg memory) {
        return cfgPlain(OB, 5 ether, 3);
    }

    function cfgPR(uint256 i) internal pure returns (Cfg memory) {
        return cfgPlain(r(i), 1 ether, 4);
    }

    function cfgPC(uint256 i) internal pure returns (Cfg memory) {
        return cfgPlain(c(i), 1 ether, 5);
    }

    function predict(Cfg memory k) internal view returns (address) {
        return factory.predict(k.owner, k.guardians, k.threshold, k.limit, k.salt);
    }

    function deployPocket(Cfg memory k) internal returns (PocketVault v) {
        v = PocketVault(payable(factory.deploy(k.owner, k.guardians, k.threshold, k.limit, k.salt)));
    }

    /// @dev PA, deployed and funded with 100 QOR.
    function pocketA() internal returns (PocketVault v) {
        address a = predict(cfgPA());
        vm.deal(a, 100 ether);
        v = deployPocket(cfgPA());
    }
}
