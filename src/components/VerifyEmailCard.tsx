'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, Loader2, ArrowLeft, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiPost } from '@/lib/api-client';

interface VerifyEmailCardProps {
  initialEmail?: string;
}

export function VerifyEmailCard({ initialEmail = '' }: VerifyEmailCardProps) {
  const [email, setEmail] = useState(initialEmail);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function handleResend() {
    if (!email) {
      setFeedback({ type: 'error', text: 'Please enter your email address to resend confirmation.' });
      return;
    }
    setSending(true);
    setFeedback(null);

    const res = await apiPost<{ ok: boolean; message: string }>('/api/auth/resend', { email });
    setSending(false);

    if (!res.ok || !res.data) {
      setFeedback({ type: 'error', text: res.error ?? 'Unable to resend confirmation email.' });
      return;
    }

    setFeedback({ type: 'success', text: res.data.message });
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-4 py-8 sm:px-0">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-600 shadow-md">
          <Mail className="h-6 w-6 text-white" />
        </div>
        <span className="text-xl font-bold tracking-tight text-slate-900">Find My Device</span>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-4 text-center">
          <CardTitle className="text-xl">Check your email</CardTitle>
          <CardDescription>
            We sent a confirmation link to your email address. Please click the link to verify your account and get started.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {email ? (
            <div className="rounded-xl bg-slate-50 p-3.5 text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Sent to</p>
              <p className="mt-0.5 break-all text-sm font-semibold text-slate-900">{email}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="resend-email" className="text-xs font-medium text-slate-700">
                Email address
              </label>
              <input
                id="resend-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="flex h-10 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              />
            </div>
          )}

          {feedback && (
            <Alert variant={feedback.type === 'error' ? 'destructive' : 'success'}>
              <AlertDescription>{feedback.text}</AlertDescription>
            </Alert>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={handleResend}
            disabled={sending}
            className="w-full min-h-[42px]"
          >
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {sending ? 'Sending…' : 'Resend confirmation email'}
          </Button>
        </CardContent>

        <CardFooter className="justify-center border-t border-slate-100 pt-4">
          <Link
            href="/login"
            className="inline-flex items-center text-sm font-medium text-slate-600 hover:text-teal-600"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to sign in
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}

