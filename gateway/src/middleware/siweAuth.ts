import type { Request, Response, NextFunction } from 'express';
import { SiweMessage } from 'siwe';
import { config } from '../config';
import { logger } from '../logger';

/**
 * SIWE (Sign-In With Ethereum) bearer auth.
 * Frontend must send `Authorization: SIWE <base64(message)>::<signature>`.
 * Verifies the signature matches the recovered address. No session — stateless.
 */
export async function siweAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!config.requireAuthOnUploads) {
    next();
    return;
  }

  const header = req.header('authorization') ?? '';
  if (!header.startsWith('SIWE ')) {
    res.status(401).json({ error: 'missing SIWE bearer' });
    return;
  }

  const [encodedMessage, signature] = header.slice(5).split('::');
  if (!encodedMessage || !signature) {
    res.status(401).json({ error: 'malformed SIWE header' });
    return;
  }

  try {
    const messageText = Buffer.from(encodedMessage, 'base64').toString('utf8');
    const message = new SiweMessage(messageText);
    const result = await message.verify({ signature });
    if (!result.success) {
      res.status(401).json({ error: 'SIWE verification failed' });
      return;
    }
    (req as Request & { siweAddress?: string }).siweAddress = message.address;
    next();
  } catch (err) {
    logger.warn({ err }, 'SIWE verify error');
    res.status(401).json({ error: 'invalid SIWE message' });
  }
}
