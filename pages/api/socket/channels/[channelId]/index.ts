import { MethodNotAllowedError } from '@/errors/method-not-allowed-error';
import { NotFoundError } from '@/errors/not-found-error';
import { UnauthorizedError } from '@/errors/unauthorized-error';
import { ValidationError } from '@/errors/validation-error';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { currentProfile } from '@/lib/current-profile';
import { db } from '@/lib/db';
import { NextApiResponseServerIO } from '@/types';
import { NextApiRequest, NextApiResponse } from 'next';
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

      const channel = await db.channel.update({
        where: {
          id: channelId,
          serverId,
        },
        data: {
          name,
        },
      });

      if (!channel) {
        throw new NotFoundError('Channel not found');
      }

      const channelUpdatedKey = `server:${serverId}:channel:updated`;
      res.socket?.server?.io?.emit(channelUpdatedKey, channel);

      return res.status(200).json(channel);
    }

    if (req.method === 'DELETED') {
      const channel = await db.channel.delete({
        where: {
          id: channelId,
          serverId,
        },
      });
      const channelUpdatedKey = `server:${serverId}:channel:deleted`;
      res.socket?.server?.io?.emit(channelUpdatedKey, channel.id);
      return res.status(200).json({});
    }

    throw new MethodNotAllowedError();
  } catch (err: any) {
    return apiErrorHandler(err, req, res, '[CHANNEL_ID]');
  }
}
