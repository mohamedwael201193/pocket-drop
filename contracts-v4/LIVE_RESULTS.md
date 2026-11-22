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

## Q-Day drill: "Steal this Pocket" baits (PROD instance, 20 Nov 2026, TEAM-RUN)
Five bait Pockets whose classical secp256k1 keys are published on `/qday` (owner-approved, testnet). Each ML-DSA-87 secret is independent random entropy. Record: `deployments/qday-baits.json`; attack script: `script/qday/attack.mjs`; page: https://pocketdrop-app.vercel.app/qday.

| Bait | Setup | Key account | Pocket |
|---|---|---|---|
| B1 | Plain: no guardians, daily limit 0.05 QOR | `0xf2a37748aFf0Dc12E0C5abC1C3566A0c6D12121f` | `0xCE272e8c261202C4c4e38479763c8892C64C2B1F` |
| B2 | Guarded: 2 team guardians, threshold 2, daily limit 0.05 QOR | `0x17d3D6A9ddb1Da525D4A3a1a26ED9Fb369EBc754` | `0x31368D55a0fD1983397ffc5D85dB3bdd482a11cE` |
| B3 | Queued: the owner queued a 0.1 QOR spend to a team address (24 h timelock); nobody else can veto, redirect or add one | `0xbDfE6C1030712554Ce0f466BD4A3f377e966bE34` | `0x5e08A3308f60b512d6958A46629E1EE3FEC8Bd06` |
| B4 | Recipient: bound and confirmed recipient of a 0.1 QOR Confirmed drop; only its ML-DSA key can claim it | `0x1991ab25891f7B1c475bA8e85Ccd685f0FC6d045` | `0xb5056dC92734cdA2162D76E74Aaba3D338E6C28F` |
| B5 | Counterfactual: not deployed yet, 0.2 QOR waits at the predicted address; deploying it pins the real registered key | `0xaD127D5b5e7013038428ccdB4c5Dc1C6eDeB8464` | `0xa5BFb1edE77C41d91450a0a918D3d5775a178f24` |

