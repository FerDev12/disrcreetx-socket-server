import { NextApiRequest } from 'next';

import { currentProfile } from '@/lib/current-profile';
import { db } from '@/lib/db';
import { NextApiResponseServerIO } from '@/types';
import { createApiHandler } from '@/lib/api-handler';

const handler = createApiHandler<NextApiRequest, NextApiResponseServerIO>();

handler.post(async (req, res) => {
  const date = new Date();

  const profile = await currentProfile(req);

  if (!profile) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { serverId, channelId } = req.query;

  if (!serverId) {
    return res.status(400).json({ error: 'Server Id missing' });
  }

  if (!channelId) {
    return res.status(400).json({ error: 'Channel Id missing' });
  }

  const { content, fileUrl } = req.body as {
    content: string;
    fileUrl: string;
  };

  if (!content) {
    return res.status(400).json({ error: 'Missing content' });
  }

  const [serverResponse, channelResponse] = await Promise.allSettled([
    db.server.findFirst({
      where: {
        id: serverId as string,
        members: {
          some: {
            profileId: profile.id,
          },
        },
      },
      include: {
        members: true,
      },
    }),
    db.channel.findFirst({
      where: {
        id: channelId as string,
        serverId: serverId as string,
      },
    }),
  ]);

  if (serverResponse.status === 'rejected') {
    throw new Error('Find server request failed');
  }

  if (channelResponse.status === 'rejected') {
    throw new Error('Find channel request failed');
  }

  const server = serverResponse.value;
  const channel = channelResponse.value;

  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  const member = server.members.find(
    (member) => member.profileId === profile.id
  );

  if (!member) {
    return res.status(404).json({ error: 'Member not found' });
  }

  const message = await db.message.create({
    data: {
      content,
      fileUrl,
      channelId: channelId as string,
      memberId: member.id,
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

  const channelKey = `chat:${channelId}:messages`;

  res?.socket?.server?.io?.emit(channelKey, message);

  return res.status(201).json(message);
});

export default handler;
