import { MethodNotAllowedError } from '@/errors/method-not-allowed-error';
import { NotFoundError } from '@/errors/not-found-error';
import { UnauthorizedError } from '@/errors/unauthorized-error';
import { ValidationError } from '@/errors/validation-error';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { currentProfile } from '@/lib/current-profile';
import { db } from '@/lib/db';
import { NextApiResponseServerIO } from '@/types';
import { Call, Conversation, Member, Profile } from '@prisma/client';
import { NextApiRequest } from 'next';
import NextCors from 'nextjs-cors';
import { z } from 'zod';

const querySchema = z.object({
  callId: z.string().nonempty().trim(),
  conversationId: z.string().nonempty().trim(),
});

const bodySchema = z.object({
  cancelled: z.boolean(),
  answered: z.boolean(),
  declined: z.boolean(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  try {
    await NextCors(req, res, {
      // Options
      methods: ['DELETE'],
      origin: '*',
      optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
    });

    if (!['DELETE', 'PATCH'].includes(req.method ?? '')) {
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

    const { conversationId, callId } = queryResponse.data;

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
        memberOne: {
          select: {
            profileId: true,
          },
        },
        memberTwo: {
          select: {
            profileId: true,
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundError('Conversation not found');
    }

    const otherMemberProfileId =
      conversation.memberOne.profileId === profile.id
        ? conversation.memberTwo.profileId
        : conversation.memberOne.profileId;

    const callKey = `server:${conversation.serverId}:call:${otherMemberProfileId}`;

    let call:
      | (Call & {
          conversation: Conversation;
        })
      | null = null;

    if (req.method === 'PATCH') {
      const bodyResponse = bodySchema.safeParse(req.body);

      if (!bodyResponse.success) {
        throw new ValidationError(bodyResponse.error.errors);
      }

      const { answered, declined, cancelled } = bodyResponse.data;
      const active = !declined && !cancelled;

      call = await db.call.update({
        where: {
          id: callId,
          conversationId,
        },
        data: {
          active,
          answered,
          declined,
          cancelled,
          ended: !active,
        },
        include: {
          conversation: true,
        },
      });

      if (!call) {
        throw new NotFoundError('Call not found');
      }

      const callEditedKey = callKey + ':edited';
      res.socket?.server?.io?.emit(callEditedKey, call);
    }

    // IMPLEMENT SOFT DELETE
    if (req.method === 'DELETE') {
      call = await db.call.update({
        where: {
          id: callId,
          conversationId,
        },
        data: {
          active: false,
          ended: true,
        },
        include: {
          conversation: true,
        },
      });

      if (!call) {
        throw new NotFoundError('Call not found');
      }

      const callEndedKey = callKey + ':ended';
      res.socket?.server?.io?.emit(callEndedKey, call);
    }

    return res.status(200).json(call);
  } catch (err: any) {
    return apiErrorHandler(err, req, res, '[CALL_ID]');
  }
}
