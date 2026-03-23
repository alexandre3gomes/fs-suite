import * as React from 'react';
import { View, Text, type ViewProps } from 'react-native';

type BadgeVariant = 'default' | 'success' | 'destructive' | 'outline' | 'vfr' | 'ifr';

export interface BadgeProps extends ViewProps {
  variant?: BadgeVariant;
  className?: string;
  children?: React.ReactNode;
}

const variantContainerClass: Record<BadgeVariant, string> = {
  default: 'bg-muted',
  success: 'bg-success/20',
  destructive: 'bg-destructive/20',
  outline: 'border border-border',
  vfr: 'bg-success/20',
  ifr: 'bg-primary/20',
};

const variantTextClass: Record<BadgeVariant, string> = {
  default: 'text-foreground',
  success: 'text-success',
  destructive: 'text-destructive',
  outline: 'text-muted-foreground',
  vfr: 'text-success',
  ifr: 'text-primary',
};

export function Badge({ variant = 'default', className = '', children, ...props }: BadgeProps) {
  return (
    <View
      className={[
        'flex-row items-center rounded-full px-2 py-0.5',
        variantContainerClass[variant],
        className,
      ].join(' ')}
      {...props}
    >
      <Text className={['text-xs font-medium', variantTextClass[variant]].join(' ')}>
        {children}
      </Text>
    </View>
  );
}
