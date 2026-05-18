import type { AircraftCatalogEntry } from '@fs-suite/types';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Dropdown } from 'react-native-element-dropdown';

import { formatOptionalMetric } from './weatherTimeUtils';

const COMPLETENESS_LABELS: Record<string, { label: string; color: string }> = {
  complete: { label: 'Completo', color: '#16a34a' },
  partial: { label: 'Parcial', color: '#d97706' },
  skeleton: { label: 'Básico', color: '#9ca3af' },
};

interface Props {
  value: AircraftCatalogEntry | null;
  onSelect: (aircraft: AircraftCatalogEntry) => void;
  onClear: () => void;
  catalog: AircraftCatalogEntry[];
  loading?: boolean;
  error?: string | null;
}

export { formatOptionalMetric } from './weatherTimeUtils';

export function AircraftSelect({ value, onSelect, onClear, catalog, loading, error }: Props) {
  const { t } = useTranslation();

  const data = useMemo(
    () =>
      catalog
        .filter((a) => a.icaoType != null)
        .map((a) => ({
          label: `${a.icaoType} — ${a.manufacturer ?? ''} ${a.model ?? a.name}`.trim(),
          value: a.icaoType!,
          search: `${a.icaoType} ${a.manufacturer ?? ''} ${a.model ?? ''} ${a.name}`.toLowerCase(),
          entry: a,
        })),
    [catalog],
  );

  const handleChange = useCallback(
    (item: (typeof data)[number]) => {
      onSelect(item.entry);
    },
    [onSelect],
  );

  if (loading) {
    return (
      <View className="mb-3">
        <Text className="mb-1 text-xs font-medium text-muted-foreground">
          {t('aircraft.selectAircraft')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 }}>
          <ActivityIndicator size="small" />
          <Text style={{ fontSize: 13, color: '#9ca3af' }}>{t('common.loading')}</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View className="mb-3">
        <Text className="mb-1 text-xs font-medium text-muted-foreground">
          {t('aircraft.selectAircraft')}
        </Text>
        <View style={{ padding: 12, backgroundColor: '#fef2f2', borderRadius: 8, borderWidth: 1, borderColor: '#fecaca' }}>
          <Text style={{ fontSize: 13, color: '#dc2626' }}>
            {t('aircraft.catalogError', { defaultValue: 'Erro ao carregar catálogo de aeronaves. Verifique sua conexão.' })}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="mb-3">
      <View className="flex-row items-center justify-between">
        <Text className="mb-1 text-xs font-medium text-muted-foreground">
          {t('aircraft.selectAircraft')}
        </Text>
        {value ? (
          <Pressable onPress={onClear}>
            <Text className="text-xs text-muted-foreground">{'✕'}</Text>
          </Pressable>
        ) : null}
      </View>
      <Dropdown
        data={data}
        labelField="label"
        valueField="value"
        searchField="search"
        value={value?.icaoType ?? null}
        onChange={handleChange}
        search
        searchPlaceholder={t('aircraft.searchPlaceholder')}
        placeholder={t('aircraft.searchPlaceholder')}
        style={{
          borderWidth: 1,
          borderColor: '#e5e7eb',
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: 'var(--input, #fff)',
        }}
        placeholderStyle={{ fontSize: 14, color: '#9ca3af' }}
        selectedTextStyle={{ fontSize: 14, color: 'var(--foreground, #1a1d26)' }}
        inputSearchStyle={{
          fontSize: 14,
          borderColor: '#e5e7eb',
          borderRadius: 6,
          paddingHorizontal: 8,
          height: 36,
        }}
        containerStyle={{
          borderRadius: 8,
          borderColor: '#e5e7eb',
          shadowColor: '#000',
          shadowOpacity: 0.08,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          overflow: 'hidden',
        }}
        maxHeight={280}
        renderItem={(item) => {
          const badge = COMPLETENESS_LABELS[item.entry.dataCompleteness] ?? { label: 'Básico', color: '#9ca3af' };
          return (
            <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#2563eb' }}>{item.entry.icaoType}</Text>
                <Text style={{ fontSize: 14, color: '#1a1d26', flex: 1 }} numberOfLines={1}>
                  {item.entry.manufacturer ?? ''} {item.entry.model ?? item.entry.name}
                </Text>
                <View style={{ backgroundColor: badge.color + '18', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                  <Text style={{ fontSize: 9, fontWeight: '600', color: badge.color }}>{badge.label}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 2 }}>
                <Text style={{ fontSize: 10, color: '#6b7280' }}>{formatOptionalMetric(item.entry.cruiseSpeedKts, 'kt')}</Text>
                <Text style={{ fontSize: 10, color: '#6b7280' }}>{formatOptionalMetric(item.entry.fuelBurnLph, 'L/h')}</Text>
                <Text style={{ fontSize: 10, color: '#6b7280' }}>MTOW {formatOptionalMetric(item.entry.mtowKg, 'kg')}</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}
