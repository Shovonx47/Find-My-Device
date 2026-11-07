import { describe, expect, it, vi } from 'vitest';
import {
  canTransitionStatus,
  validateConsentAction,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validateThreadMessage,
  validateUuid,
} from '@/lib/validation';
import {
  calculateDistanceMeters,
  formatDistanceAway,
  formatLocationStatusLabel,
  isLocationStale,
  resetPlaceCacheForTests,
  reverseGeocodePlace,
} from '@/lib/utils';

describe('Input Validation & Consent State Machine', () => {
  it('normalizes and validates email addresses', () => {
    expect(validateEmail('  Alice@Example.COM ')).toEqual({
      valid: true,
      value: 'alice@example.com',
    });
    expect(validateEmail('not-an-email')).toEqual({
      valid: false,
      error: 'Please enter a valid email address.',
    });
    expect(validateEmail('')).toEqual({
      valid: false,
      error: 'Please enter a valid email address.',
    });
  });

  it('enforces password length boundaries while allowing all character types', () => {
    expect(validatePassword('short7!')).toEqual({
      valid: false,
      error: 'Password must be at least 8 characters long (12+ recommended).',
    });

    const strongPassphrase = 'correct horse battery staple! 🚀 #2026';
    expect(validatePassword(strongPassphrase)).toEqual({
      valid: true,
      value: strongPassphrase,
    });

    expect(validatePassword('a'.repeat(129)).valid).toBe(false);
  });

  it('strips control characters from display names', () => {
    expect(validateDisplayName('  Bob\u0000 Builder  ')).toEqual({
      valid: true,
      value: 'Bob Builder',
    });
    expect(validateDisplayName('   ').valid).toBe(false);
  });

  it('validates UUID v4 identifiers', () => {
    expect(validateUuid('550e8400-e29b-41d4-a716-446655440000')).toEqual({
      valid: true,
      value: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(validateUuid('12345')).toEqual({
      valid: false,
      error: 'Invalid identifier format.',
    });
  });

  it('validates thread messages up to 500 characters', () => {
    expect(validateThreadMessage('   ').valid).toBe(false);
    expect(validateThreadMessage('a'.repeat(501)).valid).toBe(false);
    expect(validateThreadMessage('On my way!\u0000')).toEqual({
      valid: true,
      value: 'On my way!',
    });
  });

  it('enforces strict consent state transitions', () => {
    expect(validateConsentAction('accepted').valid).toBe(true);
    expect(validateConsentAction('denied').valid).toBe(true);
    expect(validateConsentAction('revoked').valid).toBe(true);
    expect(validateConsentAction('pending').valid).toBe(false);

    // Valid transitions
    expect(canTransitionStatus('pending', 'accepted')).toBe(true);
    expect(canTransitionStatus('pending', 'denied')).toBe(true);
    expect(canTransitionStatus('accepted', 'revoked')).toBe(true);

    // Invalid transitions
    expect(canTransitionStatus('pending', 'revoked')).toBe(false);
    expect(canTransitionStatus('denied', 'accepted')).toBe(false);
    expect(canTransitionStatus('revoked', 'accepted')).toBe(false);
    expect(canTransitionStatus('accepted', 'denied')).toBe(false);
  });

  it('calculates Haversine straight-line distance and formats meters vs kilometers', () => {
    // Same point -> 0m
    expect(calculateDistanceMeters(23.1667, 89.2167, 23.1667, 89.2167)).toBe(0);
    expect(formatDistanceAway(420)).toBe('420 m away');
    expect(formatDistanceAway(1460)).toBe('1.5 km away');
    expect(formatDistanceAway(14800)).toBe('15 km away');
  });

  it('formats recent (<2 min) vs stale (>=2 min) location status labels accurately', () => {
    const now = Date.parse('2026-11-08T12:00:00Z');
    const recentIso = '2026-11-08T11:59:30Z'; // 30s ago
    const staleIso = '2026-11-08T11:45:00Z'; // 15m ago

    expect(isLocationStale(recentIso, now)).toBe(false);
    expect(
      formatLocationStatusLabel({
        updatedAt: recentIso,
        placeName: 'RN Road, Jashore',
        distanceLabel: '1.2 km away',
        nowMs: now,
      })
    ).toEqual({
      label: 'Updated 30 seconds ago',
      isStale: false,
    });

    expect(isLocationStale(staleIso, now)).toBe(true);
    expect(
      formatLocationStatusLabel({
        updatedAt: staleIso,
        placeName: 'RN Road, Jashore',
        distanceLabel: '1.2 km away',
        nowMs: now,
      })
    ).toEqual({
      label: 'Last seen 15 minutes ago near RN Road, Jashore, 1.2 km away',
      isStale: true,
    });
  });

  it('caches Nominatim reverse geocoding within 100m and re-queries when moved >100m', async () => {
    resetPlaceCacheForTests();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          address: {
            road: 'RN Road',
            city: 'Jashore',
          },
        }),
        { status: 200 }
      )
    );

    const place1 = await reverseGeocodePlace(23.1667, 89.2167);
    expect(place1).toBe('RN Road, Jashore');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Move ~20 meters (<100m) -> should hit cache without another fetch
    const place2 = await reverseGeocodePlace(23.1668, 89.2167);
    expect(place2).toBe('RN Road, Jashore');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
  });

  it('manages Web Audio API ring and message sounds safely and gracefully', async () => {
    const {
      playRingTone,
      playMessageTickSound,
      stopRingTone,
      unlockAudio,
      isAudioUnlocked,
    } = await import('@/lib/audio');

    expect(() => playRingTone()).not.toThrow();
    expect(() => stopRingTone()).not.toThrow();
    expect(() => playMessageTickSound()).not.toThrow();

    const mockGain = {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      },
      connect: vi.fn(),
    };
    const mockOsc = {
      type: 'triangle',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const mockAudioContext = {
      state: 'running',
      currentTime: 10,
      destination: {},
      createGain: vi.fn(() => mockGain),
      createOscillator: vi.fn(() => mockOsc),
      resume: vi.fn().mockResolvedValue(undefined),
    };

    (window as unknown as { AudioContext: unknown }).AudioContext = vi
      .fn()
      .mockImplementation(() => mockAudioContext);

    expect(await unlockAudio()).toBe(true);
    expect(isAudioUnlocked()).toBe(true);

    playRingTone();
    expect(mockAudioContext.createGain).toHaveBeenCalled();
    expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    expect(mockOsc.start).toHaveBeenCalled();

    stopRingTone();
    expect(mockGain.gain.cancelScheduledValues).toHaveBeenCalled();

    playMessageTickSound();
    expect(mockAudioContext.createGain).toHaveBeenCalled();
  });
});

