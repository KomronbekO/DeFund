'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseEther } from 'viem';
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { contractAddress, crowdfundingAbi } from '@/lib/contract';

export function PledgeForm({ campaignId }: { campaignId: number }) {
  const router = useRouter();
  const { isConnected } = useAccount();
  const [amount, setAmount] = useState('0.01');
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // After the tx is mined, give the backend indexer a beat to catch up
  // (it polls every 1s) and then re-fetch the SSR page so the pledged
  // total reflects the new pledge without a manual refresh.
  useEffect(() => {
    if (!isSuccess) return;
    const id = setTimeout(() => router.refresh(), 1500);
    return () => clearTimeout(id);
  }, [isSuccess, router]);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    let value: bigint;
    try {
      value = parseEther(amount);
    } catch {
      toast.error('Invalid amount');
      return;
    }
    if (value === 0n) {
      toast.error('Amount must be > 0');
      return;
    }
    writeContract({
      address: contractAddress,
      abi: crowdfundingAbi,
      functionName: 'pledge',
      args: [BigInt(campaignId)],
      value,
    });
  };

  if (!isConnected) {
    return <p className="text-sm text-gray-500">Connect a wallet to pledge.</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-medium">Pledge amount (ETH)</label>
      <div className="flex gap-2">
        <input
          type="number"
          step="0.001"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
        <button
          type="submit"
          disabled={isPending || confirming}
          className="shrink-0 whitespace-nowrap rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {isPending ? 'Confirm in wallet…' : confirming ? 'Confirming…' : 'Pledge'}
        </button>
      </div>
      {isSuccess && <p className="text-sm text-emerald-600">Pledged. Tx: {hash?.slice(0, 10)}…</p>}
      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
    </form>
  );
}
