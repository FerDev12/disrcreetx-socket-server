import { Server as NetServer } from 'http';
import { NextApiRequest, NextConfig } from 'next';
import { Server as ServerIO } from 'socket.io';
import { NextApiResponseServerIO } from '@/types';
import { createApiHandler } from '@/lib/api-handler';

export const config: NextConfig = {
  api: {
    bodyParser: false,
  },
};

const ioHandler = createApiHandler<NextApiRequest, NextApiResponseServerIO>();

ioHandler.all(async (_, res) => {
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
});

export default ioHandler;
