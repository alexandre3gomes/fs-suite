import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Dropdown } from 'react-native-element-dropdown';

import { type AircraftSpec, AIRCRAFT_CATALOG } from '../../data/aircraftCatalog';

interface Props {
  value: AircraftSpec | null;
  onSelect: (aircraft: AircraftSpec) => void;
  onClear: () => void;
}

export function AircraftSelect({ value, onSelect, onClear }: Props) {
  const { t } = useTranslation();

  const data = useMemo(
    () =>
      AIRCRAFT_CATALOG.map((a) => ({
        label: `${a.icaoType} — ${a.manufacturer} ${a.model}`,
        value: a.icaoType,
        search: `${a.icaoType} ${a.manufacturer} ${a.model}`.toLowerCase(),
        spec: a,
      })),
    [],
  );

  const handleChange = useCallback(
    (item: (typeof data)[number]) => {
      onSelect(item.spec);
    },
    [onSelect],
  );

  return (
    <View className="mb-3">
      <View className="flex-row items-center justify-between">
        <Text className="mb-1 text-xs font-medium text-muted-foreground">
          {t('aircraft.selectAircraft')}
        </Text>
        {value ? (
          <Pressable onPress={onClear}>
            <Text className="text-xs text-muted-foreground">✕</Text>
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
        renderItem={(item) => (
          <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#2563eb' }}>{item.spec.icaoType}</Text>
              <Text style={{ fontSize: 14, color: '#1a1d26' }} numberOfLines={1}>
                {item.spec.manufacturer} {item.spec.model}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 2 }}>
              <Text style={{ fontSize: 10, color: '#6b7280' }}>{item.spec.cruiseSpeedKts} kt</Text>
              <Text style={{ fontSize: 10, color: '#6b7280' }}>{item.spec.fuelBurnLph} L/h</Text>
              <Text style={{ fontSize: 10, color: '#6b7280' }}>MTOW {item.spec.mtowKg} kg</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}
