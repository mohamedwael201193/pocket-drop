# Live results (QoreChain Diana testnet, EVM chain id 9800)

Instances: PROD (24 h timelock / 48 h recovery) router `0x8abf85b7491f50ab4aeae16582723200bc3bd46a`, drop `0xbc13b9ee91f31ed56932abdb796693515c351f00`, pool `0xaa981588e5430e3db9a789a3754e108cc01e3d00`, factory `0x3ec6a625a8e7e00b89b8bbf95f5fc2ae8780331a`; LAB (60 s delays) router `0x72ba4753375d4724e7ccbfdc9a330276ae90606e`, drop `0x42da108a4e8bf5d152600b470f1abd28debdee59`, pool `0x1858193617bc2f2e2570a137320e1a1cb3a7ce5b`, factory `0xfc665d14165dc4f3320a70a569290bc4dcad4197`.

Every row with a hash is a mined transaction. "reverted" rows are the lab attacks: each was decoded with eth_call first, then mined with an explicit gas limit so the revert is on chain. Rows marked "refused" are transactions the chain refuses to BROADCAST (the relayer EVM window lists only the two routers and PocketDrop v3), so they have no hash by design. Gas-used values are in deployments/diana.json.

The suite ran twice. Run 1 (41 txs, kept in deployments/diana.json under priorRuns) aborted at the pool step because of a bug in the harness own JS digest cross-check (it used the fixture pool address, not the deployed one); the contracts were not at fault and every tx in it is real. This table is the complete run 2.

