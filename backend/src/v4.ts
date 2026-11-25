import type { Hex } from 'viem';

/** Pocket Drop deployments on Diana testnet (RECORDED from contracts-v4/deployments/diana.json; checked by test/route.test.ts).
 *  `prod` / `lab` are the CURRENT contracts (v5, strict PqcLib, deployed 25 Nov 2026). `prodV4` / `labV4` are the previous
 *  v4 contracts: still read for history and still relayed to, so links and Pockets made on v4 keep working. */
export const V4_INSTANCES = {
  prod: {
    router: '0x13b8e379e50da657b943781d2816fc17473ae376',
    factory: '0x87b0caf7e9b6ecb28debe1cec223d6e3d7f6b19f',
    drop: '0xcd52c8d2e812ca386fa2f864ba69c1cf63d5d798',
    pool: '0xdb67b9881b37c0e9a4988a56089c05c221c0a26f',
  },
  lab: {
    router: '0x6de5f7d06e5a4c9563d405b39c192d8d2de1be75',
    factory: '0xf00a2ce5945dd6bf762105d03d00b6cb91639443',
    drop: '0xb4a6b993e7aaa450b729fbc1f1b05048d093169a',
    pool: '0xd358dd2e8bcd1db502bfefd99b2795f3e81aa3d6',
  },
  prodV4: {
    router: '0xb0d8fd2379e06ed5d48371b41baa6dd0a31cf209',
    factory: '0x74b604e8f1bb729a6e43dcd893f01747688e3e8f',
    drop: '0xbc13b9ee91f31ed56932abdb796693515c351f00',
    pool: '0xaa981588e5430e3db9a789a3754e108cc01e3d00',
  },
  labV4: {
    router: '0x0b4ee3c8a7a63716c5700b2711ad57a461b7ac2d',
    factory: '0x864cf0278a24c1b27d1ac66c883c3e74ff8d5a0c',
    drop: '0x42da108a4e8bf5d152600b470f1abd28debdee59',
    pool: '0x1858193617bc2f2e2570a137320e1a1cb3a7ce5b',
  },
} as const satisfies Record<string, Record<string, Hex>>;

export type V4Env = keyof typeof V4_INSTANCES;
export const V4_ENVS = Object.keys(V4_INSTANCES) as V4Env[];
