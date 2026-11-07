'use client';

import { useState, type FormEvent } from 'react';
import { Loader2, LogOut, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiPost } from '@/lib/api-client';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Profile } from '@/types/database';

interface AccountPanelProps {
  email: string;
  initialDisplayName: string;
}

export function AccountPanel({ email, initialDisplayName }: AccountPanelProps) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [savingName, setSavingName] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleUpdateName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);
    setSavingName(true);

    const response = await apiPost<{ ok: boolean; profile: Profile }>('/api/profile', { displayName });
    setSavingName(false);

    if (!response.ok || !response.data) {
      setErrorMessage(response.error ?? 'Could not update your name. Please try again.');
      return;
    }
    setDisplayName(response.data.profile.display_name);
    setStatusMessage('Name updated successfully.');
  }

  async function handleLogout() {
    setLoggingOut(true);
    setErrorMessage(null);
    await apiPost('/api/auth/logout');
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      // Best-effort client cleanup
    }
    window.location.href = '/login';
  }

  return (
    <div className="space-y-6">
      {/* Account details */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Your account information and settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Email row */}
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Email address
            </p>
            <p
              data-testid="account-email"
              className="mt-1 break-all text-sm font-semibold text-slate-900"
            >
              {email}
            </p>
          </div>

          {/* Name form */}
          <form onSubmit={handleUpdateName} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="accountDisplayName">Your name</Label>
              <p className="text-xs text-slate-500">
                This is the name other people will see when connecting with you.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <Input
                  id="accountDisplayName"
                  type="text"
                  required
                  maxLength={80}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full sm:max-w-xs"
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={savingName}
                  size="default"
                  className="w-full sm:w-auto min-h-[40px] shrink-0"
                >
                  {savingName ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-1.5 h-4 w-4" />
                  )}
                  {savingName ? 'Saving…' : 'Save name'}
                </Button>
              </div>
            </div>

            {statusMessage && (
              <Alert variant="success" className="mt-2">
                <AlertDescription>{statusMessage}</AlertDescription>
              </Alert>
            )}
            {errorMessage && (
              <Alert variant="destructive" className="mt-2">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Session Card */}
      <Card>
        <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-6">
          <div>
            <p className="text-sm font-semibold text-slate-900">Sign out</p>
            <p className="text-xs text-slate-500">
              Sign out of your account on this device.
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full sm:w-auto min-h-[40px] shrink-0"
          >
            {loggingOut ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="mr-2 h-4 w-4" />
            )}
            {loggingOut ? 'Logging out…' : 'Log out'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
