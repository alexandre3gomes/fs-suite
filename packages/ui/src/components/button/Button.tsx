import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { Platform, Pressable, type PressableProps } from 'react-native';

import { cn } from '../../lib/utils';
import { TextClassContext } from '../text/Text';

/**
 * Modernist button: zero radius, flush-left label, no shadow.
 * A button wider than its label starts the text at the left padding edge —
 * never centred. Pass `align="center"` for the rare centred case (a lone
 * full-width CTA on a narrow phone screen).
 */
const buttonVariants = cva(
  cn(
    'group shrink-0 flex-row items-center gap-2 rounded-none',
    Platform.select({
      web: 'outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    }),
  ),
  {
    variants: {
      variant: {
        default: cn(
          'bg-primary active:bg-accent',
          Platform.select({ web: 'hover:bg-accent' }),
        ),
        destructive: cn(
          'bg-destructive active:bg-destructive/90',
          Platform.select({ web: 'hover:bg-destructive/90' }),
        ),
        outline: cn(
          'border-2 border-rule bg-transparent active:bg-secondary',
          Platform.select({ web: 'hover:bg-secondary' }),
        ),
        secondary: cn(
          'border-2 border-rule bg-transparent active:bg-secondary',
          Platform.select({ web: 'hover:bg-secondary' }),
        ),
        ghost: cn(
          'active:bg-secondary',
          Platform.select({ web: 'hover:bg-secondary' }),
        ),
        link: '',
      },
      size: {
        default: 'h-11 px-4 py-2',
        sm: 'h-9 gap-1.5 px-3',
        lg: 'h-12 px-6',
        icon: 'h-11 w-11 justify-center',
      },
      align: {
        left: 'justify-start',
        center: 'justify-center',
      },
    },
    defaultVariants: { variant: 'default', size: 'default', align: 'left' },
  },
);

const buttonTextVariants = cva('font-sans font-bold', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      destructive: 'text-destructive-foreground',
      outline: 'text-foreground',
      secondary: 'text-foreground',
      ghost: 'text-foreground',
      link: cn('text-accent', Platform.select({ web: 'group-hover:underline' })),
    },
    size: {
      default: 'text-[15px]',
      sm: 'text-[13px]',
      lg: 'text-base',
      icon: 'text-[15px]',
    },
    align: {
      left: 'text-left',
      center: 'text-center',
    },
  },
  defaultVariants: { variant: 'default', size: 'default', align: 'left' },
});

export interface ButtonProps
  extends PressableProps,
    VariantProps<typeof buttonVariants> {
  className?: string;
}

const Button = React.forwardRef<React.ElementRef<typeof Pressable>, ButtonProps>(
  ({ className, variant, size, align, disabled, ...props }, ref) => {
    return (
      <TextClassContext.Provider value={buttonTextVariants({ variant, size, align })}>
        <Pressable
          ref={ref}
          role="button"
          disabled={disabled}
          className={cn(
            disabled && 'opacity-45',
            buttonVariants({ variant, size, align }),
            className,
          )}
          {...props}
        />
      </TextClassContext.Provider>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonTextVariants, buttonVariants };
