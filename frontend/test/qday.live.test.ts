// LIVE (Diana testnet, eth_call only): every browser attack path against every bait must revert.
// Keys come from QDAY_BAIT_KEYS ({"B1":"0x…"}) or from the public /api/qday when publishing is on; otherwise skipped.
import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { QDAY, tryBait } from '../src/lib/qday';

async function keys(): Promise<Record<string, Hex>> {
  if (process.env.QDAY_BAIT_KEYS) return JSON.parse(process.env.QDAY_BAIT_KEYS);
  try {
    const j = await (await fetch('https://pocket-drop-api.vercel.app/api/qday')).json();
    return Object.fromEntries((j.baits ?? []).filter((b: { classicalKey: string | null }) => b.classicalKey).map((b: { id: string; classicalKey: Hex }) => [b.id, b.classicalKey]));
  } catch { return {}; }
}

describe('Q-Day browser attacks (live)', async () => {
  const k = await keys();
  for (const b of QDAY.baits) {
    it.skipIf(!k[b.id])(`${b.id}: every classical-key path is refused`, async () => {
      const rows = await tryBait(b.id, k[b.id]);
      expect(rows.length).toBeGreaterThanOrEqual(5);
      expect(rows.filter((r) => r.outcome !== 'refused')).toEqual([]);
    }, 120_000);
  }
  it('rejects a key that does not belong to the bait', async () => {
    await expect(tryBait('B1', ('0x' + '11'.repeat(32)) as Hex)).rejects.toThrow(/not B1/);
  });
});
