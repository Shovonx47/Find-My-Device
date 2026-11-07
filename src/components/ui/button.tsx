import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 touch-manipulation',
  {
    variants: {
      variant: {
        default:
          'bg-teal-600 text-white hover:bg-teal-700 focus-visible:ring-teal-500',
        destructive:
          'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500',
        outline:
          'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-teal-500',
        ghost:
          'text-slate-700 hover:bg-slate-100 focus-visible:ring-teal-500',
        link: 'text-teal-600 underline-offset-4 hover:underline',
        secondary:
          'bg-slate-100 text-slate-800 hover:bg-slate-200 focus-visible:ring-slate-400',
        success:
          'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500',
      },
      size: {
        default: 'h-10 px-4 py-2 min-h-[40px]',
        sm: 'h-9 px-3.5 text-xs min-h-[36px]',
        lg: 'h-11 px-6 min-h-[44px]',
        icon: 'h-10 w-10 min-h-[40px] min-w-[40px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
