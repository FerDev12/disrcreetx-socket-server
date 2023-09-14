import { BadRequestError } from '@/errors/bad-request-error';
import { MethodNotAllowedError } from '@/errors/method-not-allowed-error';
import { NotFoundError } from '@/errors/not-found-error';
import { UnauthorizedError } from '@/errors/unauthorized-error';
import { ValidationError } from '@/errors/validation-error';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { currentProfile } from '@/lib/current-profile';
import { db } from '@/lib/db';
import { NextApiResponseServerIO, ServerSocketEvents } from '@/types';
import { NextApiRequest } from 'next';
import NextCors from 'nextjs-cors';
import { z } from 'zod';

const querySchema = z.object({
  serverId: z.string().uuid().nonempty(),
  channelId: z.string().uuid().nonempty(),
});

const bodySchema = z.object({
  name: z.string().min(1).nonempty(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  try {
    await NextCors(req, res, {
      origin: '*',
      methods: ['PATCH', 'DELETE'],
      optionsSuccessStatus: 200,
    });

    const profile = await currentProfile(req);

    if (!profile) {
      throw new UnauthorizedError();
    }

    const queryResponse = querySchema.safeParse(req.query);

    if (!queryResponse.success) {
      throw new ValidationError(queryResponse.error.errors);
    }

    const { serverId, channelId } = queryResponse.data;

    if (req.method === 'PATCH') {
      const bodyResponse = bodySchema.safeParse(req.body);

      if (!bodyResponse.success) {
        throw new ValidationError(bodyResponse.error.errors);
      }

      const { name } = bodyResponse.data;

      if (name === 'general') {
        throw new BadRequestError('Only one general channel can exist');
      }

      const server = await db.server.update({
        where: {
          id: serverId,
          members: {
            some: {
              id: profile.id,
              role: {
                in: ['MODERATOR', 'GUEST'],
              },
            },
          },
        },
        data: {
          channels: {
            update: {
              where: {
                id: channelId,
                name: {
                  not: 'general',
                },
              },
              data: {
                name,
              },
            },
          },
        },
        include: {
          channels: {
            where: {
              id: channelId,
            },
          },
        },
      });

      if (!server) {
        throw new NotFoundError('Server not found');
      }

      const channel = server.channels.find(
        (channel) => channel.id === channelId
      );

      const channelUpdatedKey = `server:${serverId}`;
      res.socket?.server?.io?.emit(channelUpdatedKey, {
        type: ServerSocketEvents.CHANNEL_UPDATED,
        data: channel,
      });

      return res.status(200).json(server);
    }

    if (req.method === 'DELETED') {
      const channel = await db.channel.delete({
        where: {
          id: channelId,
          server: {
            id: serverId,
            members: {
              some: {
                profileId: profile.id,
                role: {
                  in: ['MODERATOR', 'ADMIN'],
                },
              },
            },
          },
        },
      });

      if (!channel) {
        throw new NotFoundError('Channel not found');
      }

      const channelDeletedKey = `server:${serverId}:channel:deleted`;
      res.socket?.server?.io?.emit(channelDeletedKey, {
        type: ServerSocketEvents.CHANNEL_DELETED,
        data: channel,
      });
      return res.status(200).json(channel);
    }

    throw new MethodNotAllowedError();
  } catch (err: any) {
    return apiErrorHandler(err, req, res, '[CHANNEL_ID]');
  }
}
