/**
 * On-chain `metadataURI` is just a string. We use a small JSON envelope so a
 * campaign can carry title, description, and an optional image URL together,
 * regardless of whether the URI is `data:application/json,...`, an `ipfs://`
 * pin, or a plain `https://` URL pointing to a JSON file.
 *
 * Backward compatibility: older URIs that are themselves an image URL
 * (https://, ipfs://, data:image/...) are still recognised — we treat them
 * as image-only metadata with no title/description.
 */
export interface CampaignMetadata {
  title?: string;
  description?: string;
  image?: string;
  /** True when the URI on chain was an image URL with no JSON envelope. */
  imageOnly?: boolean;
}

const IMAGE_PROTOCOLS = ['http://', 'https://', 'ipfs://', 'data:image/'];

export function parseMetadata(uri: string): CampaignMetadata {
  if (!uri) return {};

  if (IMAGE_PROTOCOLS.some((p) => uri.startsWith(p)) && !uri.endsWith('.json')) {
    return { image: uri, imageOnly: true };
  }

  if (uri.startsWith('data:application/json')) {
    const comma = uri.indexOf(',');
    if (comma === -1) return {};
    const raw = decodeURIComponent(uri.slice(comma + 1));
    try {
      const parsed = JSON.parse(raw) as CampaignMetadata;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  // Fallback: assume it's a JSON file URL we can't (or shouldn't) fetch SSR.
  return {};
}

/** Build the JSON metadata URI written to chain by the create form. */
export function buildMetadataURI(meta: CampaignMetadata): string {
  return `data:application/json,${encodeURIComponent(JSON.stringify(meta))}`;
}
