import { Router } from 'express';
import multer from 'multer';
import { storeImage } from '../lib/storage';
import { logger } from '../logger';

export const uploadsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB cap
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('only image/* uploads are supported'));
      return;
    }
    cb(null, true);
  },
});

uploadsRouter.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'file is required (multipart field "file")' });
    return;
  }
  try {
    const uri = await storeImage(req.file.originalname, req.file.mimetype, req.file.buffer);
    res.json({ uri });
  } catch (err) {
    logger.error({ err }, 'image upload failed');
    res.status(502).json({ error: 'upload failed' });
  }
});
