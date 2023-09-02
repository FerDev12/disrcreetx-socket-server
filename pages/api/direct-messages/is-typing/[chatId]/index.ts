import { NextApiResponseServerIO } from '@/types';
import { NextApiRequest } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  try {
    const { key, isTyping } = req.body;

    if (!key) {
      return res.status(400).json({ message: 'Missing API key' });
    }

    if (isTyping === null || isTyping === undefined) {
      return res.status(400).json({ message: 'Missing isTyping' });
    }

    res.socket?.server?.io?.emit(key, isTyping);

    res.end();
  } catch (err: any) {
    console.error('[DIRECT_MESSAGE_TYPING]', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