| step | status | outcome / custom error | tx |
|---|---|---|---|
| fund sender-owner 0.12 QOR (for its PQ registration fee) | success | funded | [0x543f8bcf1f...](https://explore.qore.network/tx/0x543f8bcf1fff24ac4e393f3234b35ce1672fe04cc17f4d7ed6c313ab8880c6b1) |
| sender-owner S registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [1A2829DD78AA...](https://explore.qore.network/tx/1A2829DD78AAF1866AB3F6DBF98A1A32E46C8DF34CC7B1C11649219B7BF7CB3E) |
| fund attacker-B (second person, own proven key) 0.12 QOR (for its PQ registration fee) | success | funded | [0x88c042fcc7...](https://explore.qore.network/tx/0x88c042fcc7905523ea65da944b9ded3ac0110cf4d93082c364498b7042fcc2be) |
| attacker B registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [5B6C6058682C...](https://explore.qore.network/tx/5B6C6058682CCEC1AB78AA7D50A95662C82D6293D6B4FA52CE29E76D45810B65) |
| fund pool-claimer-1 0.12 QOR (for its PQ registration fee) | success | funded | [0xa540b927e8...](https://explore.qore.network/tx/0xa540b927e807405e3cd4ff81608dd9c0119f8105f112439f5da3a4a8912281d5) |
| pool claimer C1 registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [7BD28C4B9C63...](https://explore.qore.network/tx/7BD28C4B9C6342C2614EBF213D5FD403C17A35707D4AA30D9FE59114CA9793F8) |
| fund pool-claimer-2 0.12 QOR (for its PQ registration fee) | success | funded | [0x02cbcdc96a...](https://explore.qore.network/tx/0x02cbcdc96a170789d2390a881a53026dac6d8425734b16aa0df00c51ede38189) |
| pool claimer C2 registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [4895C4A013B5...](https://explore.qore.network/tx/4895C4A013B5CB89D804965612D41620DD395B89852D69E4BB8BF1BCAA912058) |
| S1 plain QOR send to the Pocket address BEFORE it exists (counterfactual funding) | success | address 0xac6847B04117eAD2AcDb27676df5D373013Ae918 has no code, balance 1.5 QOR | [0x81e4412542...](https://explore.qore.network/tx/0x81e4412542671d255877d9993d59b2c2b88ef270018a5bc0281a107f659983dc) |
| S2 lazy deploy + first intent through PocketRouter(prod): deploys the Pocket, then spends 0.05 QOR (ML-DSA signature checked by pqcVerify) | success | Pocket deployed and spent | [0x0cb4d392de...](https://explore.qore.network/tx/0x0cb4d392de9c22f3618b25f347980c9be22e024d6e58d444e7cd11e832ae6058) |
| check: JS intent digest == PocketVault.intentDigest (on-chain view) | info | 0xf0a6bb93e2f6909167ddbfba917974a9c133e323417cf0c18955aed7ca373e2a | none (not mined) |
| ATTACK replayed intent (same signed spend submitted again) | reverted | BadSignature | [0x469483cde6...](https://explore.qore.network/tx/0x469483cde66bf0def0acb33f6402d87a0d53f69c88e5eceda8dc7aabda5fef2b) |
| ATTACK vault spend signed by a wrong (but PoP-proven) key | reverted | BadSignature | [0x75dc4a4c8a...](https://explore.qore.network/tx/0x75dc4a4c8ab5e0a9d73903cd20ddd247f4d28ec7365a2b2828d9633db79617ea) |
| ATTACK router targeting a non-Pocket address | reverted | NotAllowed | [0xc13556cbb5...](https://explore.qore.network/tx/0xc13556cbb52cf7baa921f781ddd09695a29ccd1c4999bee7d977a633f0d2653f) |
| ATTACK relayer sends a tx to an off-list target (PocketDrop v4 (prod)): refused by the CHAIN at broadcast (never mined, no hash) | refused | Missing or invalid parameters. Double check you have provided the correct parameters. | none (not mined) |
| ATTACK relayer sends a tx to an off-list target (a Pocket directly): refused by the CHAIN at broadcast (never mined, no hash) | refused | Missing or invalid parameters. Double check you have provided the correct parameters. | none (not mined) |
| T1 spend of 2.5 QOR (> 2 QOR daily limit): queued, NOT paid, 24 h timelock | success | queued id 1 | [0x45e99ae6af...](https://explore.qore.network/tx/0x45e99ae6af686fe8d34b9d40ae3fad4d1af9efd1cbd64d38445b803a68f0e2ba) |
| check: queued entry | info | to=0x392f50b1955a827458A320205e19acf7C664f116 amount=2.5 unlockAt=1795201147 (now+86400s) | none (not mined) |
| ATTACK above-limit spend executed before the 24 h timelock ends | reverted | TooEarly | [0x3c86129320...](https://explore.qore.network/tx/0x3c86129320e4473959c9c56ffb91a5a45f984174339ec2a18e2eb8241962d7e0) |
| T2 owner vetoes the queued spend (ML-DSA intent) | success | vetoed | [0x75f62d5baa...](https://explore.qore.network/tx/0x75f62d5baa3de685e0ca7815de57b3543d05fe80e0bc52340a98f7d203a00ba3) |
| D1 sender Pocket creates a Confirmed drop (0.3 QOR + 0.1 drip + 0.02 relayer fee) by intent | success | link created | [0x530ad4c2c7...](https://explore.qore.network/tx/0x530ad4c2c70839c6b89089f84a0ccd9aafacf47b4fe0c3d2b4beb21f0f6c7257) |
| ATTACK 1 mempool thief swaps recipient/payTo in a signed bind (v3 attack 1) | reverted | BadLinkSignature | [0x0993d60a0e...](https://explore.qore.network/tx/0x0993d60a0e7307a99d4458bbe42dc9375472f53c6dbc45e895b06debf46ba8ec) |
| D2 relayer binds R (recipient account R, payout Pocket PR). Drip lands in R, relayerFee reaches the relayer through the router sweep | success | bound | [0x68cdb61d49...](https://explore.qore.network/tx/0x68cdb61d497df21699ea5525935cfc21266fd1717a109255a09061cc6d8ac9ff) |
| newcomer R (fee paid from the drip, R started with 0 QOR) registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [2C6D2F5210FC...](https://explore.qore.network/tx/2C6D2F5210FCEA0B2352E5C4AD8CA5F3C3E5B5674D2A077E210705CB0A41043F) |
| ATTACK sender confirms a recipient key it never checked (RecipientChanged) | reverted | RecipientChanged | [0x2a420f1025...](https://explore.qore.network/tx/0x2a420f10257dbd504b7738078dd1b0bc1485f64ef4e5af3e3059385b33197fea) |
| D3 sender confirms the recipient key fingerprint in ONE intent (no second device) | success | confirmed | [0x7fd15d73e9...](https://explore.qore.network/tx/0x7fd15d73e9d1d73349171a9cf7cb34e98611bf1638ba5ba188756cf7540d215d) |
| ATTACK 5 a second person (B, own proven key) claims the Confirmed link | reverted | BadRecipientSignature | [0xf460bc70fc...](https://explore.qore.network/tx/0xf460bc70fc77f842d42bc55c091d53918a0739a02bff3f33b2a39970276c582c) |
| ATTACK 2 claim signed by a key other than the registered one | reverted | BadRecipientSignature | [0x7cbd15e728...](https://explore.qore.network/tx/0x7cbd15e728f275e8334ceff9cc2dff81ca5a202fa6ff007ab90eb5b6409ffa0b) |
| ATTACK 6 sender cancels after confirming (v3 attack 6) | reverted | InvalidState | [0xf4fd1cdecb...](https://explore.qore.network/tx/0xf4fd1cdecb1b07bf522f85e9b9daa1f2c2c7cbd5e6cca73361df11590dccc2ef) |
| D4 relayer claims with the recipient signature: 0.3 QOR lands in the recipient POCKET | success | amount paid to the Pocket | [0x71ad48ac39...](https://explore.qore.network/tx/0x71ad48ac391881c31cafac0d138534f0b893cb24620c81ff0ea11eba7d44390c) |
| check: recipient Pocket got the money while still undeployed | info | 0xbf8b575AF6D7124a173A0157eaC24Fc159867241 balance 0.3 QOR, code none, link state Claimed | none (not mined) |
| D5 claim of an already claimed link | reverted | InvalidState | [0x49f8f8c067...](https://explore.qore.network/tx/0x49f8f8c067020ebd668ff42c24077411a5ea4374c8a01cb6f5d5b347bc177d5f) |
| D6 recipient first action: lazy-deploys its own Pocket through the router and spends 0.05 QOR from it | success | Pocket deployed, spend ok | [0x80347ea213...](https://explore.qore.network/tx/0x80347ea213a518b1a6b2e5784f26f7b7879c4e8f9d0a2a1e28b54ca0f8feb58e) |
| A3a create Open link (0.1 QOR, expiry +240 s) | success | link created | [0x32d85b9dfb...](https://explore.qore.network/tx/0x32d85b9dfb26e32a8ac28479f66ac5ed711d9c0d2c1ab84c4f03d699e691c57f) |
| A3b bind to the main test wallet (legacy key, possessionProven=false) with payout Pocket PS | success | bound | [0x48447d5127...](https://explore.qore.network/tx/0x48447d5127e0d6439289c02386a0587f7fea38146bc2ec2f02a31ff97ae52015) |
| check: main wallet key status | info | registered=true possessionProven=false | none (not mined) |
| ATTACK 3 claim into an account whose key has possessionProven=false (v3 attack 3) | reverted | PossessionNotProven | [0x44e90f29b1...](https://explore.qore.network/tx/0x44e90f29b1b86375044cc23442a1ed585a4ecbd9e413c277401d11cb04aa7a92) |
| A4a create Open link (0.1 QOR, expiry +240 s) | success | link created | [0xb9abadd41c...](https://explore.qore.network/tx/0xb9abadd41c908545c535042ff9a9952a786e2d4c30ea3a355430e0a1d962f484) |
| A4b bind to an account that has no PQ key | success | bound | [0x800b6c1275...](https://explore.qore.network/tx/0x800b6c12754c3d149e5325fe2fb5c79de6d0300fe0c19cea418d2806c8b64377) |
| ATTACK 4 claim into an account with no PQ key (v3 attack 4) | reverted | NotRegistered | [0xf1d48e3d36...](https://explore.qore.network/tx/0xf1d48e3d36e3306e4f5c2bd492c41d0cc723f6e414fae03cebc22bbd8d0fdc66) |
| P1 sender Pocket hosts a Drop Pool (3 slots x 0.05 QOR) by intent | success | pool created | [0x48b13c9263...](https://explore.qore.network/tx/0x48b13c9263e9bef0576312c48f6afd74344a209d665ee92f98ef4f0df0adf198) |
| P2 claimer C1 claims slot 1 (distinct PoP account; link-key sig + own sig); 0.05 QOR into C1's counterfactual Pocket | success | slot paid | [0x964b149e96...](https://explore.qore.network/tx/0x964b149e967ebadfebb99388b0e3097295581e7c417705dd61258558b5b7d9a8) |
| P3 claimer C2 claims slot 2 | success | slot paid | [0x0467176a7b...](https://explore.qore.network/tx/0x0467176a7b12ecd64e9f160deb606ae92e6a563f704184065be556b2ec9ff6cf) |
| ATTACK pool slot claimed twice by one account (C1 again) | reverted | AlreadyClaimed | [0x97da22aaea...](https://explore.qore.network/tx/0x97da22aaea932139559f34349e25f607fad3b347f9a431b8376663b7343e68b6) |
| check: pool claimers are accounts, not people | info | taken=2 of 3; main wallet possessionProven=false cannot claim | none (not mined) |
| P4 host Pocket closes the pool: the unclaimed slot returns to the Pocket | success | refunded | [0x78ebb1a138...](https://explore.qore.network/tx/0x78ebb1a13890b45b73b09b6b3ea8c4e7c2a568b26de8edda4f4649a7dcd25a6a) |
| LEGACY RESCUE main test wallet (possessionProven=false) sends 0.05 QOR into a Pocket | success | Pocket 0xac6847B04117eAD2AcDb27676df5D373013Ae918 (qor1435y0vzpzl4d9txmyankmawnwvqn46gchcpmtd) balance +0.05 QOR; the Pocket's owner is PoP-proven, the sender is not | [8970B8EEEBE7...](https://explore.qore.network/tx/8970B8EEEBE7E2D250C89030197F8BD694CB5F47368955876AA2B0A8526C7E8D) |
| fund lab-owner 0.12 QOR (for its PQ registration fee) | success | funded | [0x3993e11a0d...](https://explore.qore.network/tx/0x3993e11a0df03b580e78d82ba3363a26dd9eef909b67500d5b783ecac3d7de14) |
| lab owner registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [DA53857855C1...](https://explore.qore.network/tx/DA53857855C11DC18C97D516F57521DF6FC44F0900F5C18E97E9339827A3F27B) |
| fund guardian-1 0.12 QOR (for its PQ registration fee) | success | funded | [0xec453b57a3...](https://explore.qore.network/tx/0xec453b57a3afeca94045d76d9c9d44129b2bdf28aee4b9705ab7e9d4c9bdd899) |
| guardian G1 registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [52DE232D109B...](https://explore.qore.network/tx/52DE232D109BD4CDC0D41A85400824205BC11E697217B5EAA3628A4C8355D752) |
| fund guardian-2 0.12 QOR (for its PQ registration fee) | success | funded | [0x9a222ba233...](https://explore.qore.network/tx/0x9a222ba233e793ed677c231ac9bd6b20887d77cdf159d92966733d3a356dc56e) |
| guardian G2 registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [FBC9E5D9796C...](https://explore.qore.network/tx/FBC9E5D9796CA84F24679DEE80ADA2CC6042F9B320A0F6F656754A12E5A393D6) |
| fund guardian-3 0.12 QOR (for its PQ registration fee) | success | funded | [0x5c3439c69b...](https://explore.qore.network/tx/0x5c3439c69b4af7230f4c0f25e3e733ffc140bb2984aa263877bfe5925fc50a0b) |
| guardian G3 registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [D9D7BF86204A...](https://explore.qore.network/tx/D9D7BF86204A4BA2FEE1A00839E5FF401A54BAC3DF9A62FA454A0A5C4E51981F) |
| fund new-owner-after-recovery 0.12 QOR (for its PQ registration fee) | success | funded | [0x6ea391fab5...](https://explore.qore.network/tx/0x6ea391fab5f1ebb1432fcbb11911ce19dbd2d8144d6afcfcb2c9e6b2161d121f) |
| new owner N registers its ML-DSA-87 key with proof of possession | success | possessionProven=true | [91DB0C3C727B...](https://explore.qore.network/tx/91DB0C3C727B511470BC25084950419A79B319BC0FBE3E263CB82B8E86CE0020) |
| LAB: fund the counterfactual lab Pocket 1.2 QOR before deploy | success | 0x92f9D19ACb4Fe29a30c50bf8Dff17a2a9f716f8a | [0xfc3f446014...](https://explore.qore.network/tx/0xfc3f446014070457f97f82fcf0597106ea8b5745132e268293470e764a4211b0) |
| LAB: deploy the lab Pocket (2-of-3 guardians, 0.2 QOR daily limit, 60 s timelock, 60 s recovery) via router, empty data | success | deployed | [0x374aba4a0c...](https://explore.qore.network/tx/0x374aba4a0c91f16f93409fe3e5a5a354afdecc674cc0520416c20da1f7dfd5b6) |
| check: lab delays | info | TIMELOCK=60s RECOVERY_DELAY=60s; prod TIMELOCK=86400s RECOVERY_DELAY=172800s | none (not mined) |
| TL1 lab: spend 0.5 QOR (> 0.2 limit) is queued with a 60 s timelock | success | queued id 1 | [0x7751717273...](https://explore.qore.network/tx/0x775171727370a8e46d6a3c9cb71cf2e6abf688ba5f63074f584dfef7639922d9) |
| ATTACK lab: execute the queued spend before the timelock ends | reverted | TooEarly | [0x46ba101f16...](https://explore.qore.network/tx/0x46ba101f167fa407e35d04d5f8e1a02d7927863f8bcd84505c38c2a9560c12aa) |
| TL2 lab: owner vetoes the queued spend | success | vetoed | [0x26a51dd5b2...](https://explore.qore.network/tx/0x26a51dd5b25733b9dcc48900de508627caf96d054d7dbd8dfc191f8a02df0733) |
| TL3 lab: another over-limit spend (0.3 QOR) is queued (id 2) | success | queued id 2 | [0xbba35c4a8c...](https://explore.qore.network/tx/0xbba35c4a8ce62523ee3bfca7702e8ef9b0f4a250386cc53fd6d496f67326635b) |
| TL4 lab: the vetoed spend can never execute, even after the timelock | reverted | NotQueued | [0x81a0797235...](https://explore.qore.network/tx/0x81a0797235084a90e0134529d6b35e74ef9c851d2f1f7a28a1da896ca661cc02) |
| TL5 lab: after the timelock the un-vetoed spend (id 2) executes | success | 0.3 QOR paid | [0x754f10f1d2...](https://explore.qore.network/tx/0x754f10f1d25fc9ad74340a2edb10f7be0dd01fe266ba81959932428a98ef15f7) |
| ATTACK recovery with only 1 of 3 guardians | reverted | NotEnoughSigners | [0x36278f828d...](https://explore.qore.network/tx/0x36278f828d3f0d4a7b94e0ce4c8bbcbe6fb8d2ad721cc3de13787cc35ea0d299) |
| RC1 recovery proposed by 2 of 3 guardians (G1 + G2 ML-DSA signatures), 60 s delay | success | pending | [0xcf369103fd...](https://explore.qore.network/tx/0xcf369103fd29bfa6f1f3bc6eab1e36b19a40d8fb3580e0d80c5ad0d20327cfa7) |
| RC2 the OLD owner key vetoes the recovery | success | recovery vetoed | [0x2c910049ad...](https://explore.qore.network/tx/0x2c910049adb9598cf2bcd05698d686101ccf5b3b4bf75b59c5de7fd985e3a11c) |
| ATTACK finalize a vetoed recovery | reverted | NoRecoveryPending | [0x24432581b2...](https://explore.qore.network/tx/0x24432581b2af11c0d0e02f14c6691ea5c99bded2515dba7f4c3ed3167ddbdf09) |
| ATTACK replay the vetoed proposal's guardian signatures | reverted | BadSignature | [0x3301bbc356...](https://explore.qore.network/tx/0x3301bbc3561557eb476fc67216f5be0174ee64fb966974d3198bf283eb4b94f8) |
| RC3 fresh recovery proposal (G2 + G3) | success | pending | [0x4a10f0b131...](https://explore.qore.network/tx/0x4a10f0b131ba3cbd78f1d9b7d1b973198e5fc7170cea84e6671fb621b693d08c) |
| ATTACK finalize before the recovery delay | reverted | TooEarly | [0x7eb0964a27...](https://explore.qore.network/tx/0x7eb0964a277563c3100562d151144cf74805a0df61e853af26b5e8d6dc9997fc) |
| RC4 finalize after the delay: owner is now N | success | owner replaced | [0xed066f5c17...](https://explore.qore.network/tx/0xed066f5c1728ac0d1373afdcd4be4c2a47e476d8c4f7f333b8d70a71cca08ad6) |
| ATTACK the OLD owner key spends after recovery | reverted | BadSignature | [0x625825586a...](https://explore.qore.network/tx/0x625825586a4bce3c0bf7458f38e34d19635d769e7133032ea01b2604cac27c7c) |
| RC5 the NEW owner spends from the recovered Pocket | success | new key works | [0x18a8e79be3...](https://explore.qore.network/tx/0x18a8e79be39adebbeb33bb31a3c245da9a5325a250eb212db190b68cdd533753) |
| G refund link 5 after expiry (anyone may; escrow returns to the sender Pocket) | success | refunded to Pocket | [0xc4f8dcb13b...](https://explore.qore.network/tx/0xc4f8dcb13b949a08a508fbe5803cedacab78fe2abe33d58c1a6f67a24f8ec4ef) |
| G refund link 6 after expiry (anyone may; escrow returns to the sender Pocket) | success | refunded to Pocket | [0x8aed4a2b1b...](https://explore.qore.network/tx/0x8aed4a2b1b3108742d009a6d413af85a2ba55528c0752cece3ab6ffeb83efc1e) |
| PQGUARD example dApp: PqGuardedCounter.bump(PocketA) accepts the Pocket owner's ML-DSA approval via ERC-1271 | success | counted | [0x7dcb11ad6a...](https://explore.qore.network/tx/0x7dcb11ad6a399682710bf10503754295cd326aa886a382586f6437fd48f94bb8) |
| ATTACK relayer sends a tx to an off-list target (PocketDrop v4 prod, exact chain text): refused at broadcast, never mined | refused | failed to broadcast transaction: the EVM authorisation window for qor17mn0ktfnhmesgd5zvk8zk60n5tuxzmxdc8ymnl does not admit this transaction: the window does not list 0xbc13b9EE91f31eD56932abDb796693515C351f00 as an allowed recipient: EVM authorisation window exhausted: EVM authorisation window exha | none (not mined) |

Summary: {
  "ranAt": "2026-11-19T19:04:50.682Z",
  "instances": {
    "prod": {
      "router": "0x8abf85b7491f50ab4aeae16582723200bc3bd46a",
      "drop": "0xbc13b9ee91f31ed56932abdb796693515c351f00",
      "pool": "0xaa981588e5430e3db9a789a3754e108cc01e3d00",
      "factory": "0x3ec6a625a8e7e00b89b8bbf95f5fc2ae8780331a"
    },
    "lab": {
      "router": "0x72ba4753375d4724e7ccbfdc9a330276ae90606e",
      "drop": "0x42da108a4e8bf5d152600b470f1abd28debdee59",
      "pool": "0x1858193617bc2f2e2570a137320e1a1cb3a7ce5b",
      "factory": "0xfc665d14165dc4f3320a70a569290bc4dcad4197"
    }
  },
  "relayerNetQor": "2.43216363875",
  "pockets": {
    "PS": "0xac6847B04117eAD2AcDb27676df5D373013Ae918",
    "PR": "0xbf8b575AF6D7124a173A0157eaC24Fc159867241",
    "PL": "0x92f9D19ACb4Fe29a30c50bf8Dff17a2a9f716f8a"
  },
  "balancesAfter": {
    "deployerQor": "6.1573773825",
    "relayerQor": "0.405780485"
  },
  "qorSentFromMainWalletForV4": {
    "total": 18,
    "note": "12 + 6 QOR sent from the main test wallet to the deployer; deploy gas, test-account funding, escrow round trips and gas are paid from it; part remains in the deployer, the relayer and the test Pockets (testnet QOR, no value)"
  }
}
