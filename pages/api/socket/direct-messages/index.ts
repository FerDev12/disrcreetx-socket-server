import { NextApiRequest } from 'next';
import { currentProfile } from '@/lib/current-profile';
import { db } from '@/lib/db';
import { NextApiResponseServerIO } from '@/types';
import NextCors from 'nextjs-cors';
import Cryptr from 'cryptr';

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

    const { conversationId } = req.query;

    if (!conversationId) {
      return res.status(400).json({ error: 'Conversation Id missing' });
    }

    const { content, fileUrl } = req.body as {
      content: string;
      fileUrl: string;
    };

    if (!content) {
      return res.status(400).json({ error: 'Missing content' });
    }

    const conversation = await db.conversation.findFirst({
      where: {
        id: conversationId as string,
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
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const member =
      conversation.memberOne.profileId === profile.id
        ? conversation.memberOne
        : conversation.memberTwo;

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const cryptr = new Cryptr(process.env.CRYPTR_SECRET_KEY ?? '');
    const encryptedContent = cryptr.encrypt(content);
    let encryptedFileUrl: null | string = null;
    if (fileUrl) {
      encryptedFileUrl = cryptr.encrypt(fileUrl);
    }

    const message = await db.directMessage.create({
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

    const channelKey = `chat:${conversationId}:messages`;

    res?.socket?.server?.io?.emit(channelKey, message);

    return res.status(201).json(message);
  } catch (err: any) {
    console.error('[DIRECT_MESSAGE_ERROR]', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
