import { env } from './env';

export const crowdfundingAbi = [
  {
    type: 'function',
    name: 'campaignCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'createCampaign',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'goal', type: 'uint128' },
      { name: 'deadline', type: 'uint64' },
      { name: 'metadataURI', type: 'string' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'pledge',
    stateMutability: 'payable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'refund',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getCampaign',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'creator', type: 'address' },
          { name: 'goal', type: 'uint128' },
          { name: 'pledged', type: 'uint128' },
          { name: 'deadline', type: 'uint64' },
          { name: 'claimed', type: 'bool' },
          { name: 'metadataURI', type: 'string' },
        ],
      },
    ],
  },
  {
    // Auto-generated getter for `mapping(uint256 => mapping(address => uint256)) public pledgesOf`
    type: 'function',
    name: 'pledgesOf',
    stateMutability: 'view',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'backer', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'CampaignCreated',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'goal', type: 'uint128', indexed: false },
      { name: 'deadline', type: 'uint64', indexed: false },
      { name: 'metadataURI', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Pledged',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'backer', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'newTotal', type: 'uint128', indexed: false },
    ],
  },
] as const;

export const contractAddress = env.contractAddress;
