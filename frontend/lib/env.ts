export const env = {
  gatewayUrl: process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:4000',
  chainId: parseInt(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337', 10),
  contractAddress: (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as `0x${string}`,
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '',
};
