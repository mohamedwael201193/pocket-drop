# Live results (QoreChain Diana testnet, EVM chain id 9800)

Redeployed vault (guardian freeze + unanimous recovery). PROD (24 h timelock / 48 h recovery / 72 h freeze / 72 h unanimous recovery): router `0xb0d8fd2379e06ed5d48371b41baa6dd0a31cf209`, factory `0x74b604e8f1bb729a6e43dcd893f01747688e3e8f`, vault implementation `0x899b289ef60444ac74d82dea5cacc6637a2a29c3`, drop `0xbc13b9ee91f31ed56932abdb796693515c351f00`, pool `0xaa981588e5430e3db9a789a3754e108cc01e3d00`. LAB (60 s timelock and recovery, 120 s freeze, 180 s unanimous recovery): router `0x0b4ee3c8a7a63716c5700b2711ad57a461b7ac2d`, factory `0x864cf0278a24c1b27d1ac66c883c3e74ff8d5a0c`, vault implementation `0xd017f09992c4c0f27f2d504ba42fe7d3bf578d96`, drop `0x42da108a4e8bf5d152600b470f1abd28debdee59`, pool `0x1858193617bc2f2e2570a137320e1a1cb3a7ce5b`. The earlier vault / factory / router are listed under `superseded` in deployments/diana.json; the results of that first deployment are in git history.

Every row with a hash is a mined transaction. "reverted" rows are attacks: each was decoded with eth_call first, then mined with an explicit gas limit so the revert is on chain. Rows marked "refused" are transactions the chain refuses to BROADCAST (the relayer EVM window lists only the two routers and PocketDrop v3), so they have no hash by design.

## Part 1. Money flows on the redeployed vault (PROD instance): counterfactual Pocket, spend, 24 h timelock, drops, pool, attacks
This is test/live/run.mjs. It was run twice against the new deployment; both stopped at a gas-money limit of the test harness (the deployer, then the relayer, ran out of testnet QOR; both were topped up), not at a contract failure. The table is the first attempt, which ran every prod step (sections 1 to 6) successfully; the lab sections of that script (queued spend + veto, threshold recovery + owner veto) are re-run in Part 2, sections C/D. The second attempt (32 txs, a repeat of the first steps) and the superseded deployment's complete run are kept in deployments/diana.json under priorRuns. The end-of-run refunds of short-expiry attack links and the PqGuard counter example were not repeated (they do not touch the changed vault code).

