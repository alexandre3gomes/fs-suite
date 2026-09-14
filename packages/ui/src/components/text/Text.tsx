import * as Slot from '@rn-primitives/slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { Platform, Text as RNText } from 'react-native';

import { cn } from '../../lib/utils';

const TextClassContext = React.createContext<string | undefined>(undefined);

/**
 * Modernist type: three steps only.
 *   label   — 11px uppercase, tracked. Names a thing.
 *   body    — 13-15px. Reads.
 *   display — 26-48px, tight. The number you flew here to see.
 * Everything is flush left. `kicker` is the accent-coloured label above a
 * page or section title.
 */
const textVariants = cva(
  cn('font-sans text-[15px] text-foreground', Platform.select({ web: 'select-text' })),
  {
    variants: {
      variant: {
        default: '',

        // Display
        display: 'text-[48px] font-extrabold leading-[0.98]',
        h1: 'text-[34px] font-extrabold leading-[1.02]',
        h2: 'text-[26px] font-extrabold leading-[1.06]',
        h3: 'text-[21px] font-bold leading-[1.1]',
        h4: 'text-[17px] font-bold leading-[1.2]',

        // A figure in a metric cell — tabular, tight, unmissable.
        metric: 'text-[34px] font-extrabold leading-none',
        metricSm: 'text-[26px] font-extrabold leading-none',

        // Labels
        label: 'text-[11px] font-bold uppercase text-muted-foreground',
        labelInk: 'text-[11px] font-bold uppercase text-foreground',
        kicker: 'text-[11px] font-bold uppercase text-accent',

        // Body
        large: 'text-[17px] font-bold',
        lead: 'text-[17px] leading-[1.5] text-muted-foreground',
        small: 'text-[13px] font-semibold',
        muted: 'text-[13px] leading-[1.5] text-muted-foreground',
        mono: 'font-mono text-[13px]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/** Tracking can't live in the class on native, so it rides along per variant. */
const trackingByVariant: Partial<Record<string, number>> = {
  display: -1.0,
  h1: -0.7,
  h2: -0.5,
  h3: -0.3,
  metric: -0.7,
  metricSm: -0.5,
  label: 1.3,
  labelInk: 1.3,
  kicker: 1.8,
};

type TextProps = React.ComponentProps<typeof RNText> &
  VariantProps<typeof textVariants> & {
    asChild?: boolean;
  };

const Text = React.forwardRef<React.ElementRef<typeof RNText>, TextProps>(
  ({ className, variant, asChild = false, style, ...props }, ref) => {
    const textClass = React.useContext(TextClassContext);
    const Component = asChild ? Slot.Text : RNText;
    const letterSpacing = variant ? trackingByVariant[variant] : undefined;
    return (
      <Component
        ref={ref}
        className={cn(textVariants({ variant }), textClass, className)}
        style={[letterSpacing !== undefined ? { letterSpacing } : null, style]}
        {...props}
      />
    );
  },
);
Text.displayName = 'Text';

export { Text, TextClassContext, textVariants };
export type { TextProps };
