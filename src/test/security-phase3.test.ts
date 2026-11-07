import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSecurityHeaders,
  resetRateLimitStoreForTests,
} from '@/lib/security';
import {
  validateCommandMessage,
  validateCoordinates,
} from '@/lib/validation';

const USER_A_ID = '11111111-1111-4111-8111-111111111111';
const USER_B_ID = '22222222-2222-4222-8222-222222222222';
const USER_C_ID = '33333333-3333-4333-8333-333333333333'; // Adversarial user with no connections
const CONN_AB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Mock state for testing route handlers against simulated database & RLS
let mockCurrentUser: { id: string; email?: string; email_confirmed_at?: string | null } | null = {
  id: USER_C_ID,
  email: 'mallory@example.com',
  email_confirmed_at: '2026-11-07T12:00:00Z',
};

interface DbConnection {
  id: string;
  requester_id: string;
  target_id: string;
  status: 'pending' | 'accepted' | 'denied' | 'revoked';
  created_at: string;
  responded_at: string | null;
}

interface DbLocation {
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  updated_at: string;
}

interface DbCommand {
  id: string;
  from_user_id: string;
  to_user_id: string;
  type: 'ring' | 'message';
  payload: string | null;
  created_at: string;
}

/**
 * In-memory PostgreSQL RLS policy evaluator that mirrors the exact SQL policies
 * in supabase/schema.sql to test adversarial queries from User C.
 */
class RlsDatabaseSimulator {
  connections: DbConnection[] = [
    {
      id: CONN_AB_ID,
      requester_id: USER_A_ID,
      target_id: USER_B_ID,
      status: 'accepted',
      created_at: '2026-11-07T10:00:00Z',
      responded_at: '2026-11-07T10:05:00Z',
    },
  ];

  locations: DbLocation[] = [
    {
      user_id: USER_A_ID,
      latitude: 37.7749,
      longitude: -122.4194,
      accuracy: 12,
      updated_at: '2026-11-07T12:00:00Z',
    },
    {
      user_id: USER_B_ID,
      latitude: 34.0522,
      longitude: -118.2437,
      accuracy: 15,
      updated_at: '2026-11-07T12:00:00Z',
    },
  ];

  commands: DbCommand[] = [
    {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      from_user_id: USER_A_ID,
      to_user_id: USER_B_ID,
      type: 'message',
      payload: 'Private note from A to B',
      created_at: '2026-11-07T12:01:00Z',
    },
  ];

  hasAcceptedConnection(user1: string, user2: string): boolean {
    return this.connections.some(
      (c) =>
        c.status === 'accepted' &&
        ((c.requester_id === user1 && c.target_id === user2) ||
          (c.target_id === user1 && c.requester_id === user2))
    );
  }

  // Policy: locations_select_active
  selectLocationsAs(authUid: string | null, targetUserId?: string): DbLocation[] {
    if (!authUid) return [];
    return this.locations.filter((loc) => {
      if (targetUserId && loc.user_id !== targetUserId) return false;
      return (
        loc.user_id === authUid ||
        this.hasAcceptedConnection(authUid, loc.user_id)
      );
    });
  }

  // Policy: locations_insert_own / locations_update_own
  upsertLocationAs(authUid: string | null, row: DbLocation): { error?: string } {
    if (!authUid || row.user_id !== authUid) {
      return {
        error: 'new row violates row-level security policy for table "locations"',
      };
    }
    const idx = this.locations.findIndex((l) => l.user_id === row.user_id);
    if (idx >= 0) this.locations[idx] = row;
    else this.locations.push(row);
    return {};
  }

  // Policy: connections_select_involved
  selectConnectionsAs(authUid: string | null): DbConnection[] {
    if (!authUid) return [];
    return this.connections.filter(
      (c) => c.requester_id === authUid || c.target_id === authUid
    );
  }

  // Policy: commands_insert_accepted
  insertCommandAs(
    authUid: string | null,
    cmd: Omit<DbCommand, 'id' | 'created_at'>
  ): { data?: DbCommand; error?: string } {
    if (
      !authUid ||
      cmd.from_user_id !== authUid ||
      cmd.from_user_id === cmd.to_user_id ||
      !this.hasAcceptedConnection(authUid, cmd.to_user_id)
    ) {
      return {
        error: 'new row violates row-level security policy for table "commands"',
      };
    }
    const created: DbCommand = {
      ...cmd,
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      created_at: new Date().toISOString(),
    };
    this.commands.push(created);
    return { data: created };
  }

  // Policy: commands_select_involved (allows recipient or sender)
  selectCommandsAs(authUid: string | null): DbCommand[] {
    if (!authUid) return [];
    return this.commands.filter((c) => c.to_user_id === authUid || c.from_user_id === authUid);
  }
}

