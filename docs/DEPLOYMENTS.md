# Earlier Pocket Drop deployments on Diana (v5.1, v5, v4, legacy v3)

Testnet only (Diana, EVM chain id 9800). The current contracts are **v5.2**; their addresses are at the top of the [README](../README.md#for-jurors-the-six-v52-addresses) and in [`contracts-v4/deployments/diana.json`](../contracts-v4/deployments/diana.json) under `v5_2`. Everything below is history: these contracts stay deployed and readable, and links and Pockets made on them keep working there (claim, refund, cancel, spend). The contracts have no owner, admin, pause or upgrade, so nothing here can be switched off or changed. Every address and deploy transaction below is RECORDED in `diana.json` and re-checked LIVE by `node frontend/scripts/reverify.mjs`.

What still holds on a Pocket made on an older generation: [README, Contracts on Diana](../README.md#contracts-on-diana).

## v5.1

**v5.1** (deployed 26 Nov 2026; links and Pockets made on v5.1 keep working there). v5.1 is v5 with the open review items fixed: the bind signs `feeTo`, ERC-1271 and PqGuard approvals carry their own tag and are bound to the account and chain, the router holds no value, plus the Stage 4 cleanups and NatSpec. See [docs/V5_1.md](V5_1.md).

| Contract | v5.1 PROD | v5.1 LAB |
|---|---|---|
| PocketRouter | `0x99711daaa39f2f03901950486c70641eca5261cb` | `0x007dd2b3d907e6924e3ad7d3f5281cacebabab07` |
| PocketFactory | `0x2783b00467e98498eb1ca2f980670d11f241c9f2` | `0x364062747767c0e94e5ed34d3a8ed2a76d59f90b` |
| PocketVault (implementation) | `0x4d16e0effbf21764520de3dfafeaefbcec9915c5` | `0xfd81083bf8109f76c0b3c1d1976971bebde60965` |
| PocketDrop | `0xf85e1d470b9e23ed632d8036adc37d66233e20ed` | `0x496342faa28e12b9afee8000793aac261d75d23f` |
| DropPool | `0xeaf7b161c1d82615d96a01c3e32602be4b1c92e7` | `0xdb17f2d96817cfdd715e23c8d30214afd22a3052` |

- v5.1 PqGuard example (`PqGuardedCounter`): `0xb6d4dc26188b7f90de2dd2e6ccdd943025fa1765`

## v5

**v5** (deployed 25 Nov 2026; links and Pockets made on v5 keep working there). v5 is v4 with a stricter `PqcLib`: exact ML-DSA-87 key and signature sizes are checked before the precompile is called, and the key-status reply must have the exact layout. Nothing else in `src/` changed. See [docs/V5.md](V5.md).

| Contract | v5 PROD | v5 LAB |
|---|---|---|
| PocketRouter | `0x13b8e379e50da657b943781d2816fc17473ae376` | `0x6de5f7d06e5a4c9563d405b39c192d8d2de1be75` |
| PocketFactory | `0x87b0caf7e9b6ecb28debe1cec223d6e3d7f6b19f` | `0xf00a2ce5945dd6bf762105d03d00b6cb91639443` |
| PocketVault (implementation) | `0x8603937464a48c18ebede4de1149e8e7dc4e91b4` | `0x5c17c28b7c000e302a7ac67c87562aa767439584` |
| PocketDrop | `0xcd52c8d2e812ca386fa2f864ba69c1cf63d5d798` | `0xb4a6b993e7aaa450b729fbc1f1b05048d093169a` |
| DropPool | `0xdb67b9881b37c0e9a4988a56089c05c221c0a26f` | `0xd358dd2e8bcd1db502bfefd99b2795f3e81aa3d6` |

- v5 PqGuard example (`PqGuardedCounter`): `0x4b8bef69fe7264851f263f6fcf02db3985f43ac9`

## v4

**v4** (still deployed and readable; links and Pockets made on v4 keep working there). From [`contracts-v4/deployments/diana.json`](../contracts-v4/deployments/diana.json). PROD uses a 24 h timelock, 48 h recovery, 72 h freeze and 72 h unanimous recovery. LAB uses the same bytecode with short delays (60 s timelock and recovery, 120 s freeze, 180 s unanimous recovery), so the flows can be demonstrated in minutes.

| Contract | v4 PROD | v4 LAB |
|---|---|---|
| PocketRouter | `0xb0d8fd2379e06ed5d48371b41baa6dd0a31cf209` | `0x0b4ee3c8a7a63716c5700b2711ad57a461b7ac2d` |
| PocketFactory | `0x74b604e8f1bb729a6e43dcd893f01747688e3e8f` | `0x864cf0278a24c1b27d1ac66c883c3e74ff8d5a0c` |
| PocketVault (implementation) | `0x899b289ef60444ac74d82dea5cacc6637a2a29c3` | `0xd017f09992c4c0f27f2d504ba42fe7d3bf578d96` |
| PocketDrop | `0xbc13b9ee91f31ed56932abdb796693515c351f00` | `0x42da108a4e8bf5d152600b470f1abd28debdee59` |
| DropPool | `0xaa981588e5430e3db9a789a3754e108cc01e3d00` | `0x1858193617bc2f2e2570a137320e1a1cb3a7ce5b` |

- v4 PqGuard example (`PqGuardedCounter`): `0x5ae81c71b7ff0c93886df8fe7502f3c846c3835f`

## Legacy v3

- Legacy v3 PocketDrop (still readable, used by old links): `0x29f53b4b8031e7ba1785dc8c7a1c0be413a4bd97`. `/api/stats` reports it at the top level and under `v3`; the v4 to v5.2 contracts are under `v4`.
