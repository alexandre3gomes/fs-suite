import * as React from 'react';
import { Platform, TextInput, type TextInputProps, View } from 'react-native';

import { cn } from '../../lib/utils';
import { Text } from '../text/Text';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  className?: string;
}

const Input = React.forwardRef<TextInput, InputProps>(
  ({ label, error, hint, className, ...props }, ref) => {
    return (
      <View className="gap-1.5">
        {label ? (
          <Text className="text-sm font-medium text-foreground">{label}</Text>
        ) : null}
        <TextInput
          ref={ref}
          className={cn(
            'w-full rounded-md border bg-background px-3 py-2.5 text-sm text-foreground',
            Platform.select({
              web: 'outline-none ring-offset-background transition-colors focus:ring-2 focus:ring-ring focus:ring-offset-2',
            }),
            error ? 'border-destructive' : 'border-input',
            className,
          )}
          placeholderTextColor="hsl(220, 8.9%, 46.1%)"
          {...props}
        />
        {error ? <Text className="text-xs text-destructive">{error}</Text> : null}
        {hint && !error ? (
          <Text className="text-xs text-muted-foreground">{hint}</Text>
        ) : null}
      </View>
    );
  },
);

Input.displayName = 'Input';

export { Input };
