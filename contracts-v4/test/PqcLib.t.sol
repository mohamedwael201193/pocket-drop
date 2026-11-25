// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PqcLib} from "../src/PqcLib.sol";
import {RawMock, MockPqcVerify, MockPqcKeys} from "./mocks/MockPqc.sol";

contract PqcLibHarness {
    function verify(bytes memory pk, bytes memory sig, bytes memory m) external view returns (bool) {
        return PqcLib.verify(pk, sig, m);
    }

    function keyStatus(address a) external view returns (PqcLib.KeyStatus memory) {
        return PqcLib.keyStatus(a);
    }

    function pqMessage(bytes32 d) external pure returns (bytes memory) {
        return PqcLib.pqMessage(d);
    }

    function checkKey(address a, bytes32 pinned) external view returns (PqcLib.KeyCheck, bytes memory) {
        return PqcLib.checkKey(a, pinned);
    }

    function requireKey(address a, bytes32 pinned) external view returns (bytes memory) {
        return PqcLib.requireKey(a, pinned);
    }

    function verifyFor(address a, bytes memory m, bytes memory s) external view returns (bool) {
        return PqcLib.verifyFor(a, m, s);
    }

    function verifyForKey(address a, bytes32 pinned, bytes memory m, bytes memory s) external view returns (bool) {
        return PqcLib.verifyForKey(a, pinned, m, s);
    }
}

