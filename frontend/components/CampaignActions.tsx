'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { contractAddress, crowdfundingAbi } from '@/lib/contract';
import type { CampaignDto } from '@/lib/api';
import { formatWei } from '@/lib/format';

interface Props {
  campaign: CampaignDto;
}

// Mounted only when CampaignSidebar has confirmed (via chain time) that the
// campaign has ended.
export function CampaignActions({ campaign }: Props) {
  const router = useRouter();
  const { address } = useAccount();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const goalMet = BigInt(campaign.pledged) >= BigInt(campaign.goal);
  const isCreator = address && address.toLowerCase() === campaign.creator.toLowerCase();

  // Live refundable amount from the chain. Historical pledges in SQLite still
  // exist after a refund — the chain mapping is the only source of truth for
  // "what is currently owed back to me?".
  const { data: refundable, refetch: refetchRefundable } = useReadContract({
    address: contractAddress,
    abi: crowdfundingAbi,
    functionName: 'pledgesOf',
    args: address ? [BigInt(campaign.id), address] : undefined,
    query: { enabled: !!address && !goalMet },
  });

  // After a successful tx, give the indexer a beat, then refresh SSR + chain reads.
  useEffect(() => {
    if (!isSuccess) return;
    const id = setTimeout(() => {
      router.refresh();
      refetchRefundable();
    }, 1500);
    return () => clearTimeout(id);
  }, [isSuccess, router, refetchRefundable]);

  const handleClaim = (): void => {
    writeContract(
      {
        address: contractAddress,
        abi: crowdfundingAbi,
        functionName: 'claim',
        args: [BigInt(campaign.id)],
      },
      { onError: (e) => toast.error(e.message) },
    );
  };

  const handleRefund = (): void => {
    writeContract(
      {
        address: contractAddress,
        abi: crowdfundingAbi,
        functionName: 'refund',
        args: [BigInt(campaign.id)],
      },
      { onError: (e) => toast.error(e.message) },
    );
  };

  const refundableAmount = (refundable as bigint | undefined) ?? 0n;
  const canRefund = !goalMet && refundableAmount > 0n;
  const canClaim = goalMet && isCreator && !campaign.claimed;

  return (
    <div className="space-y-2">
      {canClaim && (
        <button
          onClick={handleClaim}
          disabled={isPending || confirming}
          className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {isPending || confirming ? 'Confirming…' : 'Claim funds'}
        </button>
      )}
      {canRefund && (
        <button
          onClick={handleRefund}
          disabled={isPending || confirming}
          className="w-full rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {isPending || confirming ? 'Confirming…' : `Refund ${formatWei(refundableAmount)}`}
        </button>
      )}
      {!canClaim && !canRefund && (
        <p className="text-xs text-gray-500">
          {!address
            ? 'Connect a wallet to see actions.'
            : goalMet
              ? campaign.claimed
                ? 'Funds were claimed by the creator.'
                : 'Awaiting creator to claim.'
              : 'No pledge to refund on this campaign.'}
        </p>
      )}
      {isSuccess && <p className="text-xs text-emerald-600">Done. Tx: {hash?.slice(0, 10)}…</p>}
    </div>
  );
}
