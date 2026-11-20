import type { Hex } from 'viem';

/** Pocket Drop v4 deployments on Diana testnet (RECORDED from contracts-v4/deployments/diana.json; checked by test/route.test.ts). */
export const V4_INSTANCES = {
  prod: {
    router: '0xb0d8fd2379e06ed5d48371b41baa6dd0a31cf209',
    factory: '0x74b604e8f1bb729a6e43dcd893f01747688e3e8f',
    drop: '0xbc13b9ee91f31ed56932abdb796693515c351f00',
    pool: '0xaa981588e5430e3db9a789a3754e108cc01e3d00',
  },
  lab: {
    router: '0x0b4ee3c8a7a63716c5700b2711ad57a461b7ac2d',
    factory: '0x864cf0278a24c1b27d1ac66c883c3e74ff8d5a0c',
    drop: '0x42da108a4e8bf5d152600b470f1abd28debdee59',
    pool: '0x1858193617bc2f2e2570a137320e1a1cb3a7ce5b',
  },
} as const satisfies Record<string, Record<string, Hex>>;

export type V4Env = keyof typeof V4_INSTANCES;
export const V4_ENVS = Object.keys(V4_INSTANCES) as V4Env[];
