// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4Base} from "../test/Base.t.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {PocketDrop} from "../src/PocketDrop.sol";
import {DropPool} from "../src/DropPool.sol";
import {PqcLib} from "../src/PqcLib.sol";
import {RealPqcVerify} from "./RealPqcHarness.sol";

/// @dev Calls PqcLib directly so the library itself can be fed edge cases.
contract PqcLibProbe {
    function verify(bytes memory pk, bytes memory sig, bytes memory m) external view returns (bool) {
        return PqcLib.verify(pk, sig, m);
    }

    function verifyFor(address a, bytes memory m, bytes memory sig) external view returns (bool) {
        return PqcLib.verifyFor(a, m, sig);
    }
}

/// @notice Real-crypto suite (FOUNDRY_PROFILE=realcrypto forge test). Keys and signatures are generated at test time
///         with ML-DSA-87 (script/ffi/mldsa.mjs, qorechain pqc) and the pqcVerify precompile at 0x0A01 is replaced by
///         RealPqcVerify, which verifies with the real algorithm in two libraries. Nothing is pre-approved: the only
///         way a call passes is a signature the real ML-DSA-87 verifier accepts over the exact bytes the contract
///         builds. The key registry (0x0A02) stays a state table (MockPqcKeys): it stores keys, it does no crypto.
contract RealCryptoTest is V4Base {
    PocketVault internal pv; // owner ALICE, guardians GA/GB/GC, threshold 2, limit 5 QOR
    PqcLibProbe internal probe;

    address internal constant ALICE = address(uint160(0xa11ce));
    address internal constant BOB = address(uint160(0xb0b));
    address internal constant CAROL = address(uint160(0xca201));
    address internal constant GA = address(uint160(0x6a01));
    address internal constant GB = address(uint160(0x6a02));
    address internal constant GC = address(uint160(0x6a03));
    uint256 internal constant SIG_LEN = 4627;
    uint256 internal constant PK_LEN = 2592;

    mapping(bytes32 => bytes) internal pkCache;

    function setUp() public virtual override {
        super.setUp();
        vm.etch(VERIFY_ADDR, address(new RealPqcVerify()).code);
        probe = new PqcLibProbe();
        _reg(ALICE, "alice");
        _reg(BOB, "bob");
        _reg(CAROL, "carol");
        _reg(GA, "ga");
        _reg(GB, "gb");
        _reg(GC, "gc");
        address[] memory g = new address[](3);
        g[0] = GA;
        g[1] = GB;
        g[2] = GC;
        address a = factory.predict(ALICE, g, 2, 5 ether, bytes32(uint256(77)));
        vm.deal(a, 20 ether);
        pv = PocketVault(payable(factory.deploy(ALICE, g, 2, 5 ether, bytes32(uint256(77)))));
    }

    /*---------------- real ML-DSA-87 via ffi ----------------*/

    function _seed(string memory name) internal pure returns (string memory) {
        return vm.toString(keccak256(bytes(string.concat("pocketdrop-realcrypto-", name))));
    }

    function pk(string memory name) internal returns (bytes memory k) {
        bytes32 id = keccak256(bytes(name));
        k = pkCache[id];
        if (k.length != 0) return k;
        string[] memory cmd = new string[](4);
        cmd[0] = "node";
        cmd[1] = "script/ffi/mldsa.mjs";
        cmd[2] = "keygen";
        cmd[3] = _seed(name);
        k = abi.decode(vm.ffi(cmd), (bytes));
        pkCache[id] = k;
    }

    function sign(string memory name, bytes memory message) internal returns (bytes memory) {
        string[] memory cmd = new string[](5);
        cmd[0] = "node";
        cmd[1] = "script/ffi/mldsa.mjs";
        cmd[2] = "sign";
        cmd[3] = _seed(name);
        cmd[4] = vm.toString(message);
        return abi.decode(vm.ffi(cmd), (bytes));
    }

    function _reg(address who, string memory name) internal {
        keys.set(who, true, 1, pk(name), true);
    }

    function _signDigest(string memory name, bytes32 d) internal returns (bytes memory) {
        return sign(name, PqcLib.pqMessage(d));
    }

    function _spendSig(string memory name, address to, uint256 amount, uint256 nonce_, uint256 dl)
        internal
        returns (bytes memory)
    {
        return _signDigest(name, pv.intentDigest(pv.ACT_SPEND(), nonce_, dl, abi.encode(to, amount)));
    }

    function _relaySpend(address to, uint256 amount, uint256 dl, bytes memory sig) internal {
        router.relay(address(pv), abi.encodeCall(PocketVault.spend, (to, amount, dl, sig)));
    }

    function _trunc(bytes memory b, uint256 n) internal pure returns (bytes memory out) {
        out = new bytes(n);
        for (uint256 i; i < n; i++) {
            out[i] = b[i];
        }
    }

    /*---------------- sanity: the generated material is real ML-DSA-87 ----------------*/

    function test_real_sizes_and_library_agreement() public {
        assertEq(pk("alice").length, PK_LEN);
        bytes memory s = sign("alice", "hello");
        assertEq(s.length, SIG_LEN);
        assertTrue(probe.verify(pk("alice"), s, "hello"));
        assertFalse(probe.verify(pk("bob"), s, "hello"));
        assertFalse(probe.verify(pk("alice"), s, "hellp"));
    }

    function test_empty_message_signature_verifies_with_real_algorithm() public {
        bytes memory s = sign("alice", "");
        assertTrue(probe.verify(pk("alice"), s, ""));
        assertFalse(probe.verify(pk("alice"), s, hex"00"));
    }

    /*---------------- PocketVault through PocketRouter ----------------*/

    function test_spend_real_signature_accepted_through_router() public {
        bytes memory s = _spendSig("alice", SINK, 1 ether, 0, DL);
        _relaySpend(SINK, 1 ether, DL, s);
        assertEq(SINK.balance, 1 ether);
        assertEq(pv.nonce(), 1);
    }

    function test_spend_replay_of_a_real_signature_refused() public {
        bytes memory s = _spendSig("alice", SINK, 1 ether, 0, DL);
        _relaySpend(SINK, 1 ether, DL, s);
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 1 ether, DL, s);
        assertEq(SINK.balance, 1 ether);
    }

    function test_spend_tampered_amount_and_recipient_refused() public {
        bytes memory s = _spendSig("alice", SINK, 1 ether, 0, DL);
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 2 ether, DL, s);
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(mallory, 1 ether, DL, s);
        assertEq(pv.nonce(), 0);
    }

    function test_spend_one_flipped_signature_bit_refused() public {
        bytes memory s = _spendSig("alice", SINK, 1 ether, 0, DL);
        s[100] = bytes1(uint8(s[100]) ^ 0x01);
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 1 ether, DL, s);
    }

    function test_spend_signed_by_wrong_key_refused() public {
        bytes memory s = _spendSig("bob", SINK, 1 ether, 0, DL); // valid ML-DSA-87, but not the owner's key
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 1 ether, DL, s);
        s = _spendSig("ga", SINK, 1 ether, 0, DL); // a guardian cannot sign owner intents
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 1 ether, DL, s);
    }

    function test_spend_truncated_oversized_and_empty_signature_refused() public {
        bytes memory s = _spendSig("alice", SINK, 1 ether, 0, DL);
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 1 ether, DL, _trunc(s, SIG_LEN - 1));
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 1 ether, DL, bytes.concat(s, hex"00"));
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 1 ether, DL, "");
        // the untouched signature still works afterwards: nothing above consumed the nonce
        _relaySpend(SINK, 1 ether, DL, s);
        assertEq(SINK.balance, 1 ether);
    }

    function test_spend_wrong_domain_refused() public {
        bytes32 d = pv.intentDigest(pv.ACT_SPEND(), 0, DL, abi.encode(SINK, 1 ether));
        // the raw 32-byte digest without the QoreX prefix
        bytes memory s = sign("alice", abi.encodePacked(d));
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 1 ether, DL, s);
        // the right prefix but another chain string
        s = sign("alice", bytes.concat("qorechain-msg-v1|qorechain-mainnet|", bytes(_hex(d))));
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 1 ether, DL, s);
        // the same digest under another action tag (a veto signature replayed as a spend)
        bytes32 dv = pv.intentDigest(pv.ACT_VETO_QUEUED(), 0, DL, abi.encode(SINK, 1 ether));
        s = _signDigest("alice", dv);
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 1 ether, DL, s);
    }

    function test_spend_wrong_chain_id_refused() public {
        bytes32 d =
            keccak256(abi.encode(pv.ACT_SPEND(), uint256(1), address(pv), uint256(0), DL, abi.encode(SINK, 1 ether)));
        bytes memory s = _signDigest("alice", d);
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 1 ether, DL, s);
        // and a signature made for chain 9800 is refused when the chain id differs
        bytes memory ok = _spendSig("alice", SINK, 1 ether, 0, DL);
        vm.chainId(9801);
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 1 ether, DL, ok);
    }

    function test_spend_wrong_nonce_refused() public {
        bytes memory s = _spendSig("alice", SINK, 1 ether, 1, DL);
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 1 ether, DL, s);
    }

    function test_spend_deadline_bound_and_expiry_refused() public {
        bytes memory s = _spendSig("alice", SINK, 1 ether, 0, DL);
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 1 ether, DL + 1, s); // deadline is part of the signed digest
        vm.warp(DL + 1);
        vm.expectRevert(PocketVault.Expired.selector);
        _relaySpend(SINK, 1 ether, DL, s);
    }

    function test_owner_key_rotated_in_registry_old_and_new_key_both_refused() public {
        bytes memory s = _spendSig("alice", SINK, 1 ether, 0, DL);
        keys.set(ALICE, true, 1, pk("carol"), true); // registry now holds another key: pinned hash no longer matches
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 1 ether, DL, s);
        s = _spendSig("carol", SINK, 1 ether, 0, DL);
        vm.expectRevert(PocketVault.BadSignature.selector);
        _relaySpend(SINK, 1 ether, DL, s);
    }

    function test_truncated_oversized_and_zero_registered_keys_never_verify() public {
        bytes memory s = sign("bob", "m");
        bytes memory k = pk("bob");
        assertTrue(probe.verify(k, s, "m"));
        assertFalse(probe.verify(_trunc(k, PK_LEN - 1), s, "m"));
        assertFalse(probe.verify(bytes.concat(k, hex"00"), s, "m"));
        assertFalse(probe.verify(new bytes(PK_LEN), s, "m"));
        assertFalse(probe.verify("", s, "m"));
        // through the registry: a truncated key registered for an account never verifies its real signature
        keys.set(BOB, true, 1, _trunc(k, PK_LEN - 1), true);
        assertFalse(probe.verifyFor(BOB, "m", s));
        keys.set(BOB, true, 1, k, false); // real key, possession not proven
        assertFalse(probe.verifyFor(BOB, "m", s));
        keys.set(BOB, true, 2, k, true); // real key under another algorithm id
        assertFalse(probe.verifyFor(BOB, "m", s));
        keys.set(BOB, true, 1, k, true);
        assertTrue(probe.verifyFor(BOB, "m", s));
    }

    /// v5: a Pocket cannot even be created for an owner whose registered ML-DSA-87 key has the wrong length.
    function test_pocket_with_truncated_owner_key_cannot_be_created() public {
        bytes memory k = pk("bob");
        address[] memory none = new address[](0);
        keys.set(BOB, true, 1, _trunc(k, PK_LEN - 1), true);
        vm.expectRevert(PqcLib.BadKeyLength.selector);
        factory.deploy(BOB, none, 0, 5 ether, bytes32(uint256(78)));
        keys.set(BOB, true, 1, bytes.concat(k, hex"00"), true);
        vm.expectRevert(PqcLib.BadKeyLength.selector);
        factory.deploy(BOB, none, 0, 5 ether, bytes32(uint256(78)));
        keys.set(BOB, true, 1, k, true);
        PocketVault p = PocketVault(payable(factory.deploy(BOB, none, 0, 5 ether, bytes32(uint256(78)))));
        assertEq(p.ownerKeyHash(), keccak256(k));
    }

    function test_erc1271_real_signature() public {
        bytes32 h = keccak256("order #1");
        bytes memory s = _signDigest("alice", h);
        assertEq(pv.isValidSignature(h, s), bytes4(0x1626ba7e));
        assertEq(pv.isValidSignature(keccak256("order #2"), s), bytes4(0xffffffff));
        assertEq(pv.isValidSignature(h, _signDigest("bob", h)), bytes4(0xffffffff));
    }

    function test_guardian_freeze_with_two_real_guardian_signatures() public {
        bytes memory m = PqcLib.pqMessage(pv.freezeDigest(0, DL));
        address[] memory who = new address[](2);
        bytes[] memory sigs = new bytes[](2);
        who[0] = GA;
        who[1] = GC;
        sigs[0] = sign("ga", m);
        sigs[1] = sign("gc", m);
        // a signature from the wrong guardian key in GC's slot is refused
        bytes[] memory bad = new bytes[](2);
        bad[0] = sigs[0];
        bad[1] = sign("gb", m);
        vm.expectRevert(PocketVault.BadSignature.selector);
        pv.guardianFreeze(who, bad, 0, DL);
        pv.guardianFreeze(who, sigs, 0, DL);
        assertTrue(pv.frozen());
        bytes memory s = _spendSig("alice", SINK, 1 ether, 0, DL);
        vm.expectRevert(PocketVault.Frozen.selector);
        _relaySpend(SINK, 1 ether, DL, s);
    }

    /*---------------- PocketDrop ----------------*/

    function _createDrop(uint8 mode) internal returns (uint256 id) {
        bytes32 lk = keccak256(pk("link1"));
        bytes memory p =
            abi.encode(DROP, lk, mode, uint64(EXP), uint96(0.2 ether), uint96(0.05 ether), uint256(1.25 ether));
        bytes memory s = _signDigest("alice", pv.intentDigest(pv.ACT_CREATE_DROP(), pv.nonce(), DL, p));
        bytes memory ret = router.relay(
            address(pv),
            abi.encodeCall(
                PocketVault.createDrop,
                (DROP, lk, mode, uint64(EXP), uint96(0.2 ether), uint96(0.05 ether), 1.25 ether, DL, s)
            )
        );
        id = abi.decode(ret, (uint256));
    }

    function test_drop_open_mode_full_flow_real_signatures() public {
        uint256 id = _createDrop(1);
        bytes32 bk = keccak256(pk("bob"));
        bytes memory bs = _signDigest("link1", drop.bindDigest(id, BOB, bk, CAROL));
        router.relay(DROP, abi.encodeCall(drop.bind, (id, BOB, bk, CAROL, pk("link1"), bs)));
        assertEq(BOB.balance, 0.2 ether); // drip for gas
        bytes memory cs = _signDigest("bob", drop.claimDigest(id, BOB, CAROL));
        router.relay(DROP, abi.encodeCall(drop.claim, (id, cs)));
        assertEq(CAROL.balance, 1 ether);
    }

    function test_drop_confirmed_mode_flow_real_signatures() public {
        uint256 id = _createDrop(0);
        bytes32 bk = keccak256(pk("bob"));
        bytes memory bs = _signDigest("link1", drop.bindDigest(id, BOB, bk, CAROL));
        drop.bind(id, BOB, bk, CAROL, pk("link1"), bs);
        bytes memory cs = _signDigest("bob", drop.claimDigest(id, BOB, CAROL));
        vm.expectRevert(abi.encodeWithSelector(PocketDrop.InvalidState.selector, PocketDrop.State.Bound));
        drop.claim(id, cs); // not confirmed by the sender yet
        bytes memory p = abi.encode(DROP, id, bk);
        bytes memory s = _signDigest("alice", pv.intentDigest(pv.ACT_CONFIRM_DROP(), pv.nonce(), DL, p));
        pv.confirmDrop(DROP, id, bk, DL, s);
        drop.claim(id, cs);
        assertEq(CAROL.balance, 1 ether);
    }

    function test_drop_bind_with_wrong_link_signature_refused() public {
        uint256 id = _createDrop(1);
        bytes32 bk = keccak256(pk("bob"));
        bytes memory lpk = pk("link1");
        // signed by another key
        bytes memory s = _signDigest("bob", drop.bindDigest(id, BOB, bk, CAROL));
        vm.expectRevert(PocketDrop.BadLinkSignature.selector);
        drop.bind(id, BOB, bk, CAROL, lpk, s);
        // link key signed a bind for another payTo: the relayer cannot redirect the payout
        s = _signDigest("link1", drop.bindDigest(id, BOB, bk, CAROL));
        vm.expectRevert(PocketDrop.BadLinkSignature.selector);
        drop.bind(id, BOB, bk, mallory, lpk, s);
        // link key signed the claim digest instead of the bind digest (domain separation)
        s = _signDigest("link1", drop.claimDigest(id, BOB, CAROL));
        vm.expectRevert(PocketDrop.BadLinkSignature.selector);
        drop.bind(id, BOB, bk, CAROL, lpk, s);
        // a different link public key
        s = _signDigest("carol", drop.bindDigest(id, BOB, bk, CAROL));
        bytes memory cpk = pk("carol");
        vm.expectRevert(PocketDrop.LinkKeyMismatch.selector);
        drop.bind(id, BOB, bk, CAROL, cpk, s);
    }

    function test_drop_claim_needs_the_recipient_key() public {
        uint256 id = _createDrop(1);
        bytes32 bk = keccak256(pk("bob"));
        drop.bind(id, BOB, bk, CAROL, pk("link1"), _signDigest("link1", drop.bindDigest(id, BOB, bk, CAROL)));
        bytes memory cs = _signDigest("bob", drop.claimDigest(id, BOB, CAROL));
        bytes memory byLink = _signDigest("link1", drop.claimDigest(id, BOB, CAROL));
        bytes memory overBind = _signDigest("bob", drop.bindDigest(id, BOB, bk, CAROL));
        bytes memory cut = _trunc(cs, SIG_LEN - 1);
        // the link key (which anyone holding the URL has) cannot claim
        vm.expectRevert(PocketDrop.BadRecipientSignature.selector);
        drop.claim(id, byLink);
        // the recipient signing the bind digest is not a claim
        vm.expectRevert(PocketDrop.BadRecipientSignature.selector);
        drop.claim(id, overBind);
        // truncated recipient signature
        vm.expectRevert(PocketDrop.BadRecipientSignature.selector);
        drop.claim(id, cut);
        drop.claim(id, cs);
        assertEq(CAROL.balance, 1 ether);
    }

    /*---------------- DropPool ----------------*/

    function _createPool() internal returns (uint256 pid) {
        bytes32 lk = keccak256(pk("pool1"));
        bytes memory p = abi.encode(POOL, lk, uint32(2), uint96(0.5 ether), uint64(EXP));
        bytes memory s = _signDigest("alice", pv.intentDigest(pv.ACT_CREATE_POOL(), pv.nonce(), DL, p));
        pid = pv.createPool(POOL, lk, 2, 0.5 ether, uint64(EXP), DL, s);
    }

    function test_pool_claim_real_signatures_and_domain_separation() public {
        uint256 pid = _createPool();
        bytes memory lpk = pk("pool1");
        bytes memory ls = _signDigest("pool1", pool.linkDigest(pid, BOB, CAROL));
        bytes memory rs = _signDigest("bob", pool.claimDigest(pid, BOB, CAROL));
        bytes memory lsSwapped = _signDigest("pool1", pool.claimDigest(pid, BOB, CAROL));
        bytes memory rsSwapped = _signDigest("bob", pool.linkDigest(pid, BOB, CAROL));
        bytes memory rsOther = _signDigest("carol", pool.claimDigest(pid, BOB, CAROL));
        // swapped: link key over the claim digest, recipient over the link digest
        vm.expectRevert(DropPool.BadLinkSignature.selector);
        pool.claim(pid, BOB, CAROL, lpk, lsSwapped, rs);
        vm.expectRevert(DropPool.BadRecipientSignature.selector);
        pool.claim(pid, BOB, CAROL, lpk, ls, rsSwapped);
        // recipient signature by another registered key
        vm.expectRevert(DropPool.BadRecipientSignature.selector);
        pool.claim(pid, BOB, CAROL, lpk, ls, rsOther);
        router.relay(POOL, abi.encodeCall(pool.claim, (pid, BOB, CAROL, lpk, ls, rs)));
        assertEq(CAROL.balance, 0.5 ether);
        vm.expectRevert(DropPool.AlreadyClaimed.selector);
        pool.claim(pid, BOB, CAROL, lpk, ls, rs);
    }

    /*---------------- helpers ----------------*/

    /// @dev The router sweeps relayer fees to its caller (this test contract).
    receive() external payable {}

    function _hex(bytes32 d) internal pure returns (string memory) {
        bytes memory out = new bytes(66);
        out[0] = "0";
        out[1] = "x";
        bytes16 al = "0123456789abcdef";
        for (uint256 i; i < 32; i++) {
            out[2 + 2 * i] = al[uint8(d[i]) >> 4];
            out[3 + 2 * i] = al[uint8(d[i]) & 0x0f];
        }
        return string(out);
    }
}
