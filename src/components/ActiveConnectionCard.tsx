'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Loader2,
  MapPin,
  MapPinOff,
  MessageSquare,
  Navigation,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DeviceMap } from '@/components/DeviceMap';
import { apiPost } from '@/lib/api-client';
import {
  calculateDistanceMeters,
  formatDistanceAway,
  formatLocationStatusLabel,
  reverseGeocodePlace,
} from '@/lib/utils';
import type {
  ConnectionWithNames,
  MessageRecord,
  UserLocation,
} from '@/types/database';

interface ActiveConnectionCardProps {
  connection: ConnectionWithNames;
  currentUserId: string;
  location?: UserLocation | null;
  currentUserLocation?: UserLocation | null;
  messages?: MessageRecord[];
  isThreadOpen?: boolean;
  onToggleThread?: () => void;
  onMarkThreadRead?: (connectionId: string, readAt: string) => void;
  onStopSharing?: (connectionId: string) => void;
  isStopping?: boolean;
}

export function ActiveConnectionCard({
  connection,
  currentUserId,
  location,
  currentUserLocation,
  messages = [],
  isThreadOpen = false,
  onToggleThread,
  onMarkThreadRead,
  onStopSharing,
  isStopping = false,
}: ActiveConnectionCardProps) {
  const isRequester = connection.requester_id === currentUserId;
  const otherUserId = isRequester
    ? connection.target_id
    : connection.requester_id;
  const otherUserName = isRequester
    ? connection.target_name
    : connection.requester_name;

  const [ringing, setRinging] = useState(false);
  const [ringStatus, setRingStatus] = useState<string | null>(null);

  const [localThreadOpen, setLocalThreadOpen] = useState(false);
  const threadOpen = onToggleThread ? isThreadOpen : localThreadOpen;

  const [placeName, setPlaceName] = useState<string | null>(null);
  const lastGeocodedCoordsRef = useRef<{ lat: number; lng: number } | null>(
    null
  );

  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Periodic tick so staleness ("Updated X ago" -> "Last seen X ago...") updates live
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  // Straight-line Haversine distance between current user and the other person
  const distanceLabel = useMemo(() => {
    if (
      !location ||
      !currentUserLocation ||
      !Number.isFinite(location.latitude) ||
      !Number.isFinite(location.longitude) ||
      !Number.isFinite(currentUserLocation.latitude) ||
      !Number.isFinite(currentUserLocation.longitude)
    ) {
      return null;
    }
    const meters = calculateDistanceMeters(
      currentUserLocation.latitude,
      currentUserLocation.longitude,
      location.latitude,
      location.longitude
    );
    return formatDistanceAway(meters);
  }, [
    location,
    currentUserLocation,
  ]);

  // Reverse-geocode the other person's coordinates via Nominatim only when moved >100m
  useEffect(() => {
    let cancelled = false;
    const lat = location?.latitude;
    const lng = location?.longitude;

    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      return;
    }

    if (lastGeocodedCoordsRef.current) {
      const movedMeters = calculateDistanceMeters(
        lastGeocodedCoordsRef.current.lat,
        lastGeocodedCoordsRef.current.lng,
        lat,
        lng
      );
      if (movedMeters <= 100 && placeName) {
        return;
      }
    }

    lastGeocodedCoordsRef.current = { lat, lng };

    void reverseGeocodePlace(lat, lng).then((resolved) => {
      if (!cancelled && resolved) {
        setPlaceName(resolved);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [location?.latitude, location?.longitude, placeName]);

  // Sort messages oldest to newest
  const sortedMessages = useMemo(
    () =>
      [...messages].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
    [messages]
  );

  // Count unread incoming messages
  const unreadCount = useMemo(
    () =>
      sortedMessages.filter(
        (m) => m.recipient_id === currentUserId && !m.read_at
      ).length,
    [sortedMessages, currentUserId]
  );

  // Mark unread messages as read when the recipient has the thread open
  useEffect(() => {
    if (!threadOpen || unreadCount === 0) return;

    let cancelled = false;
    const optimisticReadAt = new Date().toISOString();
    onMarkThreadRead?.(connection.id, optimisticReadAt);

    void apiPost<{ ok: boolean; readAt: string }>('/api/messages/read', {
      connection_id: connection.id,
    }).then((res) => {
      if (!cancelled && res.ok && res.data?.readAt) {
        onMarkThreadRead?.(connection.id, res.data.readAt);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [threadOpen, unreadCount, connection.id, onMarkThreadRead]);

  const statusInfo = formatLocationStatusLabel({
    updatedAt: location?.updated_at,
    placeName,
    distanceLabel,
    nowMs,
  });

  async function handleRing() {
    setRinging(true);
    setRingStatus(null);

    const res = await apiPost<{ ok: boolean }>('/api/commands', {
      to_user_id: otherUserId,
      type: 'ring',
    });

    setRinging(false);
    if (res.ok) {
      setRingStatus('Ringing alert sent!');
      setTimeout(() => setRingStatus(null), 4000);
    } else {
      setRingStatus(res.error ?? 'Could not ring device.');
      setTimeout(() => setRingStatus(null), 4000);
    }
  }

  function handleToggleThreadClick() {
    if (onToggleThread) {
      onToggleThread();
    } else {
      setLocalThreadOpen((prev) => !prev);
    }
  }

  return (
    <Card className="border-teal-300 bg-white shadow-sm overflow-hidden">
      <CardHeader className="pb-3 border-b border-slate-100 bg-teal-50/40">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base sm:text-lg text-slate-900">
                {otherUserName}
              </CardTitle>

              {distanceLabel && (
                <Badge
                  data-testid="distance-away-badge"
                  variant="default"
                  className="inline-flex items-center gap-1 border-teal-200 bg-white text-teal-800"
                >
                  <Navigation className="h-3 w-3 text-teal-600" />
                  {distanceLabel}
                </Badge>
              )}

              {placeName && !statusInfo.isStale && (
                <span
                  data-testid="header-place-name"
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600"
                >
                  <MapPin className="h-3 w-3 text-teal-600" />
                  Near {placeName}
                </span>
              )}
            </div>

            <CardDescription className="text-xs text-slate-500">
              {isRequester
                ? `${otherUserName} is sharing their location with you`
                : `You're sharing your location with ${otherUserName}`}
            </CardDescription>

            {location?.updated_at && statusInfo.isStale && (
              <p
                data-testid="card-stale-summary"
                className="text-xs font-medium text-amber-800 pt-0.5"
              >
                {statusInfo.label}
              </p>
            )}
          </div>

          {!isRequester && onStopSharing && (
            <Button
              variant="destructive"
              size="sm"
              disabled={isStopping}
              onClick={() => onStopSharing(connection.id)}
              className="w-full sm:w-auto min-h-[36px] shrink-0"
            >
              {isStopping ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <MapPinOff className="mr-1.5 h-3.5 w-3.5" />
              )}
              Stop sharing
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {/* Map View */}
        <DeviceMap
          latitude={location?.latitude}
          longitude={location?.longitude}
          accuracy={location?.accuracy}
          targetName={otherUserName}
          updatedAt={location?.updated_at}
          placeName={placeName}
          distanceLabel={distanceLabel}
          nowMs={nowMs}
        />

        {/* Action Controls: Ring & Message Thread */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRing}
              disabled={ringing}
              className="min-h-[38px] flex-1 sm:flex-initial"
            >
              {ringing ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Bell className="mr-1.5 h-3.5 w-3.5 text-teal-600" />
              )}
              {ringing ? 'Ringing…' : 'Ring'}
            </Button>

            <Button
              type="button"
              variant={threadOpen ? 'default' : 'outline'}
              size="sm"
              onClick={handleToggleThreadClick}
              data-testid={`toggle-thread-${connection.id}`}
              className="relative min-h-[38px] flex-1 sm:flex-initial"
            >
              <MessageSquare
                className={`mr-1.5 h-3.5 w-3.5 ${
                  threadOpen ? 'text-white' : 'text-teal-600'
                }`}
              />
              <span>Messages</span>
              {sortedMessages.length > 0 && unreadCount === 0 && (
                <span
                  className={`ml-1.5 text-xs ${
                    threadOpen ? 'text-teal-100' : 'text-slate-400'
                  }`}
                >
                  ({sortedMessages.length})
                </span>
              )}
              {unreadCount > 0 && (
                <span
                  data-testid={`unread-badge-${connection.id}`}
                  className="ml-2 inline-flex items-center gap-1 rounded-full bg-teal-600 px-2 py-0.5 text-[11px] font-bold text-white shadow-sm"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                  {unreadCount} new
                </span>
              )}
            </Button>

            {ringStatus && (
              <span className="text-xs font-medium text-teal-700 animate-fadeIn">
                {ringStatus}
              </span>
            )}
          </div>

          <p className="text-[11px] text-slate-500 leading-tight">
            Note: Ringing plays an alert sound when {otherUserName} has this page open. Click Messages to open the chat window.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