/// @notice PqcLib must be fail-closed: any failure or malformed precompile output => false / ok == false, never a revert.
contract PqcLibTest is Test {
    address internal constant VERIFY_ADDR = address(uint160(0x0a01));
    address internal constant KEYS_ADDR = address(uint160(0x0a02));

    PqcLibHarness internal h;
    RawMock internal rawVerify = RawMock(VERIFY_ADDR);
    RawMock internal rawKeys = RawMock(KEYS_ADDR);
    address internal acct = address(0xabc);
    /// @dev v5: PqcLib.verify only calls the precompile for ML-DSA-87 sizes, so the raw-return tests use those sizes.
    bytes internal P = new bytes(2592);
    bytes internal S = new bytes(4627);

    function setUp() public {
        h = new PqcLibHarness();
        vm.etch(VERIFY_ADDR, address(new RawMock()).code);
        vm.etch(KEYS_ADDR, address(new RawMock()).code);
    }

    /*---------------- verify ----------------*/

    function test_verify_true_only_for_exactly_one_word_equal_one() public {
        rawVerify.set(abi.encode(uint256(1)), false);
        assertTrue(h.verify(P, S, "c"));
        rawVerify.set(abi.encode(true), false);
        assertTrue(h.verify(P, S, "c"));
    }

    function test_verify_false_variants() public {
        rawVerify.set(abi.encode(uint256(0)), false);
        assertFalse(h.verify(P, S, "c"), "false word");
        rawVerify.set(abi.encode(uint256(2)), false);
        assertFalse(h.verify(P, S, "c"), "word 2 is not true");
        rawVerify.set(abi.encode(type(uint256).max), false);
        assertFalse(h.verify(P, S, "c"), "max word");
        rawVerify.set(hex"", false);
        assertFalse(h.verify(P, S, "c"), "empty return");
        rawVerify.set(hex"01", false);
        assertFalse(h.verify(P, S, "c"), "1 byte");
        rawVerify.set(new bytes(31), false);
        assertFalse(h.verify(P, S, "c"), "31 bytes");
        rawVerify.set(bytes.concat(abi.encode(uint256(1)), hex"00"), false);
        assertFalse(h.verify(P, S, "c"), "33 bytes");
        rawVerify.set(abi.encode(uint256(1), uint256(1)), false);
        assertFalse(h.verify(P, S, "c"), "64 bytes");
        rawVerify.set(abi.encode(uint256(1)), true);
        assertFalse(h.verify(P, S, "c"), "reverting precompile");
    }

    function test_verify_false_when_precompile_has_no_code() public {
        vm.etch(VERIFY_ADDR, hex"");
        assertFalse(h.verify(P, S, "c"), "no code => empty return => false");
    }

    function test_verify_passes_exact_calldata() public {
        // Use the signature-real mock: only the exact triple is accepted.
        vm.etch(VERIFY_ADDR, address(new MockPqcVerify()).code);
        bytes memory pk = _filled(2592, 0x11);
        bytes memory sig = _filled(4627, 0x22);
        bytes memory m = hex"06";
        MockPqcVerify(VERIFY_ADDR).accept(keccak256(abi.encode(pk, sig, m)));
        assertTrue(h.verify(pk, sig, m));
        assertFalse(h.verify(pk, sig, hex"07"));
        bytes memory sig2 = _filled(4627, 0x22);
        sig2[4626] = 0x23;
        assertFalse(h.verify(pk, sig2, m));
        bytes memory pk2 = _filled(2592, 0x11);
        pk2[0] = 0x12;
        assertFalse(h.verify(pk2, sig, m));
    }

    /*---------------- v5: sizes enforced in the contract ----------------*/

    function _filled(uint256 n, uint8 b) internal pure returns (bytes memory out) {
        out = new bytes(n);
        for (uint256 i; i < n; i++) {
            out[i] = bytes1(b);
        }
    }

    /// The precompile is never reached for a wrong size, even if it would answer true.
    function test_v5_verify_refuses_wrong_sizes_before_the_precompile() public {
        rawVerify.set(abi.encode(uint256(1)), false); // a precompile that says yes to everything
        assertTrue(h.verify(P, S, "m"));
        assertFalse(h.verify(new bytes(2591), S, "m"), "pk 2591");
        assertFalse(h.verify(new bytes(2593), S, "m"), "pk 2593");
        assertFalse(h.verify("", S, "m"), "pk empty");
        assertFalse(h.verify(new bytes(1952), S, "m"), "ML-DSA-65 key size");
        assertFalse(h.verify(P, new bytes(4626), "m"), "sig 4626");
        assertFalse(h.verify(P, new bytes(4628), "m"), "sig 4628");
        assertFalse(h.verify(P, "", "m"), "sig empty");
        assertFalse(h.verify(P, new bytes(3309), "m"), "ML-DSA-65 sig size");
    }

    function testFuzz_v5_verify_true_only_at_exact_sizes(uint16 pkLen, uint16 sigLen) public {
        pkLen = uint16(bound(pkLen, 0, 6000));
        sigLen = uint16(bound(sigLen, 0, 6000));
        rawVerify.set(abi.encode(uint256(1)), false);
        bool got = h.verify(new bytes(pkLen), new bytes(sigLen), "m");
        assertEq(got, pkLen == 2592 && sigLen == 4627);
    }

    function test_v5_keyStatus_refuses_trailing_data() public {
        bytes memory good = _enc(true, 1, P, true);
        rawKeys.set(good, false);
        assertTrue(h.keyStatus(acct).ok);
        _assertNotOk(bytes.concat(good, new bytes(32)), false, "32 trailing bytes");
        _assertNotOk(bytes.concat(good, hex"00"), false, "1 trailing byte");
    }

    function test_v5_checkKey_refuses_ml_dsa_87_key_of_wrong_length() public {
        _setKeys(true, 1, new bytes(2591), true);
        (PqcLib.KeyCheck code,) = h.checkKey(acct, 0);
        assertEq(uint8(code), uint8(PqcLib.KeyCheck.BadKeyLength));
        vm.expectRevert(PqcLib.BadKeyLength.selector);
        h.requireKey(acct, 0);
        _setKeys(true, 1, new bytes(2593), true);
        (code,) = h.checkKey(acct, 0);
        assertEq(uint8(code), uint8(PqcLib.KeyCheck.BadKeyLength));
        _setKeys(true, 1, P, true);
        (code,) = h.checkKey(acct, 0);
        assertEq(uint8(code), uint8(PqcLib.KeyCheck.Ok));
    }

    /*---------------- keyStatus ----------------*/

    function _enc(bool reg, uint256 algo, bytes memory pk, bool pop) internal pure returns (bytes memory) {
        return abi.encode(reg, uint8(algo), pk, pop);
    }

    function test_keyStatus_valid_decode() public {
        bytes memory pk = new bytes(2592);
        for (uint256 i; i < pk.length; i++) {
            pk[i] = bytes1(uint8(i * 7 + 3));
        }
        rawKeys.set(_enc(true, 1, pk, true), false);
        PqcLib.KeyStatus memory st = h.keyStatus(acct);
        assertTrue(st.ok);
        assertTrue(st.registered);
        assertEq(st.algoId, 1);
        assertTrue(st.possessionProven);
        assertEq(st.pubkey, pk);
    }

    function test_keyStatus_unregistered_empty_key() public {
        rawKeys.set(_enc(false, 0, "", false), false);
        PqcLib.KeyStatus memory st = h.keyStatus(acct);
        assertTrue(st.ok);
        assertFalse(st.registered);
        assertEq(st.pubkey.length, 0);
    }

    function test_keyStatus_odd_length_key_and_flags() public {
        bytes memory pk = hex"aabbcc";
        rawKeys.set(_enc(true, 255, pk, false), false);
        PqcLib.KeyStatus memory st = h.keyStatus(acct);
        assertTrue(st.ok);
        assertEq(st.algoId, 255);
        assertFalse(st.possessionProven);
        assertEq(st.pubkey, pk);
    }

    function test_v5_keyStatus_refuses_gap_between_head_and_tail() public {
        // offset 160 instead of 128: valid ABI, but not the layout the precompile produces. v4 accepted it; v5 does not.
        bytes memory pk = hex"0102030405";
        bytes memory data = abi.encodePacked(
            uint256(1), uint256(1), uint256(160), uint256(1), uint256(0), uint256(pk.length), pk, new bytes(27)
        );
        _assertNotOk(data, false, "offset 0xa0");
    }

    function _assertNotOk(bytes memory data, bool doRevert, string memory why) internal {
        rawKeys.set(data, doRevert);
        PqcLib.KeyStatus memory st = h.keyStatus(acct);
        assertFalse(st.ok, why);
        assertFalse(st.registered, why);
        assertFalse(st.possessionProven, why);
        assertEq(st.algoId, 0, why);
        assertEq(st.pubkey.length, 0, why);
    }

    function test_keyStatus_fail_closed_on_call_failure() public {
        _assertNotOk(_enc(true, 1, hex"01", true), true, "revert");
    }

    function test_keyStatus_fail_closed_on_no_code() public {
        vm.etch(KEYS_ADDR, hex"");
        PqcLib.KeyStatus memory st = h.keyStatus(acct);
        assertFalse(st.ok);
    }

    function test_keyStatus_fail_closed_on_short_data() public {
        _assertNotOk(hex"", false, "empty");
        _assertNotOk(new bytes(159), false, "159 bytes");
        _assertNotOk(new bytes(128), false, "head only");
        // a 3-tuple (missing the last bool) is not accepted
        _assertNotOk(abi.encode(true, uint8(1), uint256(96)), false, "3-tuple");
    }

    function test_keyStatus_fail_closed_on_non_bool_flags() public {
        bytes memory pk = hex"0102";
        bytes memory good = _enc(true, 1, pk, true);
        bytes memory bad = good;
        _setWord(bad, 0, 2);
        _assertNotOk(bad, false, "registered == 2");
        bad = good;
        _setWord(bad, 3, 2);
        _assertNotOk(bad, false, "possession == 2");
        bad = good;
        _setWord(bad, 1, 256);
        _assertNotOk(bad, false, "algo > uint8");
        bad = good;
        _setWord(bad, 0, type(uint256).max);
        _assertNotOk(bad, false, "registered max");
    }

    function test_keyStatus_fail_closed_on_bad_offsets() public {
        bytes memory good = _enc(true, 1, hex"0102", true);
        bytes memory bad = good;
        _setWord(bad, 2, 96);
        _assertNotOk(bad, false, "offset inside head");
        bad = good;
        _setWord(bad, 2, 129);
        _assertNotOk(bad, false, "offset misaligned");
        bad = good;
        _setWord(bad, 2, good.length - 31);
        _assertNotOk(bad, false, "offset past data");
        bad = good;
        _setWord(bad, 2, type(uint256).max);
        _assertNotOk(bad, false, "offset huge");
        bad = good;
        _setWord(bad, 2, 0);
        _assertNotOk(bad, false, "offset zero");
    }

    function test_keyStatus_fail_closed_on_bad_length() public {
        bytes memory good = _enc(true, 1, hex"0102", true);
        bytes memory bad = good;
        _setWord(bad, 4, 8193);
        _assertNotOk(bad, false, "len above cap");
        bad = good;
        _setWord(bad, 4, type(uint256).max);
        _assertNotOk(bad, false, "len huge");
        bad = good;
        _setWord(bad, 4, 33); // claims more bytes than present
        _assertNotOk(bad, false, "len beyond data");
        // truncated payload
        bytes memory truncated = new bytes(good.length - 32);
        for (uint256 i; i < truncated.length; i++) {
            truncated[i] = good[i];
        }
        _assertNotOk(truncated, false, "truncated");
    }

    function test_keyStatus_cap_boundary() public {
        bytes memory pk = new bytes(8192);
        pk[8191] = 0x07;
        rawKeys.set(_enc(true, 1, pk, true), false);
        assertTrue(h.keyStatus(acct).ok);
        bytes memory tooBig = new bytes(8193);
        _assertNotOk(_enc(true, 1, tooBig, true), false, "8193");
    }

    /// Any random bytes: never reverts; if ok it must be internally consistent.
    function testFuzz_keyStatus_never_reverts(bytes memory data) public {
        rawKeys.set(data, false);
        PqcLib.KeyStatus memory st = h.keyStatus(acct);
        if (!st.ok) {
            assertFalse(st.registered);
            assertEq(st.pubkey.length, 0);
        } else {
            assertLe(st.pubkey.length, 8192);
        }
    }

    function testFuzz_verify_never_reverts(bytes memory data, bool doRevert) public {
        rawVerify.set(data, doRevert);
        bool v = h.verify("pk", "sig", "msg");
        if (v) assertEq(data, abi.encode(uint256(1)));
    }

    /// Mutating any single word of a valid encoding either keeps the decode consistent or fails closed.
    function testFuzz_keyStatus_mutated_word(uint8 wordIdx, uint256 value) public {
        bytes memory pk = hex"0102030405060708";
        bytes memory data = _enc(true, 1, pk, true);
        uint256 words = data.length / 32;
        _setWord(data, wordIdx % words, value);
        rawKeys.set(data, false);
        PqcLib.KeyStatus memory st = h.keyStatus(acct);
        if (st.ok) {
            assertLe(st.pubkey.length, 8192);
        }
    }

    function _setWord(bytes memory b, uint256 idx, uint256 v) internal pure {
        assembly {
            mstore(add(add(b, 32), mul(idx, 32)), v)
        }
    }
    /*---------------- v4: prefixed message, key checks ----------------*/

    function _setKeys(bool reg, uint8 algo, bytes memory pk, bool pop) internal {
        vm.etch(KEYS_ADDR, address(new MockPqcKeys()).code);
        MockPqcKeys(KEYS_ADDR).set(acct, reg, algo, pk, pop);
    }

    function test_pqMessage_is_qorex_prefix_plus_hex_digest() public view {
        bytes32 d = keccak256("x");
        assertEq(h.pqMessage(d), bytes.concat("qorechain-msg-v1|qorechain-diana|", bytes(vm.toString(d))));
        assertEq(h.pqMessage(bytes32(0)).length, 17 + 15 + 1 + 66);
    }

    function testFuzz_pqMessage_matches_reference(bytes32 d) public view {
        assertEq(h.pqMessage(d), bytes.concat("qorechain-msg-v1|qorechain-diana|", bytes(vm.toString(d))));
    }

    function test_checkKey_codes() public {
        bytes memory pk = _filled(2592, 0x01);
        (PqcLib.KeyCheck code,) = h.checkKey(acct, 0); // RawMock: empty data => unavailable
        assertEq(uint8(code), uint8(PqcLib.KeyCheck.Unavailable));
        _setKeys(false, 0, "", false);
        (code,) = h.checkKey(acct, 0);
        assertEq(uint8(code), uint8(PqcLib.KeyCheck.NotRegistered));
        _setKeys(true, 2, pk, true);
        (code,) = h.checkKey(acct, 0);
        assertEq(uint8(code), uint8(PqcLib.KeyCheck.UnsupportedAlgo));
        _setKeys(true, 1, pk, false);
        (code,) = h.checkKey(acct, 0);
        assertEq(uint8(code), uint8(PqcLib.KeyCheck.NotProven));
        _setKeys(true, 1, pk, true);
        (code,) = h.checkKey(acct, bytes32(uint256(1)));
        assertEq(uint8(code), uint8(PqcLib.KeyCheck.KeyMismatch));
        bytes memory got;
        (code, got) = h.checkKey(acct, keccak256(pk));
        assertEq(uint8(code), uint8(PqcLib.KeyCheck.Ok));
        assertEq(got, pk);
        (code, got) = h.checkKey(acct, 0);
        assertEq(uint8(code), uint8(PqcLib.KeyCheck.Ok));
    }

    function test_requireKey_reverts_per_code() public {
        bytes memory pk = _filled(2592, 0x01);
        vm.expectRevert(PqcLib.KeyUnavailable.selector);
        h.requireKey(acct, 0);
        _setKeys(false, 0, "", false);
        vm.expectRevert(PqcLib.NotRegistered.selector);
        h.requireKey(acct, 0);
        _setKeys(true, 2, pk, true);
        vm.expectRevert(PqcLib.UnsupportedAlgo.selector);
        h.requireKey(acct, 0);
        _setKeys(true, 1, pk, false);
        vm.expectRevert(PqcLib.PossessionNotProven.selector);
        h.requireKey(acct, 0);
        _setKeys(true, 1, pk, true);
        vm.expectRevert(PqcLib.KeyMismatch.selector);
        h.requireKey(acct, bytes32(uint256(1)));
        assertEq(h.requireKey(acct, keccak256(pk)), pk);
    }

    function test_verifyFor_uses_registered_key_and_exact_message() public {
        bytes memory pk = _filled(2592, 0x01);
        bytes memory sig = _filled(4627, 0x03);
        bytes memory m = hex"05";
        _setKeys(true, 1, pk, true);
        vm.etch(VERIFY_ADDR, address(new MockPqcVerify()).code);
        MockPqcVerify(VERIFY_ADDR).accept(keccak256(abi.encode(pk, sig, m)));
        assertTrue(h.verifyFor(acct, m, sig));
        assertFalse(h.verifyFor(acct, hex"06", sig));
        assertTrue(h.verifyForKey(acct, keccak256(pk), m, sig));
        assertFalse(h.verifyForKey(acct, bytes32(uint256(9)), m, sig), "pinned hash mismatch");
        _setKeys(true, 1, pk, false);
        assertFalse(h.verifyFor(acct, m, sig), "no PoP");
    }
}
