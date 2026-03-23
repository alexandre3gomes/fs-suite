import * as React from 'react';
import { View, Text, TextInput, type TextInputProps } from 'react-native';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  className?: string;
}

export const Input = React.forwardRef<TextInput, InputProps>(
  ({ label, error, hint, className = '', ...props }, ref) => {
    return (
      <View className="gap-1.5">
        {label && (
          <Text className="text-sm font-medium text-foreground">{label}</Text>
        )}
        <TextInput
          ref={ref}
          className={[
            'w-full rounded-button border bg-input px-3 py-2 text-sm text-foreground',
            error ? 'border-destructive' : 'border-border',
            className,
          ].join(' ')}
          placeholderTextColor="#8892a4"
          {...props}
        />
        {error && <Text className="text-xs text-destructive">{error}</Text>}
        {hint && !error && <Text className="text-xs text-muted-foreground">{hint}</Text>}
      </View>
    );
  },
);

Input.displayName = 'Input';
