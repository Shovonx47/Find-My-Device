export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

const PLACEHOLDER_URL = 'https://your-project-ref.supabase.co';
const PLACEHOLDER_KEY = 'your-supabase-publishable-key';

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

  if (!url || !key) return false;
  if (url === PLACEHOLDER_URL || key === PLACEHOLDER_KEY) return false;

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function getSupabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local.'
    );
  }
  if (!anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set. Add it to .env.local.'
    );
  }

  return { url, anonKey };
}

/** Returns the specific https + wss origins for this Supabase project. */
export function getSupabaseCspOrigins(): string[] {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const origins = new Set<string>();

  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      origins.add(parsed.origin); // https://xxx.supabase.co
      origins.add(`wss://${parsed.host}`); // wss://xxx.supabase.co
    } catch {
      // Fallback to safe wildcard if the URL is malformed during build
      origins.add('https://*.supabase.co');
      origins.add('wss://*.supabase.co');
    }
  } else {
    origins.add('https://*.supabase.co');
    origins.add('wss://*.supabase.co');
  }

  return Array.from(origins);
}