| step | status | outcome / custom error | tx |
|---|---|---|---|
| fund sender-owner 0.12 QOR (for its PQ registration fee) | success | funded | [0x26a7fd1585...](https://explore.qore.network/tx/0x26a7fd1585bd4d990da79d6bce7233d15d850d13209078e1afde1f678f0d0a06) |
| sender-owner S registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [D206279A16F2...](https://explore.qore.network/tx/D206279A16F260F52EE960D7BFC5A3E98E6B78B0A4CBCD2196792DEAAFD3C754) |
| fund attacker-B (second person, own proven key) 0.12 QOR (for its PQ registration fee) | success | funded | [0xa547db1c83...](https://explore.qore.network/tx/0xa547db1c833ceedfce24d7625aa2954166879fff3e2b7e6225e82da47b9371eb) |
| attacker B registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [181B124ED317...](https://explore.qore.network/tx/181B124ED3175EE03CBEC964AB6A546A7454D2D0298E1F38E66F67900CF9C995) |
| fund pool-claimer-1 0.12 QOR (for its PQ registration fee) | success | funded | [0xdc6db2891a...](https://explore.qore.network/tx/0xdc6db2891ad24c2ca217c340c7f699e3ff462da460aad7a62737fb8a03cd3444) |
| pool claimer C1 registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [BCD7C063A2B7...](https://explore.qore.network/tx/BCD7C063A2B72311FB2A20C0E6ACA416032319E5F4356C4F5FE6A1E9BE0A766B) |
| fund pool-claimer-2 0.12 QOR (for its PQ registration fee) | success | funded | [0x31906d1ac5...](https://explore.qore.network/tx/0x31906d1ac558bb613f2fecb39e8ae7cf0f7c2604964b5b90d8ffc1ff0f673a67) |
| pool claimer C2 registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [399FE88AD713...](https://explore.qore.network/tx/399FE88AD71372D0051C892EE655A56046D4B1B142D38A5A869E2CE4802BB5CE) |
| S1 plain QOR send to the Pocket address BEFORE it exists (counterfactual funding) | success | address 0xe7eBB8dBD9fea7a84160dFd41688a4C5dD42E8e8 has no code, balance 1.5 QOR | [0x235d054a1d...](https://explore.qore.network/tx/0x235d054a1dbc2941feaaa9d594e2ee0b888717b1be900537c7bd09105e04df91) |
| S2 lazy deploy + first intent through PocketRouter(prod): deploys the Pocket, then spends 0.05 QOR (ML-DSA signature checked by pqcVerify) | success | Pocket deployed and spent | [0x9c21d3cae7...](https://explore.qore.network/tx/0x9c21d3cae77ef1ae9af98e0d560036982e50a8e2b9d7ff9c0ec762d84e229cf4) |
| check: JS intent digest == PocketVault.intentDigest (on-chain view) | info | 0x3f2249e77549a989645126667584eee6564c5ad7f15dea48e494613e678b9697 | none (not mined) |
| ATTACK replayed intent (same signed spend submitted again) | reverted | BadSignature | [0x54d99c1e8b...](https://explore.qore.network/tx/0x54d99c1e8b04744df5a0360a5dd7b0a02b3066d7f39794a5af97f90ba6957fec) |
| ATTACK vault spend signed by a wrong (but PoP-proven) key | reverted | BadSignature | [0x312c0fe1ec...](https://explore.qore.network/tx/0x312c0fe1ecfe1a0159618152ade48639139671adbda5336b4132d06f2a830dcb) |
| ATTACK router targeting a non-Pocket address | reverted | NotAllowed | [0x27e7f6f5ef...](https://explore.qore.network/tx/0x27e7f6f5ef8d752b9b90fc7faa38328bc274636ef63a71d5ef77ba3341a5a06a) |
| ATTACK relayer sends a tx to an off-list target (PocketDrop v4 (prod)): refused by the CHAIN at broadcast (never mined, no hash) | refused | failed to broadcast transaction: the EVM authorisation window for qor17mn0ktfnhmesgd5zvk8zk60n5tuxzmxdc8ymnl does not admit this transaction: the window does not list 0xbc13b9EE91f31eD56932abDb796693515C351f00 as an allowed recipient: EVM authorisation window exhausted: EVM authorisation window exhausted [cosmossdk.io/errors@v1.0.2/errors.go:77] | none (not mined) |
| ATTACK relayer sends a tx to an off-list target (a Pocket directly): refused by the CHAIN at broadcast (never mined, no hash) | refused | failed to broadcast transaction: the EVM authorisation window for qor17mn0ktfnhmesgd5zvk8zk60n5tuxzmxdc8ymnl does not admit this transaction: the window does not list 0xe7eBB8dBD9fea7a84160dFd41688a4C5dD42E8e8 as an allowed recipient: EVM authorisation window exhausted: EVM authorisation window exhausted [cosmossdk.io/errors@v1.0.2/errors.go:77] | none (not mined) |
| T1 spend of 2.5 QOR (> 2 QOR daily limit): queued, NOT paid, 24 h timelock | success | queued id 1 | [0x93c9d74349...](https://explore.qore.network/tx/0x93c9d7434943adf2993be31a87bc6fac1ad11b123f87a9fe226fc6998930b1fc) |
| check: queued entry | info | to=0x392f50b1955a827458A320205e19acf7C664f116 amount=2.5 unlockAt=1795202851 (now+86398s) | none (not mined) |
| ATTACK above-limit spend executed before the 24 h timelock ends | reverted | TooEarly | [0x48ab50d894...](https://explore.qore.network/tx/0x48ab50d8946248abd715a727727e90b266a6534931f0216b1d3a8c2305288e68) |
| T2 owner vetoes the queued spend (ML-DSA intent) | success | vetoed | [0xf40199c3ae...](https://explore.qore.network/tx/0xf40199c3ae67bfd2b4503a390bd4225a1356c09fbd7065d0ce5ab3a7800e2b20) |
| D1 sender Pocket creates a Confirmed drop (0.3 QOR + 0.1 drip + 0.02 relayer fee) by intent | success | link created | [0x0a53e7d969...](https://explore.qore.network/tx/0x0a53e7d9694a3e26f4c59ff5bcad14dd3d2069c8ce6b895c21808d693821ba09) |
| ATTACK 1 mempool thief swaps recipient/payTo in a signed bind (v3 attack 1) | reverted | BadLinkSignature | [0xf72a9a098d...](https://explore.qore.network/tx/0xf72a9a098d5ea3708302968a6caa712b04e3982870d2c7e34e37c28381996318) |
| D2 relayer binds R (recipient account R, payout Pocket PR). Drip lands in R, relayerFee reaches the relayer through the router sweep | success | bound | [0x4537c7ea3f...](https://explore.qore.network/tx/0x4537c7ea3f667cbedb3b6a84ceb172d0f93b406e74874f498ab68317c090f5b3) |
| newcomer R (fee paid from the drip, R started with 0 QOR) registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [D98528C61DAC...](https://explore.qore.network/tx/D98528C61DACD8A81B7EBE87450A603F2979819A84C3877647F5B8DA232A3D2D) |
| ATTACK sender confirms a recipient key it never checked (RecipientChanged) | reverted | RecipientChanged | [0xafa21c667d...](https://explore.qore.network/tx/0xafa21c667dcbe7d7d03efb5d157d049658053ab7d05b86e64142f80d80f64d57) |
| D3 sender confirms the recipient key fingerprint in ONE intent (no second device) | success | confirmed | [0x13a2b59a1b...](https://explore.qore.network/tx/0x13a2b59a1bc71b37a93b112423efbd89b78ee2e681e72f92d4043454f58e8822) |
| ATTACK 5 a second person (B, own proven key) claims the Confirmed link | reverted | BadRecipientSignature | [0x716a2b6108...](https://explore.qore.network/tx/0x716a2b61088a1c1a84100c9e3c686122f8da6192b5feebd8f2eebfb6b5300054) |
| ATTACK 2 claim signed by a key other than the registered one | reverted | BadRecipientSignature | [0x8e009ab9e9...](https://explore.qore.network/tx/0x8e009ab9e9d858f8bf8904ba55e12434246232d2a56b33392e2db9074cdd8a73) |
| ATTACK 6 sender cancels after confirming (v3 attack 6) | reverted | InvalidState | [0x91292d57a6...](https://explore.qore.network/tx/0x91292d57a67be38e79afec1cf23c21b0282a757a7116d64402ab70bfbfb25edc) |
| D4 relayer claims with the recipient signature: 0.3 QOR lands in the recipient POCKET | success | amount paid to the Pocket | [0x94d872a4b9...](https://explore.qore.network/tx/0x94d872a4b94ed9307bd29933161027891ca48e5b6d81602b0028a6b9c038a275) |
| check: recipient Pocket got the money while still undeployed | info | 0x10B0ac40a1f6Ae5dE5DDd4393086504e91A0b2cB balance 0.3 QOR, code none, link state Claimed | none (not mined) |
| D5 claim of an already claimed link | reverted | InvalidState | [0x0b9f7899ec...](https://explore.qore.network/tx/0x0b9f7899ec28520268bef6f0e86b2ebb737feea1936fedd12fde525498b443bb) |
| D6 recipient first action: lazy-deploys its own Pocket through the router and spends 0.05 QOR from it | success | Pocket deployed, spend ok | [0xefeca9d922...](https://explore.qore.network/tx/0xefeca9d922a1acbb37a41d286e996ce85e9b7e3ee31fcb38973003e04394431c) |
| A3a create Open link (0.1 QOR, expiry +240 s) | success | link created | [0x2fc043a6c7...](https://explore.qore.network/tx/0x2fc043a6c7f35390dadc71a19caf22ad0047747be6cc7b691223b1e494441757) |
| A3b bind to the main test wallet (legacy key, possessionProven=false) with payout Pocket PS | success | bound | [0xdf871411da...](https://explore.qore.network/tx/0xdf871411daf88c4605cc497c53b155ad5e0207f13b72fe1edcfcbefda5cf29f9) |
| check: main wallet key status | info | registered=true possessionProven=false | none (not mined) |
| ATTACK 3 claim into an account whose key has possessionProven=false (v3 attack 3) | reverted | PossessionNotProven | [0x4664a69a20...](https://explore.qore.network/tx/0x4664a69a207575641d38bcf3af724d9f81753c275dd8312c2a66fb3b18be5b5b) |
| A4a create Open link (0.1 QOR, expiry +240 s) | success | link created | [0xcc007068cb...](https://explore.qore.network/tx/0xcc007068cb2cc6f0b0bfb1a2ae9c4cac194acb03267c7973e7a710450dd38c51) |
| A4b bind to an account that has no PQ key | success | bound | [0x47dac26cfd...](https://explore.qore.network/tx/0x47dac26cfde89c5dda83f11610881535ad60b4360e23fe07a458086c34a2a36c) |
| ATTACK 4 claim into an account with no PQ key (v3 attack 4) | reverted | NotRegistered | [0x634daabad6...](https://explore.qore.network/tx/0x634daabad61a5506cee38d3d7e262a9fd83d901e39445fd1eb07ce87a2073e26) |
| P1 sender Pocket hosts a Drop Pool (3 slots x 0.05 QOR) by intent | success | pool created | [0xa6a039a650...](https://explore.qore.network/tx/0xa6a039a6509db78cb0aa5cabc090a64478943bcef3bdaf070ae3e6024177fd80) |
| P2 claimer C1 claims slot 1 (distinct PoP account; link-key sig + own sig); 0.05 QOR into C1's counterfactual Pocket | success | slot paid | [0x449b567f89...](https://explore.qore.network/tx/0x449b567f89574d48846c427858a79449d9c00c3da3adcea0ff59753b0cc8fe95) |
| P3 claimer C2 claims slot 2 | success | slot paid | [0x5d26d1a20c...](https://explore.qore.network/tx/0x5d26d1a20cf1fcc5d15bcdf4ce1616010f071a804a0ba841e47884155c8af9ba) |
| ATTACK pool slot claimed twice by one account (C1 again) | reverted | AlreadyClaimed | [0xbd41b8f683...](https://explore.qore.network/tx/0xbd41b8f68324eea98b5b3eff0de604037641c1a71c6ec2764991d2025833716c) |
| check: pool claimers are accounts, not people | info | taken=2 of 3; main wallet possessionProven=false cannot claim | none (not mined) |
| P4 host Pocket closes the pool: the unclaimed slot returns to the Pocket | success | refunded | [0x84b270879a...](https://explore.qore.network/tx/0x84b270879a65a9a587b778e765545bb3af01e0f886a4365c0408483f4b03cdfb) |
| LEGACY RESCUE main test wallet (possessionProven=false) sends 0.05 QOR into a Pocket | success | Pocket 0xe7eBB8dBD9fea7a84160dFd41688a4C5dD42E8e8 (qor1ul4m3k7el6n6sstqml2pdz9ychw5968gv2j6r2) balance +0.05 QOR; the Pocket's owner is PoP-proven, the sender is not | [58057D726F5D...](https://explore.qore.network/tx/58057D726F5D1C72982005E3471F6E3F8439F9ED61B9B5BFEA335E958841DAFA) |
| fund lab-owner 0.12 QOR (for its PQ registration fee) | success | funded | [0x3158a31d99...](https://explore.qore.network/tx/0x3158a31d99fc1b1dce95aff7fa9370a7778e40be15607fdb9a94965bb486e5f4) |
| lab owner registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [1D2DF5219442...](https://explore.qore.network/tx/1D2DF52194423963A998ABFE8331860AA2DEBEDAFC3F6039E605CA189B9BBED6) |
| fund guardian-1 0.12 QOR (for its PQ registration fee) | success | funded | [0x14dd6a54a1...](https://explore.qore.network/tx/0x14dd6a54a1e798ff99f506902d33b628aa62202e0f54f45f761fdf0e4bc54238) |
| guardian G1 registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [B3F18DC0BFC9...](https://explore.qore.network/tx/B3F18DC0BFC962CEADF04DDCD626D415B42DA78F92D9A14A36C82B80A98A84A2) |
| fund guardian-2 0.12 QOR (for its PQ registration fee) | success | funded | [0x891909913b...](https://explore.qore.network/tx/0x891909913b52818a514b4932a1484b74251d193a1e387be19b86544dd874d77a) |
| guardian G2 registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [A90ED3D2F544...](https://explore.qore.network/tx/A90ED3D2F544B1FE12EB328CA2D422A3B4465E43D0B6F9DA17546DA46C604941) |
| fund guardian-3 0.12 QOR (for its PQ registration fee) | success | funded | [0x3aa257a424...](https://explore.qore.network/tx/0x3aa257a424873bafa81bdcfb5ce06974619de3d810f6440d0706eb4822d660d0) |
| guardian G3 registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [391A57F12019...](https://explore.qore.network/tx/391A57F120190FA4909364A4829591ECD1C872112567D9CEE8A4413BF1B887C4) |
| fund new-owner-after-recovery 0.12 QOR (for its PQ registration fee) | success | funded | [0x2eb974d51f...](https://explore.qore.network/tx/0x2eb974d51f694204b78ae3fa35bd540cc4b25bf5959cbd52b893e21f641c86dd) |
| new owner N registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [ACF869C30A16...](https://explore.qore.network/tx/ACF869C30A1623A33F3F06CD994548BC37C85DAA3CA74A56D9038C5091B8818A) |

## Guardian freeze and unanimous recovery (stolen-key scenarios, LAB)

Lab instance of the redeployed vault (freeze 120 s, unanimous recovery 180 s, timelock 60 s), router `0x0b4ee3c8a7a63716c5700b2711ad57a461b7ac2d`, factory `0x864cf0278a24c1b27d1ac66c883c3e74ff8d5a0c`, vault implementation `0xd017f09992c4c0f27f2d504ba42fe7d3bf578d96`. A = stolen key (thief holds the owner key; guardians freeze, then replace the owner unanimously, the thief cannot veto). B = a freeze that expires on its own, plus the cap on repeated freezes. C/D = queued spend + veto and threshold recovery + owner veto on the new vault. Spend, drop create -> claim and the pool flows on the new deployment are in the table above. All txs below were mined on Diana testnet; "reverted" rows were decoded with eth_call first, then mined with an explicit gas limit.

| step | status | outcome / custom error | tx |
|---|---|---|---|
| fund freeze-demo-thief (holds the stolen owner key) 0.12 QOR (for its PQ registration fee) | success | funded | [0xa5dbfbb7f2...](https://explore.qore.network/tx/0xa5dbfbb7f24ea76ff58f4d61cc3f4a9c5bfcd68431652ac55069dc56d26a74f9) |
| freeze-demo-thief (holds the stolen owner key) registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [7F2938B17D6F...](https://explore.qore.network/tx/7F2938B17D6F5FF16DFFC998FECC1C81D96F23C07C2C40509B5BD05F70EC24BD) |
| fund freeze-demo-new-owner 0.12 QOR (for its PQ registration fee) | success | funded | [0x6707f7c310...](https://explore.qore.network/tx/0x6707f7c31036edb0dac887a3d26c1a3579622cef71f2062fbb71267dcdc72f29) |
| freeze-demo-new-owner registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [8E2CF1E6D1B0...](https://explore.qore.network/tx/8E2CF1E6D1B091FD49941A2AA39593B5429B906B285427CD9CECF293E4E9EBAE) |
| fund freeze-demo-expiry-owner 0.12 QOR (for its PQ registration fee) | success | funded | [0x479b48455c...](https://explore.qore.network/tx/0x479b48455cf147faae86d3043a1c8b6b702ba21112bb77827e6973946deaffe2) |
| freeze-demo-expiry-owner registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [64BD34135878...](https://explore.qore.network/tx/64BD34135878C1804AFD8565C8043B92E70C160E3D4622E895A9D0AA35805F97) |
| check: lab FREEZE_PERIOD / UNANIMOUS_RECOVERY_DELAY read from the deployed implementation | info | FREEZE_PERIOD=120s UNANIMOUS_RECOVERY_DELAY=180s | none (not mined) |
| A0 fund the counterfactual Pocket 0.7 QOR (owner key = the key the thief will steal) | success | 0x945c44207bfe05dc7e3f63FF7e77ddA590351643 | [0xa642e0cbe3...](https://explore.qore.network/tx/0xa642e0cbe33923ff52157988c6f2c57223c95bb20a8ce9b2f64bd4beaa2f6e7e) |
| A1 THIEF (holds the owner key) spends 0.15 QOR of the 0.2 QOR daily limit BEFORE any freeze: the residual risk | success | paid (within daily limit) | [0x71acb1e4a9...](https://explore.qore.network/tx/0x71acb1e4a98dd482061d544ad480b4f4274b9fdb0e655b56ed7f0a1fe00487ec) |
| A2 THIEF queues a 0.5 QOR spend (above the remaining allowance, 60 s timelock) | success | queued id 1 | [0xee2583d423...](https://explore.qore.network/tx/0xee2583d4230fb6a0d46b6eaf9c1df32a4ec11c91b89cb4ac822360a53335d4e5) |
| A3 GUARDIAN FREEZE: guardians G1 + G2 sign (threshold 2 of 3), the Pocket is frozen for FREEZE_PERIOD | success | frozen | [0xa0042ee4b4...](https://explore.qore.network/tx/0xa0042ee4b44a67f65342c8f99aa117229af5d24ca38301dd03b32261b49956cf) |
| check: frozen() / frozenUntil after the freeze | info | frozen=true frozenUntil=1795117063 (now+120s) | none (not mined) |
| A4 ATTACK thief spend 0.01 QOR (genuine owner signature, inside the allowance) while frozen | reverted | Frozen | [0xd4ca245527...](https://explore.qore.network/tx/0xd4ca2455271a6a0a2f16862632dda34da026789985089753ecab209fdd86f416) |
| A5 ATTACK thief raises the daily limit while frozen | reverted | Frozen | [0x0e0d590190...](https://explore.qore.network/tx/0x0e0d5901900818a2fef7333fdacbe6bad91e164d10320f019cef9b8e6cf2f5c1) |
| A6 ATTACK unanimous recovery proposed with only 2 of 3 guardians | reverted | NotEnoughSigners | [0x4c99d703c0...](https://explore.qore.network/tx/0x4c99d703c08b310b8a378a824ea975a0afc4e2deeb6801b55fdee11df0331718) |
| A7 UNANIMOUS RECOVERY proposed by ALL 3 guardians (G1 + G2 + G3), delay UNANIMOUS_RECOVERY_DELAY, new owner N | success | pending | [0xa6a62dcca4...](https://explore.qore.network/tx/0xa6a62dcca41826f487b9682166687e2769248a0e430381c985afe33eb3680a41) |
| A8 ATTACK thief vetoes the unanimous recovery with the old owner key | reverted | NoRecoveryPending | [0x0ea55e94ba...](https://explore.qore.network/tx/0x0ea55e94baeeb07b079b4e10014b5adab4eb906e0bb76f47f2ec48e17038284a) |
| A9 ATTACK finalize before the unanimous delay | reverted | TooEarly | [0x7a941d2b20...](https://explore.qore.network/tx/0x7a941d2b20e524eb99b121d6860edd856403995daecdf6342dd496322560d364) |
| A10 ATTACK execute the thief's ripe queued spend (timelock over) while frozen | reverted | Frozen | [0x6510b6fe1e...](https://explore.qore.network/tx/0x6510b6fe1e0d599018a34f8c317e922c07198002aa899eba8a262a5899c7b2c8) |
| check: the freeze clock has run out but the pending unanimous recovery keeps the Pocket frozen | info | now>frozenUntil=true frozen()=true uRecoveryAt=1795117140 | none (not mined) |
| A11 ATTACK thief spend after the freeze clock ended, while the unanimous recovery is pending | reverted | Frozen | [0x7d7db6b818...](https://explore.qore.network/tx/0x7d7db6b818bc59e19cfc7bb8dbb0d7541135809835af58873472e0f06b3ecf2a) |
| A12 finalize the unanimous recovery after its delay: owner is now N (the thief key was never able to veto) | success | owner replaced | [0x97aa69e559...](https://explore.qore.network/tx/0x97aa69e5597e70fcccd49ad012f85b4ab8bf29ff010317186c5c99135ee05494) |
| A13 ATTACK execute the thief's queued spend after recovery (epoch bumped) | reverted | StaleEpoch | [0x7ba6bc941d...](https://explore.qore.network/tx/0x7ba6bc941d709beeb71419bf1b306a77d0d2697d3390b177f9e636561c856296) |
| A14 ATTACK the stolen (old) owner key spends after recovery | reverted | BadSignature | [0x3aee0b0293...](https://explore.qore.network/tx/0x3aee0b0293126ddb74e2698b733ee83edbb2f9f5881327275fc8837f3af54f4c) |
| A15 the NEW owner spends 0.02 QOR from the recovered Pocket | success | new key works | [0xda65673c93...](https://explore.qore.network/tx/0xda65673c93b80662f73a4410adcb8c283ada254697c53a29dd5e7dc2e3b04b58) |
| check: Pocket balance (0.7 QOR - 0.15 thief drain - 0.02 new owner spend; the 0.5 queued spend never left) | info | before=0.55 after=0.53 QOR | none (not mined) |
| B0 fund the counterfactual Pocket 0.3 QOR | success | 0xb5bfDdd7C4E8559Ab0f64ceDfB9f6a2EE519755C | [0xde752dfb02...](https://explore.qore.network/tx/0xde752dfb02135082ba46cf3bf7a840b4475d768f94388445b8a818e25669b35b) |
| B1 lazy deploy + owner spends 0.02 QOR (not frozen) | success | paid | [0x5783a38123...](https://explore.qore.network/tx/0x5783a381234f5c72febee9b9193ad5d9c2804e80def8dd31b7edce50b3e5c848) |
| B2 ATTACK freeze with only 1 guardian | reverted | NotEnoughSigners | [0x79cc7c258f...](https://explore.qore.network/tx/0x79cc7c258fb3d42d7577e9d793a07474a4d1bbcfb801eec48a5ac638e25477c9) |
| B3 ATTACK freeze signed by a non-guardian account | reverted | NotGuardian | [0x41a1adcfe0...](https://explore.qore.network/tx/0x41a1adcfe0f57d765a682a07bb3d7868e891aa3751241e6c8c49ab199294f535) |
| B4 guardian freeze #1 (G2 + G3) | success | frozen | [0xe48a4798e5...](https://explore.qore.network/tx/0xe48a4798e54d4fbf04f34d6e044092af13eee5ac8af6bbe6cb532207087a88ac) |
| B5 owner spend while frozen (the owner key cannot lift a freeze) | reverted | Frozen | [0x9461c2a883...](https://explore.qore.network/tx/0x9461c2a88385beea4ddbc68dea865df3a25201675674a0a955f45e11d25fbe42) |
| B6 ATTACK a second freeze while one is running (no extension) | reverted | AlreadyFrozen | [0x2963df19f8...](https://explore.qore.network/tx/0x2963df19f84b23ac493ed46f10ded97306b01db6387b25d13bc46647c1e498af) |
| check: freeze expired by itself | info | frozen()=false streak=1 | none (not mined) |
| B7 owner spends 0.02 QOR after the freeze expired (nobody lifted it; the period ran out) | success | paid after expiry | [0x41dfde3a84...](https://explore.qore.network/tx/0x41dfde3a84f3ab5729f8f4c1f3ad6f215ede3581b34a513aae5022c915adbd2c) |
| B8 guardian freeze #2 back-to-back by the same guardians (streak 2, the allowed renewal) | success | frozen (streak 2) | [0x93b0e3854f...](https://explore.qore.network/tx/0x93b0e3854f842468b2d12829ff7443061864a5a4eb3667b6fed57e79f8e4221f) |
| B9 ATTACK a THIRD freeze in a row by the same guardian set is refused (collusion cap) | reverted | FreezeCapped | [0x3c3ef55bf5...](https://explore.qore.network/tx/0x3c3ef55bf5a48bedf4202ef739d5cb65d8fb24d4b01d56a49ca8dda7a8945732) |
| B10 owner window after the cap: spend works again | success | paid | [0x612108ee6d...](https://explore.qore.network/tx/0x612108ee6df13f0502f2fd0dd9b1f80107a908d99dae5fe966bc78ac37d35a58) |
| C0 fund the counterfactual Pocket 0.4 QOR | success | 0x5d8c8FB64330C60e3b7592BcDFde0D88242f0790 | [0x38cf1dc694...](https://explore.qore.network/tx/0x38cf1dc69493c49f756002d056a5af959492cfc2d9dc48d6fbf781104469242c) |
| C1 lazy deploy + owner spend 0.05 QOR within the daily limit (paid now) | success | paid | [0x9ef6d76a0d...](https://explore.qore.network/tx/0x9ef6d76a0de19c3336539ba26f9669b67d2ce8f9ce1da812bdf7a610df1f1b3c) |
| C2 spend 0.3 QOR (above the remaining allowance): queued with the timelock, not paid | success | queued id 1 | [0x4c9d636342...](https://explore.qore.network/tx/0x4c9d636342b9fa60ca5c00dd05da43dd536bd2d530a11bbc09ae64cb72391d35) |
| C3 owner vetoes the queued spend | success | vetoed | [0x284f156dda...](https://explore.qore.network/tx/0x284f156dda5a1446e7cdeab5b92cfdb737b6e6a1efd4c89bf0ce2f9d0c5a96db) |
| C4 the vetoed spend can not be executed | reverted | NotQueued | [0x64a49f1439...](https://explore.qore.network/tx/0x64a49f1439ac3b6cad7dafa892c84f49247b2a84cf1322c7e0d4b4c5e7c4858f) |
| D1 threshold recovery proposed by 2 of 3 guardians (G1 + G2), 60 s delay (vetoable by the owner) | success | pending | [0xd7bb62ed96...](https://explore.qore.network/tx/0xd7bb62ed9602bf4fb6a47ef7e0666d268000f03ce081504d222bc64f28c41925) |
| D2 the OWNER key vetoes the threshold recovery (still possible: covers colluding guardians) | success | recovery vetoed | [0x2f7996759d...](https://explore.qore.network/tx/0x2f7996759dcf7e16f84ced7cc02a3f050bf53d7168bf85a60890791659809662) |
| D3 finalize a vetoed recovery | reverted | NoRecoveryPending | [0xaa7e5a3015...](https://explore.qore.network/tx/0xaa7e5a3015ce3ab7e563eafe1bb480e9f85ece801f75c58a1706e924a4545b68) |

Summary: {
  "ranAt": "2026-11-19T19:44:48.116Z",
  "lab": {
    "router": "0x0b4ee3c8a7a63716c5700b2711ad57a461b7ac2d",
    "factory": "0x864cf0278a24c1b27d1ac66c883c3e74ff8d5a0c",
    "vaultImpl": "0xd017f09992c4c0f27f2d504ba42fe7d3bf578d96"
  },
  "pockets": {
    "stolenKeyScenario": "0x945c44207bfe05dc7e3f63FF7e77ddA590351643",
    "expiryScenario": "0xb5bfDdd7C4E8559Ab0f64ceDfB9f6a2EE519755C"
  },
  "deployerNetQor": "1.4984275",
  "relayerNetQor": "1.81292655375"
}
