import { NextApiRequest } from 'next';
import { currentProfile } from '@/lib/current-profile';
import { db } from '@/lib/db';
import { NextApiResponseServerIO } from '@/types';
import NextCors from 'nextjs-cors';
import Cryptr from 'cryptr';
import { z } from 'zod';
import { ValidationError } from '@/errors/validation-error';
import { NotFoundError } from '@/errors/not-found-error';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { UnauthorizedError } from '@/errors/unauthorized-error';
import { MethodNotAllowedError } from '@/errors/method-not-allowed-error';

const querySchema = z.object({
  serverId: z.string().uuid().nonempty(),
  conversationId: z.string().uuid().nonempty(),
  memberId: z.string().uuid().nonempty(),
});

const boydSchema = z.object({
  content: z.string().nonempty(),
  fileUrl: z.string().url().nullish(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  await NextCors(req, res, {
    // Options
    methods: ['POST'],
    origin: '*',
    optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
  });
  try {
    const date = new Date();
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

    const { conversationId, memberId, serverId } = queryResponse.data;

    const bodyResponse = boydSchema.safeParse(req.body);

    if (!bodyResponse.success) {
      throw new ValidationError(bodyResponse.error.errors);
    }

    const { content, fileUrl } = bodyResponse.data;

    const cryptr = new Cryptr(process.env.CRYPTR_SECRET_KEY ?? '');
    const encryptedContent = cryptr.encrypt(content);
    let encryptedFileUrl: null | string = null;
    if (fileUrl) {
      encryptedFileUrl = cryptr.encrypt(fileUrl);
    }

    const conversation = await db.conversation.update({
      where: {
        id: conversationId,
        serverId,
        OR: [
          {
            memberOne: {
              id: memberId,
              profileId: profile.id,
            },
          },
          {
            memberTwo: {
              id: memberId,
              profileId: profile.id,
            },
          },
        ],
      },
      data: {
        directMessages: {
          create: {
            content: encryptedContent,
            fileUrl: encryptedFileUrl,
            memberId: memberId,
          },
        },
      },
      select: {
        serverId: true,
        memberOne: {
          select: {
            id: true,
            profileId: true,
          },
        },
        memberTwo: {
          select: {
            id: true,
            profileId: true,
          },
        },
        directMessages: {
          take: 1,
          include: {
            member: {
              include: {
                profile: {
                  select: {
                    id: true,
                    name: true,
                    imageUrl: true,
                    email: true,
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundError('Conversation not found');
    }

    const directMessage = conversation.directMessages[0];

    if (!directMessage) {
      throw new NotFoundError('Direct message not found');
    }

    const otherMemberProfileId =
      conversation.memberOne.profileId === profile.id
        ? conversation.memberTwo.profileId
        : conversation.memberOne.profileId;

    directMessage.content = content;
    directMessage.fileUrl = fileUrl ?? null;

    const channelKey = `chat:${conversationId}:messages`;
    const notificationKey = `server:${conversation.serverId}:notifications:${otherMemberProfileId}`;

    res?.socket?.server?.io?.emit(channelKey, directMessage);
    res?.socket.server?.io?.emit(notificationKey);

    return res.status(201).json(directMessage);
  } catch (err: any) {
    return apiErrorHandler(err, req, res, '[DIRECT_MESSAGE_POST]');
  }
}
