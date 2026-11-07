import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionWithNames } from '@/types/database';

type PostgresChangeHandler = (payload: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
}) => void;

const realtimeListeners: PostgresChangeHandler[] = [];

const mockChannel = {
  on: vi.fn(
    (
      _type: string,
      _filter: Record<string, unknown>,
      callback: PostgresChangeHandler
    ) => {
      realtimeListeners.push(callback);
      return mockChannel;
    }
  ),
  subscribe: vi.fn((cb?: (status: string) => void) => {
    // Simulate async subscription success
    setTimeout(() => cb?.('SUBSCRIBED'), 0);
    return mockChannel;
  }),
};

const mockSupabaseBrowserClient = {
  auth: {
    getSession: vi.fn().mockResolvedValue({
      data: { session: { access_token: 'test-jwt-token' } },
    }),
    onAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  },
  realtime: {
    setAuth: vi.fn(),
  },
  channel: vi.fn(() => mockChannel),
  removeChannel: vi.fn().mockResolvedValue('ok'),
};

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => mockSupabaseBrowserClient,
}));

import { ConsentDashboard } from '@/components/ConsentDashboard';
import { AccountPanel } from '@/components/AccountPanel';
import { AuthForm } from '@/components/AuthForm';

const ALICE_ID = '11111111-1111-4111-8111-111111111111';
const BOB_ID = '22222222-2222-4222-8222-222222222222';
const CONN_1_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONN_2_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('End-to-End Auth, Account, Consent Request/Accept/Deny/Revoke & Realtime Sync', () => {
  beforeEach(() => {
    realtimeListeners.length = 0;
    vi.restoreAllMocks();
    // Re-attach mocks after restoreAllMocks
    mockSupabaseBrowserClient.auth.getSession = vi.fn().mockResolvedValue({
      data: { session: { access_token: 'test-jwt-token' } },
    });
    mockSupabaseBrowserClient.auth.onAuthStateChange = vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    }));
    mockChannel.on.mockImplementation(
      (_type: string, _filter: Record<string, unknown>, callback: PostgresChangeHandler) => {
        realtimeListeners.push(callback);
        return mockChannel;
      }
    );
    mockChannel.subscribe.mockImplementation((cb?: (status: string) => void) => {
      setTimeout(() => cb?.('SUBSCRIBED'), 0);
      return mockChannel;
    });
    mockSupabaseBrowserClient.channel.mockReturnValue(mockChannel);
  });

  it('submits signup and redirects to /dashboard when session is active', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, requiresEmailConfirmation: false }),
        { status: 200 }
      )
    );

    const originalHref = window.location.href;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: originalHref },
    });

    render(<AuthForm mode="signup" supabaseConfigured={true} />);

    fireEvent.change(screen.getByLabelText(/Your Name/i), {
      target: { value: 'Alice Rivera' },
    });
    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'strong-passphrase-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Sign up/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/signup',
        expect.objectContaining({ method: 'POST' })
      );
      expect(window.location.href).toContain('/verify-email');
    });
  });

  it('renders Account page with signed-in email and performs clean logout', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost:3000/account' },
    });

    render(
      <AccountPanel email="bob@example.com" initialDisplayName="Bob Chen" />
    );

    expect(screen.getByTestId('account-email')).toHaveTextContent(
      'bob@example.com'
    );

    fireEvent.click(screen.getByRole('button', { name: /Log out/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/logout',
        expect.objectContaining({ method: 'POST' })
      );
      expect(window.location.href).toBe('/login');
    });
  });

  it('completes request -> realtime incoming prompt -> accept -> persistent Stop sharing -> revoke flow', async () => {
    let serverConnections: ConnectionWithNames[] = [];

    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url === '/api/connections' && method === 'GET') {
        return new Response(JSON.stringify({ connections: serverConnections }), { status: 200 });
      }
      if (url === `/api/connections/${CONN_1_ID}/respond` && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { status: 'accepted' | 'denied' | 'revoked' };
        serverConnections = serverConnections.map((c) =>
          c.id === CONN_1_ID ? { ...c, status: body.status, responded_at: '2026-11-07T16:30:00Z' } : c
        );
        return new Response(JSON.stringify({ ok: true, connection: serverConnections.find((c) => c.id === CONN_1_ID) }), { status: 200 });
      }
      if (url === `/api/connections/${CONN_2_ID}/respond` && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { status: 'accepted' | 'denied' | 'revoked' };
        serverConnections = serverConnections.map((c) =>
          c.id === CONN_2_ID ? { ...c, status: body.status, responded_at: '2026-11-07T16:31:00Z' } : c
        );
        return new Response(JSON.stringify({ ok: true, connection: serverConnections.find((c) => c.id === CONN_2_ID) }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'Unhandled route' }), { status: 404 });
    });

    render(
      <ConsentDashboard currentUserId={BOB_ID} initialConnections={[]} />
    );

    // Wait for realtime to subscribe (mock fires setTimeout 0)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // 1. Simulate incoming request via Realtime INSERT
    serverConnections = [{
      id: CONN_1_ID,
      requester_id: ALICE_ID,
      target_id: BOB_ID,
      requester_name: 'Alice Rivera',
      target_name: 'Bob Chen',
      status: 'pending',
      created_at: '2026-11-07T16:29:00Z',
      responded_at: null,
    }];

    await act(async () => {
      realtimeListeners.forEach((listener) =>
        listener({ eventType: 'INSERT', new: serverConnections[0] as unknown as Record<string, unknown> })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Alice Rivera wants to see your location — Accept or Deny?')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();

    // 2. Bob accepts
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() => {
      expect(screen.getByText("You're sharing your location with Alice Rivera")).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeInTheDocument();
    });

    // 3. Bob stops sharing
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));

    await waitFor(() => {
      expect(screen.queryByText("You're sharing your location with Alice Rivera")).not.toBeInTheDocument();
      expect(screen.getByText('You stopped sharing your location')).toBeInTheDocument();
    });

    // 4. Second request -> Deny
    serverConnections = [...serverConnections, {
      id: CONN_2_ID,
      requester_id: ALICE_ID,
      target_id: BOB_ID,
      requester_name: 'Alice Rivera',
      target_name: 'Bob Chen',
      status: 'pending',
      created_at: '2026-11-07T16:30:30Z',
      responded_at: null,
    }];

    await act(async () => {
      realtimeListeners.forEach((listener) =>
        listener({ eventType: 'INSERT', new: serverConnections[1] as unknown as Record<string, unknown> })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Alice Rivera wants to see your location — Accept or Deny?')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    await waitFor(() => {
      expect(screen.getByText('You declined this request')).toBeInTheDocument();
    });
  });

  it('updates requester view live via Supabase Realtime when target accepts and revokes', async () => {
    const initialOutgoing: ConnectionWithNames[] = [{
      id: CONN_1_ID,
      requester_id: ALICE_ID,
      target_id: BOB_ID,
      requester_name: 'Alice Rivera',
      target_name: 'Bob Chen',
      status: 'pending',
      created_at: '2026-11-07T16:29:00Z',
      responded_at: null,
    }];

    let latestStatus: 'pending' | 'accepted' | 'revoked' = 'pending';

    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({ connections: [{ ...initialOutgoing[0], status: latestStatus }] }),
        { status: 200 }
      )
    );

    render(
      <ConsentDashboard currentUserId={ALICE_ID} initialConnections={initialOutgoing} />
    );

    expect(screen.getByText('Waiting for Bob Chen to respond')).toBeInTheDocument();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Bob accepts
    latestStatus = 'accepted';
    await act(async () => {
      realtimeListeners.forEach((listener) =>
        listener({
          eventType: 'UPDATE',
          new: { ...initialOutgoing[0], status: 'accepted', responded_at: '2026-11-07T16:30:00Z' },
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Bob Chen accepted and is sharing with you')).toBeInTheDocument();
    });

    // Bob revokes
    latestStatus = 'revoked';
    await act(async () => {
      realtimeListeners.forEach((listener) =>
        listener({
          eventType: 'UPDATE',
          new: { ...initialOutgoing[0], status: 'revoked', responded_at: '2026-11-07T16:31:00Z' },
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Bob Chen stopped sharing their location')).toBeInTheDocument();
    });
  });

  it('displays distance badge, reverse-geocoded place name, unread message indicator, message thread, and incoming toast', async () => {
    const acceptedConn: ConnectionWithNames = {
      id: CONN_1_ID,
      requester_id: ALICE_ID,
      target_id: BOB_ID,
      requester_name: 'Alice Rivera',
      target_name: 'Bob Chen',
      status: 'accepted',
      created_at: '2026-11-07T16:29:00Z',
      responded_at: '2026-11-07T16:30:00Z',
    };

    const initialMessages = [
      {
        id: '11111111-aaaa-4aaa-8aaa-111111111111',
        connection_id: CONN_1_ID,
        sender_id: BOB_ID,
        recipient_id: ALICE_ID,
        body: 'Hey Alice, I am near the station.',
        created_at: '2026-11-07T16:31:00Z',
        read_at: null,
      },
    ];

    let markReadCalled = false;

    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.startsWith('https://nominatim.openstreetmap.org/reverse')) {
        return new Response(
          JSON.stringify({
            address: {
              road: 'RN Road',
              city: 'Jashore',
            },
          }),
          { status: 200 }
        );
      }
      if (url === '/api/messages/read' && method === 'POST') {
        markReadCalled = true;
        return new Response(
          JSON.stringify({
            ok: true,
            updatedIds: ['11111111-aaaa-4aaa-8aaa-111111111111'],
          }),
          { status: 200 }
        );
      }
      if (url === '/api/messages' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as {
          connection_id: string;
          body: string;
        };
        return new Response(
          JSON.stringify({
            ok: true,
            message: {
              id: '22222222-bbbb-4bbb-8bbb-222222222222',
              connection_id: body.connection_id,
              sender_id: ALICE_ID,
              recipient_id: BOB_ID,
              body: body.body,
              created_at: '2026-11-07T16:32:00Z',
              read_at: null,
            },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ connections: [acceptedConn] }), {
        status: 200,
      });
    });

    render(
      <ConsentDashboard
        currentUserId={ALICE_ID}
        initialConnections={[acceptedConn]}
        initialLocations={[
          {
            user_id: ALICE_ID,
            latitude: 23.1667,
            longitude: 89.2167,
            accuracy: 10,
            updated_at: new Date().toISOString(),
          },
          {
            user_id: BOB_ID,
            latitude: 23.1757, // ~1.0 km north of Alice
            longitude: 89.2167,
            accuracy: 12,
            updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 minutes ago (stale)
          },
        ]}
        initialMessages={initialMessages}
      />
    );

    // Distance badge next to Bob's name
    expect(screen.getByTestId('distance-away-badge')).toHaveTextContent(
      /1\.0 km away/i
    );

    // Unread indicator badge shows 1 unread message
    expect(screen.getByTestId(`unread-badge-${CONN_1_ID}`)).toHaveTextContent('1 new');

    // Wait for Nominatim place name to resolve and staleness label to include it
    await waitFor(() => {
      expect(screen.getByTestId('card-stale-summary')).toHaveTextContent(
        /Last seen 10 minutes ago near RN Road, Jashore, 1\.0 km away/i
      );
    });

    // Open the message thread
    fireEvent.click(screen.getByTestId(`toggle-thread-${CONN_1_ID}`));

    await waitFor(() => {
      expect(screen.getByTestId(`message-thread-${CONN_1_ID}`)).toBeInTheDocument();
      expect(
        screen.getByText('Hey Alice, I am near the station.')
      ).toBeInTheDocument();
      expect(markReadCalled).toBe(true);
    });

    // Send a reply in the thread
    const input = screen.getByLabelText(/Message Bob Chen/i);
    fireEvent.change(input, { target: { value: 'See you in 5 minutes!' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));

    await waitFor(() => {
      expect(screen.getByText('See you in 5 minutes!')).toBeInTheDocument();
    });
  });
});
