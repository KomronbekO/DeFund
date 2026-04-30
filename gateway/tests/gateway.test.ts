import express from 'express';
import http from 'http';
import request from 'supertest';
import { AddressInfo } from 'net';
import { createApp } from '../src/app';

let upstream: http.Server;
let upstreamUrl: string;

beforeAll(async () => {
  // Stand up a tiny upstream service that mimics the backend
  const up = express();
  up.use(express.json());
  up.get('/campaigns', (_req, res) => res.json({ campaigns: ['from-upstream'] }));
  up.get('/campaigns/:id', (req, res) => res.json({ id: req.params.id }));
  up.post('/uploads', (_req, res) => res.json({ uri: 'ipfs://stub' }));

  await new Promise<void>((resolve) => {
    upstream = up.listen(0, () => {
      const port = (upstream.address() as AddressInfo).port;
      upstreamUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  upstream.close();
});

describe('Gateway', () => {
  it('serves /health locally without proxying', async () => {
    const app = createApp({ backendUrl: upstreamUrl });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('gateway');
    expect(res.body.upstream).toBe(upstreamUrl);
  });

  it('proxies GET /campaigns to upstream', async () => {
    const app = createApp({ backendUrl: upstreamUrl });
    const res = await request(app).get('/campaigns');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ campaigns: ['from-upstream'] });
  });

  it('proxies parameterized routes', async () => {
    const app = createApp({ backendUrl: upstreamUrl });
    const res = await request(app).get('/campaigns/42');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: '42' });
  });

  it('blocks /uploads with 401 when SIWE auth required and missing', async () => {
    process.env.REQUIRE_AUTH_ON_UPLOADS = 'true';
    // Reload config since createApp reads from it at construction time
    jest.resetModules();
    const { createApp: createAppReloaded } = await import('../src/app');
    const app = createAppReloaded({ backendUrl: upstreamUrl });
    const res = await request(app).post('/uploads');
    expect(res.status).toBe(401);
    delete process.env.REQUIRE_AUTH_ON_UPLOADS;
  });
});
