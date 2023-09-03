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

const querySchema = z.object({
  conversationId: z.string().nonempty(),
});

const boydSchema = z.object({
  content: z.string().nonempty(),
  fileUrl: z.string().url(),
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
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const profile = await currentProfile(req);

    if (!profile) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const queryResponse = querySchema.safeParse(req.query);

    if (!queryResponse.success) {
      throw new ValidationError(queryResponse.error.errors);
    }

    const { conversationId } = queryResponse.data;

    const bodyResponse = boydSchema.safeParse(req.body);

    if (!bodyResponse.success) {
      throw new ValidationError(bodyResponse.error.errors);
    }

    const { content, fileUrl } = bodyResponse.data;

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
    });

    if (!conversation) {
      throw new NotFoundError('Conversation not found');
    }

    const member =
      conversation.memberOne.profileId === profile.id
        ? conversation.memberOne
        : conversation.memberTwo;

    if (!member) {
      throw new NotFoundError('Member not found');
    }

    const cryptr = new Cryptr(process.env.CRYPTR_SECRET_KEY ?? '');
    const encryptedContent = cryptr.encrypt(content);
    let encryptedFileUrl: null | string = null;
    if (fileUrl) {
      encryptedFileUrl = cryptr.encrypt(fileUrl);
    }

    const directMessage = await db.directMessage.create({
      data: {
        content: encryptedContent,
        fileUrl: encryptedFileUrl,
        memberId: member.id,
        conversationId: conversationId as string,
        createdAt: date,
        updatedAt: date,
      },
      include: {
        member: {
          include: {
            profile: true,
          },
        },
      },
    });

    if (!directMessage) {
      throw new NotFoundError('Message not found');
    }

    directMessage.content = content;
    directMessage.fileUrl = fileUrl;

    const channelKey = `chat:${conversationId}:messages`;

    res?.socket?.server?.io?.emit(channelKey, directMessage);

    return res.status(201).json(directMessage);
  } catch (err: any) {
    return apiErrorHandler(err, req, res, '[DIRECT_MESSAGE_POST]');
  }
}
