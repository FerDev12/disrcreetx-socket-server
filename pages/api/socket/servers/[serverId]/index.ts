import { BadRequestError } from '@/errors/bad-request-error';
import { InternalServerError } from '@/errors/internal-server-error';
import { MethodNotAllowedError } from '@/errors/method-not-allowed-error';
import { NotFoundError } from '@/errors/not-found-error';
import { UnauthorizedError } from '@/errors/unauthorized-error';
import { ValidationError } from '@/errors/validation-error';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { currentProfile } from '@/lib/current-profile';
import { db } from '@/lib/db';
import { NextApiResponseServerIO } from '@/types';
import { MemberRole } from '@prisma/client';
import { NextApiRequest, NextApiResponse } from 'next';
import NextCors from 'nextjs-cors';
import { ZodError, z } from 'zod';

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

    const [queryResponse, bodyResponse] = await Promise.allSettled([
      querySchema.safeParseAsync(req.query),
      bodySchema.safeParseAsync(req.body),
    ]);

    if (queryResponse.status === 'rejected') {
      throw new BadRequestError('Failed to parse query');
    }

    if (!queryResponse.value.success) {
      throw new ValidationError(queryResponse.value.error.errors);
    }

    if (bodyResponse.status === 'rejected') {
      throw new BadRequestError('Failed to parse body');
    }

    if (!bodyResponse.value.success) {
      throw new ValidationError(bodyResponse.value.error.errors);
    }

    const { serverId } = queryResponse.value.data;
    const { eventType, name, imageUrl } = bodyResponse.value.data;

    const server = await db.server.findUnique({
      where: {
        id: serverId,
        members: {
          some: {
            profileId: profile.id,
            role: {
              in: [MemberRole.ADMIN, MemberRole.MODERATOR],
            },
          },
        },
      },
      include: {
        members: true,
      },
    });

    if (!server) {
      throw new NotFoundError('Server not found');
    }

    const isAdmin = server.members.findIndex(
      (member) =>
        member.role === MemberRole.ADMIN && member.profileId === profile.id
    );

    if (eventType === 'server:updated') {
      if (!isAdmin) {
        throw new UnauthorizedError();
      }

      if (!name && !imageUrl) {
        throw new ValidationError([
          {
            path: ['name'],
            message: 'Required',
            code: 'invalid_type',
            expected: 'string',
            received: 'undefined',
          },
          {
            path: ['imageUrl'],
            message: 'Required',
            code: 'invalid_type',
            expected: 'string',
            received: 'undefined',
          },
        ]);
      }

      // Update Server
      let data: { name?: string; imageUrl?: string } = {};
      if (name && name.length) {
        data.name = name;
      } else {
        data.name = server.name;
      }

      if (imageUrl && imageUrl.length) {
        data.imageUrl = imageUrl;
      } else {
        data.imageUrl = server.imageUrl;
      }

      const updatedServer = await db.server.update({
        where: {
          id: serverId,
          members: {
            some: {
              AND: [
                {
                  profileId: profile.id,
                },
                {
                  role: {
                    in: [MemberRole.MODERATOR, MemberRole.ADMIN],
                  },
                },
              ],
            },
          },
        },
        data,
      });

      if (!updatedServer) {
        throw new NotFoundError('Server not found');
      }

      const serverUpdatedKey = `server:${serverId}:updated`;
      res.socket?.server?.io?.emit(serverUpdatedKey, updatedServer);
      return res.status(200).json(updatedServer);
    }

    if (eventType === 'server:deleted') {
      if (!isAdmin) {
        throw new UnauthorizedError();
      }

      const deletedServer = await db.server.delete({
        where: {
          id: serverId,
          profileId: profile.id,
        },
      });

      if (!deletedServer) {
        throw new NotFoundError('Server not found');
      }

      const serverDeletedKey = `server:${serverId}:deleted`;
      res.socket?.server?.io?.emit(serverDeletedKey, deletedServer.id);
      return res.status(200).json(deletedServer);
    }

    throw new InternalServerError();
  } catch (err: any) {
    return apiErrorHandler(err, req, res, '[SERVER_ID]');
  }
}
