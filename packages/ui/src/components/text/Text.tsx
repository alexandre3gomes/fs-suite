import * as Slot from '@rn-primitives/slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { Platform, Text as RNText } from 'react-native';

import { cn } from '../../lib/utils';

const TextClassContext = React.createContext<string | undefined>(undefined);

const textVariants = cva(
  cn('text-foreground text-base', Platform.select({ web: 'select-text' })),
  {
    variants: {
      variant: {
        default: '',
        h1: cn(
          'text-4xl font-extrabold tracking-tight',
          Platform.select({ web: 'scroll-m-20' }),
        ),
        h2: cn(
          'text-3xl font-semibold tracking-tight',
          Platform.select({ web: 'scroll-m-20 first:mt-0' }),
        ),
        h3: cn(
          'text-2xl font-semibold tracking-tight',
          Platform.select({ web: 'scroll-m-20' }),
        ),
        h4: cn(
          'text-xl font-semibold tracking-tight',
          Platform.select({ web: 'scroll-m-20' }),
        ),
        large: 'text-lg font-semibold',
        lead: 'text-xl text-muted-foreground',
        small: 'text-sm font-medium leading-none',
        muted: 'text-sm text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

type TextProps = React.ComponentProps<typeof RNText> &
  VariantProps<typeof textVariants> & {
    asChild?: boolean;
  };

const Text = React.forwardRef<React.ElementRef<typeof RNText>, TextProps>(
  ({ className, variant, asChild = false, ...props }, ref) => {
    const textClass = React.useContext(TextClassContext);
    const Component = asChild ? Slot.Text : RNText;
    return (
      <Component
        ref={ref}
        className={cn(textVariants({ variant }), textClass, className)}
        {...props}
      />
    );
  },
);
Text.displayName = 'Text';

export { Text, TextClassContext, textVariants };
export type { TextProps };
