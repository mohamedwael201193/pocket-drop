# Live results (QoreChain Diana testnet, EVM chain id 9800)

Main: `0x29f53b4b8031e7ba1785dc8c7a1c0be413a4bd97`  Lab (same bytecode, BIND_TIMEOUT 60 s): `0xce1912ed9d310f1973a88e7ff6aa56f6d76c9a67`
Every row is a mined EVM transaction. "reverted" rows are the lab attacks and negative checks: each was first decoded with eth_call, then mined with an explicit gas limit so the revert is on-chain.

| step | receipt status | outcome / custom error | tx |
|---|---|---|---|
| fund attacker B 0.6 QOR | success | funded | [0x6beca7ca92...](https://explore.qore.network/tx/0x6beca7ca925c980debfce154e3995b217785a2148097366cbc1c6942c4b3f20c) |
| attacker B registers PQ key (PoP) | success | possessionProven=true | [527E572EBEE9...](https://explore.qore.network/tx/527E572EBEE9DA30FDDA3417E32325603AF69BCC962EB003813EDFED6E3EB1C7) |
| attacker B opens EVM window | success | window opened | [DD0F7D991672...](https://explore.qore.network/tx/DD0F7D991672976A762657EF437626849EC94E086D2C3F10F5219D6EB39F64B1) |
| A1 create (Confirmed, 1 QOR, drip 0.2) | success | link created | [0x07d368c3b8...](https://explore.qore.network/tx/0x07d368c3b8c493326dd60bc2b557c57fc4dd18edcc1b8820474e781e41e4046c) |
| ATTACK 1 thief swaps recipient in bind | reverted | BadLinkSignature | [0xdbea1fe56b...](https://explore.qore.network/tx/0xdbea1fe56bc41b07900138570d975b3acee3e862fe398b06496dc3f52fbeed10) |
| A2: relayer binds recipient (drip lands) | success | ok | [0x1109eb4c68...](https://explore.qore.network/tx/0x1109eb4c68aa1efe0b06e442837560be867f3d7aa65b735a6afe45e18f32acfa) |
| A2: recipient registers ML-DSA-87 key with PoP (fee paid from drip) | success | possessionProven=true | [AAF516A51BBB...](https://explore.qore.network/tx/AAF516A51BBBB50F058C4931904AE2025AB884D7F6A244D727EE2B4B41DB3EEE) |
| A3 sender confirms (checked fingerprint of recipientKeyHash) | success | ok | [0x253f623659...](https://explore.qore.network/tx/0x253f623659d747381e22871b67b84d30009eb29bb124bdfe6c866507c0917cca) |
| ATTACK 6 sender cancels after confirm | reverted | InvalidState | [0x1c9a969192...](https://explore.qore.network/tx/0x1c9a9691920ba98f1cd52ecb7a38d1b114c64106a7c814149945c4f286b6f582) |
| ATTACK 5 second person (B, own proven key) claims the Confirmed link | reverted | BadRecipientSignature | [0x42bb1ca0f7...](https://explore.qore.network/tx/0x42bb1ca0f7c527de11b64e13dc7f516a4e8277eb9c557520a5f02cbc1e0c58aa) |
| A4 relayer claims with the recipient signature | success | amount paid | [0x3e52c32c1c...](https://explore.qore.network/tx/0x3e52c32c1cfd7548dd70ea117e1fd363a1d5f7d5bae99ad4f73eb64e5a58142a) |
| A5 second claim of a claimed link | reverted | InvalidState | [0x5af1e2fae1...](https://explore.qore.network/tx/0x5af1e2fae19f9537d88785af321ae00614ec1d47340c9c8959e6471a474f4d75) |
| B1 create (Open, 0.5 QOR, drip 0.2) | success | link created | [0x156e7efa32...](https://explore.qore.network/tx/0x156e7efa32a546ff00f36a92d884074da8db41a6b8737a07d94d51fe87b8ec42) |
| B2: relayer binds recipient (drip lands) | success | ok | [0x533ff1ece4...](https://explore.qore.network/tx/0x533ff1ece49b38b3a8a0155e7a805554f9dc39b2e955bc81744b30a9ea3aa964) |
| B2: recipient registers ML-DSA-87 key with PoP (fee paid from drip) | success | possessionProven=true | [05F78E03D933...](https://explore.qore.network/tx/05F78E03D933AD1FACE5162D2F03B9E21A91C7274CF818CC996F499C669F7EDF) |
| B3 relayer claims | success | amount paid | [0x730067b90e...](https://explore.qore.network/tx/0x730067b90eb45556ce36280bd4b02b0f33b0de2d7f0c180fb5069afa99e6796f) |
| C1 create (Open, 0.3 QOR, drip 0.2) | success | link created | [0x356d86a4fc...](https://explore.qore.network/tx/0x356d86a4fc2ace3a77a94a5ea7ca30e412f8bbaad02a943d7eca04ed1a5e3fe1) |
| C2: relayer binds recipient (drip lands) | success | ok | [0xc921cb27d8...](https://explore.qore.network/tx/0xc921cb27d8aae78917a179c04c48956f12a5844990fb8b0a268e6a23da56022e) |
| C2: recipient registers ML-DSA-87 key with PoP (fee paid from drip) | success | possessionProven=true | [C06D7D3F5D5A...](https://explore.qore.network/tx/C06D7D3F5D5A4108EDD7A2A291D8361CD0426001701FF677B8EA81F854A79F96) |
| ATTACK 2 claim signed by a key other than the registered one | reverted | BadRecipientSignature | [0x7fcc837d59...](https://explore.qore.network/tx/0x7fcc837d595e479bd2dae229f57eff9d44858230d7b2dedd9f61d9add3d64cf2) |
| C3 honest claim still works afterwards | success | amount paid | [0x69c9b80149...](https://explore.qore.network/tx/0x69c9b80149230a805d6988b43c326a6775d72dbf5730b3a73147370e3cdb79b2) |
| D1 create (Open, 0.2 QOR, expiry +100s) | success | link created | [0x6ab4f00f38...](https://explore.qore.network/tx/0x6ab4f00f38e1c93f9a5b6f923a68866dd3577be1486b809031888a0df11ff934) |
| D2 bind to main test wallet (legacy key, possessionProven=false) | success | ok | [0x5956253a49...](https://explore.qore.network/tx/0x5956253a493daf0415f8240ea835d943167b7b9458e35eb45955a9ebfdbbd743) |
| ATTACK 3 claim into an account whose key has possessionProven=false | reverted | PossessionNotProven | [0x168d02b9fa...](https://explore.qore.network/tx/0x168d02b9fa213fef2bcd2bcb179306de90476421ebe6223035daf086d9887ecc) |
| E1 create (Open, 0.2 QOR, expiry +100s) | success | link created | [0x3e01de18e9...](https://explore.qore.network/tx/0x3e01de18e99ff6c408b51a40528f95f0dd9ef6068de07c9eecdcb882b36d1dd3) |
| E2 bind to an account with no PQ key | success | ok | [0xd3bb48c7ed...](https://explore.qore.network/tx/0xd3bb48c7edda3bc69b124dbac6324c70a019d6d70331ad84eb04c6addaa04a9c) |
| ATTACK 4 claim into an account with no PQ key | reverted | NotRegistered | [0x7e3c9c2e4f...](https://explore.qore.network/tx/0x7e3c9c2e4fc56d6104b38526af3e62a64cbd38e8ec7a5de0ddf239b024f42d44) |
| F1 create (Open, 0.2 QOR, drip 0.1) | success | link created | [0x06b6e125f7...](https://explore.qore.network/tx/0x06b6e125f7f484a4412c848b3956eda74edf2e667365aab5fbc146389cd4f516) |
| F2 sender cancels (refund amount + unpaid drip) | success | refunded | [0x86a0868b60...](https://explore.qore.network/tx/0x86a0868b60322184e73569096066dbfa6a2c3862a509d7a6b18d0c400ef4308f) |
| F3 cancel again | reverted | InvalidState | [0xd967f73421...](https://explore.qore.network/tx/0xd967f734219f0bb0d85bdb89a29f8b8636bbfe6690aaaf3e6e8cb67edb14ca22) |
| G1 create (Open, 0.15 QOR, expiry +40s) | success | link created | [0x51b93493b5...](https://explore.qore.network/tx/0x51b93493b5dd9e8bc3d69283c96c580cb49ca746c30b647286121b4491c69eaf) |
| G2 refund before expiry | reverted | NotExpired | [0xeb2c68d51a...](https://explore.qore.network/tx/0xeb2c68d51a25ef5a94fd2d096c7d98d0e3358e7cef6f3377ee8ca41e7e9ce77f) |
| G3 refund link 4 after expiry, by the relayer | success | refunded to sender | [0x250563c828...](https://explore.qore.network/tx/0x250563c8289214c3ffeda69269e923d17542f56e4ca9c51c189aad7f1483dadf) |
| G3 refund link 5 after expiry, by the relayer | success | refunded to sender | [0xf38cf0fc90...](https://explore.qore.network/tx/0xf38cf0fc90c089f4122434a90655674ab5b1e741e1ea10ef62b1ab49787dde20) |
| G3 refund link 7 after expiry, by the relayer | success | refunded to sender | [0xc70edceb4d...](https://explore.qore.network/tx/0xc70edceb4d4e47d38f620fe347f31c51a1987e2ec7588b1e65b85b14830da409) |
| G4 claim after expiry/refund | reverted | InvalidState | [0x20ddfdca8d...](https://explore.qore.network/tx/0x20ddfdca8d0e6e58a50f51085b9573307cc52c16a0afc3a3df39437ef8bf1cef) |
| H1 create on lab (Open, 0.2 QOR, drip 0.2) | success | link created | [0xf59fdb6707...](https://explore.qore.network/tx/0xf59fdb6707c131b471a9428d15ddb90001b9b659101e8f69c9a32333b88ee3ad) |
| H2 bind R1 | success | ok | [0x9e8b97b3d4...](https://explore.qore.network/tx/0x9e8b97b3d4893dc3f474cfe56e2e112e88976960dd2900e45162aa29bf956cc4) |
| H3 rebind before timeout is refused | reverted | InvalidState | [0xf854495d59...](https://explore.qore.network/tx/0xf854495d59fc0f92ae2eee594b39cbbc025da13da0b8f22b7f95e993a242b132) |
| H1 create on lab (Open, 0.2 QOR, drip 0.2) | success | link created | [0x8d8323f1bc...](https://explore.qore.network/tx/0x8d8323f1bc575fc9c28453013aec1c33e33046e1222808aff59be1971182bdc9) |
| H2 bind R1 | success | ok | [0x713d315a7c...](https://explore.qore.network/tx/0x713d315a7c75b93391e1a23e3724b677608cf529abfb2e4a8d459a548e94beaf) |
| H3 rebind before timeout is refused | reverted | InvalidState | [0x2875a7d4a6...](https://explore.qore.network/tx/0x2875a7d4a6ee7b9dd6e5ea7bf3221a1783496977890bf150f88027c0d6aeda44) |
| H4 rebind to R2 after timeout (no second drip) | success | rebound | [0xb0e5c11912...](https://explore.qore.network/tx/0xb0e5c11912d99cb124604a0a92aa6168854da02472eb31ed9ed08df03c96123d) |
| H5 deployer tops up R2 for its registration fee | success | funded | [0x9e4dbc9179...](https://explore.qore.network/tx/0x9e4dbc91798f8a5df555158aded6c9351c251e81b9f7c82ea91444abb2c2db4b) |
| H6 R2 registers PQ key (PoP) | success | ok | [9D3E454D8323...](https://explore.qore.network/tx/9D3E454D8323BAE7ABD84850AA6C63577FCD6B4444EEE54DC9202EC7C67FD1B3) |
| H7 old recipient R1 signature no longer claims | reverted | BadRecipientSignature | [0xc9c1a22fa2...](https://explore.qore.network/tx/0xc9c1a22fa230f615da1ab7a0b794cad2ed6c5897bcd6f98035cec8c719b3dce3) |
| H8 R2 claims | success | amount paid | [0xad0329ba28...](https://explore.qore.network/tx/0xad0329ba289c6aa682e16140197a68cf9c854ec35b84d956d859f20e574a44b8) |

Summary: {
  "ranAt": "2026-11-19T01:48:02.778Z",
  "contractsChecked": {
    "main": "0x29f53b4b8031e7ba1785dc8c7a1c0be413a4bd97",
    "lab": "0xce1912ed9d310f1973a88e7ff6aa56f6d76c9a67"
  },
  "deployerSpentQorIncludingEscrowRoundTrips": "0.74281946",
  "mainLinkCount": "7",
  "labLinkCount": "2",
  "mainContractBalanceQor": "0",
  "labContractBalanceQor": "0.2"
}

## Notes
- The first run was interrupted after H3 (process killed by the operator, not a contract fault); the rebind scenario (H1..H8, second block) was re-run alone with `ONLY=H`. Lab link 1 from the interrupted run stays bound to a recipient that never registered and holds 0.2 QOR; it expires after 1 h and `refund(1)` on the lab instance returns it to the deployer.
- Escrows on the main instance all ended terminal: contract balance 0.
- Receipts of reverted attack txs show `status: reverted`; the revert reason was decoded from an eth_call at the same state immediately before mining.
