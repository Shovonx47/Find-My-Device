'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  AlertTriangle,
  Loader2,
  MessageSquare,
  Radio,
  Send,
  ShieldOff,
  ShieldX,
  Volume2,
  X,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ActiveConnectionCard } from '@/components/ActiveConnectionCard';
import { FloatingChatWidget } from '@/components/FloatingChatWidget';
import { apiGet, apiPost } from '@/lib/api-client';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  calculateDistanceMeters,
  isAudioUnlocked,
  playMessageTickSound,
  playRingTone,
  stopRingTone,
  unlockAudio,
} from '@/lib/utils';
import type { ConsentUpdateAction } from '@/lib/validation';
import type {
  CommandRecord,
  Connection,
  ConnectionStatus,
  ConnectionWithNames,
  MessageRecord,
  UserLocation,
} from '@/types/database';

interface ConsentDashboardProps {
  currentUserId: string;
  initialConnections: ConnectionWithNames[];
  initialLocations?: UserLocation[];
  initialMessages?: MessageRecord[];
  schemaError?: string | null;
  realtimeAccessToken?: string | null;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  pending: 'Waiting',
  accepted: 'Sharing',
  denied: 'Declined',
  revoked: 'Stopped',
};

export function ConsentDashboard({
  currentUserId,
  initialConnections,
  initialLocations = [],
  initialMessages = [],
  schemaError,
  realtimeAccessToken = null,
}: ConsentDashboardProps) {
  const [connections, setConnections] =
    useState<ConnectionWithNames[]>(initialConnections);
  const [locationsMap, setLocationsMap] = useState<
    Record<string, UserLocation>
  >(() => {
    const map: Record<string, UserLocation> = {};
    for (const loc of initialLocations) {
      map[loc.user_id] = loc;
    }
    return map;
  });
  const [messages, setMessages] = useState<MessageRecord[]>(initialMessages);
  const [openChatConnectionId, setOpenChatConnectionId] = useState<string | null>(null);
  const openChatConnectionIdRef = useRef<string | null>(null);

  const [targetEmail, setTargetEmail] = useState('');
  const [sendingRequest, setSendingRequest] = useState(false);
  const [requestFeedback, setRequestFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyConnectionIds, setBusyConnectionIds] = useState<
    Record<string, boolean>
  >({});
  const [realtimeState, setRealtimeState] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('connecting');

  // Geolocation state
  const [geoError, setGeoError] = useState<string | null>(null);
  const lastLocationRef = useRef<{
    lat: number;
    lng: number;
    time: number;
  } | null>(null);
  const watchIdRef = useRef<number | null>(null);

  // Incoming alerts (Ring & New Unread Message Toast when thread is closed)
  const [activeRingAlert, setActiveRingAlert] = useState<{
    fromName: string;
    id: string;
  } | null>(null);
  const [activeMessageAlert, setActiveMessageAlert] = useState<{
    fromName: string;
    text: string;
    id: string;
    connectionId?: string;
  } | null>(null);

  const isRefreshingRef = useRef(false);
  const queuedRefreshRef = useRef(false);

  // Sound & Web Audio autoplay permission state
  const [soundAllowed, setSoundAllowed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isEnabledInSession =
      window.sessionStorage?.getItem('fmd_sound_enabled') === '1';
    if (isEnabledInSession || isAudioUnlocked()) {
      setSoundAllowed(true);
    }
    const checkStatus = () => {
      if (isAudioUnlocked()) {
        setSoundAllowed(true);
      }
    };
    window.addEventListener('click', checkStatus, { passive: true });
    window.addEventListener('keydown', checkStatus, { passive: true });
    return () => {
      window.removeEventListener('click', checkStatus);
      window.removeEventListener('keydown', checkStatus);
    };
  }, []);

  useEffect(() => {
    openChatConnectionIdRef.current = openChatConnectionId;
  }, [openChatConnectionId]);

  const refreshConnections = useCallback(async () => {
    if (isRefreshingRef.current) {
      queuedRefreshRef.current = true;
      return;
    }
    isRefreshingRef.current = true;
    try {
      const response = await apiGet<{ connections: ConnectionWithNames[] }>(
        '/api/connections'
      );
      if (response.ok && response.data) {
        setConnections(response.data.connections);
      }
    } finally {
      isRefreshingRef.current = false;
      if (queuedRefreshRef.current) {
        queuedRefreshRef.current = false;
        void refreshConnections();
      }
    }
  }, []);

  useEffect(() => {
    if (document.visibilityState === 'visible') void refreshConnections();
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') void refreshConnections();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refreshConnections]);

  // Derived connection lists
  const acceptedConnections = useMemo(
    () => connections.filter((c) => c.status === 'accepted'),
    [connections]
  );
  const pendingIncomingRequests = useMemo(
    () =>
      connections.filter(
        (c) => c.target_id === currentUserId && c.status === 'pending'
      ),
    [connections, currentUserId]
  );
  const outgoingRequests = useMemo(
    () => connections.filter((c) => c.requester_id === currentUserId),
    [connections, currentUserId]
  );
  const pastIncomingRequests = useMemo(
    () =>
      connections.filter(
        (c) =>
          c.target_id === currentUserId &&
          (c.status === 'denied' || c.status === 'revoked')
      ),
    [connections, currentUserId]
  );

  // Group messages by connection_id
  const messagesByConnection = useMemo(() => {
    const grouped: Record<string, MessageRecord[]> = {};
    for (const msg of messages) {
      if (!grouped[msg.connection_id]) {
        grouped[msg.connection_id] = [];
      }
      grouped[msg.connection_id]!.push(msg);
    }
    return grouped;
  }, [messages]);

  const handleMessageSent = useCallback((newMsg: MessageRecord) => {
    setMessages((prev) =>
      prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]
    );
  }, []);

  const handleMarkThreadRead = useCallback(
    (connectionId: string, readAt: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.connection_id === connectionId &&
            m.recipient_id === currentUserId &&
            !m.read_at
            ? { ...m, read_at: readAt }
            : m
        )
      );
    },
    [currentUserId]
  );

  // ── 1. GEOLOCATION TRACKING ───────────────────────────────────────────────
  // Automatically track and broadcast location only when an accepted connection exists.
  useEffect(() => {
    const hasActiveSharing = acceptedConnections.length > 0;

    if (!hasActiveSharing) {
      if (watchIdRef.current !== null && typeof navigator !== 'undefined') {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setGeoError(null);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError('Location is not supported by your browser.');
      return;
    }

    async function sendLocationUpdate(
      lat: number,
      lng: number,
      acc: number | null
    ) {
      await apiPost('/api/location', {
        latitude: lat,
        longitude: lng,
        accuracy: acc,
      });
    }

    function handlePosition(pos: GeolocationPosition) {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = pos.coords.accuracy || null;
      const now = Date.now();
      const isoNow = new Date(now).toISOString();

      // Update current user's own location in local map state immediately so
      // straight-line distance ("X km away") is always up to date
      setLocationsMap((prev) => ({
        ...prev,
        [currentUserId]: {
          user_id: currentUserId,
          latitude: lat,
          longitude: lng,
          accuracy: acc,
          updated_at: isoNow,
        },
      }));

      // Throttle network writes: send if 15 seconds have passed OR moved > 25 meters
      if (lastLocationRef.current) {
        const timeDiff = (now - lastLocationRef.current.time) / 1000;
        const dist = calculateDistanceMeters(
          lastLocationRef.current.lat,
          lastLocationRef.current.lng,
          lat,
          lng
        );

        if (timeDiff < 15 && dist < 25) {
          return;
        }
      }

      lastLocationRef.current = { lat, lng, time: now };
      setGeoError(null);
      void sendLocationUpdate(lat, lng, acc);
    }

    function handleError(err: GeolocationPositionError) {
      if (err.code === err.PERMISSION_DENIED) {
        setGeoError(
          'Location access is turned off. To let connected friends see where you are, please allow location permissions in your browser.'
        );
      }
    }

    try {
      const watchId = navigator.geolocation.watchPosition(
        handlePosition,
        handleError,
        {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 15000,
        }
      );
      watchIdRef.current = watchId;
    } catch {
      // Graceful fallback
    }

    return () => {
      if (watchIdRef.current !== null && typeof navigator !== 'undefined') {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [acceptedConnections.length, currentUserId]);

  // ── 2. REALTIME SUBSCRIPTIONS (Connections, Locations, Commands, Messages) ─
  useEffect(() => {
    let isMounted = true;
    const supabase = createSupabaseBrowserClient();
    let activeChannel: ReturnType<typeof supabase.channel> | null = null;

    async function setupRealtime() {
      let session: { access_token?: string } | null = null;
      try {
        const result = await supabase.auth.getSession();
        session = result?.data?.session ?? null;
      } catch {
        // Fallback for tests
      }

      if (!isMounted) return;
      const token = realtimeAccessToken ?? session?.access_token ?? null;
      if (token) supabase.realtime.setAuth(token);

      activeChannel = supabase
        .channel(`dashboard-realtime-${currentUserId}`)
        // Listen to connections table changes
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'connections' },
          (payload) => {
            if (!isMounted) return;
            if (payload.eventType === 'UPDATE' && payload.new) {
              const updatedRow = payload.new as Connection;
              setConnections((prev) =>
                prev.some((item) => item.id === updatedRow.id)
                  ? prev.map((item) =>
                    item.id === updatedRow.id
                      ? {
                        ...item,
                        status: updatedRow.status,
                        responded_at: updatedRow.responded_at,
                      }
                      : item
                  )
                  : prev
              );
            } else if (payload.eventType === 'DELETE' && payload.old) {
              const deletedId = (payload.old as { id?: string }).id;
              if (deletedId) {
                setConnections((prev) =>
                  prev.filter((item) => item.id !== deletedId)
                );
              }
            }
            void refreshConnections();
          }
        )
        // Listen to locations table changes for live map movements
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'locations' },
          (payload) => {
            if (!isMounted) return;
            if (
              (payload.eventType === 'INSERT' ||
                payload.eventType === 'UPDATE') &&
              payload.new
            ) {
              const updatedLoc = payload.new as UserLocation;
              setLocationsMap((prev) => ({
                ...prev,
                [updatedLoc.user_id]: updatedLoc,
              }));
            }
          }
        )
        // Listen to commands table for incoming Ring alerts
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'commands' },
          (payload) => {
            if (!isMounted) return;
            const cmd = payload.new as CommandRecord;
            if (cmd.to_user_id !== currentUserId) return;

            const senderConn = connections.find(
              (c) =>
                (c.requester_id === cmd.from_user_id ||
                  c.target_id === cmd.from_user_id) &&
                c.status === 'accepted'
            );
            const fromName = senderConn
              ? senderConn.requester_id === cmd.from_user_id
                ? senderConn.requester_name
                : senderConn.target_name
              : 'Someone you share with';

            if (cmd.type === 'ring') {
              playRingTone();
              setActiveRingAlert({ fromName, id: cmd.id });
            } else if (cmd.type === 'message') {
              playMessageTickSound();
              setActiveMessageAlert({
                fromName,
                text: cmd.payload || '',
                id: cmd.id,
                connectionId: senderConn?.id,
              });
            }
          }
        )
        // Listen to messages table for real-time conversation thread updates
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'messages' },
          (payload) => {
            if (!isMounted) return;
            if (payload.eventType === 'INSERT' && payload.new) {
              const newMsg = payload.new as MessageRecord;
              setMessages((prev) =>
                prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]
              );

              // Play polite message tick sound whenever an incoming message arrives
              if (newMsg.recipient_id === currentUserId) {
                playMessageTickSound();

                // Show a brief toast/banner if the recipient's thread for this connection isn't open
                if (openChatConnectionIdRef.current !== newMsg.connection_id) {
                  const senderConn = connections.find(
                    (c) => c.id === newMsg.connection_id
                  );
                  const fromName = senderConn
                    ? senderConn.requester_id === newMsg.sender_id
                      ? senderConn.requester_name
                      : senderConn.target_name
                    : 'Someone you share with';

                  setActiveMessageAlert({
                    fromName,
                    text: newMsg.body,
                    id: newMsg.id,
                    connectionId: newMsg.connection_id,
                  });
                }
              }
            } else if (payload.eventType === 'UPDATE' && payload.new) {
              const updatedMsg = payload.new as MessageRecord;
              setMessages((prev) =>
                prev.map((m) => (m.id === updatedMsg.id ? updatedMsg : m))
              );
            }
          }
        )
        .subscribe((status) => {
          if (!isMounted) return;
          if (status === 'SUBSCRIBED') setRealtimeState('connected');
          else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status))
            setRealtimeState('disconnected');
          else setRealtimeState('connecting');
        });
    }

    void setupRealtime();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      if (activeChannel) void supabase.removeChannel(activeChannel);
    };
  }, [currentUserId, refreshConnections, connections, realtimeAccessToken]);

  async function handleSendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestFeedback(null);
    setSendingRequest(true);
    const response = await apiPost<{ ok: boolean; message: string }>(
      '/api/connections',
      {
        email: targetEmail,
      }
    );
    setSendingRequest(false);
    if (!response.ok || !response.data) {
      setRequestFeedback({
        type: 'error',
        text: response.error ?? 'Unable to send request. Please try again.',
      });
      return;
    }
    setTargetEmail('');
    setRequestFeedback({ type: 'success', text: response.data.message });
    await refreshConnections();
  }

  async function handleConsentDecision(
    connectionId: string,
    action: ConsentUpdateAction
  ) {
    setActionError(null);
    setBusyConnectionIds((prev) => ({ ...prev, [connectionId]: true }));
    const response = await apiPost<{ ok: boolean; connection: Connection }>(
      `/api/connections/${connectionId}/respond`,
      { status: action }
    );
    setBusyConnectionIds((prev) => ({ ...prev, [connectionId]: false }));

    if (!response.ok || !response.data) {
      setActionError(
        response.error ?? 'Could not update request. Please try again.'
      );
      return;
    }
    const updated = response.data.connection;
    setConnections((prev) =>
      prev.map((item) =>
        item.id === updated.id
          ? {
            ...item,
            status: updated.status,
            responded_at: updated.responded_at,
          }
          : item
      )
    );
  }

  return (
    <div className="space-y-6">
      {/* Incoming Ring Modal / Alert */}
      {activeRingAlert && (
        <div
          role="alertdialog"
          className="rounded-2xl border-2 border-teal-500 bg-teal-600 p-5 text-white shadow-xl animate-bounceOnce"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 shrink-0">
                <Volume2 className="h-6 w-6 text-white animate-pulse" />
              </div>
              <div>
                <h3 className="text-lg font-bold tracking-tight">
                  {activeRingAlert.fromName} is ringing your device!
                </h3>
                <p className="text-xs text-teal-100">
                  An audible alert tone is playing on this screen.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                stopRingTone();
                setActiveRingAlert(null);
              }}
              className="bg-white text-slate-900 hover:bg-teal-50 border-white shrink-0 min-h-[40px]"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Incoming Message Toast / Banner (shown when thread isn't currently open) */}
      {activeMessageAlert && (
        <div
          role="alert"
          data-testid="incoming-message-toast"
          className="rounded-2xl border border-teal-200 bg-teal-50/90 p-4 shadow-md animate-fadeIn"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600 text-white shrink-0 mt-0.5">
                <MessageSquare className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-teal-900 uppercase tracking-wide">
                  New message from {activeMessageAlert.fromName}
                </p>
                <p className="text-sm font-medium text-slate-900 mt-0.5">
                  &ldquo;{activeMessageAlert.text}&rdquo;
                </p>
                {activeMessageAlert.connectionId && (
                  <button
                    type="button"
                    onClick={() => {
                      const connId = activeMessageAlert.connectionId;
                      if (connId) {
                        setOpenChatConnectionId(connId);
                      }
                      setActiveMessageAlert(null);
                    }}
                    className="mt-1.5 text-xs font-semibold text-teal-700 hover:text-teal-800 underline"
                  >
                    Open conversation
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveMessageAlert(null)}
              aria-label="Close message"
              className="rounded-lg p-1 text-slate-400 hover:bg-teal-100 hover:text-slate-700 transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Page Heading & Status */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Location Sharing
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            See who can see your location and respond to sharing requests.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!soundAllowed && (
            <button
              type="button"
              data-testid="enable-sound-btn"
              onClick={async () => {
                const ok = await unlockAudio();
                if (ok) {
                  setSoundAllowed(true);
                  playMessageTickSound();
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 transition shadow-sm"
              title="Click to allow audio ringtones and notification sounds in your browser"
            >
              <Volume2 className="h-3.5 w-3.5 text-teal-600 animate-pulse" />
              <span>Enable sound</span>
            </button>
          )}

          <div
            aria-live="polite"
            className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm"
          >
            <span
              className={`h-2 w-2 rounded-full ${realtimeState === 'connected'
                ? 'bg-teal-500'
                : realtimeState === 'connecting'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-rose-500'
                }`}
            />
            <Radio className="h-3 w-3" />
            <span>
              {realtimeState === 'connected'
                ? 'Connected'
                : realtimeState === 'connecting'
                  ? 'Updating…'
                  : 'Reconnecting…'}
            </span>
          </div>
        </div>
      </div>

      {geoError && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Location permission needed</AlertTitle>
          <AlertDescription>{geoError}</AlertDescription>
        </Alert>
      )}

      {schemaError && (
        <Alert variant="warning">
          <AlertTitle>Notice</AlertTitle>
          <AlertDescription>{schemaError}</AlertDescription>
        </Alert>
      )}

      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {/* ── 1. ACTIVE CONNECTIONS (MAP + RING + MESSAGE THREAD) ──────────── */}
      {acceptedConnections.length > 0 && (
        <section
          aria-labelledby="active-sharing-heading"
          className="space-y-4"
        >
          <div className="flex items-center gap-2">
            <h2
              id="active-sharing-heading"
              className="text-lg font-bold text-slate-900"
            >
              Active Connections
            </h2>
            <Badge variant="accepted">
              {acceptedConnections.length} active
            </Badge>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {acceptedConnections.map((conn) => {
              const otherUserId =
                conn.requester_id === currentUserId
                  ? conn.target_id
                  : conn.requester_id;
              const otherUserLocation = locationsMap[otherUserId] || null;
              const currentUserLocation = locationsMap[currentUserId] || null;

              return (
                <div key={conn.id} data-testid={`active-share-${conn.id}`}>
                  <ActiveConnectionCard
                    connection={conn}
                    currentUserId={currentUserId}
                    location={otherUserLocation}
                    currentUserLocation={currentUserLocation}
                    messages={messagesByConnection[conn.id] ?? []}
                    isThreadOpen={openChatConnectionId === conn.id}
                    onToggleThread={() => {
                      setOpenChatConnectionId((prev) => {
                        const nextId = prev === conn.id ? null : conn.id;
                        if (
                          nextId &&
                          activeMessageAlert?.connectionId === conn.id
                        ) {
                          setActiveMessageAlert(null);
                        }
                        return nextId;
                      });
                    }}
                    onMarkThreadRead={handleMarkThreadRead}
                    onStopSharing={(id) =>
                      handleConsentDecision(id, 'revoked')
                    }
                    isStopping={Boolean(busyConnectionIds[conn.id])}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 2. REQUESTS FOR YOUR LOCATION ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldOff className="h-5 w-5 text-slate-500 shrink-0" />
              <CardTitle>Requests for Your Location</CardTitle>
            </div>
            {pendingIncomingRequests.length > 0 && (
              <Badge variant="pending">
                {pendingIncomingRequests.length} new
              </Badge>
            )}
          </div>
          <CardDescription>
            People who have asked to see your location.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingIncomingRequests.length === 0 ? (
            <p className="text-sm text-slate-400 italic">
              No new requests right now.
            </p>
          ) : (
            <ul className="space-y-3.5">
              {pendingIncomingRequests.map((conn) => {
                const isBusy = Boolean(busyConnectionIds[conn.id]);
                return (
                  <li
                    key={conn.id}
                    data-testid={`pending-request-${conn.id}`}
                    className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 sm:p-5"
                  >
                    <p className="text-base font-bold text-slate-900">
                      {conn.requester_name} wants to see your location — Accept
                      or Deny?
                    </p>
                    <div className="mt-4 flex flex-col sm:flex-row gap-2">
                      <Button
                        variant="success"
                        size="sm"
                        disabled={isBusy}
                        onClick={() =>
                          handleConsentDecision(conn.id, 'accepted')
                        }
                        className="w-full sm:w-auto min-h-[38px]"
                      >
                        {isBusy && (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        )}
                        Accept
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isBusy}
                        onClick={() =>
                          handleConsentDecision(conn.id, 'denied')
                        }
                        className="w-full sm:w-auto min-h-[38px]"
                      >
                        Deny
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── 3. SHARE LOCATION WITH SOMEONE ────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Send className="h-5 w-5 text-slate-500 shrink-0" />
            <CardTitle>Share location with someone</CardTitle>
          </div>
          <CardDescription>
            Enter a registered user&apos;s email address to ask to connect.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSendRequest}
            className="flex flex-col gap-2.5 sm:flex-row"
          >
            <label htmlFor="targetEmail" className="sr-only">
              Email address
            </label>
            <Input
              id="targetEmail"
              name="targetEmail"
              type="email"
              required
              maxLength={254}
              placeholder="friend@example.com"
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={sendingRequest}
              className="w-full sm:w-auto min-h-[40px] shrink-0"
            >
              {sendingRequest && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Send request
            </Button>
          </form>
          {requestFeedback && (
            <Alert
              variant={
                requestFeedback.type === 'error' ? 'destructive' : 'success'
              }
              className="mt-3"
            >
              <AlertDescription>{requestFeedback.text}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* ── 4. REQUESTS YOU SENT ───────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Requests You Sent</CardTitle>
          <CardDescription>
            Track the status of requests you sent to other people.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {outgoingRequests.length === 0 ? (
            <p className="text-sm text-slate-400 italic">
              You haven&apos;t sent any requests yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {outgoingRequests.map((conn) => (
                <li
                  key={conn.id}
                  data-testid={`outgoing-request-${conn.id}`}
                  className="flex flex-col justify-between gap-2 py-3.5 sm:flex-row sm:items-center"
                >
                  <div className="pr-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {conn.target_name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {conn.status === 'pending' &&
                        `Waiting for ${conn.target_name} to respond`}
                      {conn.status === 'accepted' &&
                        `${conn.target_name} accepted and is sharing with you`}
                      {conn.status === 'denied' &&
                        `${conn.target_name} declined your request`}
                      {conn.status === 'revoked' &&
                        `${conn.target_name} stopped sharing their location`}
                    </p>
                  </div>
                  <Badge
                    variant={conn.status as ConnectionStatus}
                    className="self-start sm:self-center shrink-0"
                  >
                    {STATUS_LABEL[conn.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── 5. PAST REQUESTS ──────────────────────────────────────────────── */}
      {pastIncomingRequests.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldX className="h-5 w-5 text-slate-400 shrink-0" />
              <CardTitle>Past Requests</CardTitle>
            </div>
            <CardDescription>
              Requests you previously declined or stopped sharing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {pastIncomingRequests.map((conn) => (
                <li
                  key={conn.id}
                  className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {conn.requester_name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {conn.status === 'denied'
                        ? 'You declined this request'
                        : 'You stopped sharing your location'}
                    </p>
                  </div>
                  <Badge
                    variant={conn.status as ConnectionStatus}
                    className="self-start sm:self-center shrink-0"
                  >
                    {STATUS_LABEL[conn.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Floating Messenger-Style Chat Widget */}
      {acceptedConnections.length > 0 && (
        <FloatingChatWidget
          connections={acceptedConnections}
          currentUserId={currentUserId}
          messagesByConnection={messagesByConnection}
          openConnectionId={openChatConnectionId}
          onOpen={(connId) => {
            setOpenChatConnectionId(connId);
            if (activeMessageAlert?.connectionId === connId) {
              setActiveMessageAlert(null);
            }
          }}
          onClose={() => setOpenChatConnectionId(null)}
          onMessageSent={handleMessageSent}
          onMarkThreadRead={handleMarkThreadRead}
        />
      )}
    </div>
  );
}
