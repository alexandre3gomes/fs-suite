import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { colors } from '../../tokens';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  'aria-label'?: string;
}

const sizeMap: Record<'sm' | 'md' | 'lg', 'small' | 'large'> = {
  sm: 'small',
  md: 'small',
  lg: 'large',
};

export function Spinner({
  size = 'md',
  className = '',
  'aria-label': ariaLabel = 'Loading',
}: SpinnerProps) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={ariaLabel}
      className={className}
    >
      <ActivityIndicator size={sizeMap[size]} color={colors.primary} />
    </View>
  );
}
