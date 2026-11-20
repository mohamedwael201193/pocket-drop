// Bundled entry for the sponsor's hybrid signer. @cosmjs 0.39 require()s ESM-only @noble/@scure packages, which the
// Vercel Node runtime refuses, so scripts/bundle-signer.mjs bundles this file and its deps into vendor/sponsor-signer.mjs
// (plain ESM, no runtime require). Rebuild it after changing this file or bumping @qorechain/sdk.
import { EthNativeSigner, bank, getNetwork, unifiedAccountFromSeed } from '@qorechain/sdk';

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
