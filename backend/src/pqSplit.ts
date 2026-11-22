// Split hybrid signing for relays: the API holds only the relayer's secp256k1 key, an isolated signer function holds only
// the ML-DSA-87 secret. Neither one alone can produce a valid relay (the chain checks both signatures), so one leaked
// environment no longer yields both keys.
//
// Byte layout is the one @qorechain/sdk signHybridEth produces (dist/index.js signHybridEth):
//   b0       = TxBody{messages, memo, timeoutHeight}                (no extension)
//   authInfo = AuthInfo{[SignerInfo{ethsecp256k1 PubKey, DIRECT, sequence}], Fee{amount, gas, "", ""}}
//   ML-DSA   = sign(hybridSignBytes(version, chainId, b0, authInfo))           <- isolated signer
//   body     = TxBody{messages, memo, timeoutHeight, extensionOptions:[PQCHybridSignature]}
//   secp     = compact secp256k1 over keccak256(SignDoc{body, authInfo, chainId, accountNumber})   <- API
//   tx       = TxRaw{body, authInfo, [secp]}
// test/pqSplit.test.ts checks every piece against the SDK.
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { AlgorithmDilithium5, buildHybridSignatureExtension, crossvm, encodeHybridExtension, ETHSECP256K1_PUBKEY_TYPE, evmToQor, getNetwork, hybridSignBytes, pqcKeyFromRecoveryCode, pqcRecoveryCodeFromSecret, pqcSign, qorechainRegistry } from '@qorechain/sdk';
import { PubKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys';
import { SignMode } from 'cosmjs-types/cosmos/tx/signing/v1beta1/signing';
import { AuthInfo, Fee, ModeInfo, SignDoc, SignerInfo, TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { Any } from 'cosmjs-types/google/protobuf/any';

const hex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const unb64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));
export const CROSSVM_TYPE = '/qorechain.crossvm.v1.MsgCrossVMCall';

/** What the API sends to the isolated signer: the two byte strings the ML-DSA signature covers, nothing secret. */
export interface PqSignRequest { b0: string; authInfo: string; chainId: string; version: 'v1' | 'v2' }
export interface CrossVmIn { secp: string; contract: string; data: string; memo: string; gas: bigint; feeUqor: string; accountNumber: bigint; sequence: bigint; version: 'v1' | 'v2'; chainId?: string }
export interface Parts extends PqSignRequest { from: string; accountNumber: string }

export function relayerAddressOf(secp: string): { evm: string; cosmos: string; pubkey: Uint8Array } {
  const sk = hex(secp);
  const pubkey = secp256k1.getPublicKey(sk, true);
  const evm = `0x${Buffer.from(keccak_256(secp256k1.getPublicKey(sk, false).slice(1)).slice(-20)).toString('hex')}`;
  return { evm, cosmos: evmToQor(evm), pubkey };
}

/** API side, step 1: build the unsigned parts of one relay (a MsgCrossVMCall into `contract`). */
export function crossVmParts(i: CrossVmIn): Parts {
  const me = relayerAddressOf(i.secp);
  const chainId = i.chainId ?? getNetwork('testnet').chainId;
  const msg = crossvm.crossVmCall({ sender: me.cosmos, sourceVm: 'cosmwasm', targetVm: 'evm', targetContract: i.contract.toLowerCase(), payload: hex(i.data), funds: [], async: false });
  const any = qorechainRegistry().encodeAsAny(msg as never) as { typeUrl: string; value: Uint8Array };
  const b0 = TxBody.encode(TxBody.fromPartial({ messages: [Any.fromPartial(any)], memo: i.memo, timeoutHeight: 0n })).finish();
  const authInfo = AuthInfo.encode(AuthInfo.fromPartial({
    signerInfos: [SignerInfo.fromPartial({
      publicKey: Any.fromPartial({ typeUrl: ETHSECP256K1_PUBKEY_TYPE, value: PubKey.encode(PubKey.fromPartial({ key: me.pubkey })).finish() }),
      modeInfo: ModeInfo.fromPartial({ single: { mode: SignMode.SIGN_MODE_DIRECT } }),
      sequence: i.sequence,
    })],
    fee: Fee.fromPartial({ amount: [{ denom: 'uqor', amount: i.feeUqor }], gasLimit: i.gas, granter: '', payer: '' }),
  })).finish();
  return { from: me.cosmos, b0: b64(b0), authInfo: b64(authInfo), chainId, version: i.version, accountNumber: i.accountNumber.toString() };
}

/** API side, step 3: attach the ML-DSA-87 signature, sign the SignDoc with secp256k1, return TxRaw bytes (base64). */
export function assembleHybrid(secp: string, p: Parts, pqcSignatureB64: string): string {
  const base = TxBody.decode(unb64(p.b0));
  const ext = encodeHybridExtension(buildHybridSignatureExtension({ algorithmId: AlgorithmDilithium5, signature: unb64(pqcSignatureB64) } as never)) as { typeUrl: string; value: Uint8Array };
  const bodyBytes = TxBody.encode(TxBody.fromPartial({ messages: base.messages, memo: base.memo, timeoutHeight: base.timeoutHeight, extensionOptions: [Any.fromPartial(ext)] })).finish();
  const authInfoBytes = unb64(p.authInfo);
  const signBytes = SignDoc.encode(SignDoc.fromPartial({ bodyBytes, authInfoBytes, chainId: p.chainId, accountNumber: BigInt(p.accountNumber) })).finish();
  const sig = secp256k1.sign(keccak_256(signBytes), hex(secp), { prehash: false, format: 'compact' } as never) as Uint8Array;
  return b64(TxRaw.encode(TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [sig] })).finish());
}

