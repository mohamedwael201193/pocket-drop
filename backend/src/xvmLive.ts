// Live wiring of the hybrid-relay index (xvm.ts) to the chain: tx search on the native lane + link state reads over the EVM RPC.
import { parseAbi, type Address, type PublicClient } from 'viem';
import type { Config } from './config.js';
import { V4_INSTANCES, type V4Env } from './v4.js';
import { eventsOf, hybridRelays, type LinkState, type XvmEvent } from './xvm.js';

const LINK = parseAbi(['function getLink(uint256) view returns ((address sender, uint8 mode, uint8 state, bool dripPaid, uint64 expiry, uint96 amount, uint96 drip, uint64 bindDeadline, uint96 relayerFee, address recipient, address payTo, bytes32 linkKeyHash, bytes32 recipientKeyHash))']);

export const linkReader = (pub: Pick<PublicClient, 'readContract'>) => async (env: V4Env, id: bigint): Promise<LinkState | null> => {
  const l = (await pub.readContract({ address: V4_INSTANCES[env].drop as Address, abi: LINK, functionName: 'getLink', args: [id] })) as { recipient: Address; payTo: Address; amount: bigint };
  return { recipient: l.recipient, payTo: l.payTo, amount: BigInt(l.amount) };
};

export async function hybridEventsFor(env: V4Env, cfg: Pick<Config, 'rest'>, pub: Pick<PublicClient, 'readContract'>): Promise<XvmEvent[]> {
  return eventsOf(env, await hybridRelays(env, cfg.rest), new Set(), linkReader(pub));
}
