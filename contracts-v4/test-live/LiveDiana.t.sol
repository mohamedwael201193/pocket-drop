// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PqcLib} from "../src/PqcLib.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {PocketFactory} from "../src/PocketFactory.sol";
import {PqcLibHarness} from "../test/PqcLib.t.sol";
import {RealCryptoTest} from "../test-real/RealCrypto.t.sol";
import {LivePrecompile} from "./LivePrecompile.sol";

/// @notice Live profile (FOUNDRY_PROFILE=live forge test): eth_call only against Diana, no transaction, no QOR.
contract LiveDianaTest is Test {
    address internal constant VERIFY_ADDR = address(uint160(0x0a01));
    address internal constant KEYS_ADDR = address(uint160(0x0a02));
    /// @dev Team deployer and relayer: both have an ML-DSA-87 key registered with proof of possession on Diana.
    address internal constant DEPLOYER = 0x392f50b1955a827458A320205e19acf7C664f116;
    address internal constant RELAYER = 0xF6e6fb2d33Bef3043682658E2b69F3a2F8616cCD;
    address internal constant NOBODY = address(uint160(uint256(keccak256("pocketdrop-unregistered"))));

    function _bridge() internal returns (PqcLibHarness h) {
        vm.etch(VERIFY_ADDR, address(new LivePrecompile(VERIFY_ADDR)).code);
        vm.etch(KEYS_ADDR, address(new LivePrecompile(KEYS_ADDR)).code);
        h = new PqcLibHarness();
    }

    function _ffi(string memory a, string memory b, string memory c) internal returns (bytes memory) {
        string[] memory cmd = new string[](5);
        cmd[0] = "node";
        cmd[1] = "script/ffi/mldsa.mjs";
        cmd[2] = a;
        cmd[3] = b;
        cmd[4] = c;
        return abi.decode(vm.ffi(cmd), (bytes));
    }

    function _pk(string memory seedName) internal returns (bytes memory) {
        string[] memory cmd = new string[](4);
        cmd[0] = "node";
        cmd[1] = "script/ffi/mldsa.mjs";
        cmd[2] = "keygen";
        cmd[3] = vm.toString(keccak256(bytes(seedName)));
        return abi.decode(vm.ffi(cmd), (bytes));
    }

    /// Fork mode cannot be used to test PqcLib against the chain: the precompiles are native code with no EVM bytecode
    /// to fork. PqcLib must then fail closed, which this pins down.
    function test_fork_of_diana_has_no_precompile_code_and_pqclib_fails_closed() public {
        vm.createSelectFork("diana");
        assertEq(block.chainid, 9800);
        assertEq(KEYS_ADDR.code.length, 0);
        assertEq(VERIFY_ADDR.code.length, 0);
        PqcLibHarness h = new PqcLibHarness();
        assertFalse(h.keyStatus(DEPLOYER).ok);
        assertFalse(h.verify(new bytes(2592), new bytes(4627), "x"));
    }

    function test_live_verify_real_signature_through_pqclib() public {
        PqcLibHarness h = _bridge();
        string memory seed = vm.toString(keccak256("pocketdrop-live-A"));
        bytes memory pk = _pk("pocketdrop-live-A");
        bytes memory m = PqcLib.pqMessage(keccak256("live intent"));
        bytes memory s = _ffi("sign", seed, vm.toString(m));
        assertTrue(h.verify(pk, s, m));
        bytes memory t = s;
        t[7] = bytes1(uint8(t[7]) ^ 1);
        assertFalse(h.verify(pk, t, m));
        assertFalse(h.verify(_pk("pocketdrop-live-B"), s, m));
        bytes memory cut = new bytes(4626);
        for (uint256 i; i < 4626; i++) {
            cut[i] = s[i];
        }
        assertFalse(h.verify(pk, cut, m));
        assertFalse(h.verify(pk, bytes.concat(s, hex"00"), m));
    }

    function test_live_empty_message_signature_is_accepted_now() public {
        PqcLibHarness h = _bridge();
        bytes memory s = _ffi("sign", vm.toString(keccak256("pocketdrop-live-A")), "0x");
        assertTrue(h.verify(_pk("pocketdrop-live-A"), s, ""));
    }

    function test_live_key_status_registered_and_unregistered() public {
        PqcLibHarness h = _bridge();
        for (uint256 i; i < 2; i++) {
            address a = i == 0 ? DEPLOYER : RELAYER;
            PqcLib.KeyStatus memory st = h.keyStatus(a);
            assertTrue(st.ok);
            assertTrue(st.registered);
            assertEq(st.algoId, 1);
            assertEq(st.pubkey.length, 2592);
            assertTrue(st.possessionProven);
            (PqcLib.KeyCheck code,) = h.checkKey(a, keccak256(st.pubkey));
            assertEq(uint256(code), uint256(PqcLib.KeyCheck.Ok));
            (code,) = h.checkKey(a, keccak256("another key"));
            assertEq(uint256(code), uint256(PqcLib.KeyCheck.KeyMismatch));
        }
        PqcLib.KeyStatus memory none = h.keyStatus(NOBODY);
        assertTrue(none.ok);
        assertFalse(none.registered);
        (PqcLib.KeyCheck c2,) = h.checkKey(NOBODY, bytes32(0));
        assertEq(uint256(c2), uint256(PqcLib.KeyCheck.NotRegistered));
    }

    function test_pocket_for_a_live_registered_owner_pins_the_live_key() public {
        _bridge();
        PocketVault impl = new PocketVault(1 days, 2 days, 3 days, 3 days);
        PocketFactory f = new PocketFactory(address(impl));
        address[] memory none = new address[](0);
        PocketVault p = PocketVault(payable(f.deploy(DEPLOYER, none, 0, 1 ether, bytes32(uint256(1)))));
        PqcLib.KeyStatus memory st = new PqcLibHarness().keyStatus(DEPLOYER);
        assertEq(p.ownerKeyHash(), keccak256(st.pubkey));
        vm.expectRevert(PqcLib.NotRegistered.selector);
        f.deploy(NOBODY, none, 0, 1 ether, bytes32(uint256(1)));
    }
}

/// @notice The whole real-crypto suite again, with every signature checked by the LIVE Diana pqcVerify (0x0A01)
///         instead of the local two-library verifier. The key registry stays local because the test identities
///         are not registered on chain.
contract LiveVerifyRealCryptoTest is RealCryptoTest {
    function setUp() public override {
        super.setUp();
        vm.etch(VERIFY_ADDR, address(new LivePrecompile(VERIFY_ADDR)).code);
    }
}