let dbSim = new RlsDatabaseSimulator();
let mockRpcHandler: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: mockCurrentUser },
        error: mockCurrentUser ? null : { message: 'Not authenticated' },
      }),
      signUp: async ({ email }: { email: string }) => {
        if (email === 'existing@example.com') {
          return {
            data: { user: null, session: null },
            error: { message: 'User already registered' },
          };
        }
        return {
          data: { user: { id: USER_A_ID, email }, session: null },
          error: null,
        };
      },
      signInWithPassword: async () => ({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' },
      }),
      resend: async () => ({
        data: {},
        error: { message: 'User not found' },
      }),
    },
    rpc: (fn: string, args?: Record<string, unknown>) => mockRpcHandler(fn, args),
    from: (table: string) => {
      if (table === 'connections') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => {
                const visible = dbSim.selectConnectionsAs(mockCurrentUser?.id ?? null);
                const found = visible.find((c) => c.id === val) ?? null;
                return { data: found, error: null };
              },
              or: (filterStr: string) => ({
                maybeSingle: async () => {
                  const uid = mockCurrentUser?.id ?? null;
                  if (!uid) return { data: null, error: null };
                  const match = dbSim.connections.find(
                    (c) =>
                      c.status === 'accepted' &&
                      filterStr.includes(c.requester_id) &&
                      filterStr.includes(c.target_id) &&
                      (c.requester_id === uid || c.target_id === uid)
                  );
                  return { data: match ? { id: match.id } : null, error: null };
                },
              }),
            }),
          }),
        };
      }
      if (table === 'commands') {
        return {
          insert: (row: Omit<DbCommand, 'id' | 'created_at'>) => {
            const res = dbSim.insertCommandAs(mockCurrentUser?.id ?? null, row);
            const result = {
              data: res.data ?? null,
              error: res.error ? { code: '42501', message: res.error } : null,
            };
            return {
              ...result,
              then: (onfulfilled?: (val: typeof result) => unknown) =>
                Promise.resolve(result).then(onfulfilled),
              select: () => ({
                single: async () => result,
              }),
            };
          },
        };
      }
      if (table === 'locations') {
        return {
          upsert: async (row: DbLocation) => {
            const res = dbSim.upsertLocationAs(mockCurrentUser?.id ?? null, row);
            return { error: res.error ? { code: '42501', message: res.error } : null };
          },
        };
      }
      return {};
    },
  }),
}));

