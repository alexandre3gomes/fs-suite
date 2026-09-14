import * as React from 'react';
import { View, type ViewProps } from 'react-native';

import { cn } from '../../lib/utils';

export interface RuleProps extends ViewProps {
  /** `structure` = 2px ink (between major sections). `row` = 1px (between rows). */
  weight?: 'structure' | 'row';
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

/**
 * The Modernist divider. Structure rules are 2px and ink-strength — they are
 * what organises the page, so they are never softened to a hairline or
 * dropped in favour of whitespace.
 */
export function Rule({
  weight = 'structure',
  orientation = 'horizontal',
  className,
  ...props
}: RuleProps) {
  const horizontal = orientation === 'horizontal';
  return (
    <View
      accessibilityRole="none"
      className={cn(
        horizontal ? 'w-full' : 'h-full',
        weight === 'structure' ? 'bg-rule' : 'bg-border',
        className,
      )}
      style={[
        horizontal
          ? { height: weight === 'structure' ? 2 : 1 }
          : { width: weight === 'structure' ? 2 : 1 },
      ]}
      {...props}
    />
  );
}