| Step | Tx | Result |
|---|---|---|
| fund 5 bait key accounts 0.09 QOR each + submitter X 1.4 QOR (main, one hybrid tx) | `EF24E9E0409C131C1BC0910635AE43B1ECCB6238F66072EA268A43B8AE995430` | cosmos code 0 |
| B1 registers its ML-DSA-87 key with PoP (classical, one-time) | `24EF8BEFFA5AF6682973A1F05102F69EFD2B7DFCDD73D038F0804E4CC4AA30D5` | cosmos code 0 |
| B2 registers its ML-DSA-87 key with PoP (classical, one-time) | `8B1336FAEC8276827BBF1EF3A6EF314C392AC0580301BDD4D529854A595C15AE` | cosmos code 0 |
| B3 registers its ML-DSA-87 key with PoP (classical, one-time) | `32E53A20E18045EE1AED762DB98E900DF47B1E792B6246968D60AEAFD9C28FF1` | cosmos code 0 |
| B4 registers its ML-DSA-87 key with PoP (classical, one-time) | `2A50DD5D2A03CFE0D8A7A835FC18E2C1E20B81E2BE610B638A334F1DC68E58C8` | cosmos code 0 |
| B5 registers its ML-DSA-87 key with PoP (classical, one-time) | `3C6BF59195D2DF08F825EFAFE5985E6FE7428776F433573CB1DEDC5F0F33AE24` | cosmos code 0 |
| B1 Pocket deployed through the prod router (submitter X) | `0x81dfba87bf9cc1403ba845cfe857f1fb831f472a3718896dc84a908e71187016` | success |
| B1 Pocket funded 0.2 QOR | `0x32dbb7207328c8c7e7633f7507e0b644328d53abd7fcf0df584fcf56ab737df9` | success |
| B2 Pocket deployed through the prod router (submitter X) | `0xecd3e8aed1f1e49a24847cf1aca70e4880f55924d1d5d1eb8d6613c3686df61d` | success |
| B2 Pocket funded 0.2 QOR | `0x24673ec6a930d8d6ae82e438867ecbb78c09c35b3bbebf8b2b4e4be382ba3d52` | success |
| B3 Pocket deployed through the prod router (submitter X) | `0x90a6d0fd004381dd3595456f197dbde78f00669d457ea86927426658a41d104d` | success |
| B3 Pocket funded 0.2 QOR | `0xe064409b3e2dcc7f965982810bfb90da18730f4c90c7a94c490f567ececa6670` | success |
| B4 Pocket deployed through the prod router (submitter X) | `0x8fd1ff57a5e0ffb1d52d5515504ad9d06c8bd54ff56690cd51bd6a5152c0e149` | success |
| B4 Pocket funded 0.2 QOR | `0xb890602970d339a9d21af42e1b5f05f6fdf568d4ae87533b8495c843fbeccaf9` | success |
| B5 Pocket funded 0.2 QOR | `0x18f96df60cd530922d45875376d04586aaf77c776887b685be8f295914368a03` | success |
| B3 owner queues a 0.1 QOR spend to team address X (ML-DSA intent; 24 h timelock) | `0x7bb07d1ea414e4e42088821fb5fa0c37f9bd0db43b889bb4313bd1cc0c525169` | success |
| team sender S key account funded 0.08 QOR (registration fee) | `0x2683af1402425fc4a371e07ca789e228fccbee409f79a8d752d879f35ba2c549` | success |
| team sender S registers its ML-DSA-87 key with PoP | `F43D60090BB7C5C2F19F062DD7DC58AEB06A7D84E13064C1BCBF5F647A9D35A3` | cosmos code 0 |
| team sender Pocket S deployed (limit 1 QOR) | `0x39456e7629dfb4bc31f625d89b4bad74e4b0515d9753bd23d17f66078c5231bb` | success |
| team sender Pocket S funded 0.12 QOR | `0xf050f576455a19d4d79cbc2d7b4eb356f4a091e9c07f3043d76d4f5dbfa5f5bd` | success |
| B4 setup: team sender Pocket S creates a 0.1 QOR Confirmed drop (ML-DSA intent) | `0x4b3b4439dd48a6b95a75ea44ed887b1e2e48b7643eedbb499d2d288577fc22ad` | success |
| B4 setup: link key binds B4 as recipient of drop p23 (payTo = B4 Pocket) | `0xe5f5586b8d75cdd4cef27e99b26cf97605e5dcabb30d4bd16769523f3f1fdec6` | success |
| B4 setup: sender Pocket S confirms B4's key for drop p23 | `0x78be4db118a0b0bb6eed9c31a3cc50f159a4bcaaabd9929320cf3b0847f11671` | success |

