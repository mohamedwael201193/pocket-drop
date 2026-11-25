# Coverage (src/ only)

`FOUNDRY_PROFILE=coverage forge coverage --report summary --no-match-coverage "test/"` (solc 0.8.28, optimizer off so source maps are exact).
100% line, statement, branch and function coverage on every file in `src/`. v5 (25 Nov 2026, strict PqcLib): Tests: 165 unit, 21 fuzz, 18 invariant functions (190 Foundry tests; the 18 invariants run as 4 stateful suites). Added 23 Nov 2026 (tests only, `src/` unchanged so coverage is unchanged): `KeyStatusVectors.t.sol`, `Hardening.t.sol`, and two liveness invariants (every live link / pool unwinds after expiry). New: guardian freeze + unanimous recovery (19 unit, 4 fuzz, 5 invariants incl. "no spend or execute succeeds while frozen").
CI profile (`FOUNDRY_PROFILE=ci forge test`: fuzz 10,000 runs, invariants 256 runs x depth 50): 190 passed, 0 failed (26 Nov 2026, v5, including 5 Stage 3 audit regression tests).

| File                              | % Lines           | % Statements      | % Branches        | % Funcs         |
| src/DropPool.sol                  | 100.00% (56/56)   | 100.00% (91/91)   | 100.00% (20/20)   | 100.00% (8/8)   |
|-----------------------------------+-------------------+-------------------+-------------------+-----------------|
| src/Payout.sol                    | 100.00% (21/21)   | 100.00% (20/20)   | 100.00% (5/5)     | 100.00% (5/5)   |
|-----------------------------------+-------------------+-------------------+-------------------+-----------------|
| src/PocketDrop.sol                | 100.00% (130/130) | 100.00% (190/190) | 100.00% (38/38)   | 100.00% (16/16) |
|-----------------------------------+-------------------+-------------------+-------------------+-----------------|
| src/PocketFactory.sol             | 100.00% (19/19)   | 100.00% (21/21)   | 100.00% (2/2)     | 100.00% (4/4)   |
|-----------------------------------+-------------------+-------------------+-------------------+-----------------|
| src/PocketRouter.sol              | 100.00% (29/29)   | 100.00% (34/34)   | 100.00% (6/6)     | 100.00% (7/7)   |
|-----------------------------------+-------------------+-------------------+-------------------+-----------------|
| src/PocketVault.sol               | 100.00% (258/258) | 100.00% (324/324) | 100.00% (60/60)   | 100.00% (42/42) |
|-----------------------------------+-------------------+-------------------+-------------------+-----------------|
| src/PqGuard.sol                   | 100.00% (8/8)     | 100.00% (14/14)   | 100.00% (3/3)     | 100.00% (2/2)   |
|-----------------------------------+-------------------+-------------------+-------------------+-----------------|
| src/PqcLib.sol                    | 100.00% (70/70)   | 100.00% (112/112) | 100.00% (20/20)   | 100.00% (7/7)   |
|-----------------------------------+-------------------+-------------------+-------------------+-----------------|
| src/examples/PqGuardedCounter.sol | 100.00% (6/6)     | 100.00% (6/6)     | N/A (0/0)         | 100.00% (2/2)   |
|-----------------------------------+-------------------+-------------------+-------------------+-----------------|
| Total                             | 100.00% (597/597) | 100.00% (812/812) | 100.00% (154/154) | 100.00% (93/93) |
