import type { Hex } from 'viem';
import type { Config } from '../src/config.js';

export const hexBytes = (n: number, fill = 'ab') => ('0x' + fill.repeat(n)) as Hex;
export const ADDR = '0x8ab5CE4fcd45cC69FEe31Ea6E9e6222C1e18bBDd';
export const CONTRACT = '0x1111111111111111111111111111111111111111';
export const KEY = ('0x' + '11'.repeat(32)) as Hex; // throwaway test key, not a real account

export const cfg = (over: Partial<Config> = {}): Config => ({
  evmRpc: 'http://rpc.invalid', rest: 'http://rest.invalid', contract: CONTRACT as Hex, relayerKey: KEY, relayerPqc: null, pqSignerUrl: null, pqSignerHmac: null, relayMode: 'evm', relayFallback: true, deployBlock: null,
  statsLookback: 1000n, gasBind: 900_000n, gasClaim: 800_000n, gasRouteMin: 350_000n, gasRouteMax: 1_800_000n, gasRoutePct: 140n, upstashUrl: null, upstashToken: null, ...over,
});

export const bindBody = (over: Record<string, unknown> = {}) => ({
  linkId: '7', recipient: ADDR, recipientKeyHash: hexBytes(32), linkPk: hexBytes(2592), linkSig: hexBytes(4627), ...over,
});
export const claimBody = (over: Record<string, unknown> = {}) => ({ linkId: 7, recipientSig: hexBytes(4627), ...over });