First team-bot run after publishing (https://github.com/mohamedwael201193/pocket-drop/actions/runs/44680831601, every path against all five baits, read-only): 98 attempts, 0 succeeded (Cosmos paths refused with codes 20/21/234, Pocket paths revert BadSignature, NoGuardians or BadRecipientSignature; B4's drop claim BadRecipientSignature). In-browser paths (eth_call) for every bait: all refused (`frontend/test/qday.live.test.ts`).

First attempt mined through the relayer (Try-it marker `QDAYTRY1`, B1 spend signed with an attacker ML-DSA key): `0xd0aede1a9056a76ea3b1ea477984646f59c94e8a6ce04dac509a9bc1e5fb7a0a`, status 0 (reverted), gasUsed 254,140, B1 still holds 0.2 QOR.


## Depth round, 20 Nov 2026 (TEAM-RUN, Diana testnet)

### Old-key team Pockets emptied to main (prod, 10:13 Cairo)
Six prod Pockets deployed before the v2 key release block (10412597) still held QOR, all team-owned. Each was emptied by its owner's ML-DSA-87 spend intent, relayed by `POST /api/route` to main `0x8ab5CE4fcd45cC69FEe31Ea6E9e6222C1e18bBDd`. Evidence: `frontend/evidence/v4/oldkey-drain-2026-11-20.json`.

| Pocket | Amount | Tx | Result |
|---|---|---|---|
| `0xe7eBB8dBD9fea7a84160dFd41688a4C5dD42E8e8` | 0.78 | `0x0101ae7cf9e5850287565b6f748d968c97252fa9ea5cde10d19fd469332413ab` | paid, balance 0 |
| `0x10B0ac40a1f6Ae5dE5DDd4393086504e91A0b2cB` | 0.25 | `0xa23b76db687edd23c812ad4737105fba9f55f68fc746fc1eb44478f1884ffaf5` | paid, balance 0 |
| `0x801EB77057e60eED9AA348ed7E309f8495811Ef7` | 1.03 | `0x529b7ec32c6a9ce28e59afee65bce4e77f9e8b4e9c23148a996bada836092a44` | paid, balance 0 |
| `0xD6b6Fd3D68aD53E8FD6018099A32c01BaB4aa58b` (V, /qday "after") | 0.05 | `0xf8e5bd455c7276a8006e507363729b62b410668836bdab5c90ed970694998262` | paid (daily limit 0.05) |
| same | 0.15 | `0xf111ffec09a91064950bfd56e490a29e316f42b18e6ed6de977f5007aa1620d3` | queued #1, unlocks 2026-11-21 08:13 UTC; anyone may executeQueued |
| `0x803B3ACEf3e7C7c54580663d1BFa05adA8cB6B17` (W, the robbed twin) | 0.01 | `0x1a91a8cfb93610b0ea79df6a2f9886aaad826a8f304a2c44c634181ffd2303d5` | paid, balance 0 |
| `0xa5DeeE50ff5B11cdc65F15999BFEFC169827B9F8` (P20) | 0.04 | none | stays: its browser key was not retained |

Relayer gas 0.266 QOR. Funded v1-era prod Pockets: 6 before, 2 after (V until its queued spend executes, and P20).

### LAB flow d rerun: full pass, now including unanimous recovery (10:14 to 10:26 Cairo)
Playwright on the live app (`chromium-1440` project; owner chromium 1440, new owners webkit 390 and chromium 390, guardians chromium/webkit): 1 passed in 11.9 min, 0 issues. All 23 txs were mined (receipts checked in the run and by `frontend/scripts/reverify.mjs`). New in this run: during the freeze, all three guardians moved the Pocket to a fresh key by unanimous recovery, and that key finished it after the 180 s LAB delay. Evidence: `frontend/evidence/v4/e2e/flow-d-lab-rerun-2026-11-20.json`, screenshots `QORE/qa/shots-d-rerun/`.

| Step | Tx | Result |
|---|---|---|
| fund owner key 0.075 | `0xc981fba1e5362e916560c439eb652f8d232ee534b078a31d68d3314e50cbd71c` | success |
| fund owner Pocket 0.6 | `0x2a3a1db62e8162da00ccb577a1af3455082ee47a5d77777ea1b1bf0dfb122e4a` | success |
| owner spend 0.01 (lazy deploy) | `0x7eee5bf2231e1a710432f1aa7f89ce665cc6b662c7bd1398f4204fb1adab89ee` | success |
| owner lowers limit to 0.05 | `0xdf2f2ff70f60ac6c3440a22084019424ddcdfceb6b3ec0e63329d48021d57481` | success |
| owner queues spend 0.08 | `0x71bd55ed59f5c95ea209f6952a7cb07c7aec8dbd7952e5fb31e6ad5653354486` | success |
| owner vetoes queued #1 | `0x8a20362fb2c4b70838bb921d7a25b951c043a3a24e0bd1346383e3ef6c1584bf` | success |
| owner queues spend 0.06 | `0xa2e577601ebbb52d6e5738cc00bb3fabc50b885ffa19b8e33650156bc408029b` | success |
| anyone executes queued #2 | `0x41e19e75a37fcd4902541ca82849933b4f32a846dda60f523f71a192dd1d2ae4` | success |
| owner queues limit raise to 1 | `0x834a38b75d5d29d0f363ed8317aecbe81049bf6b4c2e97fab2b84054509894ad` | success |
| anyone applies the limit raise | `0x287359114ba6ca69770691686796cf8bac812fed54749ffcb61e3d5839fc0373` | success |
| owner queues guardians 2-of-3 | `0xc54edcecc81cb5ac98cfe7da30c79108cd54909cc7607e8b3dcccb0844686f1e` | success |
| anyone applies guardians | `0x0bbb61ff71b25f323e11feaf5b5692e059701dcf29369987937cde8a52c72141` | success |
| Q-Day rescue: legacy main wallet sends 0.05 into the LAB Pocket (cosmos) | `578EFC0A681698ACB0FE688A2968731B21ED2751373BE9DDE9603F09754BEF94` | cosmos code 0 |
| fund new owner key | `0x99e68fdb8d9e3b3b83b3ddedfd5aa6acb721c960739e98849e2ba206aa76bf17` | success |
| guardians 2-of-3 propose threshold recovery #1 | `0xaabc1770fe7e544e41d81b54504d25275389eca19388e6370448bd14d8f15b8e` | success |
| owner vetoes recovery #1 | `0x913dd2c3605bc8936efba50f7624e49c5b8df3ea189411fb2d8b1cdf5a9a9c35` | success |
| guardians 2-of-3 propose threshold recovery #2 | `0x71bacdd2c3e6061e837188a07dd88e93505e347850ee3501979fe4f528d901c8` | success |
| new owner finishes recovery #2 | `0x781ad702aaed1c5e78ad18bfc9ffadaf6fb99895d2770d849d2ee421f58cfcf3` | success |
| sweep recovered LAB Pocket Pocket to deployer | `0xa7cb8a647f4e68b7076ce8e0287f61e59faa29df1ad6caa0281c762203273010` | success |
| guardians 2-of-3 freeze | `0xc271b106f7570f81528117027fa901015e77047a8139b0912a6a622e969884fb` | success |
| fund unanimous new owner key | `0x45345a0405b0b45f8045d8ee5d61b761563a8b01f7921bad713cb4fb6e361ec6` | success |
| guardians 3-of-3 propose unanimous recovery (while frozen) | `0x687da019fcfe23f5acbdc4c80a15cb4a1e0ad4fa180f43d0623f6b25bc7f8ec9` | success |
| new owner finishes unanimous recovery | `0x2b2fabf145d60fa25fc07f391818959e4671544d34612c1a94c83f0a1f3cdc2d` | success |

### QoreX-format signed intent through the prod router (10:20 Cairo)
Account Q is a fresh mnemonic. Its ML-DSA-87 key is `deriveCanonicalPqKey` from `@qorechain/qoresign` (the QoreX canonical derivation), registered with proof of possession. The spend intent digest was signed with `qoresign.signMessage`, which is the exact `signArbitrary` response format, and relayed with lazy deploy. Evidence: `frontend/evidence/v4/e2e/qorex-format-intent-2026-11-20.json`.

| Step | Tx | Result |
|---|---|---|
| main funds Q key account 0.09 and Q's counterfactual Pocket 0.05 | `C83C5D588DDAC593AE42471557D794865EBF958878F7DE57A2A09E0FB64A4510` | cosmos code 0 |
| Q registers its canonical ML-DSA-87 key with PoP | `9EDC000FD332D062F3AAD8A65C9BE4FBD8056415D645850A46ABDC882553F385` | cosmos code 0 |
| QoreX-format intent: deploy Pocket `0xcb1b21f0Ef016829e235F806FD4D6EE45ceB972D` + spend 0.02 to main | `0x36909c05a300789652254abcaad394d36ab1be2e37cd7c64090818eda61cd04d` | success (503,646 gas) |

This is not yet the QoreX app signing. The QoreX extension (0.4.3) was installed and run headlessly with a test wallet on testnet (`qor1ppxmr9ek5yex76uy4x4j726029he0zg5kcfe2e`, funded by `1B270665EF435A0CA51EFC01A98D0F4C2FA3B939ADBAED06BE88A6008CD7597F`). Its key registration needs a send from the wallet, which is waiting for the owner's approval.

### Real QoreX wallet signature through the prod router (11:10 Cairo)
This step used the QoreX extension 0.4.3 itself, running headless with a team test wallet on testnet; the earlier intent was QoreX format made by a script. On its first send the wallet registered its own ML-DSA-87 key with proof of possession. A dApp page then called `window.qorex.native.signArbitrary("qorechain-diana", wallet, digest)`. The QoreX approval window showed the digest, the request was approved, and its `pq.signature` went unchanged into the Pocket spend. Evidence: `frontend/evidence/v4/e2e/qorex-wallet-intent-2026-11-20.json`.

| Step | Tx | Result |
|---|---|---|
| QoreX registers its ML-DSA-87 key (MsgRegisterPQCKeyV2, sent by the wallet) | `D409DE041B4EFEA3B9E6A58586D66937147036F13C2E7FCBE758EB72DCD98426` | cosmos code 0 |
| QoreX hybrid send 0.001 QOR to main | `22AD39137B19A8D541AD30160E3A4A9A491955190239D7855DF3A33F012C2BF4` | cosmos code 0 |
| main funds the counterfactual Pocket `0x088e8f3240523d73E5d6b14C48B3996685e5eD22` 0.05 | `809127BDA39D9CEC9B2BE698EA0F64D56C7E8AD4742B69DB65A93D4F753AB8F2` | cosmos code 0 |
| QoreX-signed intent: deploy Pocket + spend 0.02 to main | `0xf98daf5ec7aecb3b82666c25ce10704f251e54460e066a6bc3733a6635286d1a` | success (503,790 gas) |

## Hybrid relay lane, 22 Nov 2026 (TEAM-RUN, Diana testnet, prod instance)
The relayer stopped sending ECDSA-only EVM transactions. Each relay is now a native `MsgCrossVMCall` (`@qorechain/sdk` `crossvm.crossVmCall`) to the PocketRouter, signed with secp256k1 + ML-DSA-87. The chain checks both signatures and records `pqc_hybrid_verify status=verified` in the transaction. The deployed contracts did not change. A cross-VM call leaves no EVM log: `/api/xvm` rebuilds the drop and pool events from the native lane, and `/api/stats` adds them in. Evidence: `frontend/evidence/v4/e2e/hybrid-relay-2026-11-22.json` (local build, 11 relays) and `hybrid-relay-live-2026-11-22.json` (deployed app, 11 relays). `reverify.mjs` section 9 re-checks every row and the closed window.

First probe (04:08 Cairo): `router.relay(V, executeQueued(1))` as a hybrid cross-VM call, `93FC5B4B3704CF84F6C587FB4B543294793A0FDC4CC95F8D4EA0843C5345C192`, code 0, height 10527710; V's queued spend #1 went from Pending to Executed. A probe that reverts inside the EVM (`B05749E6C1CAED0CB2605B420D959B6D9984581F804F15A7BD077E7019B16B70`) fails with code 14 and still pays its fee, so the API always runs a dry run first.

Deployed app, flow a (confirmed drop) and flow c (pool), Chromium and WebKit at 390 and 1440:

| Step | Native tx | Height | Result |
|---|---|---|---|
| sender createDrop (lazy-deploys the Pocket) | `04AA17839F57179DA8EC58454F1CD1CEBDDA4D883C86376B4CD92720AF56D445` | 10529216 | code 0, pqc_hybrid_verify verified |
| recipient bind (link-key signature) | `F2550467C360F9E040640A8241E1636F1C1C87848AAE6E5F96329DD2358BF745` | 10529222 | code 0, verified |
| sender confirmDrop | `3ABD34F23BDCA59D0A7818AFB92F61578B6495E3008B203595297B97ADC8CC2B` | 10529237 | code 0, verified |
| recipient claim | `32FB6769EB94FEB411CC9482EA90782603ABC1C846DC750F71519DC0FC45B682` | 10529241 | code 0, verified |
| relayer window replaced by a 10-block, 1-tx window (hybrid MsgOpenEVMWindow) | `0373ACC4860EB877DEE1AE45B2EF0B7F9E7A9B683EA843623FC41A0FB1F4C3A6` | 10529369 | code 0; window expired at 10529379 |
| ECDSA-only relay from the relayer to the prod router, after expiry | attempted `0xf2dbd9f5d6bc42c68f3546ad127b463677e8024af30d705580c53315f41ad540` | none | **refused at broadcast**: "EVM authorisation window exhausted" |
| host createPool 3 x 0.02 (window closed) | `AEA2C44E337A9EBE5FEB9898D8192891AD0E609F07EFED67AD3C996DBC84CDD5` | 10529456 | code 0, verified |
| claimer 1 takes a slot | `9B191BEC461B751FE562E15CD91D0ED149B688F700AA0041C4D503DBD18E4445` | 10529469 | code 0, verified |
| claimer 2 takes a slot | `A12839ABEA58FBE03E99C59D0FF0576A5B2D6761A157AF55645EDEE49A343390` | 10529481 | code 0, verified |
| host closePool | `71C3E330A808205FE1C9698978DE2CAEE6C4425E4CB3AD586E31E048D579F835` | 10529543 | code 0, verified |

Cost: a hybrid relay used 0.099 to 0.169 QOR of native gas in these runs (gas = dry run + 15%), against about 0.08 QOR for an EVM relay. The relayer was topped up with 2 QOR from the main wallet (`D1A2C4CDA911F75C2A2BF37D25167CF522CA5AFEE0354801A3F6ED2E3F376AA5`).

### Later runs on the hybrid lane (22 Nov 2026, window closed)

LAB flow d on the deployed app (Chromium 1440 owner, WebKit 390 new owners and guardians; LAB delays: 60 s timelock and recovery, 120 s freeze, 180 s unanimous recovery). Evidence: `frontend/evidence/v4/e2e/hybrid-relay-d-lab-live-2026-11-22.json`.

| Step | Native tx | Height | Result |
|---|---|---|---|
| owner spend 0.01 (lazy deploy) | `276C21B5578B39194F684123F3BADDDA7CD31AA836076F5FD756EDAEE703B4DA` | 10531510 | code 0, verified |
| owner lowers limit to 0.05 | `F4B841B1C6A9FADC3278799F79202B06365849A6F5B75E70DCF8FF10F5289F3C` | 10531513 | code 0, verified |
| owner queues spend 0.08 | `6F3E42A231EAE4CB7F757F2AE8749FAC09C48FEEEDBE79E91C47CBFBCAFE1445` | 10531516 | code 0, verified |
| owner vetoes queued #1 | `609203DC61318E1EEC496FC0DE77BD13325744D257F75A178C7382A51493CB28` | 10531519 | code 0, verified |
| owner queues spend 0.06 | `3CD05753628AA6ED0509839D01460FB8B10DEAB3C3B4105477E14FEBE9C09816` | 10531521 | code 0, verified |
| anyone executes queued #2 | `14F8BD0A4F9DEC16F97B6504EE7A639B0FB6E258DFF855C9319C508EACF9615E` | 10531567 | code 0, verified |
| owner queues limit raise to 1 | `D4972AE0A1EE01DC1E1342D829B66FB0399D283217C307BEE36C088D9AED340A` | 10531569 | code 0, verified |
| anyone applies the limit raise | `E8B81A8EFCDD734A5964938F965910C5152937BBA15584B0791599C991026B39` | 10531613 | code 0, verified |
| owner queues guardians 2-of-3 | `493BA213EBC98499814071DE0C42D962A2C3EDE65334D7F2D60478D8F9260F43` | 10531616 | code 0, verified |
| anyone applies guardians | `146BE1F9F67F6760D3061BFF739E73570708E249694402C0ABED58B72794B075` | 10531662 | code 0, verified |
| guardians 2-of-3 propose threshold recovery #1 | `1BF648F9610EEC2ADC8E413C1A92981764CEAE1E7CEB44B4133DACA7BFA8FF8A` | 10531729 | code 0, verified |
| owner vetoes recovery #1 | `ED5DE1ADB224CFB2D7DE84BD1DDE38F31FACF8435CF69C3E3445E9875B73CF04` | 10531732 | code 0, verified |
| guardians 2-of-3 propose threshold recovery #2 | `A765898021670961F2E9A3EDCBD8BB7AAF5BA05AC4677060429B55F194D32F98` | 10531737 | code 0, verified |
| new owner finishes recovery #2 | `90716CB4B111435066D8BC8B852C57582AFD7838302A94AE1DA94C82EE7EE440` | 10531788 | code 0, verified |
| sweep recovered LAB Pocket Pocket to deployer | `F8F788C341068D47B7F284D1BF07E87CDAD85F2A83803940966E2B0407C5A4CC` | 10531815 | code 0, verified |
| guardians 2-of-3 freeze | `699F4AB495102067FAA77BC7F55B65025EE6C936E72D2D19B036D8C54FB97015` | 10531820 | code 0, verified |
| guardians 3-of-3 propose unanimous recovery (while frozen) | `1E4AA3329FCF415419C5C4675B1398C4DE55C048418F03E4331691C5603C61C6` | 10531837 | code 0, verified |
| new owner finishes unanimous recovery | `495C47E6292F595487232C3E457077793C64AF5087E1CA97C6CBC7A0C0864390` | 10532010 | code 0, verified |

18 relays, 1.800 QOR of relayer gas in total. The Q-Day rescue step is a plain hybrid MsgSend from the main wallet (`E4654677085D62526A12188E81B06F741D7EFC43A93C35D69253DFA2308C7DD1`).

v3 link #29 (Giveaway, created by the team deployer with `0x811fc5e09b7ef4d1e85a9f205fbe6332b31f8dfd7a5854eb121522211a29d5a7`), claimed in WebKit 390 on the deployed app; bind and claim are relayed into the v3 PocketDrop as cross-VM calls. Evidence: `hybrid-relay-v3-live-2026-11-22.json`.

| Step | Native tx | Height | Result |
|---|---|---|---|
| recipient bind | `1806B21CC3DC90474BCF634880797598611122606695E012214A0259413E6F24` | 10532170 | code 0, verified |
| recipient claim | `CAFECB9ABD82E5715DAE1EB721D8332E10631370F62A15F26384825EAB98F71C` | 10532177 | code 0, verified |
| recipient registers its ML-DSA-87 key (own hybrid tx, paid from the drip) | `44CF7B7CC0812FC87B9580E89E43500DA0BB1F3E31710264FD8E788181D39E09` | 10532173 | code 0 |

Q-Day drill attempts through `POST /api/qday` (the Try it button). Each is a hybrid cross-VM call that the bait Pocket reverts, so it is mined with code 14 and leaves no EVM tx; `/api/qday` finds them by fee payer and `/qday` lists them under Refused attempts. Evidence: `hybrid-relay-qday-2026-11-22.json`.

| Attempt | Native tx | Height | Result |
|---|---|---|---|
| pd qday try B2 spend (Expired (replay of a recorded bot attempt with its old deadline)) | `BC011B9E894932C8BCDF97D7AA1DCCAD87EB4D4FD72568741C5E19F3953E2621` | 10531305 | code 14 (reverted on purpose), relayer signature verified |
| pd qday try B1 spend (BadSignature (in-tab attack E1: spend signed with the attacker's own ML-DSA key)) | `BB29C5D702311A1666613C66F52F68F3C54DAA454BCDEC5B2D46C92E0340BFED` | 10531318 | code 14 (reverted on purpose), relayer signature verified |
| pd qday try B1 spend (BadSignature (in-tab attack E1: spend signed with the attacker's own ML-DSA key)) | `FB826A14E7E1A8A6271E9489E2BA12BF17075CC793479720F981594F758F00D3` | 10531327 | code 14 (reverted on purpose), relayer signature verified |

The relayer was topped up again with 2.5 QOR from the main wallet (`8478BC95B90616353FE4E2B635D6F4CFD74BE2C046CC6EAAEDC0920302F5ABA3`), and the deployer with 1 QOR (`5570A3AF3DEF4C97AB38BB8CF852EFB04A8950F7DFF092D0B46F13A00533FB7B`); both move team QOR and are not spending.

Anyone can re-check any of these in the app: Proof > Check a transaction fetches the transaction from the chain and re-verifies each ML-DSA-87 signature in the browser, with the keys read from the chain.
