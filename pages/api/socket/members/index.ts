import { BadRequestError } from '@/errors/bad-request-error';
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
  inviteCode: z.string().nonempty(),
});

const bodySchema = z.object({
  username: z.string().min(1, { message: 'Name is required' }),
  avatarUrl: z.string().url().min(1, { message: 'Avatar is required' }),
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

    const { serverId, inviteCode } = queryResponse.data;

    const existingServer = await db.server.findUnique({
      where: {
        id: serverId,
        inviteCode,
      },
      select: {
        id: true,
        members: {
          select: {
            id: true,
            profileId: true,
          },
        },
      },
    });

    if (!existingServer) {
      throw new NotFoundError('Server not found');
    }

    if (existingServer.members.length === 100) {
      throw new BadRequestError('Server members limit reached');
    }

    const existingMember =
      existingServer.members.findIndex(
        (member) => member.profileId === profile.id
      ) !== -1;

    if (existingMember) {
      throw new BadRequestError('Member already exists');
    }

    const bodyResponse = bodySchema.safeParse(req.body);

    if (!bodyResponse.success) {
      throw new ValidationError(bodyResponse.error.errors);
    }

    const { username, avatarUrl } = bodyResponse.data;

    const member = await db.member.create({
      data: {
        profileId: profile.id,
        serverId,
        username,
        avatarUrl,
      },
    });

    if (!member) {
      throw new BadRequestError('Member creation failed');
    }

    const memberAddedKey = `server:${serverId}`;
    res.socket?.server?.io?.emit(memberAddedKey, {
      type: ServerSocketEvents.MEMBER_ADDED,
      data: member,
    });

    return res.status(201).json(member);
  } catch (err: any) {
    return apiErrorHandler(err, req, res, '[MEMBER_POST]');
  }
}
