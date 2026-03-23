import * as React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'module';
}

export function Card({ variant = 'default', className = '', children, ...props }: CardProps) {
  return (
    <div
      className={[
        'rounded-[var(--radius-card)] border border-border bg-surface',
        variant === 'module' && 'transition-colors hover:bg-surface-muted hover:border-primary/40',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={['px-6 py-4 border-b border-border', className].join(' ')} {...props}>
      {children}
    </div>
  );
}

export function CardContent({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={['px-6 py-4', className].join(' ')} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={['px-6 py-4 border-t border-border', className].join(' ')} {...props}>
      {children}
    </div>
  );
}
