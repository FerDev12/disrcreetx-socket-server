import { BadRequestError } from '@/errors/bad-request-error';
import { NotFoundError } from '@/errors/not-found-error';
import { UnauthorizedError } from '@/errors/unauthorized-error';
import { ValidationError } from '@/errors/validation-error';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { currentProfile } from '@/lib/current-profile';
import { db } from '@/lib/db';
import { NextApiResponseServerIO } from '@/types';
import { CallType } from '@prisma/client';
import { NextApiRequest } from 'next';
import { z } from 'zod';
import NextCors from 'nextjs-cors';
import { MethodNotAllowedError } from '@/errors/method-not-allowed-error';

const querySchema = z.object({
  serverId: z.string().nonempty().trim(),
  conversationId: z.string().nonempty().trim(),
});

const bodySchema = z.object({
  type: z.enum([CallType.AUDIO, CallType.VIDEO]),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  try {
    await NextCors(req, res, {
      // Options
      methods: ['POST'],
      origin: '*',
      optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
    });

    if (req.method !== 'POST') {
      throw new MethodNotAllowedError();
    }

    const profile = await currentProfile(req);

    if (!profile) {
      throw new UnauthorizedError();
    }

    const queryResponse = querySchema.safeParse(req.query);

    if (!queryResponse.success) {
      throw new ValidationError(queryResponse.error.errors);
    }

    const bodyResponse = bodySchema.safeParse(req.body);

    if (!bodyResponse.success) {
      throw new ValidationError(bodyResponse.error.errors);
    }

    const { conversationId, serverId } = queryResponse.data;
    const { type } = bodyResponse.data;

    const currentActiveCall = await db.call.findFirst({
      where: {
        OR: [
          {
            active: true,
          },
          {
            ended: false,
          },
        ],
        conversation: {
          id: conversationId,
          OR: [
            {
              memberOne: {
                profileId: profile.id,
              },
              memberTwo: {
                profileId: profile.id,
              },
            },
          ],
        },
      },
    });

    if (currentActiveCall) {
      throw new BadRequestError('Only one concurrent conversation is allowed.');
    }

    const conversation = await db.conversation.findFirst({
      where: {
        id: conversationId,
        OR: [
          {
            memberOne: {
              profileId: profile.id,
            },
          },
          {
            memberTwo: {
              profileId: profile.id,
            },
          },
        ],
      },
      include: {
        memberOne: true,
        memberTwo: true,
      },
    });

    if (!conversation) {
      throw new NotFoundError('Conversation not found');
    }

    const memberId =
      conversation.memberOne.profileId === profile.id
        ? conversation.memberOneId
        : conversation.memberTwoId;

    const otherMemberProfileId =
      conversation.memberOne.profileId === profile.id
        ? conversation.memberTwo.profileId
        : conversation.memberTwo.profileId;

    const call = await db.call.create({
      data: {
        type,
        memberId,
        conversationId,
      },
      include: {
        conversation: true,
      },
    });

    if (!call) {
      throw new BadRequestError('Failed to create call');
    }

    const callKey = `server:${serverId}:call:${otherMemberProfileId}:answer`;
    res?.socket?.server?.io?.emit(callKey, {
      from: {
        name: profile.name,
        imageUrl: profile.imageUrl,
      },
      call,
    });

    return res.status(201).json(call);
  } catch (err: any) {
    return apiErrorHandler(err, req, res, '[CALLS_POST]');
  }
}
