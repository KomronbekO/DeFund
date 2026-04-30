'use client';

import { useBlock } from 'wagmi';
import type { CampaignDto } from '@/lib/api';
import { formatDeadline, formatWei, progressPercent } from '@/lib/format';
import { PledgeForm } from './PledgeForm';
import { CampaignActions } from './CampaignActions';

interface Props {
  campaign: CampaignDto;
}

/**
 * The "expired" gate has to handle two demo edge cases:
 *  - Hardhat fast-forwarded ahead of real time (`evm_increaseTime`) → chain
 *    is past the deadline, but the user's wall clock isn't.
 *  - Hardhat sitting idle → chain time is frozen at the last mined block,
 *    so real time may be past the deadline while chain time isn't.
 * Taking the max of both is correct in either direction: if EITHER clock
 * says expired, the next mined block will too — so the contract would
 * revert a pledge anyway.
 */
export function CampaignSidebar({ campaign }: Props) {
  const { data: latestBlock } = useBlock({ watch: true });
  const realNow = Math.floor(Date.now() / 1000);
  const chainNow = latestBlock ? Number(latestBlock.timestamp) : realNow;
  const effectiveNow = Math.max(realNow, chainNow);
  const expired = effectiveNow >= campaign.deadline;
  const pct = progressPercent(campaign.pledged, campaign.goal);

  return (
    <aside className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div>
        <p className="text-sm text-gray-500">Pledged</p>
        <p className="text-xl font-semibold">{formatWei(campaign.pledged)}</p>
        <p className="mt-0.5 text-xs text-gray-500">of {formatWei(campaign.goal)}</p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div>
        <p className="text-xs text-gray-500">Deadline</p>
        <p className="text-sm">{formatDeadline(campaign.deadline)}</p>
        <p className="mt-0.5 text-xs">
          <span className={expired ? 'text-amber-600' : 'text-emerald-600'}>
            {expired ? 'Ended' : 'Active'}
          </span>
          {campaign.claimed && <span className="ml-2 text-emerald-600">Claimed</span>}
        </p>
      </div>

      {!expired ? <PledgeForm campaignId={campaign.id} /> : <CampaignActions campaign={campaign} />}
    </aside>
  );
}