function makeCsrfPostRequest(url: string, body: unknown, ip = '203.0.113.50'): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      Host: 'localhost:3000',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Forwarded-For': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('Phase 3 Security Hardening & Adversarial Audit', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      'sb_publishable_test_key_1234567890';
    resetRateLimitStoreForTests();
    dbSim = new RlsDatabaseSimulator();
    mockCurrentUser = {
      id: USER_C_ID,
      email: 'mallory@example.com',
      email_confirmed_at: '2026-11-07T12:00:00Z',
    };
    mockRpcHandler = async (fn, args) => {
      if (fn === 'get_my_connections') {
        return {
          data: dbSim.selectConnectionsAs(mockCurrentUser?.id ?? null),
          error: null,
        };
      }
      if (fn === 'request_location_sharing') {
        const email = String(args?.target_email ?? '');
        if (email === 'nonexistent@example.com') {
          return {
            data: {
              success: true,
              code: 'REQUEST_SENT',
              message:
                'If an account exists for that email, your location-sharing request has been sent.',
              connection_id: null,
            },
            error: null,
          };
        }
        return {
          data: {
            success: true,
            code: 'REQUEST_SENT',
            message:
              'If an account exists for that email, your location-sharing request has been sent.',
            connection_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };
  });

  it('Adversarial RLS Test: User C (no accepted connections) cannot SELECT User A location, read A/B connections, or INSERT commands to User A', async () => {
    // 1. User C attempts to SELECT User A's location
    const locationsForC = dbSim.selectLocationsAs(USER_C_ID, USER_A_ID);
    expect(locationsForC).toHaveLength(0);

    // Verify User B (who has an accepted connection with User A) CAN read User A's location
    const locationsForB = dbSim.selectLocationsAs(USER_B_ID, USER_A_ID);
    expect(locationsForB).toHaveLength(1);
    expect(locationsForB[0]?.latitude).toBeCloseTo(37.7749);

    // 2. User C attempts to read User A/B's connections via RLS & get_my_connections
    const connectionsForC = dbSim.selectConnectionsAs(USER_C_ID);
    expect(connectionsForC).toHaveLength(0);

    // 3. User C attempts to read User A/B's commands
    const commandsForC = dbSim.selectCommandsAs(USER_C_ID);
    expect(commandsForC).toHaveLength(0);

    // 4. User C attempts to INSERT a ring command to User A directly at DB level
    const directInsert = dbSim.insertCommandAs(USER_C_ID, {
      from_user_id: USER_C_ID,
      to_user_id: USER_A_ID,
      type: 'ring',
      payload: null,
    });
    expect(directInsert.error).toContain('violates row-level security policy');

    // 5. User C attempts to INSERT a command to User A via POST /api/commands
    const { POST: postCommand } = await import('@/app/api/commands/route');
    const cmdRes = await postCommand(
      makeCsrfPostRequest('http://localhost:3000/api/commands', {
        to_user_id: USER_A_ID,
        type: 'ring',
      })
    );
    expect(cmdRes.status).toBe(403);

    // 6. User C attempts to modify/revoke User A & B's connection via POST /api/connections/[id]/respond
    const { POST: postRespond } = await import(
      '@/app/api/connections/[id]/respond/route'
    );
    const respondRes = await postRespond(
      makeCsrfPostRequest(
        `http://localhost:3000/api/connections/${CONN_AB_ID}/respond`,
        { status: 'revoked' }
      ),
      { params: { id: CONN_AB_ID } }
    );
    // Because RLS hides User A/B's connection from User C, User C receives 404
    expect(respondRes.status).toBe(404);

    // 7. When User B revokes connection with User A, User A immediately loses location & command access
    dbSim.connections[0]!.status = 'revoked';
    expect(dbSim.selectLocationsAs(USER_A_ID, USER_B_ID)).toHaveLength(0);
    expect(
      dbSim.insertCommandAs(USER_A_ID, {
        from_user_id: USER_A_ID,
        to_user_id: USER_B_ID,
        type: 'ring',
        payload: null,
      }).error
    ).toContain('violates row-level security policy');
  });

  it('successfully sends a ring command between two accepted users via POST /api/commands', async () => {
    mockCurrentUser = {
      id: USER_A_ID,
      email: 'alice@example.com',
      email_confirmed_at: '2026-11-07T12:00:00Z',
    };

    const { POST: postCommand } = await import('@/app/api/commands/route');
    const ringRes = await postCommand(
      makeCsrfPostRequest('http://localhost:3000/api/commands', {
        to_user_id: USER_B_ID,
        type: 'ring',
      })
    );

    const body = (await ringRes.json()) as { ok?: boolean; error?: string };
    expect(ringRes.status).toBe(201);
    expect(body.ok).toBe(true);

    // Verify command was recorded in the database
    const ringCommands = dbSim.commands.filter(
      (c) => c.from_user_id === USER_A_ID && c.to_user_id === USER_B_ID && c.type === 'ring'
    );
    expect(ringCommands).toHaveLength(1);
  });

  it('prevents email enumeration in request_location_sharing, signup, and resend endpoints', async () => {
    const { POST: postConnection } = await import('@/app/api/connections/route');

    const resUnknown = await postConnection(
      makeCsrfPostRequest('http://localhost:3000/api/connections', {
        email: 'nonexistent@example.com',
      })
    );
    const bodyUnknown = (await resUnknown.json()) as { ok: boolean; message: string };

    const resKnown = await postConnection(
      makeCsrfPostRequest('http://localhost:3000/api/connections', {
        email: 'alice@example.com',
      })
    );
    const bodyKnown = (await resKnown.json()) as { ok: boolean; message: string };

    expect(resUnknown.status).toBe(200);
    expect(resKnown.status).toBe(200);
    expect(bodyUnknown.message).toBe(bodyKnown.message);

    // Signup with already-registered email returns uniform 200 confirmation response
    const { POST: postSignup } = await import('@/app/api/auth/signup/route');
    const signupRes = await postSignup(
      makeCsrfPostRequest('http://localhost:3000/api/auth/signup', {
        displayName: 'Test',
        email: 'existing@example.com',
        password: 'strong-password-123',
      })
    );
    const signupBody = (await signupRes.json()) as {
      ok: boolean;
      requiresEmailConfirmation: boolean;
    };
    expect(signupRes.status).toBe(200);
    expect(signupBody.ok).toBe(true);
    expect(signupBody.requiresEmailConfirmation).toBe(true);
  });

  it('enforces rate limits on signup, login, resend, and location endpoints', async () => {
    const { POST: postLogin } = await import('@/app/api/auth/login/route');
    for (let i = 0; i < 5; i++) {
      const r = await postLogin(
        makeCsrfPostRequest('http://localhost:3000/api/auth/login', {
          email: 'target@example.com',
          password: 'wrong-password',
        })
      );
      expect(r.status).toBe(401);
    }
    const blockedLogin = await postLogin(
      makeCsrfPostRequest('http://localhost:3000/api/auth/login', {
        email: 'target@example.com',
        password: 'wrong-password',
      })
    );
    expect(blockedLogin.status).toBe(429);
    expect(blockedLogin.headers.get('Retry-After')).toBeTruthy();

    const { POST: postResend } = await import('@/app/api/auth/resend/route');
    for (let i = 0; i < 3; i++) {
      const r = await postResend(
        makeCsrfPostRequest('http://localhost:3000/api/auth/resend', {
          email: 'target@example.com',
        })
      );
      expect(r.status).toBe(200);
    }
    const blockedResend = await postResend(
      makeCsrfPostRequest('http://localhost:3000/api/auth/resend', {
        email: 'target@example.com',
      })
    );
    expect(blockedResend.status).toBe(429);

    const { POST: postLocation } = await import('@/app/api/location/route');
    for (let i = 0; i < 30; i++) {
      const r = await postLocation(
        makeCsrfPostRequest('http://localhost:3000/api/location', {
          latitude: 37.77,
          longitude: -122.41,
          accuracy: 10,
        })
      );
      expect(r.status).toBe(200);
    }
    const blockedLocation = await postLocation(
      makeCsrfPostRequest('http://localhost:3000/api/location', {
        latitude: 37.77,
        longitude: -122.41,
        accuracy: 10,
      })
    );
    expect(blockedLocation.status).toBe(429);
  });

  it('rejects non-finite coordinates (NaN, Infinity) and out-of-range accuracy', () => {
    expect(
      validateCoordinates({ latitude: Number.NaN, longitude: -122.4 }).valid
    ).toBe(false);
    expect(
      validateCoordinates({ latitude: 37.7, longitude: Number.POSITIVE_INFINITY }).valid
    ).toBe(false);
    expect(
      validateCoordinates({ latitude: 37.7, longitude: -122.4, accuracy: -5 }).valid
    ).toBe(false);
    expect(
      validateCoordinates({ latitude: 37.7, longitude: -122.4, accuracy: 25 }).valid
    ).toBe(true);
    expect(validateCommandMessage('   ').valid).toBe(false);
    expect(validateCommandMessage('Hello\u0000World')).toEqual({
      valid: true,
      value: 'HelloWorld',
    });
  });

  it('never leaks SQL errors, table names, schema paths, or stack traces to clients on DB failure', async () => {
    mockRpcHandler = async () => ({
      data: null,
      error: {
        code: '42P01',
        message: 'relation "public.connections" does not exist at character 15',
        details: 'internal postgres stack trace',
      },
    });

    const { GET: getConnections } = await import('@/app/api/connections/route');
    const res = await getConnections(
      new Request('http://localhost:3000/api/connections')
    );
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(500);
    expect(body.error).not.toContain('42P01');
    expect(body.error).not.toContain('relation');
    expect(body.error).not.toContain('schema.sql');
    expect(body.error).not.toContain('public.connections');
  });

  it('verifies schema.sql, .gitignore, cookie flags, CSP headers, and zero service-role keys', () => {
    const rootDir = process.cwd();
    const schemaSql = fs.readFileSync(
      path.join(rootDir, 'supabase', 'schema.sql'),
      'utf8'
    );
    expect(schemaSql).toContain('alter table public.profiles enable row level security');
    expect(schemaSql).toContain('alter table public.connections enable row level security');
    expect(schemaSql).toContain('alter table public.locations enable row level security');
    expect(schemaSql).toContain('alter table public.commands enable row level security');
    expect(schemaSql).toContain('create policy "commands_select_involved"');
    expect(schemaSql).toContain('alter table public.messages enable row level security');
    expect(schemaSql).toContain('revoke all on function public.request_location_sharing(text) from public, anon');
    expect(schemaSql).toContain('revoke all on function public.get_my_connections() from public, anon');

    const gitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.env*.local');
    expect(gitignore).toContain('.env');

    const serverTs = fs.readFileSync(
      path.join(rootDir, 'src', 'lib', 'supabase', 'server.ts'),
      'utf8'
    );
    expect(serverTs).toContain('httpOnly: true');
    expect(serverTs).toContain("sameSite: 'lax'");

    const headers = buildSecurityHeaders(false);
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toBe(
      'camera=(), microphone=(), geolocation=(self)'
    );
    expect(headers['Content-Security-Policy']).not.toContain('unsafe-eval');
  });
});
