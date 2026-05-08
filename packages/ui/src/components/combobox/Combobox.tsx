import * as React from 'react';
import { FlatList, Pressable, Text, TextInput, View, type ViewProps } from 'react-native';

export interface ComboboxOption {
  label: string;
  value: string;
}

export interface ComboboxProps extends ViewProps {
  options: ComboboxOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  onSearch?: (query: string) => void;
  placeholder?: string;
  className?: string;
}

export function Combobox({
  options,
  value,
  onValueChange,
  onSearch,
  placeholder = 'Search...',
  className = '',
  ...props
}: ComboboxProps) {
  const [query, setQuery] = React.useState('');
  const [focused, setFocused] = React.useState(false);

  const selected = options.find((o) => o.value === value);
  const displayValue = focused ? query : (selected ? selected.label : '');
  const showResults = focused && options.length > 0;

  function handleFocus() {
    setFocused(true);
    setQuery(selected ? selected.label : '');
  }

  function handleBlur() {
    // Delay to allow onPress on options to fire before hiding
    setTimeout(() => setFocused(false), 150);
  }

  function handleQueryChange(text: string) {
    setQuery(text);
    onSearch?.(text);
  }

  function handleSelect(option: ComboboxOption) {
    setQuery('');
    setFocused(false);
    onValueChange?.(option.value);
  }

  function handleClear() {
    setQuery('');
    onValueChange?.('');
    onSearch?.('');
  }

  return (
    <View {...props}>
      <View className="relative">
        <TextInput
          value={displayValue}
          onChangeText={handleQueryChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          placeholderTextColor="#9ca3af"
          className={[
            'rounded-input border border-border bg-surface px-3 py-2.5 text-foreground',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
        />
        {selected && !focused ? (
          <Pressable
            className="absolute right-2 top-0 bottom-0 items-center justify-center px-1"
            onPress={handleClear}
          >
            <Text className="text-muted-foreground">✕</Text>
          </Pressable>
        ) : null}
      </View>

      {showResults ? (
        <View className="mt-1 overflow-hidden rounded-card border border-border bg-surface">
          <FlatList
            data={options}
            keyExtractor={(item) => item.value}
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 200 }}
            renderItem={({ item }) => (
              <Pressable
                className={[
                  'border-b border-border px-4 py-3',
                  item.value === value ? 'bg-primary/10' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onPress={() => handleSelect(item)}
              >
                <Text
                  className={
                    item.value === value ? 'font-medium text-primary' : 'text-foreground'
                  }
                >
                  {item.label}
                </Text>
              </Pressable>
            )}
          />
        </View>
      ) : null}
    </View>
  );
}
