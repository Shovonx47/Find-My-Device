import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Straight-line distance in meters between two WGS84 coordinates (Haversine formula).
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) *
      Math.cos(lat2 * rad) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Formats a distance in meters as "X m away" (under 1 km) or "X km away" (1 km+).
 */
export function formatDistanceAway(
  meters?: number | null
): string | null {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) {
    return null;
  }
  if (meters < 1000) {
    return `${Math.max(1, Math.round(meters))} m away`;
  }
  const km = meters / 1000;
  if (km < 10) {
    return `${km.toFixed(1)} km away`;
  }
  return `${Math.round(km)} km away`;
}

export function formatTimeAgo(
  dateString?: string | null,
  nowMs: number = Date.now()
): string {
  if (!dateString) return 'Location not yet available';
  const updated = new Date(dateString).getTime();
  if (isNaN(updated)) return 'Unknown';
  const diffSec = Math.max(0, Math.floor((nowMs - updated) / 1000));
  if (diffSec < 15) return 'just now';
  if (diffSec < 60) return `${diffSec} seconds ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin === 1) return '1 minute ago';
  if (diffMin < 60) return `${diffMin} minutes ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours === 1) return '1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return '1 day ago';
  return `${diffDays} days ago`;
}

const STALE_THRESHOLD_SECONDS = 120; // ~2 minutes

/**
 * Returns true when a location timestamp is 2 minutes or older.
 */
export function isLocationStale(
  updatedAt?: string | null,
  nowMs: number = Date.now()
): boolean {
  if (!updatedAt) return false;
  const updated = new Date(updatedAt).getTime();
  if (isNaN(updated)) return false;
  const diffSec = Math.max(0, Math.floor((nowMs - updated) / 1000));
  return diffSec >= STALE_THRESHOLD_SECONDS;
}

/**
 * Builds the human-readable recency / staleness label for a connection's location:
 * - Recent (<2 min): "Updated just now" / "Updated X seconds ago"
 * - Stale (>=2 min): "Last seen X minutes/hours ago near [place name], X km away"
 */
export function formatLocationStatusLabel(options: {
  updatedAt?: string | null;
  placeName?: string | null;
  distanceLabel?: string | null;
  nowMs?: number;
}): { isStale: boolean; label: string } {
  const { updatedAt, placeName, distanceLabel, nowMs = Date.now() } = options;
  if (!updatedAt) {
    return { isStale: false, label: 'Location not yet available' };
  }

  const stale = isLocationStale(updatedAt, nowMs);
  const timeAgo = formatTimeAgo(updatedAt, nowMs);

  if (!stale) {
    return {
      isStale: false,
      label: `Updated ${timeAgo}`,
    };
  }

  const cleanPlace = placeName
    ? placeName.replace(/^near\s+/i, '').trim()
    : '';

  let label = `Last seen ${timeAgo}`;
  if (cleanPlace) {
    label += ` near ${cleanPlace}`;
  }
  if (distanceLabel) {
    label += `, ${distanceLabel}`;
  }

  return {
    isStale: true,
    label,
  };
}

interface PlaceCacheEntry {
  lat: number;
  lng: number;
  place: string;
  expiresAt: number;
}

const PLACE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PLACE_MOVE_THRESHOLD_METERS = 100; // Only re-geocode when moved >100m
const NOMINATIM_MIN_INTERVAL_MS = 1100; // Respect Nominatim's 1 req/sec policy

const placeCache: PlaceCacheEntry[] = [];
let lastNominatimCallAt = 0;
let nominatimQueue: Promise<void> = Promise.resolve();

export function resetPlaceCacheForTests(): void {
  placeCache.length = 0;
  lastNominatimCallAt = 0;
  nominatimQueue = Promise.resolve();
}

