'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type L from 'leaflet';
import { Clock, MapPin, MapPinOff } from 'lucide-react';
import { formatLocationStatusLabel } from '@/lib/utils';

interface DeviceMapProps {
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  targetName: string;
  updatedAt?: string | null;
  placeName?: string | null;
  distanceLabel?: string | null;
  nowMs?: number;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function DeviceMap({
  latitude,
  longitude,
  accuracy,
  targetName,
  updatedAt,
  placeName,
  distanceLabel,
  nowMs = Date.now(),
}: DeviceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  const hasCoords =
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);

  const statusInfo = formatLocationStatusLabel({
    updatedAt,
    placeName,
    distanceLabel,
    nowMs,
  });

  useEffect(() => {
    let isCancelled = false;

    async function initLeaflet() {
      if (!hasCoords || !containerRef.current) return;

      const leaflet = (await import('leaflet')).default;
      if (isCancelled || !containerRef.current) return;

      if (!mapInstanceRef.current) {
        const map = leaflet.map(containerRef.current, {
          center: [latitude, longitude],
          zoom: 15,
          zoomControl: true,
          attributionControl: true,
        });

        leaflet
          .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap',
          })
          .addTo(map);

        mapInstanceRef.current = map;
        setTimeout(() => {
          if (!isCancelled && mapInstanceRef.current) {
            mapInstanceRef.current.invalidateSize();
          }
        }, 150);
      }

      const map = mapInstanceRef.current;
      map.setView([latitude, longitude], map.getZoom() || 15);
      map.invalidateSize();

      const pinColor = statusInfo.isStale ? '#64748b' : '#0d9488';

      const customIcon = leaflet.divIcon({
        className: 'custom-device-pin',
        html: `
          <div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9999px;background:${pinColor};border:3px solid white;box-shadow:0 4px 6px -1px rgba(0,0,0,0.25);">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
          </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });

      const safeName = escapeHtml(targetName);
      const safePlace = placeName ? `<br/>Near ${escapeHtml(placeName)}` : '';
      const safeDist = distanceLabel ? ` &middot; ${escapeHtml(distanceLabel)}` : '';
      const popupHtml = `<strong>${safeName}</strong>${safePlace}${safeDist}`;

      if (!markerRef.current) {
        markerRef.current = leaflet
          .marker([latitude, longitude], { icon: customIcon })
          .addTo(map)
          .bindPopup(popupHtml);
      } else {
        markerRef.current.setLatLng([latitude, longitude]);
        markerRef.current.setIcon(customIcon);
        markerRef.current.setPopupContent(popupHtml);
      }

      if (typeof accuracy === 'number' && accuracy > 0) {
        if (!circleRef.current) {
          circleRef.current = leaflet
            .circle([latitude, longitude], {
              radius: accuracy,
              color: pinColor,
              fillColor: statusInfo.isStale ? '#94a3b8' : '#14b8a6',
              fillOpacity: 0.12,
              weight: 1.5,
            })
            .addTo(map);
        } else {
          circleRef.current.setLatLng([latitude, longitude]);
          circleRef.current.setRadius(accuracy);
        }
      }
    }

    void initLeaflet();

    return () => {
      isCancelled = true;
    };
  }, [
    hasCoords,
    latitude,
    longitude,
    accuracy,
    targetName,
    placeName,
    distanceLabel,
    statusInfo.isStale,
  ]);

  // Cleanup map on component unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
        circleRef.current = null;
      }
    };
  }, []);

  if (!hasCoords) {
    return (
      <div className="flex h-[45vh] min-h-[320px] sm:h-[55vh] sm:min-h-[420px] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
        <MapPinOff className="h-8 w-8 text-slate-400" />
        <p className="mt-2 text-sm font-medium text-slate-700">
          Waiting for {targetName}&apos;s location
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Location will appear on this map as soon as their device reports it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <div
          ref={containerRef}
          className="h-[52vh] min-h-[380px] sm:h-[65vh] sm:min-h-[480px] md:h-[68vh] md:min-h-[520px] w-full rounded-2xl border border-slate-200 bg-slate-100 shadow-inner"
        />

        {/* Place Name Badge Near the Pin / Map Top-Right */}
        {placeName && (
          <div
            data-testid="map-place-badge"
            className="pointer-events-none absolute bottom-3 left-3 right-3 z-[400] flex justify-start sm:right-auto"
          >
            <div className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-teal-200 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-md backdrop-blur-sm">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-teal-600" />
              <span className="truncate">Near {placeName}</span>
            </div>
          </div>
        )}
      </div>

      {/* Staleness / Recency Status Footer */}
      <div className="flex flex-col gap-1 rounded-lg bg-slate-50 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              statusInfo.isStale ? 'bg-amber-500' : 'bg-teal-500'
            }`}
          />
          <span
            data-testid="location-status-label"
            className={
              statusInfo.isStale
                ? 'font-medium text-amber-900'
                : 'font-medium text-slate-700'
            }
          >
            {statusInfo.label}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          {accuracy ? <span>Within ~{Math.round(accuracy)}m</span> : null}
          <span className="inline-flex items-center gap-1 text-slate-400">
            <Clock className="h-3 w-3" />
            Based on last location update
          </span>
        </div>
      </div>
    </div>
  );
}
