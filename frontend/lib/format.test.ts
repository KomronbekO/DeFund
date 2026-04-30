import { describe, it, expect } from 'vitest';
import { formatWei, formatDeadline, progressPercent, shortAddr, isExpired } from './format';

describe('formatWei', () => {
  it('formats 1 ETH', () => {
    expect(formatWei('1000000000000000000')).toBe('1 ETH');
  });
  it('formats fractional ETH', () => {
    expect(formatWei('500000000000000000')).toBe('0.5 ETH');
  });
  it('accepts a bigint', () => {
    expect(formatWei(2_000_000_000_000_000_000n)).toBe('2 ETH');
  });
});

describe('progressPercent', () => {
  it('returns 0 when goal is 0', () => {
    expect(progressPercent('0', '0')).toBe(0);
  });
  it('returns 50 at half-funded', () => {
    expect(progressPercent('5', '10')).toBe(50);
  });
  it('caps at 100 when over-funded', () => {
    expect(progressPercent('200', '100')).toBe(100);
  });
});

describe('shortAddr', () => {
  it('shortens long addresses', () => {
    expect(shortAddr('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
  });
  it('passes short input through', () => {
    expect(shortAddr('0xabc')).toBe('0xabc');
  });
});

describe('formatDeadline', () => {
  it('formats consistently regardless of host locale', () => {
    // 2026-04-29 14:55:03 UTC
    const ts = 1777474503;
    expect(formatDeadline(ts)).toBe('29 Apr 2026, 14:55 UTC');
  });

  it('zero-pads day', () => {
    // 2026-01-02 00:00:00 UTC
    const ts = 1767312000;
    expect(formatDeadline(ts)).toMatch(/^02 Jan 2026/);
  });
});

describe('isExpired', () => {
  it('returns true for past timestamps', () => {
    expect(isExpired(0)).toBe(true);
  });
  it('returns false for future timestamps', () => {
    expect(isExpired(Math.floor(Date.now() / 1000) + 3600)).toBe(false);
  });
});
