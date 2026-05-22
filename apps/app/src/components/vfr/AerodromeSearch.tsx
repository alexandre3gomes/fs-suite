import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { apiClient } from '../../services/api.client';

export interface Aerodrome {
  icao: string;
  iata: string | null;
  name: string;
  city: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  elevation: number | null;
  type: string | null;
}

interface Props {
  label: string;
  value: Aerodrome | null;
  onSelect: (aerodrome: Aerodrome) => void;
  onClear: () => void;
}

export function AerodromeSearch({ label, value, onSelect, onClear }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Aerodrome[]>([]);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const data = await apiClient.get<Aerodrome[]>(`/aerodromes/search?q=${encodeURIComponent(q)}`);
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!focused) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void search(query); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, focused, search]);

  const handleSelect = (aerodrome: Aerodrome) => {
    setQuery('');
    setFocused(false);
    setResults([]);
    onSelect(aerodrome);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    onClear();
  };

  const displayValue = focused ? query : (value ? `${value.icao} — ${value.name}` : '');

  return (
    <View className="mb-3">
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-xs font-medium text-muted-foreground">{label}</Text>
        {value && !focused ? (
          <Pressable onPress={handleClear} className="px-1 py-0.5">
            <Text className="text-[10px] font-medium text-destructive">{t('common.clear')}</Text>
          </Pressable>
        ) : null}
      </View>
      <TextInput
        value={displayValue}
        onChangeText={setQuery}
        onFocus={() => { setFocused(true); setQuery(value ? value.icao : ''); }}
        onBlur={() => setTimeout(() => setFocused(false), 200)}
        onSubmitEditing={() => { const first = results[0]; if (first) handleSelect(first); }}
        placeholder={t('vfr.searchAerodrome')}
        placeholderTextColor="#9ca3af"
        className="w-full rounded-button border border-border bg-input px-3 py-2 text-sm text-foreground"
      />

      {focused && (results.length > 0 || loading) ? (
        <View className="mt-1 overflow-hidden rounded-card border border-border bg-surface" style={{ maxHeight: 200 }}>
          {loading && results.length === 0 ? (
            <View className="px-3 py-2">
              <Text className="text-xs text-muted-foreground">{t('common.loading')}</Text>
            </View>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(item) => item.icao}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  className="border-b border-border px-3 py-2"
                  onPress={() => handleSelect(item)}
                >
                  <Text className="text-sm font-medium text-foreground">
                    {item.icao}
                    {item.iata ? ` / ${item.iata}` : ''}
                  </Text>
                  <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                    {item.name}{item.city ? ` — ${item.city}` : ''}
                  </Text>
                </Pressable>
              )}
            />
          )}
        </View>
      ) : null}
    </View>
  );
}
