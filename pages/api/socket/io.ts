import { Server as NetServer } from 'http';
import { NextApiRequest, NextConfig } from 'next';
import { Server as ServerIO } from 'socket.io';
import { NextApiResponseServerIO } from '@/types';
import NextCors from 'nextjs-cors';

export const config: NextConfig = {
  api: {
    bodyParser: false,
  },
};

export default async function ioHandler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  await NextCors(req, res, {
    // Options
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    origin: '*',
    optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
  });

  try {
    if (!res.socket.server.io) {
      const path = '/api/socket/io';
      const httpServer: NetServer = res.socket.server as any;
      const io = new ServerIO(httpServer, {
        path: path,
        // @ts-ignore
        addTrailingSlash: false,
      });
      res.socket.server.io = io;
    }

    res.end();
  } catch (err: any) {
    console.error('[IO_HANDLER_ERROR]', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
