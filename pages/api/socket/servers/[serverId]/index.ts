import { BadRequestError } from '@/errors/bad-request-error';
import { InternalServerError } from '@/errors/internal-server-error';
import { MethodNotAllowedError } from '@/errors/method-not-allowed-error';
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

// SERVER EVENTS
// server deleted
// channel created
// channel deleted
// conversation started

const querySchema = z.object({
  serverId: z.string().uuid(),
});

const bodySchema = z.object({
  eventType: z.enum(['server:deleted', 'server:updated']),
  name: z.string().nonempty().optional(),
  imageUrl: z.string().url().optional(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  try {
    await NextCors(req, res, {
      origin: '*',
      methods: ['PATCH', 'DELTE'],
      optionsSuccessStatus: 200,
    });

    if (!['PATCH', 'DELETE'].includes(req.method ?? '')) {
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

    const { serverId } = queryResponse.data;

    if (req.method === 'PATCH') {
      const bodyResponse = bodySchema.safeParse(req.body);

      if (!bodyResponse.success) {
        throw new ValidationError(bodyResponse.error.errors);
      }

      const { name, imageUrl } = bodyResponse.data;

      const data: { name?: string; imageUrl?: string } = {};

      if (!data && !imageUrl) {
        throw new BadRequestError(
          'Either name or image url or both are required'
        );
      }

      if (name) {
        data.name = name;
      }
      if (imageUrl) {
        data.imageUrl = imageUrl;
      }

      const server = await db.server.update({
        where: {
          id: serverId,
          profileId: profile.id,
        },
        data,
      });

      if (!server) {
        throw new NotFoundError('Server not found');
      }

      return res.status(200).json(server);
    }

    if (req.method === 'DELETE') {
      const server = await db.server.delete({
        where: {
          id: serverId,
          profileId: profile.id,
        },
      });

      if (!server) {
        throw new NotFoundError('Server not found');
      }

      const serverDeletedKey = `server:${serverId}`;
      res.socket?.server?.io?.emit(serverDeletedKey, {
        type: ServerSocketEvents.SERVER_DELETED,
      });
      return res.status(200).json(server);
    }

    throw new InternalServerError();
  } catch (err: any) {
    return apiErrorHandler(err, req, res, '[SERVER_ID]');
  }
}
