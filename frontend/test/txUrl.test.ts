import { describe, expect, it } from 'vitest';
import { txUrl, isEvmHash } from '../src/lib/config';
import { explorerTx } from '../src/landing/links';

const EVM = '0xe83979b1c34beac28df888c20bb732b9f58b897d448c46d0dd091f318bf439a9';
const COSMOS = 'D509C6017E5D05405F5DE55295A15F3DA59A6E598317C5743305A6858CCC1A37';

describe('tx links', () => {
  it('opens Cosmos hashes in the explorer', () => {
    expect(txUrl(COSMOS)).toBe(`https://explore.qore.network/tx/${COSMOS}`);
    expect(explorerTx(COSMOS)).toBe(`https://explore.qore.network/tx/${COSMOS}`);
  });
  it('opens EVM hashes on the /check page, because the explorer does not index them', () => {
    expect(isEvmHash(EVM)).toBe(true);
    expect(isEvmHash(COSMOS)).toBe(false);
    expect(txUrl(EVM)).toBe(`/check/${EVM}`);
    expect(explorerTx(EVM)).toBe(`/check/${EVM}`);
  });
});
