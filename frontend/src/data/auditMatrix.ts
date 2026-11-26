/** One row per QCAI finding class across the five runs. Same content as docs/AUDIT.md section 0 (RECORDED). */
export const QCAI_RUNS = [
  { id: 'S1', code: 'v4', score: 82 },
  { id: 'S2', code: 'v4', score: 78 },
  { id: 'S3', code: 'v5', score: 85 },
  { id: 'S4', code: 'v5.1', score: 82 },
  { id: 'S5', code: 'v5.2', score: 78 },
] as const;

export interface AuditClass { cls: string; runs: string[]; status: string; code: { file: string; line: number }; test: string }
export const AUDIT_MATRIX: AuditClass[] = [
  { cls: 'Recovery finalize access control', runs: ['S1', 'S2', 'S3', 'S4', 'S5'], status: 'False positive; hardened in v5.2 (signed authorization)', code: { file: 'PocketVault.sol', line: 498 }, test: 'test_qcai52_f2_unanimous_path_never_accepts_the_old_owner' },
  { cls: 'Reentrancy in payouts', runs: ['S1', 'S2', 'S4', 'S5'], status: 'False positive; hardened in v5.2 (payout asserts the lock)', code: { file: 'Payout.sol', line: 59 }, test: 'test_qcai52_f1_pay_reverts_outside_lock_and_receiver_cannot_reenter_the_locked_path' },
  { cls: 'Daily drip overflow', runs: ['S1', 'S2', 'S3', 'S4', 'S5'], status: 'False positive (checked math); headroom check explicit', code: { file: 'PocketDrop.sol', line: 384 }, test: 'test_qcai51_m2_cap_is_exact_and_drip_is_bounded' },
  { cls: 'Guardian loop gas', runs: ['S1', 'S2', 'S3', 'S4', 'S5'], status: 'Not exploitable (at most 5 guardians, bounded)', code: { file: 'PocketVault.sol', line: 891 }, test: 'test_qcai52_f6_six_signers_revert_before_any_signature_work' },
  { cls: 'Guardian freeze race or front-run', runs: ['S3', 'S5'], status: 'False positive (signed, nonce-bound)', code: { file: 'PocketVault.sol', line: 633 }, test: 'test_qcai52_f5_attacker_who_knows_the_nonce_cannot_freeze' },
  { cls: 'Unchecked call results', runs: ['S5'], status: 'False positive (checked; refused payouts deferred)', code: { file: 'PocketVault.sol', line: 921 }, test: 'test_qcai52_f4_refused_payout_is_deferred_not_lost' },
  { cls: 'ERC-1271 / ERC-165 (info)', runs: ['S1', 'S2', 'S3', 'S4', 'S5'], status: 'Informational', code: { file: 'PocketVault.sol', line: 289 }, test: 'test_qcai52_f7_erc1271_accepts_only_the_owners_bound_approval' },
];
