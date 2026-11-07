import type { ConnectionStatus } from '@/types/database';

export type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; error: string };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/g;

export function validateEmail(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') {
    return { valid: false, error: 'Email address is required.' };
  }

  const normalized = input.trim().toLowerCase();
  if (!normalized || normalized.length > 254 || !EMAIL_REGEX.test(normalized)) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }

  return { valid: true, value: normalized };
}

export function validatePassword(input: unknown): ValidationResult<string> {
  // TODO(security): Integrate HaveIBeenPwned k-anonymity API check for leaked password detection,
  // and consider enabling Supabase MFA (TOTP) and OAuth providers in future iterations.
  if (typeof input !== 'string') {
    return { valid: false, error: 'Password is required.' };
  }

  if (input.length < 8) {
    return {
      valid: false,
      error: 'Password must be at least 8 characters long (12+ recommended).',
    };
  }

  if (input.length > 128) {
    return {
      valid: false,
      error: 'Password must not exceed 128 characters.',
    };
  }

  return { valid: true, value: input };
}

export function validateDisplayName(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') {
    return { valid: false, error: 'Display name is required.' };
  }

  const cleaned = input.replace(CONTROL_CHARS_REGEX, '').trim();
  if (cleaned.length < 1 || cleaned.length > 80) {
    return {
      valid: false,
      error: 'Display name must be between 1 and 80 characters.',
    };
  }

  return { valid: true, value: cleaned };
}

export function validateUuid(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string' || !UUID_REGEX.test(input.trim())) {
    return { valid: false, error: 'Invalid identifier format.' };
  }

  return { valid: true, value: input.trim().toLowerCase() };
}

export type ConsentUpdateAction = 'accepted' | 'denied' | 'revoked';

export function validateConsentAction(
  input: unknown
): ValidationResult<ConsentUpdateAction> {
  if (input === 'accepted' || input === 'denied' || input === 'revoked') {
    return { valid: true, value: input };
  }

  return {
    valid: false,
    error: 'Invalid request action.',
  };
}

export interface ValidatedCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

export function validateCoordinates(
  body: Record<string, unknown>
): ValidationResult<ValidatedCoordinates> {
  const lat = body.latitude;
  const lng = body.longitude;
  const rawAcc = body.accuracy;

  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return { valid: false, error: 'Invalid location coordinates.' };
  }

  let accuracy: number | null = null;
  if (rawAcc !== undefined && rawAcc !== null) {
    if (
      typeof rawAcc !== 'number' ||
      !Number.isFinite(rawAcc) ||
      rawAcc < 0 ||
      rawAcc > 100000
    ) {
      return { valid: false, error: 'Invalid location accuracy value.' };
    }
    accuracy = rawAcc;
  }

  return {
    valid: true,
    value: { latitude: lat, longitude: lng, accuracy },
  };
}

export function validateCommandMessage(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') {
    return { valid: false, error: 'Please enter a message to send.' };
  }
  const cleaned = input.replace(CONTROL_CHARS_REGEX, '').trim();
  if (cleaned.length < 1 || cleaned.length > 280) {
    return {
      valid: false,
      error: 'Message must be between 1 and 280 characters.',
    };
  }
  return { valid: true, value: cleaned };
}

export function validateThreadMessage(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') {
    return { valid: false, error: 'Please enter a message to send.' };
  }
  const cleaned = input.replace(CONTROL_CHARS_REGEX, '').trim();
  if (cleaned.length < 1 || cleaned.length > 500) {
    return {
      valid: false,
      error: 'Message must be between 1 and 500 characters.',
    };
  }
  return { valid: true, value: cleaned };
}

export function canTransitionStatus(
  currentStatus: ConnectionStatus,
  nextStatus: ConsentUpdateAction
): boolean {
  if (currentStatus === 'pending') {
    return nextStatus === 'accepted' || nextStatus === 'denied';
  }

  if (currentStatus === 'accepted') {
    return nextStatus === 'revoked';
  }

  return false;
}

