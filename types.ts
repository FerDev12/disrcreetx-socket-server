import { Server as NetServer, Socket } from 'net';
import { NextApiResponse } from 'next';
import { Server as SocketIOServer } from 'socket.io';

export type NextApiResponseServerIO = NextApiResponse & {
  socket: Socket & {
    server: NetServer & {
      io: SocketIOServer;
    };
  };
};

export enum ServerSocketEvents {
  SERVER_DELETED = 'server:deleted',
  SERVER_LEAVE = 'server:leave',
  CHANNEL_CREATED = 'channel:created',
  CHANNEL_UPDATED = 'channel:updated',
  CHANNEL_DELETED = 'channel:deleted',
  MEMBER_ADDED = 'member:added',
  MEMBER_UPDATED = 'member:updated',
  MEMBER_DELETED = 'member:deleted',
}
