import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config';
import { pinFile } from './pinata';

export const LOCAL_UPLOADS_DIR = path.resolve(__dirname, '..', '..', 'uploads');

/**
 * Persist an uploaded image and return a URL the frontend can render.
 * Production path: Pinata IPFS pin → ipfs:// URI.
 * Local-dev fallback: write to disk under `backend/uploads/`, return a
 * URL through the gateway (`/files/<id>`). Same shape as an IPFS gateway
 * URL — the contract just stores a string either way.
 */
export async function storeImage(
  filename: string,
  mimeType: string,
  data: Buffer,
): Promise<string> {
  if (config.pinataJwt) {
    return pinFile(filename, mimeType, data);
  }

  await fs.mkdir(LOCAL_UPLOADS_DIR, { recursive: true });
  const ext = path.extname(filename) || extFromMime(mimeType);
  const id = crypto.randomUUID() + ext;
  await fs.writeFile(path.join(LOCAL_UPLOADS_DIR, id), data);
  return `${config.publicBaseUrl}/files/${id}`;
}

function extFromMime(mt: string): string {
  switch (mt) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    default:
      return '.bin';
  }
}
