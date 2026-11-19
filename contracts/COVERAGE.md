# Coverage

Command: `forge coverage --report summary --no-match-coverage "(test|script|lib)/"` (nothing in `src/` is excluded).

```
| File               | % Lines           | % Statements      | % Branches      | % Funcs         |
+================================================================================================+
| src/PocketDrop.sol | 100.00% (159/159) | 100.00% (221/221) | 100.00% (48/48) | 100.00% (24/24) |
| src/PqcLib.sol     | 100.00% (35/35)   | 100.00% (61/61)   | 100.00% (6/6)   | 100.00% (2/2)   |
| Total              | 100.00% (194/194) | 100.00% (282/282) | 100.00% (54/54) | 100.00% (26/26) |
```

CI profile (`FOUNDRY_PROFILE=ci forge test`: fuzz runs 10,000, invariant runs 256 x depth 50): 117 tests, all pass.

Note: the inline-assembly blocks in `PqcLib` are not branch-instrumented by forge; every Solidity guard around them
(call failure, short data, bad flags, bad offset, bad length, cap) is exercised in `test/PqcLib.t.sol`.
