import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabase } from '../lib/supabase.js';
import { invalidateUserAccess } from '../lib/user-access.js';

interface AdminUserRow {
  id: string;
  email: string;
  full_name: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
}

/** request.userAccess is set by the global auth preHandler in main.ts. */
async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.userAccess?.isAdmin) {
    return reply.code(403).send({ code: 'FORBIDDEN', message: 'Admin access required.' });
  }
}

export async function registerAdminRoutes(app: FastifyInstance) {
  // Exempt from the approval gate (see main.ts) so a pending user can read their own
  // status and the /pending screen has something to render.
  app.get('/api/me', async (request) => {
    const { userId, email, status, isAdmin } = request.userAccess;
    return { userId, email, status, isAdmin };
  });

  app.get<{ Querystring: { status?: string } }>(
    '/api/admin/users',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const status = request.query.status;
      let query = getSupabase()
        .from('users')
        .select('id, email, full_name, status, created_at, reviewed_at')
        .order('created_at', { ascending: false })
        .limit(500);

      if (status) query = query.eq('status', status);

      const { data, error } = await query;
      if (error) {
        request.log.error(error);
        return reply.code(500).send({ code: 'DB_ERROR', message: 'Could not load users.' });
      }
      return (data ?? []) as AdminUserRow[];
    },
  );

  app.patch<{ Params: { userId: string }; Body: { status?: string } }>(
    '/api/admin/users/:userId',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { status } = request.body ?? {};
      if (status !== 'approved' && status !== 'rejected') {
        return reply
          .code(400)
          .send({ code: 'BAD_REQUEST', message: 'status must be "approved" or "rejected".' });
      }
      // Admins can't demote themselves out of the tool by accident.
      if (request.params.userId === request.userId) {
        return reply
          .code(400)
          .send({ code: 'BAD_REQUEST', message: 'You cannot review your own account.' });
      }

      const { data, error } = await getSupabase()
        .from('users')
        .update({ status, reviewed_at: new Date().toISOString(), reviewed_by: request.userId })
        .eq('id', request.params.userId)
        .select('id, email, full_name, status, created_at, reviewed_at')
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ code: 'DB_ERROR', message: 'Could not update the account.' });
      }
      if (!data) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'User not found.' });
      }

      // Without this the decision sits behind the 60s cache TTL.
      invalidateUserAccess(request.params.userId);
      request.log.info({ reviewedBy: request.userId, target: data.email, status }, '[admin] user reviewed');
      return data as AdminUserRow;
    },
  );
}
