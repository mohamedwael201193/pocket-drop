// Shared helpers for fixture generation / verification. Messages are encoded with viem, independently of the contract.
import { encodeAbiParameters, keccak256, toHex } from 'viem';

export const CHAIN_ID = 9800n;
export const PD_ADDR = '0x0000000000000000000000000000000000d0d0d0'; // fixed address the Foundry tests deploy PocketDrop at
export const OTHER_ADDR = '0x0000000000000000000000000000000000d0d0d1';
export const NUM_LINK_KEYS = 3;
export const NUM_RECIPIENTS = 3;
export const NUM_LINKS = 12;
export const RECIP_ADDRS = [
  '0x00000000000000000000000000000000000b0b01',
  '0x00000000000000000000000000000000000b0b02',
  '0x00000000000000000000000000000000000b0b03',
];

export const bindMsg = ({ domain = 'POCKETDROP_BIND_V1', chainId = CHAIN_ID, contract = PD_ADDR, linkId, recipient, recipientKeyHash }) =>
  encodeAbiParameters(
    [{ type: 'string' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }],
    [domain, chainId, contract, BigInt(linkId), recipient, recipientKeyHash],
  );
export const claimMsg = ({ domain = 'POCKETDROP_CLAIM_V1', chainId = CHAIN_ID, contract = PD_ADDR, linkId, recipient }) =>
  encodeAbiParameters(
    [{ type: 'string' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }],
    [domain, chainId, contract, BigInt(linkId), recipient],
  );
export const tripleHash = (pk, sig, msg) =>
  keccak256(encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes' }, { type: 'bytes' }], [pk, sig, msg]));
export const hex = (u8) => toHex(u8);
export const unhex = (h) => Uint8Array.from(Buffer.from(h.slice(2), 'hex'));
// link key index used for link `linkId` (1-based)
export const linkKeyIndex = (linkId) => linkId % NUM_LINK_KEYS;