/* ------------------------------ isolated signer side ------------------------------ */

export interface PqPolicy {
  /** cosmos address of the relayer: the only allowed signer and sender (the PQ key is derived for it). */
  relayer: string;
  /** compressed secp256k1 pubkey of the relayer (hex): the only allowed signerInfo key. */
  relayerPubkey: string;
  /** lowercase 0x targets the relayer may call (the two routers and the v3 drop). */
  targets: string[];
  /** 4-byte selectors allowed in the payload. */
  selectors: string[];
  chainId: string;
  maxFeeUqor: bigint;
  maxGas: bigint;
}
export class PolicyError extends Error { constructor(m: string) { super(m); this.name = 'PolicyError'; } }

/** Decode the request and refuse anything that is not one relay by our relayer into an allowed target. */
export function checkPolicy(r: PqSignRequest, pol: PqPolicy): { target: string; selector: string; memo: string; feeUqor: bigint; gas: bigint } {
  if (r.chainId !== pol.chainId) throw new PolicyError(`chain ${r.chainId} not allowed`);
  if (r.version !== 'v1' && r.version !== 'v2') throw new PolicyError('bad sign-bytes version');
  let body: TxBody, auth: AuthInfo;
  try { body = TxBody.decode(unb64(r.b0)); auth = AuthInfo.decode(unb64(r.authInfo)); } catch { throw new PolicyError('undecodable tx'); }
  if (body.extensionOptions.length || body.nonCriticalExtensionOptions.length) throw new PolicyError('extensions not allowed');
  if (body.timeoutHeight !== 0n) throw new PolicyError('timeout height not allowed');
  if (!body.memo.startsWith('pd ') || body.memo.length > 200) throw new PolicyError('memo must start with "pd "');
  if (body.messages.length !== 1 || body.messages[0].typeUrl !== CROSSVM_TYPE) throw new PolicyError('exactly one MsgCrossVMCall');
  const m = qorechainRegistry().decode(body.messages[0] as never) as { sender: string; sourceVm: string; targetVm: string; targetContract: string; payload: Uint8Array; funds: unknown[]; async: boolean };
  if (m.sender !== pol.relayer) throw new PolicyError('sender is not the relayer');
  if (m.targetVm !== 'evm' || m.sourceVm !== 'cosmwasm') throw new PolicyError('not a call into the EVM');
  const target = String(m.targetContract).toLowerCase();
  if (!pol.targets.includes(target)) throw new PolicyError(`target ${target} not allowed`);
  if (m.funds?.length) throw new PolicyError('funds not allowed');
  if (m.async) throw new PolicyError('async not allowed');
  const selector = `0x${Buffer.from(m.payload.slice(0, 4)).toString('hex')}`;
  if (!pol.selectors.includes(selector)) throw new PolicyError(`selector ${selector} not allowed`);
  if (auth.signerInfos.length !== 1) throw new PolicyError('exactly one signer');
  const si = auth.signerInfos[0];
  if (si.publicKey?.typeUrl !== ETHSECP256K1_PUBKEY_TYPE) throw new PolicyError('signer key type');
  if (Buffer.from(PubKey.decode(si.publicKey.value).key).toString('hex') !== pol.relayerPubkey.toLowerCase().replace(/^0x/, '')) throw new PolicyError('signer is not the relayer');
  if (si.modeInfo?.single?.mode !== SignMode.SIGN_MODE_DIRECT) throw new PolicyError('sign mode');
  const fee = auth.fee;
  if (!fee || fee.amount.length !== 1 || fee.amount[0].denom !== 'uqor') throw new PolicyError('fee must be one uqor coin');
  if (fee.granter || fee.payer) throw new PolicyError('no fee granter or payer');
  const feeUqor = BigInt(fee.amount[0].amount);
  if (feeUqor > pol.maxFeeUqor) throw new PolicyError(`fee ${feeUqor} over ${pol.maxFeeUqor}`);
  if (fee.gasLimit > pol.maxGas) throw new PolicyError(`gas ${fee.gasLimit} over ${pol.maxGas}`);
  return { target, selector, memo: body.memo, feeUqor, gas: fee.gasLimit };
}

/** The relayer's ML-DSA-87 keypair from its 32-byte PQ secret and cosmos address (the secp key is not needed). */
export const pqKeyFor = (seedHex: string, relayer: string) => pqcKeyFromRecoveryCode(pqcRecoveryCodeFromSecret(hex(seedHex)), relayer) as { publicKey: Uint8Array; secretKey: Uint8Array };

/** Signer side: policy check, then the ML-DSA-87 signature over the hybrid sign bytes (base64). */
export function pqSign(r: PqSignRequest, pol: PqPolicy, key: { secretKey: Uint8Array }): { signature: string; checked: ReturnType<typeof checkPolicy> } {
  const checked = checkPolicy(r, pol);
  const msg = hybridSignBytes(r.version as never, r.chainId, unb64(r.b0), unb64(r.authInfo));
  return { signature: b64(pqcSign(key.secretKey, msg)), checked };
}
