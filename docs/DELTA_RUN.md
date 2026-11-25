# Measured delta: claim by link vs. a direct transfer (TEAM-RUN)

RECORDED on Diana testnet on 26 Nov 2026 (01:41 to 01:44 Cairo time, UTC+2) against the deployed v5 contracts and the public API. Every account below is a team **test account**: a fresh key pair that started with 0 QOR and no registered key. These counts are accounts, not people, and none of them is counted as an external user (they are listed in `backend/config/own-accounts.json`).

## The question

A new person gets QOR on Diana. Can they spend it with a post-quantum signature, without first getting QOR from somewhere else?

- **Path A, Pocket Drop link.** The sender's Pocket creates a link for 0.1 QOR, plus a 0.1 QOR drip and a 0.26 QOR delivery fee. The fresh account opens the link, binds its ML-DSA-87 key, registers that key with proof of possession (paid from the drip), claims into its own Pocket and makes a first spend of 0.05 QOR signed with ML-DSA-87. The public relayer submits the EVM transactions.
- **Path B, control.** The same 0.1 QOR is sent straight to a fresh 0-QOR address with a hybrid-signed bank send. The account then tries to move 0.05 QOR in two ways: a normal EVM transfer and a classical-signed Cosmos send.

## Result

| | Path A (link) | Path B (direct transfer) |
|---|---|---|
| Fresh accounts | 5 | 5 |
| Made a first spend | **5 of 5** | **0 of 5** |
| Median time from opening the link to the first spend | 17 s | not reached |
| Why | The drip pays for the key registration; the relayer pays EVM gas and is repaid from the delivery fee | The chain refuses every spend: the account has no registered post-quantum key, so it cannot open an EVM window, and classical signatures are off |

## Path A transactions