interface NominatimResponse {
  name?: string;
  display_name?: string;
  address?: {
    road?: string;
    pedestrian?: string;
    footway?: string;
    path?: string;
    neighbourhood?: string;
    suburb?: string;
    quarter?: string;
    village?: string;
    hamlet?: string;
    town?: string;
    city?: string;
    municipality?: string;
    county?: string;
    state_district?: string;
    state?: string;
  };
}

function extractReadablePlace(data: NominatimResponse): string | null {
  const addr = data.address;
  if (addr) {
    const primary =
      addr.road ||
      addr.pedestrian ||
      addr.neighbourhood ||
      addr.suburb ||
      addr.quarter ||
      addr.village ||
      addr.hamlet ||
      data.name;

    const locality =
      addr.city ||
      addr.town ||
      addr.municipality ||
      addr.county ||
      addr.state_district ||
      addr.state;

    const parts: string[] = [];
    if (primary) parts.push(primary.trim());
    if (locality && locality.trim().toLowerCase() !== primary?.trim().toLowerCase()) {
      parts.push(locality.trim());
    }
    if (parts.length > 0) {
      return parts.join(', ');
    }
  }

  if (typeof data.display_name === 'string' && data.display_name.trim()) {
    const segments = data.display_name
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length >= 2) {
      return `${segments[0]}, ${segments[1]}`;
    }
    if (segments.length === 1) {
      return segments[0] ?? null;
    }
  }

  return null;
}

/**
 * Reverse-geocodes coordinates to a readable area/road name using OpenStreetMap Nominatim.
 * Caches results for 10 minutes within a 100m radius and throttles network calls to 1 req/sec.
 */
export async function reverseGeocodePlace(
  latitude: number,
  longitude: number
): Promise<string | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const now = Date.now();

  // Prune expired cache entries
  for (let i = placeCache.length - 1; i >= 0; i--) {
    if (placeCache[i]!.expiresAt <= now) {
      placeCache.splice(i, 1);
    }
  }

  // Return cached place name if within 100m of a recent lookup
  const cached = placeCache.find(
    (entry) =>
      calculateDistanceMeters(entry.lat, entry.lng, latitude, longitude) <=
      PLACE_MOVE_THRESHOLD_METERS
  );
  if (cached) {
    return cached.place;
  }

  // Serialize requests so we never exceed Nominatim's 1 request/second rate limit
  let resultPlace: string | null = null;

  const task = nominatimQueue.then(async () => {
    const recheck = placeCache.find(
      (entry) =>
        entry.expiresAt > Date.now() &&
        calculateDistanceMeters(entry.lat, entry.lng, latitude, longitude) <=
          PLACE_MOVE_THRESHOLD_METERS
    );
    if (recheck) {
      resultPlace = recheck.place;
      return;
    }

    const elapsed = Date.now() - lastNominatimCallAt;
    if (lastNominatimCallAt > 0 && elapsed < NOMINATIM_MIN_INTERVAL_MS) {
      await new Promise((r) =>
        setTimeout(r, NOMINATIM_MIN_INTERVAL_MS - elapsed)
      );
    }

    lastNominatimCallAt = Date.now();

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        latitude.toFixed(5)
      )}&lon=${encodeURIComponent(longitude.toFixed(5))}&zoom=18&addressdetails=1`;

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'en',
        },
      });

      if (!res.ok) return;
      const json = (await res.json()) as NominatimResponse;
      const parsed = extractReadablePlace(json);
      if (parsed) {
        resultPlace = parsed;
        placeCache.push({
          lat: latitude,
          lng: longitude,
          place: parsed,
          expiresAt: Date.now() + PLACE_CACHE_TTL_MS,
        });
      }
    } catch {
      // Non-blocking if offline or Nominatim is unreachable
    }
  });

  nominatimQueue = task.catch(() => {});
  await task;
  return resultPlace;
}

export function formatMessageTime(dateString?: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  try {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export {
  getAudioContext,
  isAudioUnlocked,
  unlockAudio,
  stopRingTone,
  playRingTone,
  playMessageTickSound,
  playChimeSound,
} from '@/lib/audio';
