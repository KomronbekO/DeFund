import Link from 'next/link';
import { listCampaigns } from '@/lib/api';
import { CampaignCard } from '@/components/CampaignCard';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let campaigns: Awaited<ReturnType<typeof listCampaigns>> = [];
  let loadError: string | null = null;

  try {
    campaigns = await listCampaigns();
  } catch (err) {
    loadError = (err as Error).message;
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Active campaigns</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pledge ETH on a campaign before its deadline. Funds release if the goal is met.
        </p>
      </div>

      {loadError && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950">
          Could not load campaigns from the API gateway: {loadError}. Is the backend running?
        </div>
      )}

      {!loadError && campaigns.length === 0 && (
        <div className="rounded-md border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          No campaigns yet.{' '}
          <Link href="/campaigns/new" className="font-medium text-brand hover:underline">
            Be the first to create one
          </Link>
          .
        </div>
      )}

      {campaigns.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => (
            <CampaignCard key={c.id} campaign={c} />
          ))}
        </div>
      )}
    </section>
  );
}
