import cors from 'cors';
import { NextApiRequest, NextApiResponse } from 'next';
import { createRouter, expressWrapper } from 'next-connect';

export function createApiHandler<
  Req extends NextApiRequest = NextApiRequest,
  Res extends NextApiResponse = NextApiResponse
>() {
  const router = createRouter<Req, Res>();
  router.use(
    expressWrapper(
      cors({
        origin: [
          'http://localhost:3000',
          process.env.DISCORD_CLONE_APP_URL ?? '',
        ],
      })
    )
  );

  router.handler({
    onError: onError,
    onNoMatch: onNoMatch,
  });

  return router;
}

async function onError(err: unknown, _: NextApiRequest, res: NextApiResponse) {
  console.error(err);

  return res.status(500).json({ message: 'Internal Server Eerror' });
}

async function onNoMatch(req: NextApiRequest, res: NextApiResponse) {
  return res.status(405).json({ message: 'Method not allowed' });
}
