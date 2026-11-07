'use client';

import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-4 py-8">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-600 shadow-md">
          <MapPin className="h-6 w-6 text-white" />
        </div>
        <span className="text-xl font-bold tracking-tight text-slate-900">
          Find My Device
        </span>
      </div>

      <Card className="text-center shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">Something went wrong</CardTitle>
          <CardDescription>
            We ran into a temporary issue loading this page. Please try again.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button type="button" onClick={() => reset()} className="w-full min-h-[44px]">
            Try again
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              window.location.href = '/';
            }}
            className="w-full min-h-[44px]"
          >
            Back to home
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

