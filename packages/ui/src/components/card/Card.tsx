import * as React from 'react';
import { View, type ViewProps } from 'react-native';

export interface CardProps extends ViewProps {
  variant?: 'default' | 'module';
  className?: string;
}

export function Card({ variant = 'default', className = '', children, ...props }: CardProps) {
  return (
    <View
      className={[
        'rounded-card border border-border bg-surface',
        variant === 'module' ? 'border-primary/40' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </View>
  );
}

export function CardHeader({ className = '', children, ...props }: ViewProps & { className?: string }) {
  return (
    <View className={['px-6 py-4 border-b border-border', className].join(' ')} {...props}>
      {children}
    </View>
  );
}

export function CardContent({ className = '', children, ...props }: ViewProps & { className?: string }) {
  return (
    <View className={['px-6 py-4', className].join(' ')} {...props}>
      {children}
    </View>
  );
}

export function CardFooter({ className = '', children, ...props }: ViewProps & { className?: string }) {
  return (
    <View className={['px-6 py-4 border-t border-border', className].join(' ')} {...props}>
      {children}
    </View>
  );
}
