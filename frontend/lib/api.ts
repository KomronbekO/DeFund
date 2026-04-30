import { env } from './env';

export interface CampaignDto {
  id: number;
  creator: string;
  goal: string;
  pledged: string;
  deadline: number;
  claimed: boolean;
  metadataURI: string;
  pledges?: PledgeDto[];
}

export interface PledgeDto {
  id: number;
  backer: string;
  amount: string;
  txHash: string;
  blockNumber: number;
  createdAt: string;
}

// Always hit the gateway on each SSR pass — the gateway is local, the request
// is cheap, and any read-cache here just delays seeing on-chain state changes.
const noCache: RequestInit = { cache: 'no-store' };

export async function listCampaigns(): Promise<CampaignDto[]> {
  const res = await fetch(`${env.gatewayUrl}/campaigns`, noCache);
  if (!res.ok) throw new Error(`failed to load campaigns: ${res.status}`);
  const body = (await res.json()) as { campaigns: CampaignDto[] };
  return body.campaigns;
}

export async function getCampaign(id: string | number): Promise<CampaignDto | null> {
  const res = await fetch(`${env.gatewayUrl}/campaigns/${id}`, noCache);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`failed to load campaign: ${res.status}`);
  const body = (await res.json()) as { campaign: CampaignDto };
  return body.campaign;
}

export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${env.gatewayUrl}/uploads`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `upload failed: ${res.status}`);
  }
  const body = (await res.json()) as { uri: string };
  return body.uri;
}

export function ipfsToHttps(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  if (uri.startsWith('ipfs://')) return `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}`;
  return uri;
}
