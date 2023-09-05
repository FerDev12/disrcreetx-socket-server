import { BadRequestError } from '@/errors/bad-request-error';
import { NotFoundError } from '@/errors/not-found-error';
import { UnauthorizedError } from '@/errors/unauthorized-error';
import { ValidationError } from '@/errors/validation-error';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { currentProfile } from '@/lib/current-profile';
import { db } from '@/lib/db';
import { NextApiResponseServerIO } from '@/types';
import { ChannelType, MemberRole } from '@prisma/client';
import { NextApiRequest } from 'next';
import NextCors from 'nextjs-cors';
import { z } from 'zod';

const querySchema = z.object({
  serverId: z.string().uuid().nonempty(),
});

const bodySchema = z.object({
  name: z.string().trim().nonempty(),
  type: z.enum([ChannelType.AUDIO, ChannelType.VIDEO, ChannelType.TEXT]),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  try {
    await NextCors(req, res, {
      origin: '*',
      methods: ['POST'],
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

    const { serverId } = queryResponse.data;

    const server = await db.server.findUnique({
      where: {
        id: serverId,
        members: {
          some: {
            AND: [
              {
                profileId: profile.id,
                role: {
                  in: [MemberRole.MODERATOR, MemberRole.ADMIN],
                },
              },
            ],
          },
        },
      },
    });

    if (!server) {
      throw new NotFoundError('Server not found');
    }

    const bodyResponse = bodySchema.safeParse(req.body);

    if (!bodyResponse.success) {
      throw new ValidationError(bodyResponse.error.errors);
    }

    const { name, type } = bodyResponse.data;

    const channel = await db.channel.create({
      data: {
        serverId,
        profileId: profile.id,
        type,
        name,
      },
    });

    if (!channel) {
      throw new BadRequestError('Server creation failed');
    }

    const channelCreatedKey = `server:${serverId}:channel:created`;
    res?.socket?.server?.io?.emit(channelCreatedKey, channel);

    return res.status(201).json(channel);
  } catch (err: any) {
    return apiErrorHandler(err, req, res, '[CHANNEL_POST]');
  }
}
