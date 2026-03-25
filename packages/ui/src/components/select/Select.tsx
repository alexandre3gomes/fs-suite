import * as React from 'react';
import { FlatList, Modal, Pressable, Text, View, type ViewProps } from 'react-native';

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectProps extends ViewProps {
  options: SelectOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function Select({
  options,
  value,
  onValueChange,
  placeholder = 'Select...',
  className = '',
  ...props
}: SelectProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View {...props}>
      <Pressable
        onPress={() => setOpen(true)}
        className={[
          'flex-row items-center justify-between rounded-input border border-border bg-surface px-3 py-2.5',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <Text className={selected ? 'text-foreground' : 'text-muted-foreground'}>
          {selected ? selected.label : placeholder}
        </Text>
        <Text className="text-muted-foreground">▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 bg-black/50" onPress={() => setOpen(false)}>
          <View className="mx-4 mb-8 mt-auto overflow-hidden rounded-card border border-border bg-surface">
            <FlatList
              data={options}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => (
                <Pressable
                  className={[
                    'border-b border-border px-4 py-3',
                    item.value === value ? 'bg-primary/10' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onPress={() => {
                    onValueChange?.(item.value);
                    setOpen(false);
                  }}
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
        </Pressable>
      </Modal>
    </View>
  );
}
