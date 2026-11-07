import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Find My Device — Location Sharing',
  description: 'Share your location with people you trust.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
