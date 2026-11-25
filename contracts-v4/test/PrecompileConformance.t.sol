// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PqcLib} from "../src/PqcLib.sol";
import {RawMock} from "./mocks/MockPqc.sol";
import {PqcLibHarness} from "./PqcLib.t.sol";

/// @notice Replays the exact bytes the LIVE Diana precompiles returned (test/fixtures/conformance/live.json, recorded by
///         script/probe-precompiles.mjs with eth_call, block numbers inside) against PqcLib. For every recorded case
///         PqcLib must reach the FIPS 204 expectation: true only for a valid ML-DSA-87 signature, and the key status
///         decoded field by field as the chain reported it. If the chain's answer format ever changes, re-running the
///         probe and this test shows it.
contract PrecompileConformanceTest is Test {
    address internal constant VERIFY_ADDR = address(uint160(0x0a01));
    address internal constant KEYS_ADDR = address(uint160(0x0a02));
    PqcLibHarness internal h;
    string internal j;

    function setUp() public {
        vm.etch(VERIFY_ADDR, address(new RawMock()).code);
        vm.etch(KEYS_ADDR, address(new RawMock()).code);
        h = new PqcLibHarness();
        j = vm.readFile("test/fixtures/conformance/live.json");
    }

    function _p(string memory arr, uint256 i, string memory f) internal pure returns (string memory) {
        return string.concat(".", arr, "[", vm.toString(i), "].", f);
    }

    function test_pqcLib_verify_matches_fips204_on_every_recorded_live_answer() public {
        uint256 n = vm.parseJsonUint(j, ".vN");
        assertGt(n, 20);
        uint256 trues;
        for (uint256 i; i < n; i++) {
            bool reverted = vm.parseJsonBool(j, _p("v", i, "reverted"));
            bytes memory ret = vm.parseJsonBytes(j, _p("v", i, "ret"));
            bool expected = vm.parseJsonBool(j, _p("v", i, "expected"));
            RawMock(VERIFY_ADDR).set(ret, reverted);
            bool got = h.verify(hex"01", hex"02", hex"03"); // inputs are irrelevant: the live answer is replayed
            assertEq(got, expected, vm.parseJsonString(j, _p("v", i, "name")));
            if (got) trues++;
        }
        assertGt(trues, 0);
    }

    function test_pqcLib_keyStatus_decodes_every_recorded_live_answer() public {
        uint256 n = vm.parseJsonUint(j, ".ksN");
        assertGt(n, 2);
        for (uint256 i; i < n; i++) {
            string memory name = vm.parseJsonString(j, _p("ks", i, "name"));
            RawMock(KEYS_ADDR)
                .set(vm.parseJsonBytes(j, _p("ks", i, "ret")), vm.parseJsonBool(j, _p("ks", i, "reverted")));
            PqcLib.KeyStatus memory st = h.keyStatus(vm.parseJsonAddress(j, _p("ks", i, "address")));
            assertTrue(st.ok, name);
            assertEq(st.registered, vm.parseJsonBool(j, _p("ks", i, "registered")), name);
            assertEq(st.algoId, vm.parseJsonUint(j, _p("ks", i, "algoId")), name);
            assertEq(st.pubkey.length, vm.parseJsonUint(j, _p("ks", i, "pubkeyLen")), name);
            assertEq(st.possessionProven, vm.parseJsonBool(j, _p("ks", i, "possessionProven")), name);
            (PqcLib.KeyCheck code,) = h.checkKey(vm.parseJsonAddress(j, _p("ks", i, "address")), bytes32(0));
            if (st.registered) assertEq(uint256(code), uint256(PqcLib.KeyCheck.Ok), name);
            else assertEq(uint256(code), uint256(PqcLib.KeyCheck.NotRegistered), name);
        }
    }

    function test_recorded_key_answers_have_the_layout_the_strict_v5_lib_requires() public view {
        uint256 n = vm.parseJsonUint(j, ".ksN");
        for (uint256 i; i < n; i++) {
            bytes memory ret = vm.parseJsonBytes(j, _p("ks", i, "ret"));
            uint256 off;
            assembly {
                off := mload(add(ret, 96))
            }
            assertEq(off, 0x80);
            uint256 len = vm.parseJsonUint(j, _p("ks", i, "pubkeyLen"));
            assertTrue(len == 0 || len == 2592);
        }
    }
}
