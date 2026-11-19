# Real-phone measurements shown in the app (RECORDED)

Source: `spike/VERDICT.md` (2026-11-19), the earlier feasibility spike. Those runs used the spike page, not this app.
The on-chain steps measured are: register the PQ key (Cosmos tx), open the scoped window (Cosmos tx), claim (EVM tx).

| Device | Run | Steps total | Browser keygen |
|---|---|---|---|
| Android 10, Chrome 157 (real device) | 1 | 12,635 ms | 47 ms |
| Android 10, Chrome 157 (real device) | 2 | 10,965 ms | 48 ms |
| iPhone 16, iOS 18.0, Safari (BrowserStack; real device vs simulator unconfirmed) | 1 | 6,854 ms | 67 ms |

The old hard-coded "23.4s" was a Node measurement and has been removed from the UI.
