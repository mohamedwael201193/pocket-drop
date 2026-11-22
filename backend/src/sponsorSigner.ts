// Bundled entry for the hybrid signers (sponsor MsgSend, relayer MsgCrossVMCall). @cosmjs 0.39 require()s ESM-only @noble/@scure packages, which the
// Vercel Node runtime refuses, so scripts/bundle-signer.mjs bundles this file and its deps into vendor/sponsor-signer.mjs
// (plain ESM, no runtime require). Rebuild it after changing this file or bumping @qorechain/sdk.
import { EthNativeSigner, bank, crossvm, getNetwork, resolveSignBytesVersion, unifiedAccountFromSeed } from '@qorechain/sdk';

const hexBytes = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));

export interface SignSendIn {
  secp: string; pqc: string; rest: string;
  to: string; amountUqor: string; memo: string; feeUqor: string; gas: string;
  accountNumber: bigint; sequence: bigint;
}

export function sponsorCosmos(secp: string, pqc: string): string {
  return unifiedAccountFromSeed(hexBytes(secp), { pqcSecret: hexBytes(pqc) }).cosmos;
}

/** Hybrid-sign (secp256k1 + ML-DSA-87) a MsgSend from the sponsor; returns the TxRaw bytes, base64. */
export async function signSend(i: SignSendIn): Promise<{ from: string; txBytes: string }> {
  const acct = unifiedAccountFromSeed(hexBytes(i.secp), { pqcSecret: hexBytes(i.pqc) });
  const net = getNetwork('testnet');
  const signer = new EthNativeSigner(acct, { signMode: 'hybrid', rest: i.rest });
  const signBytesVersion = await signer.resolveSignBytesVersion(net.chainId);
  const signed = signer.sign({
    chainId: net.chainId, accountNumber: i.accountNumber, sequence: i.sequence, memo: i.memo, signBytesVersion,
    fee: { amount: [{ denom: 'uqor', amount: i.feeUqor }], gas: i.gas },
    messages: [bank.send({ fromAddress: acct.cosmos, toAddress: i.to, amount: [{ denom: 'uqor', amount: i.amountUqor }] })],
  } as never) as unknown as { txRawBytes: Uint8Array };
  return { from: acct.cosmos, txBytes: Buffer.from(signed.txRawBytes).toString('base64') };
}

export interface SignCrossVmIn {
  secp: string; pqc: string; rest: string;
  /** EVM contract the call goes to (the PocketRouter, or the v3 PocketDrop). */
  contract: string; data: string; memo: string; feeUqor: string; gas: string;
  accountNumber: bigint; sequence: bigint;
}

/** The relayer's qor1 address for its two keys. */
export function relayerCosmos(secp: string, pqc: string): string { return sponsorCosmos(secp, pqc); }

/**
 * Hybrid-sign (secp256k1 + ML-DSA-87) a MsgCrossVMCall that runs `data` on `contract` in the EVM, sent from the
 * native lane. The chain checks both signatures, so it needs no EVM window. `sourceVm` must differ from `targetVm`
 * (the chain records the native lane whatever is given); "cosmwasm" is the value the chain accepts. Returns TxRaw, base64.
 */
export async function signCrossVm(i: SignCrossVmIn): Promise<{ from: string; txBytes: string }> {
  const acct = unifiedAccountFromSeed(hexBytes(i.secp), { pqcSecret: hexBytes(i.pqc) });
  const net = getNetwork('testnet');
  const signer = new EthNativeSigner(acct, { signMode: 'hybrid', rest: i.rest });
  const signBytesVersion = await signer.resolveSignBytesVersion(net.chainId);
  const msg = crossvm.crossVmCall({ sender: acct.cosmos, sourceVm: 'cosmwasm', targetVm: 'evm', targetContract: i.contract.toLowerCase(), payload: hexBytes(i.data), funds: [], async: false });
  const signed = signer.sign({
    chainId: net.chainId, accountNumber: i.accountNumber, sequence: i.sequence, memo: i.memo, signBytesVersion,
    fee: { amount: [{ denom: 'uqor', amount: i.feeUqor }], gas: i.gas },
    messages: [msg],
  } as never) as unknown as { txRawBytes: Uint8Array };
  return { from: acct.cosmos, txBytes: Buffer.from(signed.txRawBytes).toString('base64') };
}

// Split hybrid signing (API half): see pqSplit.ts. Bundled here so the Vercel runtime loads the SDK only from the bundle.
export { assembleHybrid, crossVmParts } from './pqSplit.js';
const versions = new Map<string, Promise<'v1' | 'v2'>>();
/** Hybrid sign-bytes form the chain expects now (cached per instance). */
export const signBytesVersion = (rest: string): Promise<'v1' | 'v2'> => {
  let v = versions.get(rest);
  if (!v) { v = resolveSignBytesVersion({ chainId: getNetwork('testnet').chainId, rest }) as Promise<'v1' | 'v2'>; versions.set(rest, v); v.catch(() => versions.delete(rest)); }
  return v;
};
