import { MethodNotAllowedError } from '@/errors/method-not-allowed-error';
import { NotFoundError } from '@/errors/not-found-error';
import { UnauthorizedError } from '@/errors/unauthorized-error';
import { ValidationError } from '@/errors/validation-error';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { currentProfile } from '@/lib/current-profile';
import { db } from '@/lib/db';
import { NextApiResponseServerIO } from '@/types';
import { MemberRole } from '@prisma/client';
import Cryptr from 'cryptr';
import { NextApiRequest } from 'next';
import NextCors from 'nextjs-cors';
import { z } from 'zod';

const querySchema = z.object({
  directMessageId: z.string().nonempty(),
  conversationId: z.string().nonempty(),
});

const bodySchema = z.object({
  content: z.string().nonempty(),
});

export async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  await NextCors(req, res, {
    // Options
    methods: ['PATCH', 'DELETE'],
    origin: '*',
    optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
  });

  try {
    if (req.method !== 'DELETE' && req.method !== 'PATCH') {
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

    const { directMessageId, conversationId } = queryResponse.data;

    const [conversationResponse, directMessageResponse] =
      await Promise.allSettled([
        db.conversation.findFirst({
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
              include: {
                profile: true,
              },
            },
            memberTwo: {
              include: {
                profile: true,
              },
            },
          },
        }),
        db.directMessage.findFirst({
          where: {
            id: directMessageId,
            conversationId: conversationId,
          },
          include: {
            member: {
              include: {
                profile: true,
              },
            },
          },
        }),
      ]);

    if (
      conversationResponse.status === 'rejected' ||
      !conversationResponse.value
    ) {
      throw new NotFoundError('Conversation not found');
    }

    if (
      directMessageResponse.status === 'rejected' ||
      !directMessageResponse.value ||
      directMessageResponse.value.deleted
    ) {
      throw new NotFoundError('Direct message not found');
    }

    const conversation = conversationResponse.value;
    let directMessage = directMessageResponse.value;

    const member =
      conversation.memberOne.profileId === profile.id
        ? conversation.memberOne
        : conversation.memberTwo;

    if (!member) {
      throw new NotFoundError('Member not found');
    }

    const isMessageOwner = directMessage.memberId === member.id;
    const isAdmin = member.role === MemberRole.ADMIN;
    const isModerator = member.role === MemberRole.MODERATOR;
    const canModify = isMessageOwner || isAdmin || isModerator;

    if (!canModify) {
      throw new UnauthorizedError();
    }

    if (req.method === 'DELETE') {
      directMessage = await db.directMessage.update({
        where: {
          id: directMessageId,
        },
        data: {
          fileUrl: null,
          content: 'This message has been deleted',
          deleted: true,
        },
        include: {
          member: {
            include: {
              profile: true,
            },
          },
        },
      });
    }

    if (req.method === 'PATCH') {
      if (!isMessageOwner) {
        throw new UnauthorizedError();
      }

      const bodyResponse = bodySchema.safeParse(req.body);

      if (!bodyResponse.success) {
        throw new ValidationError(bodyResponse.error.errors);
      }

      const { content } = bodyResponse.data;

      const cryptr = new Cryptr(process.env.CRYPTR_SECRET_KEY ?? '', {
        // @ts-ignore
        encoding: 'base64',
        pbkdf2Iterations: 10000,
        saltLength: 10,
      });
      const encryptedContent = cryptr.encrypt(content);

      directMessage = await db.directMessage.update({
        where: {
          id: directMessageId,
        },
        data: {
          content: encryptedContent,
          edited: true,
        },
        include: {
          member: {
            include: {
              profile: true,
            },
          },
        },
      });

      directMessage.content = content;
    }

    const updateKey = `chat:${conversationId}:messages:update`;

    res?.socket?.server?.io?.emit(updateKey, directMessage);

    return res.status(200).json(directMessage);
  } catch (err: any) {
    return apiErrorHandler(err, req, res, '[DIRECT_MESSAGE_ID]');
  }
}

export default handler;
