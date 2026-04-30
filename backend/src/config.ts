import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';

export interface DeploymentInfo {
  network: string;
  address: string;
  deployBlock?: number;
  abi: unknown[];
}

export const config = {
  port: parseInt(process.env.PORT ?? '4001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  rpcUrl: process.env.CHAIN_RPC_URL ?? 'http://127.0.0.1:8545',
  network: process.env.CHAIN_NETWORK ?? 'localhost',
  contractAddress: process.env.CONTRACT_ADDRESS ?? '',
  deployBlock: parseInt(process.env.DEPLOY_BLOCK ?? '0', 10),
  pinataJwt: process.env.PINATA_JWT ?? '',
  // Public origin where uploaded files are reachable. In dev this is the
  // gateway, which proxies /files/* to the backend's static handler.
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:4000',
};

export async function loadDeployment(): Promise<DeploymentInfo | null> {
  const file = path.resolve(
    __dirname,
    '..',
    '..',
    'contracts',
    'deployments',
    `${config.network}.json`,
  );
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as DeploymentInfo;
  } catch {
    return null;
  }
}
