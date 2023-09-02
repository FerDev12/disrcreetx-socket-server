import { NextApiResponseServerIO } from '@/types';
import { NextApiRequest } from 'next';
import NextCors from 'nextjs-cors';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  await NextCors(req, res, {
    // Options
    methods: ['POST'],
    origin: '*',
    optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
  });

  const { key, isTyping } = req.body as { key: string; isTyping: boolean };

  try {
    if (!key || key.length === 0) {
      return res.status(400).json({ message: 'Missing API key' });
    }

    if (isTyping === null || isTyping === undefined) {
      return res.status(400).json({ message: 'Missing isTyping' });
    }

    res.socket?.server?.io?.emit(key, isTyping);

    res.end();
  } catch (err: any) {
    console.error('[IS_TYPING]', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
