// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface VmRpc {
    function rpc(string calldata urlOrAlias, string calldata method, string calldata params)
        external
        view
        returns (bytes memory);
    function toString(bytes calldata) external pure returns (string memory);
    function toString(address) external pure returns (string memory);
}

/// @notice Test-only bridge: etched at 0x0A01 / 0x0A02, it forwards the exact calldata PqcLib sends to the LIVE Diana
///         precompile at the same address with eth_call (vm.rpc, alias "diana") and returns the live bytes unchanged.
/// @dev Used because a forked EVM does not contain QoreChain's native precompiles (they have no code to fork). A
///      revert on the live side surfaces as a failed staticcall, exactly what PqcLib sees on chain.
contract LivePrecompile {
    VmRpc internal constant VM = VmRpc(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal immutable TARGET;

    constructor(address target) {
        TARGET = target;
    }

    fallback(bytes calldata data) external returns (bytes memory) {
        string memory params =
            string.concat('[{"to":"', VM.toString(TARGET), '","data":"', VM.toString(data), '"},"latest"]');
        return VM.rpc("diana", "eth_call", params);
    }
}
