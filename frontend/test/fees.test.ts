import { describe, expect, it } from 'vitest';
import { parseEther } from 'viem';
// @ts-expect-error plain JS build script
import { build } from '../scripts/relay-costs.mjs';
import costs from '../src/data/relayCosts.json';
import { deliveryCostUqor, deliveryFeeWei, RELAY_COSTS } from '../src/lib/fees';

const uqorToWei = (u: number) => BigInt(u) * 10n ** 12n;

describe('relay costs', () => {
  it('the JSON is exactly what the recorded evidence says (re-run scripts/relay-costs.mjs after new evidence)', () => {
    expect(costs).toEqual(build());
  });
  it('every row has a hash and a range, and only the Q-Day attempt row is a refused tx', () => {
    for (const r of RELAY_COSTS) {
      expect(r.example).toMatch(/^[0-9A-F]{64}$/);
      expect(r.minUqor).toBeGreaterThan(0);
      expect(r.maxUqor).toBeGreaterThanOrEqual(r.minUqor);
      expect(r.exampleCode !== 0).toBe(r.id === 'qday');
    }
  });
});

describe('delivery fee', () => {
  it('covers the recorded relays of the link in each mode', () => {
    for (const m of ['Open', 'Confirmed'] as const) expect(deliveryFeeWei(m)).toBeGreaterThanOrEqual(uqorToWei(deliveryCostUqor(m)));
  });
  it('Open covers bind + claim, Confirmed also the confirm', () => {
    const c = (id: string) => RELAY_COSTS.find((r) => r.id === id)!.maxUqor;
    expect(deliveryCostUqor('Open')).toBe(c('bind') + c('claim'));
    expect(deliveryCostUqor('Confirmed')).toBe(c('bind') + c('confirm') + c('claim'));
  });
  it('is the recorded cost plus 15 %, rounded up to 0.01 QOR', () => {
    expect(deliveryFeeWei('Open')).toBe(parseEther('0.26'));
    expect(deliveryFeeWei('Confirmed')).toBe(parseEther('0.38'));
  });
});
