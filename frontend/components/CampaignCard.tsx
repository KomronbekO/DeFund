import Link from 'next/link';
import type { CampaignDto } from '@/lib/api';
import { formatDeadline, formatWei, isExpired, progressPercent, shortAddr } from '@/lib/format';
import { parseMetadata } from '@/lib/metadata';
import { CampaignImage } from './CampaignImage';

export function CampaignCard({ campaign }: { campaign: CampaignDto }) {
  const pct = progressPercent(campaign.pledged, campaign.goal);
  const expired = isExpired(campaign.deadline);
  const meta = parseMetadata(campaign.metadataURI);
  const title = meta.title || `Campaign #${campaign.id}`;

  return (
    <Link
      href={`/campaigns/${campaign.id}`}
      className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
    >
      <CampaignImage
        metadataURI={campaign.metadataURI}
        campaignId={campaign.id}
        className="mb-3 h-40 w-full rounded-lg"
      />
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>by {shortAddr(campaign.creator)}</span>
        <span className={expired ? 'text-amber-600' : 'text-emerald-600'}>
          {expired ? 'Ended' : 'Active'}
        </span>
      </div>
      <h3 className="mt-1 truncate text-base font-semibold">{title}</h3>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-gray-500">
        <span>
          {formatWei(campaign.pledged)} / {formatWei(campaign.goal)}
        </span>
        <span>Ends {formatDeadline(campaign.deadline)}</span>
      </div>
    </Link>
  );
}
