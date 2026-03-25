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
  const [open, setOpen] = React.useState(false);

  const selected = options.find((o) => o.value === value);
  const displayValue = query || (selected ? selected.label : '');

  function handleQueryChange(text: string) {
    setQuery(text);
    setOpen(text.length > 0);
    onSearch?.(text);
  }

  function handleSelect(option: ComboboxOption) {
    setQuery('');
    setOpen(false);
    onValueChange?.(option.value);
  }

  return (
    <View className={['relative', className].filter(Boolean).join(' ')} {...props}>
      <TextInput
        value={displayValue}
        onChangeText={handleQueryChange}
        onFocus={() => {
          if (query.length > 0) setOpen(true);
        }}
        placeholder={placeholder}
        className="rounded-input border border-border bg-surface px-3 py-2.5 text-foreground"
      />

      {open && options.length > 0 ? (
        <View className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-card border border-border bg-surface">
          <FlatList
            data={options}
            keyExtractor={(item) => item.value}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                className="border-b border-border px-4 py-3"
                onPress={() => handleSelect(item)}
              >
                <Text className="text-foreground">{item.label}</Text>
              </Pressable>
            )}
          />
        </View>
      ) : null}
    </View>
  );
}
