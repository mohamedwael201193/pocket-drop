// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PocketDrop} from "../src/PocketDrop.sol";
import {IPocketDrop} from "../src/interfaces/IPocketDrop.sol";
import {MockPqcVerify, MockPqcKeys} from "./mocks/MockPqc.sol";

/// @notice Shared fixture plumbing: deploys PocketDrop at the address the fixtures were signed for, etches the
///         signature-real precompile mocks and loads the real ML-DSA-87 fixtures.
abstract contract Base is Test {
    address internal constant PD_ADDR = address(uint160(0xd0d0d0));
    address internal constant VERIFY_ADDR = address(uint160(0x0a01));
    address internal constant KEYS_ADDR = address(uint160(0x0a02));
    uint256 internal constant FIXTURE_BASE = 0xF0000000;
    uint256 internal constant NUM_LINKS = 12;
    uint256 internal constant NUM_KEYS = 3;

    // Constructor constants used by the tests (wei).
    uint256 internal constant MIN_ESCROW = 0.1 ether;
    uint256 internal constant MAX_AMOUNT = 50 ether;
    uint256 internal constant MAX_DRIP = 0.6 ether;
    uint256 internal constant DAILY_DRIP_CAP = 1 ether;
    uint256 internal constant BIND_TIMEOUT = 3600;
    uint256 internal constant MAX_EXPIRY = 30 days;

    PocketDrop internal pd;
    MockPqcVerify internal verifier = MockPqcVerify(VERIFY_ADDR);
    MockPqcKeys internal keys = MockPqcKeys(KEYS_ADDR);

    address internal alice = makeAddr("alice"); // sender
    address internal relayer = makeAddr("relayer");
    address internal mallory = makeAddr("mallory");

    uint8 internal constant CONFIRMED = 0;
    uint8 internal constant OPEN = 1;

    function setUp() public virtual {
        vm.chainId(9800);
        deployCodeTo(
            "PocketDrop.sol:PocketDrop",
            abi.encode(MIN_ESCROW, MAX_AMOUNT, MAX_DRIP, DAILY_DRIP_CAP, BIND_TIMEOUT, MAX_EXPIRY),
            PD_ADDR
        );
        pd = PocketDrop(payable(PD_ADDR));
        vm.etch(VERIFY_ADDR, address(new MockPqcVerify()).code);
        vm.etch(KEYS_ADDR, address(new MockPqcKeys()).code);
        _loadFixtures();
        vm.deal(alice, 1000 ether);
        vm.deal(relayer, 10 ether);
        vm.deal(mallory, 10 ether);
    }

    /*---------------- fixtures ----------------*/

    function _loadFixtures() internal {
        string memory json = vm.readFile("test/fixtures/pqc.json");
        bytes32[] memory acc = vm.parseJsonBytes32Array(json, ".accepted");
        for (uint256 i; i < acc.length; i++) {
            verifier.accept(acc[i]);
        }
        for (uint256 k; k < NUM_KEYS; k++) {
            vm.etch(_slot(1000 + k), vm.parseJsonBytes(json, string.concat(".linkPks[", vm.toString(k), "]")));
            vm.etch(_slot(2000 + k), vm.parseJsonBytes(json, string.concat(".recipPks[", vm.toString(k), "]")));
        }
        for (uint256 id; id < NUM_LINKS; id++) {
            for (uint256 r; r < NUM_KEYS; r++) {
                string memory p = string.concat("[", vm.toString(id), "][", vm.toString(r), "]");
                vm.etch(_slot(3000 + id * 3 + r), vm.parseJsonBytes(json, string.concat(".bindSigs", p)));
                vm.etch(_slot(4000 + id * 3 + r), vm.parseJsonBytes(json, string.concat(".claimSigs", p)));
            }
        }
        vm.etch(_slot(5000), vm.parseJsonBytes(json, ".wrong.bindDomain"));
        vm.etch(_slot(5001), vm.parseJsonBytes(json, ".wrong.bindChain"));
        vm.etch(_slot(5002), vm.parseJsonBytes(json, ".wrong.bindContract"));
        vm.etch(_slot(5003), vm.parseJsonBytes(json, ".wrong.claimDomain"));
        vm.etch(_slot(5004), vm.parseJsonBytes(json, ".wrong.claimChain"));
        vm.etch(_slot(5005), vm.parseJsonBytes(json, ".wrong.claimContract"));
    }

    function _slot(uint256 i) internal pure returns (address) {
        return address(uint160(FIXTURE_BASE + i));
    }

    /// @dev Fixture link key for `linkId` (1..12): key index = linkId % 3.
    function linkPk(uint256 linkId) internal view returns (bytes memory) {
        return _slot(1000 + linkId % NUM_KEYS).code;
    }

    function linkKeyHash(uint256 linkId) internal view returns (bytes32) {
        return keccak256(linkPk(linkId));
    }

    function recipPk(uint256 r) internal view returns (bytes memory) {
        return _slot(2000 + r).code;
    }

    function recipHash(uint256 r) internal view returns (bytes32) {
        return keccak256(recipPk(r));
    }

    function recip(uint256 r) internal pure returns (address) {
        return address(uint160(0xb0b01 + r));
    }

    function bindSig(uint256 linkId, uint256 r) internal view returns (bytes memory) {
        return _slot(3000 + (linkId - 1) * 3 + r).code;
    }

    function claimSig(uint256 linkId, uint256 r) internal view returns (bytes memory) {
        return _slot(4000 + (linkId - 1) * 3 + r).code;
    }

    function wrongSig(uint256 i) internal view returns (bytes memory) {
        return _slot(5000 + i).code;
    }

    /// @dev Register recipient key `r` for `recip(r)` with proof of possession.
    function registerKey(uint256 r) internal {
        keys.set(recip(r), true, 1, recipPk(r), true);
    }

    /*---------------- flows ----------------*/

    function nextId() internal view returns (uint256) {
        return pd.linkCount() + 1;
    }

    /// @dev Create a link as alice. Amount, drip and fee are explicit; expiry is now + `ttl`.
    function create(uint8 mode, uint256 amount, uint96 drip, uint96 fee, uint64 ttl) internal returns (uint256 id) {
        id = nextId();
        vm.prank(alice);
        pd.create{value: amount + drip + fee}(linkKeyHash(id), mode, uint64(block.timestamp) + ttl, drip, fee);
    }

    function createDefault(uint8 mode) internal returns (uint256) {
        return create(mode, 1 ether, 0.2 ether, 0.05 ether, 7 days);
    }

    function bindTo(uint256 id, uint256 r) internal {
        vm.prank(relayer);
        pd.bind(id, recip(r), recipHash(r), linkPk(id), bindSig(id, r));
    }

    function claimAs(uint256 id, uint256 r) internal {
        vm.prank(relayer);
        pd.claim(id, claimSig(id, r));
    }
}
