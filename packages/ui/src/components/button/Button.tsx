import * as React from 'react';
import { Pressable, Text, ActivityIndicator, type PressableProps } from 'react-native';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends PressableProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const variantContainerClass: Record<ButtonVariant, string> = {
  primary: 'bg-primary',
  secondary: 'bg-surface border border-border',
  ghost: 'bg-transparent',
};

const variantTextClass: Record<ButtonVariant, string> = {
  primary: 'text-primary-foreground',
  secondary: 'text-foreground',
  ghost: 'text-foreground',
};

const sizeContainerClass: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5',
  md: 'px-4 py-2',
  lg: 'px-6 py-3',
};

const sizeTextClass: Record<ButtonSize, string> = {
  sm: 'text-sm',
  md: 'text-sm',
  lg: 'text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled ?? isLoading;

  return (
    <Pressable
      disabled={isDisabled}
      className={[
        'flex-row items-center justify-center gap-2 rounded-button font-medium',
        variantContainerClass[variant],
        sizeContainerClass[size],
        isDisabled ? 'opacity-50' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {isLoading && <ActivityIndicator size="small" color="currentColor" />}
      <Text
        className={[
          'font-medium',
          variantTextClass[variant],
          sizeTextClass[size],
        ].join(' ')}
      >
        {children}
      </Text>
    </Pressable>
  );
}
