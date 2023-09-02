import { NextApiRequest } from 'next';
import { NextApiResponseServerIO } from '@/types';
import NextCors from 'nextjs-cors';
import { _scrypt } from '@/lib/_scrypt';

export default async function ioHandler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  await NextCors(req, res, {
    // Options
    methods: ['POST'],
    origin: '*',
    optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
  });

  const authToken = req.headers.authorization;

  if (
    !authToken ||
    !authToken.length ||
    !_scrypt.compare(process.env.API_SECRET_KEY ?? '', authToken)
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // FIXME ADD AUTH CHECK
    const { chatId } = req.query;

    if (!chatId) {
      return res.status(400).json({ error: 'Missing channel Id' });
    }

    const updateKey = `chat:${chatId}:messages:update`;
    res?.socket?.server?.io?.emit(updateKey);

    res.end();
  } catch (err: any) {
    console.error('[IO_HANDLER_ERROR]', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
