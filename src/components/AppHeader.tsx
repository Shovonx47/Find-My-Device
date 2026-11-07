import Link from 'next/link';
import { MapPin, LayoutDashboard, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppHeaderProps {
  activePage: 'dashboard' | 'account';
  displayName: string;
}

export function AppHeader({ activePage, displayName }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-3 py-2.5 sm:px-6 sm:py-3">
        {/* Logo */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2 group shrink-0 min-h-[40px]"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 shadow-sm transition group-hover:bg-teal-700 shrink-0">
            <MapPin className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-bold tracking-tight text-slate-900 sm:text-base">
            Find My Device
          </span>
        </Link>

        {/* Nav */}
        <nav aria-label="Main navigation" className="flex items-center gap-1 shrink-0">
          <Link
            href="/dashboard"
            aria-current={activePage === 'dashboard' ? 'page' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs sm:text-sm font-medium transition min-h-[36px]',
              activePage === 'dashboard'
                ? 'bg-teal-50 text-teal-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            )}
          >
            <LayoutDashboard className="h-4 w-4 shrink-0" />
            <span>Dashboard</span>
          </Link>

          <Link
            href="/account"
            aria-current={activePage === 'account' ? 'page' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs sm:text-sm font-medium transition min-h-[36px]',
              activePage === 'account'
                ? 'bg-teal-50 text-teal-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            )}
          >
            <User className="h-4 w-4 shrink-0" />
            <span className="max-w-[70px] sm:max-w-[120px] truncate">
              {displayName || 'Account'}
            </span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
