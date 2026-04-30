'use client';

import { useState } from 'react';
import { ipfsToHttps } from '@/lib/api';
import { parseMetadata } from '@/lib/metadata';

interface Props {
  metadataURI: string;
  campaignId: number;
  className?: string;
}

export function CampaignImage({ metadataURI, campaignId, className = '' }: Props) {
  const [failed, setFailed] = useState(false);
  const meta = parseMetadata(metadataURI);
  const url = ipfsToHttps(meta.image);
  const isImageLike = !!url && (url.startsWith('http') || url.startsWith('data:image/'));
  const showImage = isImageLike && !failed;

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-800 dark:to-gray-900 ${className}`}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={meta.title ?? ''}
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-2xl font-bold tracking-wider text-gray-400 dark:text-gray-600">
          #{campaignId}
        </span>
      )}
    </div>
  );
}
