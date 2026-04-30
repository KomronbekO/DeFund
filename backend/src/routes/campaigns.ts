import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';

export const campaignsRouter = Router();

const idParam = z.coerce.number().int().nonnegative();

campaignsRouter.get('/', async (_req, res) => {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { id: 'desc' },
  });
  res.json({ campaigns });
});

campaignsRouter.get('/:id', async (req, res) => {
  const parsed = idParam.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const id = parsed.data;
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: { pledges: { orderBy: { blockNumber: 'desc' } } },
  });
  if (!campaign) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ campaign });
});
