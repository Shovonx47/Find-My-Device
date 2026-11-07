import * as React from 'react';
import { cn } from '@/lib/utils';

const Badge = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & {
    variant?: 'default' | 'pending' | 'accepted' | 'denied' | 'revoked';
  }
>(({ className, variant = 'default', ...props }, ref) => {
  const variantStyles = {
    default: 'bg-slate-100 text-slate-700 border-slate-200',
    pending: 'bg-amber-100 text-amber-800 border-amber-200',
    accepted: 'bg-teal-100 text-teal-800 border-teal-200',
    denied: 'bg-slate-100 text-slate-600 border-slate-200',
    revoked: 'bg-rose-100 text-rose-800 border-rose-200',
  };

  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        variantStyles[variant],
        className
      )}
      {...props}
    />
  );
});
Badge.displayName = 'Badge';

export { Badge };

