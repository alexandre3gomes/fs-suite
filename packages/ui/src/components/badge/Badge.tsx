import * as React from 'react';
import { View, Text, type ViewProps } from 'react-native';

type BadgeVariant = 'default' | 'success' | 'destructive' | 'outline' | 'vfr' | 'ifr';

export interface BadgeProps extends ViewProps {
  variant?: BadgeVariant;
  className?: string;
  children?: React.ReactNode;
}

/** Modernist tag: square, tinted from the ramp, uppercase and tracked. */
const variantContainerClass: Record<BadgeVariant, string> = {
  default: 'bg-secondary',
  success: 'bg-success/15',
  destructive: 'bg-destructive/15',
  outline: 'border-2 border-rule',
  vfr: 'bg-success/15',
  ifr: 'bg-primary/15',
};

const variantTextClass: Record<BadgeVariant, string> = {
  default: 'text-foreground',
  success: 'text-success',
  destructive: 'text-destructive',
  outline: 'text-foreground',
  vfr: 'text-success',
  ifr: 'text-accent',
};

export function Badge({ variant = 'default', className = '', children, ...props }: BadgeProps) {
  return (
    <View
      className={[
        'flex-row items-center rounded-none px-2 py-1',
        variantContainerClass[variant],
        className,
      ].join(' ')}
      {...props}
    >
      <Text
        className={['font-sans text-[11px] font-bold uppercase', variantTextClass[variant]].join(' ')}
        style={{ letterSpacing: 1.2 }}
      >
        {children}
      </Text>
    </View>
  );
}
