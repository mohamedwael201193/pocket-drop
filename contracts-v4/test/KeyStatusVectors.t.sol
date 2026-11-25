// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PqcLib} from "../src/PqcLib.sol";
import {RawMock} from "./mocks/MockPqc.sol";
import {PqcLibHarness} from "./PqcLib.t.sol";

/// @notice PqcLib.keyStatus against the shared raw-return vectors (test/fixtures/keystatus/vectors.json). The same
///         file drives the strict browser/API decoder (frontend/src/lib/keystatus.ts). Two cases are the RECORDED raw
///         bytes the Diana precompile returned; the rest change one field of them.
contract KeyStatusVectorsTest is Test {
    address internal constant KEYS_ADDR = address(uint160(0x0a02));
    PqcLibHarness internal h;
    RawMock internal raw = RawMock(KEYS_ADDR);

    function setUp() public {
        h = new PqcLibHarness();
        vm.etch(KEYS_ADDR, address(new RawMock()).code);
    }

    function _vectors() internal view returns (string memory) {
        return vm.readFile("test/fixtures/keystatus/vectors.json");
    }

    function _p(uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".vectors[", vm.toString(i), "].", field);
    }

    /// @dev Shared vectors whose v4 decode was ok but which the v5 strict PqcLib refuses (non-canonical layout).
    function _v5Refuses(string memory name) internal pure returns (bool) {
        bytes32 k = keccak256(bytes(name));
        return k == keccak256("offset-0xa0-with-gap") || k == keccak256("trailing-word")
            || k == keccak256("unaligned-extra-byte");
    }

    function test_every_vector_decodes_as_recorded() public {
        string memory json = _vectors();
        uint256 n = vm.parseJsonUint(json, ".count");
        assertEq(n, 18);
        for (uint256 i; i < n; i++) {
            string memory name = vm.parseJsonString(json, _p(i, "name"));
            raw.set(vm.parseJsonBytes(json, _p(i, "raw")), false);
            PqcLib.KeyStatus memory st = h.keyStatus(address(0xabc));
            if (_v5Refuses(name)) {
                // v5 strict layout: offset exactly 0x80 and no trailing data. These decoded under v4.
                assertFalse(st.ok, name);
                assertFalse(st.registered, name);
                assertEq(st.pubkey.length, 0, name);
                continue;
            }
            assertEq(st.ok, vm.parseJsonBool(json, _p(i, "contract.ok")), name);
            assertEq(st.registered, vm.parseJsonBool(json, _p(i, "contract.registered")), name);
            assertEq(uint256(st.algoId), vm.parseJsonUint(json, _p(i, "contract.algoId")), name);
            assertEq(st.possessionProven, vm.parseJsonBool(json, _p(i, "contract.proven")), name);
            assertEq(st.pubkey.length, vm.parseJsonUint(json, _p(i, "contract.pkLen")), name);
            if (!st.ok) {
                // fail-closed: nothing leaks out of a rejected decode
                assertFalse(st.registered, name);
                assertFalse(st.possessionProven, name);
                assertEq(st.pubkey.length, 0, name);
            }
        }
    }

    /// The RECORDED Diana return is the canonical ABI layout: offset 0x80, a 2592-byte ML-DSA-87 key, no padding.
    function test_live_diana_return_is_canonical_and_usable() public {
        string memory live = vm.readFile("test/fixtures/keystatus/live-diana.json");
        bytes memory r = vm.parseJsonBytes(live, ".registered.raw");
        assertEq(r.length, 160 + 2592);
        uint256 off;
        uint256 len;
        assembly {
            off := mload(add(r, 96))
            len := mload(add(r, 160))
        }
        assertEq(off, 0x80);
        assertEq(len, 2592);

        raw.set(r, false);
        (PqcLib.KeyCheck code, bytes memory pk) = h.checkKey(address(0xabc), bytes32(0));
        assertEq(uint8(code), uint8(PqcLib.KeyCheck.Ok));
        assertEq(pk.length, 2592);
        // pinning works on the live key bytes, and a different pin is refused
        (code,) = h.checkKey(address(0xabc), keccak256(pk));
        assertEq(uint8(code), uint8(PqcLib.KeyCheck.Ok));
        (code,) = h.checkKey(address(0xabc), keccak256("other"));
        assertEq(uint8(code), uint8(PqcLib.KeyCheck.KeyMismatch));

        raw.set(vm.parseJsonBytes(live, ".unregistered.raw"), false);
        (code,) = h.checkKey(address(0xdead), bytes32(0));
        assertEq(uint8(code), uint8(PqcLib.KeyCheck.NotRegistered));
    }

    /// Possession is enforced on the live key bytes: the same key with possessionProven = 0 is refused.
    function test_live_key_without_possession_is_refused() public {
        string memory json = _vectors();
        uint256 n = vm.parseJsonUint(json, ".count");
        for (uint256 i; i < n; i++) {
            if (keccak256(bytes(vm.parseJsonString(json, _p(i, "name")))) != keccak256("registered-not-proven")) continue;
            raw.set(vm.parseJsonBytes(json, _p(i, "raw")), false);
            (PqcLib.KeyCheck code,) = h.checkKey(address(0xabc), bytes32(0));
            assertEq(uint8(code), uint8(PqcLib.KeyCheck.NotProven));
            vm.expectRevert(PqcLib.PossessionNotProven.selector);
            h.requireKey(address(0xabc), bytes32(0));
            return;
        }
        revert("vector missing");
    }
}
