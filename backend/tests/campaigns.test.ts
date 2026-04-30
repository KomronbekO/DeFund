import { execSync } from 'child_process';
import path from 'path';
import request from 'supertest';
import { prisma } from '../src/db/prisma';
import { createApp } from '../src/app';

const app = createApp();

beforeAll(() => {
  // Reset and migrate the SQLite test DB
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

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /campaigns', () => {
  it('returns empty list when no campaigns', async () => {
    const res = await request(app).get('/campaigns');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ campaigns: [] });
  });

  it('returns campaigns ordered by id desc', async () => {
    await prisma.campaign.createMany({
      data: [
        {
          id: 0,
          creator: '0xaaa',
          goal: '1000000000000000000',
          deadline: 1234567890,
          metadataURI: 'ipfs://a',
        },
        {
          id: 1,
          creator: '0xbbb',
          goal: '2000000000000000000',
          deadline: 1234567899,
          metadataURI: 'ipfs://b',
        },
      ],
    });

    const res = await request(app).get('/campaigns');
    expect(res.status).toBe(200);
    expect(res.body.campaigns).toHaveLength(2);
    expect(res.body.campaigns[0].id).toBe(1);
    expect(res.body.campaigns[1].id).toBe(0);
  });
});

describe('GET /campaigns/:id', () => {
  it('returns 404 when missing', async () => {
    const res = await request(app).get('/campaigns/42');
    expect(res.status).toBe(404);
  });

  it('returns 400 on non-numeric id', async () => {
    const res = await request(app).get('/campaigns/abc');
    expect(res.status).toBe(400);
  });

  it('returns campaign with pledges', async () => {
    await prisma.campaign.create({
      data: {
        id: 0,
        creator: '0xcre',
        goal: '5',
        deadline: 1700000000,
        metadataURI: 'ipfs://x',
      },
    });
    await prisma.pledge.create({
      data: {
        campaignId: 0,
        backer: '0xbck',
        amount: '3',
        txHash: '0xtx1',
        blockNumber: 1,
      },
    });

    const res = await request(app).get('/campaigns/0');
    expect(res.status).toBe(200);
    expect(res.body.campaign.id).toBe(0);
    expect(res.body.campaign.pledges).toHaveLength(1);
    expect(res.body.campaign.pledges[0].backer).toBe('0xbck');
  });
});

describe('POST /uploads', () => {
  it('falls back to local disk storage and returns a /files URL when Pinata is unset', async () => {
    const res = await request(app)
      .post('/uploads')
      .attach('file', Buffer.from('hello'), { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.uri).toMatch(/\/files\/[\w-]+\.png$/);
  });

  it('returns 400 when no file is provided', async () => {
    const res = await request(app).post('/uploads');
    expect(res.status).toBe(400);
  });
});
