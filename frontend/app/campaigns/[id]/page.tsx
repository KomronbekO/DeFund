import { notFound } from 'next/navigation';
import { getCampaign } from '@/lib/api';
import { formatWei, shortAddr } from '@/lib/format';
import { parseMetadata } from '@/lib/metadata';
import { CampaignImage } from '@/components/CampaignImage';
import { CampaignSidebar } from '@/components/CampaignSidebar';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function CampaignDetail({ params }: PageProps) {
  const campaign = await getCampaign(params.id);
  if (!campaign) notFound();

  const meta = parseMetadata(campaign.metadataURI);
  const title = meta.title || `Campaign #${campaign.id}`;

  return (
    <article className="grid gap-8 md:grid-cols-3">
      <div className="md:col-span-2">
        <CampaignImage
          metadataURI={campaign.metadataURI}
          campaignId={campaign.id}
          className="mb-4 h-72 w-full rounded-xl"
        />
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-gray-500">
          Campaign #{campaign.id} · Created by {shortAddr(campaign.creator)}
        </p>

        {meta.description && (
          <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-gray-700 dark:text-gray-300">
            {meta.description}
          </p>
        )}

        <details className="mt-4 text-xs text-gray-500">
          <summary className="cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300">
            On-chain metadata URI
          </summary>
          <code className="mt-2 block break-all rounded bg-gray-100 p-2 font-mono dark:bg-gray-800">
            {campaign.metadataURI}
          </code>
        </details>

        {campaign.pledges && campaign.pledges.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Pledges</h2>
            <ul className="mt-2 divide-y divide-gray-200 dark:divide-gray-800">
              {campaign.pledges.map((p) => (
                <li key={p.txHash} className="flex justify-between py-2 text-sm">
                  <span>{shortAddr(p.backer)}</span>
                  <span>{formatWei(p.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <CampaignSidebar campaign={campaign} />
    </article>
  );
}