| # | Test account | Pocket | Link create | Bind | Key registration (PoP) | Claim | First spend | Seconds |
|---|---|---|---|---|---|---|---|---|
| A1 | `0xbA9176…4a3a` | `0x9fF35c…482e` | [`EE9985C951…`](https://explore.qore.network/tx/EE9985C951EE4D4459BB05412FF2B20C016DF596E289168621689097F0310856) | [`BD9607A9E1…`](https://explore.qore.network/tx/BD9607A9E1E6E088F51CFACF8200F601DA5783C0A7B2D2A06B367BCC5E24E915) | [`00E7B45A41…`](https://explore.qore.network/tx/00E7B45A414011EAFD720F09D39A316B23A87619CD78811EE351490624B5D2C6) | [`8A734F26BD…`](https://explore.qore.network/tx/8A734F26BD4EAC2CDE6FF79C4508F15FD682FB460AF301C64C67DAED05AD6BA9) | [`E8B929D0C5…`](https://explore.qore.network/tx/E8B929D0C565AF970EAD9E3EB97DDE583BA8EA39B056D6788003EB5C4F2138F9) | 15 |
| A2 | `0x14789C…d438` | `0x650617…BF22` | [`A653A5093B…`](https://explore.qore.network/tx/A653A5093B87CF9245C3D34D6853DA18880879FDE892EC3A2878A06997C54E5D) | [`1B2CE8E6B7…`](https://explore.qore.network/tx/1B2CE8E6B774B780AD63CAF29B7559D5A92FB77743DD409B00155625827E4624) | [`65F71034A4…`](https://explore.qore.network/tx/65F71034A4903714C21C109A77F2DC10C8B7C215E82F73E2B423ECABAC768627) | [`1E8EBF004D…`](https://explore.qore.network/tx/1E8EBF004D986C02FAF0F98738F8263749AF0CDB7870D2AE39226B9B38D813D8) | [`2A4596811C…`](https://explore.qore.network/tx/2A4596811CF5788B21B67AD566CC7298F388CB00590F3D6588E55972B1DA5634) | 18 |
| A3 | `0xE5877A…1D78` | `0xb59520…b58a` | [`C4F191F6A3…`](https://explore.qore.network/tx/C4F191F6A3F532F51F723C2C5CC6567D68C6A6102CFBB95027DA9C4DEEECD979) | [`6AD41DCF9F…`](https://explore.qore.network/tx/6AD41DCF9F1E8478B80D230E7549D3F4DAB554825224293C47F861CBD0A7F451) | [`ED24646F71…`](https://explore.qore.network/tx/ED24646F715E50B9DCA4510240F83D14B17CF8359882434C61919D6315F6094D) | [`EF25913EB0…`](https://explore.qore.network/tx/EF25913EB0D75769FF0205FFE6D3F6960B010D324BD8CF93FBDB24D53769C951) | [`415D3F9E8F…`](https://explore.qore.network/tx/415D3F9E8FD4653AA150C3227DE71ADE1F09D6E15EEA319190FF588757940F25) | 15 |
| A4 | `0xC76B1c…F2d0` | `0xEB95a3…7dED` | [`47843CD1CF…`](https://explore.qore.network/tx/47843CD1CF289E0B962E70746E8B0937CF4699F43CC0C74E3142341431D78C15) | [`8953260EF7…`](https://explore.qore.network/tx/8953260EF7B670AD4B66E1A74EBC40B7B0075938190128D3E0F89A0C55A3F9A0) | [`976F8C9828…`](https://explore.qore.network/tx/976F8C98284DD4680974CA101F3B051A45F2DD16B5BCC13DDBF32D3163871504) | [`1B0D9FC3BB…`](https://explore.qore.network/tx/1B0D9FC3BB86C9B7E1A8ECE5760F0A8BCF0864F4DEDC257990E8F7B38A17F5F6) | [`17B0963B16…`](https://explore.qore.network/tx/17B0963B1699CB31A2A44F562A5EE1F34B300F46D9822467E0235F763DF65017) | 17 |
| A5 | `0x79324B…92A0` | `0xf7415B…54D8` | [`DD491D7966…`](https://explore.qore.network/tx/DD491D79661FECB6FF3C37A3A05BDA0DAC4E646B4AB579D9207CFFDDDA021539) | [`73C5D77876…`](https://explore.qore.network/tx/73C5D778760F7DE099FCC9000740D97B69B5BFF1E15DA563F301B80FBDFDB209) | [`704FA0FCF0…`](https://explore.qore.network/tx/704FA0FCF0B2713904F8EDEEEE60EF02351C8B371FAED4628291156562BD1B55) | [`E8536F8658…`](https://explore.qore.network/tx/E8536F86589C6E64453D27C91211DEFBA5AC8AA8252612913F1FE45A2DBCC00C) | [`0E26E6D251…`](https://explore.qore.network/tx/0E26E6D251B611D447131D14F5AADAFA4BAA20176640F6F33AFE91E10AA2C5D2) | 18 |

The sender Pocket `0x02eD40…bDC1` was funded once with a hybrid-signed send, [`275F36C2BE…`](https://explore.qore.network/tx/275F36C2BE25A3FBE6B8FA7932D9917C21B3B07741A15A432D9C6DE80CB1B82C). The seconds column runs from the bind (the moment the recipient opens the link) to the spend receipt; it does not include the sender's link creation.

## Path B transactions and refusals

| # | Test account | Direct transfer | EVM transfer | Cosmos send (classical) | Balance after |
|---|---|---|---|---|---|
| B1 | `0xF55e9f…4B21` | [`06D1D07932…`](https://explore.qore.network/tx/06D1D079323B6C42A59E770A9CAF45A92752F3D6F793E4EC6E70B25941590880) | refused | refused | 0.1 QOR |
| B2 | `0xBD6cc7…c493` | [`C159EF00C9…`](https://explore.qore.network/tx/C159EF00C9846BD12027BC2E7A7F964C82A06D1E71CF180ED795AABEBB0FF101) | refused | refused | 0.1 QOR |
| B3 | `0x9F88dD…5920` | [`0607514AB6…`](https://explore.qore.network/tx/0607514AB62F3F5FF9D4325DD197980C58D685C567AB7BD7561291129C8CDAA6) | refused | refused | 0.1 QOR |
| B4 | `0x71B815…1D7e` | [`1781D8E405…`](https://explore.qore.network/tx/1781D8E4052853DAF3075A29592CD3D0A5DA41E1C6F1069D8704E270771497B1) | refused | refused | 0.1 QOR |
| B5 | `0xc30D36…7886` | [`75C5B0368E…`](https://explore.qore.network/tx/75C5B0368ED4AA6A12BDE670810BEFCC1380079A5BC61252806C806CB8E3E9A5) | refused | refused | 0.1 QOR |

During the run our client library only kept the generic text "Missing or invalid parameters." for the EVM transfer, so a few minutes later each account sent the same transfer again as a raw transaction to keep the node's own message (recorded as "EVM transfer (raw re-check)"). The node's refusal (same for all five, the address differs): _failed to broadcast transaction: account qor1740flhk5skxef4ce44sw7np6zykryjepxfqvce has no usable registered post-quantum key; the EVM lane requires one, like every other lane: no open EVM authorisation window: no open EVM authorisation window_

The refusal for the classical Cosmos send: _Broadcasting transaction failed with code 8 (codespace: pqc). Log: account has no PQC key and classical fallback is disabled: classical fallback not allowed_

Refused transactions never reach a block, so they have no hash. The proof is that each account still holds the full amount and still has no registered key; `scripts/delta-verify.mjs` checks both live.

## Check it or run it again

```bash
# read-only re-check of this run, no keys needed (Node 20+)
node scripts/delta-verify.mjs

# run it again with your own funded testnet wallet (about 2.9 QOR for N=5)
cd contracts-v4 && npm ci && forge build && cd ..
QORE_ENV_FILE=<file with seed=...> QORE_SECRET_FILE=<scratch json> node scripts/delta-run.mjs --n 5
```

The run writes `frontend/evidence/v4/e2e/delta-run-<date>.json`. The sender Pocket owner needs an ML-DSA-87 key registered with proof of possession. Our run used a team deployer key for that and the main test wallet as the funder.

## Limits

- Five accounts from one team, created by a script. This shows what the chain allows; it says nothing about how people behave.
- Path A needs a sender who pays the drip and delivery fee (0.36 QOR per link here) and a working relayer. If the relayer is down, the recipient needs QOR of their own (see Relay it yourself).
- Testnet only.
