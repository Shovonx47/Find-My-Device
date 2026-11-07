export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export async function apiPost<T>(
  path: string,
  body: Record<string, unknown> = {}
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => ({}))) as T & {
      error?: string;
    };

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: payload.error ?? 'Request failed. Please try again.',
      };
    }

    return {
      ok: true,
      status: response.status,
      data: payload,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      error: 'Network error. Check your connection and try again.',
    };
  }
}

export async function apiGet<T>(path: string): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(path, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      credentials: 'same-origin',
      cache: 'no-store',
    });

    const payload = (await response.json().catch(() => ({}))) as T & {
      error?: string;
    };

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: payload.error ?? 'Unable to load data.',
      };
    }

    return {
      ok: true,
      status: response.status,
      data: payload,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      error: 'Network error. Check your connection and try again.',
    };
  }
}

