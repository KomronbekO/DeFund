import { config } from '../config';

interface PinataResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

export class PinataNotConfiguredError extends Error {
  constructor() {
    super('PINATA_JWT not set; uploads disabled');
    this.name = 'PinataNotConfiguredError';
  }
}

/** Pin a file buffer to IPFS via Pinata. Returns the resulting ipfs:// URI. */
export async function pinFile(filename: string, mimeType: string, data: Buffer): Promise<string> {
  if (!config.pinataJwt) throw new PinataNotConfiguredError();

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(data)], { type: mimeType }), filename);

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.pinataJwt}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinata upload failed (${res.status}): ${text}`);
  }

  const body = (await res.json()) as PinataResponse;
  return `ipfs://${body.IpfsHash}`;
}
