'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseEther } from 'viem';
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import { contractAddress, crowdfundingAbi } from '@/lib/contract';
import { uploadImage } from '@/lib/api';
import { buildMetadataURI } from '@/lib/metadata';

export default function NewCampaignPage() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [goalEth, setGoalEth] = useState('1');
  const [durationHours, setDurationHours] = useState('72');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!isConnected) {
      toast.error('Connect a wallet first');
      return;
    }

    let imageUrl: string | undefined;
    if (file) {
      try {
        setUploading(true);
        imageUrl = await uploadImage(file);
      } catch (err) {
        toast.error(`Upload failed: ${(err as Error).message}`);
        setUploading(false);
        return;
      } finally {
        setUploading(false);
      }
    }

    // Always emit a JSON metadata envelope so title + description survive
    // even when an image is attached.
    const metadataURI = buildMetadataURI({
      title,
      description,
      ...(imageUrl ? { image: imageUrl } : {}),
    });

    const goalWei = parseEther(goalEth);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + parseInt(durationHours, 10) * 3600);

    writeContract({
      address: contractAddress,
      abi: crowdfundingAbi,
      functionName: 'createCampaign',
      args: [goalWei, deadline, metadataURI],
    });
  };

  if (isSuccess) {
    setTimeout(() => router.push('/'), 1500);
  }

  return (
    <section className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold">Create a campaign</h1>
      <p className="mt-1 text-sm text-gray-500">
        Set a funding goal and a deadline. Backers can pledge ETH until the deadline.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">Goal (ETH)</label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={goalEth}
              onChange={(e) => setGoalEth(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Duration (hours)</label>
            <input
              type="number"
              min="1"
              value={durationHours}
              onChange={(e) => setDurationHours(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium">Image (optional)</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={uploading || isPending || confirming}
          className="w-full rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {uploading
            ? 'Uploading image…'
            : isPending
              ? 'Confirm in wallet…'
              : confirming
                ? 'Confirming…'
                : 'Create campaign'}
        </button>

        {isSuccess && <p className="text-sm text-emerald-600">Campaign created. Redirecting…</p>}
        {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
      </form>
    </section>
  );
}
