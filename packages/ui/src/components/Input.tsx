import React, { useId } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: React.ReactNode;
  /** Rendered at the right edge of the label row (e.g. "Forgot password?"). */
  labelAccessory?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, error, icon, labelAccessory, disabled, id, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

    return (
      <div className="w-full flex flex-col gap-1.5 text-left">
        {(label || labelAccessory) && (
          <div className="flex items-center justify-between">
            {label && (
              <label
                htmlFor={inputId}
                className={clsx(
                  'text-xs font-semibold uppercase tracking-wide',
                  error ? 'text-danger' : 'text-fg-muted'
                )}
              >
                {label}
                {props.required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
                {error && <span className="normal-case font-normal italic"> - {error}</span>}
              </label>
            )}
            {labelAccessory}
          </div>
        )}
        <div className="relative flex items-center">
          {icon && (
            <div className="absolute left-3 text-fg-subtle pointer-events-none flex items-center">{icon}</div>
          )}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            aria-invalid={!!error || undefined}
            aria-describedby={describedBy}
            className={twMerge(
              clsx(
                'w-full h-10 bg-void border border-line text-fg placeholder:text-fg-subtle text-sm rounded-md px-3 outline-none',
                'transition-colors duration-150 focus:border-brand',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                icon && 'pl-9',
                error && 'border-danger focus:border-danger'
              ),
              className
            )}
            {...props}
          />
        </div>
        {error && !label && (
          <span id={`${inputId}-error`} className="text-xs text-danger">
            {error}
          </span>
        )}
        {hint && !error && (
          <span id={`${inputId}-hint`} className="text-xs text-fg-subtle">
            {hint}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
