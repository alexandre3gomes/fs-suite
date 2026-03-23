import * as React from 'react';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  'aria-label'?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
};

export function Spinner({ size = 'md', className = '', 'aria-label': ariaLabel = 'Loading' }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={ariaLabel}
      className={[
        'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
        sizeClasses[size],
        className,
      ].join(' ')}
    />
  );
}
