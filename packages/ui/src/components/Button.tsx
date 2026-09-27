import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'link';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
  fullWidth?: boolean;
}

const variants = {
  primary: 'bg-brand text-on-brand hover:bg-brand-strong',
  secondary: 'bg-active text-fg hover:bg-line-strong',
  ghost: 'bg-transparent text-fg-muted hover:text-fg hover:bg-hover',
  danger: 'bg-danger text-white hover:brightness-110',
  outline: 'border border-line-strong text-fg hover:bg-hover hover:border-halo',
  link: 'bg-transparent text-brand-sky hover:underline px-0 h-auto',
} as const;

const sizes = {
  sm: 'text-xs px-3 h-8 gap-1.5',
  md: 'text-sm px-4 h-10 gap-2',
  lg: 'text-base px-6 h-12 gap-2.5',
  icon: 'h-9 w-9 p-0',
} as const;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = 'primary', size = 'md', isLoading = false, fullWidth, disabled, children, type = 'button', ...props },
    ref
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={twMerge(
        clsx(
          'inline-flex items-center justify-center font-medium rounded-md select-none',
          'transition-[background-color,color,border-color,filter] duration-150',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          variants[variant],
          variant !== 'link' && sizes[size],
          fullWidth && 'w-full',
          className
        )
      )}
      {...props}
    >
      {isLoading && (
        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      )}
      {children}
    </button>
  )
);

Button.displayName = 'Button';
