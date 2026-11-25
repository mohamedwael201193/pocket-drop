// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev The ffi cheatcode, declared `view` so the harness can be reached through the `staticcall` PqcLib makes.
interface VmFfi {
    function ffi(string[] calldata cmd) external view returns (bytes memory);
    function toString(bytes calldata) external pure returns (string memory);
}

/// @notice Test-only stand-in for the pqcVerify precompile (0x0A01) that runs the REAL ML-DSA-87 algorithm.
/// @dev Every call shells out (vm.ffi) to script/ffi/mldsa.mjs, which verifies with qorechain pqc AND
///      qorechain qoresign and fails the test if they disagree. No accept list, no keccak table, no "return true":
///      any signature the real algorithm rejects is rejected here. Input sizes are passed through unchanged, so a
///      truncated or oversized key or signature reaches the real verifier exactly as the contract sent it.
contract RealPqcVerify {
    VmFfi internal constant VM = VmFfi(address(uint160(uint256(keccak256("hevm cheat code")))));

    function pqcVerify(bytes calldata pk, bytes calldata sig, bytes calldata message) external view returns (bool) {
        string[] memory cmd = new string[](6);
        cmd[0] = "node";
        cmd[1] = "script/ffi/mldsa.mjs";
        cmd[2] = "verify";
        cmd[3] = VM.toString(pk);
        cmd[4] = VM.toString(sig);
        cmd[5] = VM.toString(message);
        return abi.decode(VM.ffi(cmd), (bool));
    }
}
