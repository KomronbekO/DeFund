'use client';

import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import { injectedWallet } from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { hardhat, sepolia } from 'wagmi/chains';
import { env } from './env';

// Inject-only connectors. MetaMask, Brave, Rabby, Phantom etc. all expose
// window.ethereum, so injectedWallet covers the desktop browser case without
// any WalletConnect dependency. Using getDefaultConfig() here brings in the
// WalletConnect relay, which fails noisily without a real Cloud project ID.
// If you want mobile QR-code wallet support later, get a project ID from
// https://cloud.reown.com and re-introduce metaMaskWallet/walletConnectWallet.
const connectors = connectorsForWallets(
  [{ groupName: 'Browser wallet', wallets: [injectedWallet] }],
  { appName: 'DeFund', projectId: env.walletConnectProjectId || 'unused' },
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [hardhat, sepolia],
  transports: {
    [hardhat.id]: http('http://127.0.0.1:8545'),
    [sepolia.id]: http(),
  },
  ssr: true,
});
