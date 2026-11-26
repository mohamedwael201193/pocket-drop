import type { Hex } from 'viem';
import { V4_INSTANCES, type V4Env } from './v4.js';

/** Implementation (vaultImpl) and PqGuard example addresses per generation, RECORDED from
 *  contracts-v4/deployments/diana.json (checked by test/health.deployments.test.ts). Router, factory, drop and pool come
 *  from V4_INSTANCES, so there is one source of truth per address in the backend. */
const EXTRA = {
  'v5.2': { deployedAt: '2026-11-26T01:51:49Z', prodVault: '0x02375366fc06356e0020c93fbe9d5d8fcbeb4f16', labVault: '0x5ca64d1ace94fc727856bf1adb1c48963a23a5d0', pqGuardedCounter: '0xa320b876afea6e2c1e20da5f7fd195b9db47d0be', prod: 'prod', lab: 'lab' },
  'v5.1': { deployedAt: '2026-11-26T00:21:44Z', prodVault: '0x4d16e0effbf21764520de3dfafeaefbcec9915c5', labVault: '0xfd81083bf8109f76c0b3c1d1976971bebde60965', pqGuardedCounter: '0xb6d4dc26188b7f90de2dd2e6ccdd943025fa1765', prod: 'prodV51', lab: 'labV51' },
  v5: { deployedAt: '2026-11-25T20:01:58Z', prodVault: '0x8603937464a48c18ebede4de1149e8e7dc4e91b4', labVault: '0x5c17c28b7c000e302a7ac67c87562aa767439584', pqGuardedCounter: '0x4b8bef69fe7264851f263f6fcf02db3985f43ac9', prod: 'prodV5', lab: 'labV5' },
  v4: { deployedAt: '2026-11-19', prodVault: '0x899b289ef60444ac74d82dea5cacc6637a2a29c3', labVault: '0xd017f09992c4c0f27f2d504ba42fe7d3bf578d96', pqGuardedCounter: '0x5ae81c71b7ff0c93886df8fe7502f3c846c3835f', prod: 'prodV4', lab: 'labV4' },
} as const satisfies Record<string, { deployedAt: string; prodVault: Hex; labVault: Hex; pqGuardedCounter: Hex; prod: V4Env; lab: V4Env }>;

export type Generation = keyof typeof EXTRA;
export const CURRENT_GENERATION: Generation = 'v5.2';
export const GENERATIONS = Object.keys(EXTRA) as Generation[];

const set = (env: V4Env, vaultImpl: Hex) => ({ env, ...V4_INSTANCES[env], vaultImpl });

/** One generation's contracts: PROD (24 h timelock, 48 h recovery) and LAB (same bytecode, short delays for demos). */
export function generation(g: Generation) {
  const x = EXTRA[g];
  return { generation: g, deployedAt: x.deployedAt, prod: set(x.prod, x.prodVault), lab: set(x.lab, x.labVault), pqGuardedCounter: x.pqGuardedCounter };
}

/** The /api/health `deployments` block: the current set first, then the previous generations (still live for old links). */
export function deploymentsSummary() {
  return {
    current: generation(CURRENT_GENERATION),
    previous: GENERATIONS.filter((g) => g !== CURRENT_GENERATION).map(generation),
    source: 'RECORDED from contracts-v4/deployments/diana.json; full table and history in docs/DEPLOYMENTS.md',
    note: 'New Pockets, drops and pools are made on the current contracts. Links and Pockets made on a previous generation keep working there.',
  };
}
