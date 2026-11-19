// LIVE: the browser-side bind/claim messages must equal the contract's bindDigest/claimDigest (eth_call on Diana),
// and a signature made in this code must be accepted by the chain's pqcVerify precompile (0x0A01).
import { describe, expect, it } from 'vitest';
import { createPublicClient, http, parseAbi, encodeFunctionData, decodeFunctionResult } from 'viem';
import { mldsa } from '@qorechain/pqc';
import { pocketDropAbi } from '../src/lib/abi';
import { bindMessage, claimMessage, hexToBytes, bytesToHex, keyHashOf } from '../src/lib/protocol';
import { dianaChain, POCKETDROP_ADDRESS, LAB_ADDRESS } from '../src/lib/config';

const pub = createPublicClient({ chain: dianaChain, transport: http('https://evm-testnet.qore.host') });
const R = '0xbeCce1e181BD39C0E2aD32E82D71DF04b7a701AE' as const;
const rkh = ('0x' + '5a'.repeat(32)) as `0x${string}`;
const VERIFY = '0x0000000000000000000000000000000000000a01' as const;
const verifyAbi = parseAbi(['function pqcVerify(bytes,bytes,bytes) view returns (bool)']);

describe.each([['main', POCKETDROP_ADDRESS], ['lab', LAB_ADDRESS]] as const)('digests equal the %s contract', (_n, addr) => {
  it('bindDigest', async () => {
    for (const id of [1n, 7n, 123456n]) {
      const onchain = await pub.readContract({ address: addr, abi: pocketDropAbi, functionName: 'bindDigest', args: [id, R, rkh] });
      expect(bindMessage(addr, id, R, rkh)).toBe(onchain);
    }
  });
  it('claimDigest', async () => {
    for (const id of [1n, 7n, 123456n]) {
      const onchain = await pub.readContract({ address: addr, abi: pocketDropAbi, functionName: 'claimDigest', args: [id, R] });
      expect(claimMessage(addr, id, R)).toBe(onchain);
    }
  });
});

describe('browser signatures verify on the chain precompile', () => {
  it('pqcVerify accepts a bind signature from this code and rejects a tampered recipient', async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const lk = mldsa.keygen(seed);
    const msg = bindMessage(POCKETDROP_ADDRESS, 99n, R, keyHashOf(lk.publicKey));
    const sig = mldsa.sign(lk.secretKey, hexToBytes(msg));
    const call = async (m: `0x${string}`) => {
      const r = await pub.call({ to: VERIFY, data: encodeFunctionData({ abi: verifyAbi, functionName: 'pqcVerify', args: [bytesToHex(lk.publicKey), bytesToHex(sig), m] }) });
      return decodeFunctionResult({ abi: verifyAbi, functionName: 'pqcVerify', data: r.data! });
    };
    expect(await call(msg)).toBe(true);
    expect(await call(bindMessage(POCKETDROP_ADDRESS, 99n, '0x0000000000000000000000000000000000000001', keyHashOf(lk.publicKey)))).toBe(false);
  });
});
