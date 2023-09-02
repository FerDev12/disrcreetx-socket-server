import { createApiHandler } from '@/lib/api-handler';
import { NextApiResponseServerIO } from '@/types';
import { NextApiRequest } from 'next';

const handler = createApiHandler<NextApiRequest, NextApiResponseServerIO>();

handler.post(async (req, res) => {
  const { key, isTyping } = req.body;

  if (!key) {
    return res.status(400).json({ message: 'Missing API key' });
  }

  if (isTyping === null || isTyping === undefined) {
    return res.status(400).json({ message: 'Missing isTyping' });
  }

  res.socket?.server?.io?.emit(key, isTyping);

  res.end();
});

export default handler;
