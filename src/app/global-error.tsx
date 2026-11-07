'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-slate-900">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-600">
            We ran into a temporary issue. Please try reloading the page.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-teal-600 px-6 text-sm font-semibold text-white hover:bg-teal-700"
          >
            Reload page
          </button>
        </div>
      </body>
    </html>
  );
}

