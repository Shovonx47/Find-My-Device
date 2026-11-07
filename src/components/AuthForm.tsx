'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { MapPin, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiPost } from '@/lib/api-client';

interface AuthFormProps {
  mode: 'login' | 'signup';
  supabaseConfigured: boolean;
  initialError?: string;
}

interface LoginResponse {
  ok: boolean;
  unverified?: boolean;
  email?: string;
  error?: string;
}

export function AuthForm({ mode, supabaseConfigured, initialError }: AuthFormProps) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const isSignup = mode === 'signup';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setUnverifiedEmail(null);
    setResendSuccess(null);
    setSubmitting(true);

    if (isSignup) {
      const response = await apiPost<{ ok: boolean }>('/api/auth/signup', {
        displayName,
        email,
        password,
      });
      setSubmitting(false);

      if (!response.ok) {
        setError(response.error ?? 'Unable to create your account. Please try again.');
        return;
      }

      // Always send the user to the verify-email page after signup
      window.location.href = `/verify-email?email=${encodeURIComponent(email)}`;
      return;
    }

    const response = await apiPost<LoginResponse>('/api/auth/login', { email, password });
    setSubmitting(false);

    if (!response.ok) {
      if (response.data?.unverified) {
        setUnverifiedEmail(response.data.email || email);
        setError('Please verify your email address before signing in.');
      } else {
        setError(response.error ?? 'Incorrect email or password.');
      }
      return;
    }

    window.location.href = '/dashboard';
  }

  async function handleResendVerification() {
    if (!unverifiedEmail) return;
    setResending(true);
    setResendSuccess(null);

    const res = await apiPost<{ ok: boolean; message: string }>('/api/auth/resend', {
      email: unverifiedEmail,
    });
    setResending(false);

    if (!res.ok || !res.data) {
      setError(res.error ?? 'Unable to resend verification email.');
      return;
    }

    setResendSuccess(res.data.message);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-4 py-8 sm:px-0">
      {/* Brand */}
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <Link href="/" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-600 shadow-md transition hover:bg-teal-700">
          <MapPin className="h-6 w-6 text-white" />
        </Link>
        <span className="text-xl font-bold tracking-tight text-slate-900">Find My Device</span>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">
            {isSignup ? 'Create your account' : 'Welcome back'}
          </CardTitle>
          <CardDescription>
            {isSignup
              ? 'Create an account to start sharing your location.'
              : 'Sign in to see and share your location.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {!supabaseConfigured && (
            <Alert variant="warning">
              <AlertDescription>
                Account services are not configured yet. Please check back shortly.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive" className="space-y-2">
              <AlertDescription>{error}</AlertDescription>
              {unverifiedEmail && (
                <div className="pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleResendVerification}
                    disabled={resending}
                    className="w-full text-xs min-h-[36px]"
                  >
                    {resending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {resending ? 'Sending…' : 'Resend verification email'}
                  </Button>
                </div>
              )}
            </Alert>
          )}

          {resendSuccess && (
            <Alert variant="success">
              <AlertDescription>{resendSuccess}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" id="auth-form">
            {isSignup && (
              <div className="space-y-1.5">
                <Label htmlFor="displayName">Your Name</Label>
                <Input
                  id="displayName"
                  name="displayName"
                  type="text"
                  required
                  maxLength={80}
                  autoComplete="name"
                  placeholder="Alex Rivera"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                <p className="text-xs text-slate-500">
                  This is the name people see when connecting with you.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={isSignup ? 8 : 1}
                maxLength={128}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                placeholder={isSignup ? 'At least 8 characters' : '••••••••'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </form>
        </CardContent>

        <CardFooter className="flex-col gap-3 pt-0">
          <Button
            type="submit"
            form="auth-form"
            disabled={submitting}
            className="w-full min-h-[44px]"
            size="lg"
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitting
              ? isSignup ? 'Creating account…' : 'Signing in…'
              : isSignup ? 'Sign up' : 'Sign in'}
          </Button>

          <p className="text-center text-sm text-slate-500">
            {isSignup ? (
              <>
                Already have an account?{' '}
                <Link href="/login" className="font-semibold text-teal-600 hover:text-teal-700">
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New here?{' '}
                <Link href="/signup" className="font-semibold text-teal-600 hover:text-teal-700">
                  Create an account
                </Link>
              </>
            )}
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
