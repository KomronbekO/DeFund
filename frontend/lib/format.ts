import { formatEther } from 'viem';

export function formatWei(wei: string | bigint): string {
  return `${formatEther(BigInt(wei))} ETH`;
}

// Deterministic format so SSR (Node) and CSR (browser) agree — `toLocaleString()`
// without an explicit locale falls back to the runtime default, which differs
// between server (en-US) and client (browser locale), causing hydration mismatches.
const DEADLINE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

export function formatDeadline(deadline: number): string {
  return DEADLINE_FORMAT.format(new Date(deadline * 1000)) + ' UTC';
}

export function progressPercent(pledged: string | bigint, goal: string | bigint): number {
  const p = BigInt(pledged);
  const g = BigInt(goal);
  if (g === 0n) return 0;
  const pct = Number((p * 10000n) / g) / 100;
  return Math.min(pct, 100);
}

export function isExpired(deadline: number): boolean {
  return Date.now() / 1000 > deadline;
}

export function shortAddr(addr: string): string {
  return addr.length < 10 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
