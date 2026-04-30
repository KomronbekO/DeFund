import { execSync } from 'child_process';
import path from 'path';
import { Indexer } from '../src/indexer/listener';
import { prisma } from '../src/db/prisma';

beforeAll(() => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'ignore',
    env: { ...process.env },
  });
});

beforeEach(async () => {
  await prisma.pledge.deleteMany();
  await prisma.campaign.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

interface FakeLog {
  args: Record<string, unknown>;
  fragment: { name: string };
  transactionHash: string;
  blockNumber: number;
}

function makeEvent(
  name: string,
  args: Record<string, unknown>,
  txHash = '0xtx',
  block = 1,
): FakeLog {
  return {
    args,
    fragment: { name },
    transactionHash: txHash,
    blockNumber: block,
  };
}

describe('Indexer.handleEvent', () => {
  const indexer = new Indexer('http://127.0.0.1:8545');

  it('upserts a campaign on CampaignCreated', async () => {
    const ev = makeEvent('CampaignCreated', {
      id: 0n,
      creator: '0xCreator',
      goal: 1_000_000n,
      deadline: 9_999_999n,
      metadataURI: 'ipfs://meta',
    });
    // @ts-expect-error — narrowing fake log to ethers shape for the unit test
    await indexer.handleEvent(ev);

    const c = await prisma.campaign.findUnique({ where: { id: 0 } });
    expect(c).not.toBeNull();
    expect(c?.creator).toBe('0xCreator');
    expect(c?.goal).toBe('1000000');
    expect(c?.deadline).toBe(9_999_999);
  });

  it('records a pledge and updates the campaign total', async () => {
    await prisma.campaign.create({
      data: {
        id: 0,
        creator: '0xC',
        goal: '100',
        deadline: 1,
        metadataURI: 'x',
      },
    });

    const ev = makeEvent(
      'Pledged',
      { id: 0n, backer: '0xBacker', amount: 25n, newTotal: 25n },
      '0xtxA',
      7,
    );
    // @ts-expect-error — narrowing fake log to ethers shape for the unit test
    await indexer.handleEvent(ev);

    const pledge = await prisma.pledge.findUnique({ where: { txHash: '0xtxA' } });
    expect(pledge?.amount).toBe('25');
    expect(pledge?.blockNumber).toBe(7);

    const c = await prisma.campaign.findUnique({ where: { id: 0 } });
    expect(c?.pledged).toBe('25');
  });

  it('marks a campaign claimed on Claimed', async () => {
    await prisma.campaign.create({
      data: {
        id: 0,
        creator: '0xC',
        goal: '100',
        deadline: 1,
        metadataURI: 'x',
      },
    });
    const ev = makeEvent('Claimed', { id: 0n, creator: '0xC', amount: 100n });
    // @ts-expect-error — narrowing fake log to ethers shape for the unit test
    await indexer.handleEvent(ev);

    const c = await prisma.campaign.findUnique({ where: { id: 0 } });
    expect(c?.claimed).toBe(true);
  });

  it('is idempotent on duplicate Pledged events', async () => {
    await prisma.campaign.create({
      data: { id: 0, creator: '0xC', goal: '100', deadline: 1, metadataURI: 'x' },
    });
    const ev = makeEvent('Pledged', { id: 0n, backer: '0xB', amount: 10n, newTotal: 10n }, '0xdup');
    // @ts-expect-error — narrowing fake log to ethers shape for the unit test
    await indexer.handleEvent(ev);
    // @ts-expect-error — narrowing fake log to ethers shape for the unit test
    await indexer.handleEvent(ev);

    const count = await prisma.pledge.count({ where: { txHash: '0xdup' } });
    expect(count).toBe(1);
  });
});
