import type { AircraftCatalogEntry, AnyAircraftProfile, UserAircraftProfile } from '@fs-suite/types';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Dropdown } from 'react-native-element-dropdown';

import type { ProfileKind, TaggedAircraftProfile } from '../../hooks/useAircraftProfiles';
import { formatOptionalMetric } from './weatherTimeUtils';

const COMPLETENESS_LABELS: Record<string, { label: string; color: string }> = {
  complete: { label: 'Completo', color: '#16a34a' },
  partial: { label: 'Parcial', color: '#d97706' },
  skeleton: { label: 'Básico', color: '#9ca3af' },
};

const KIND_BADGES: Record<ProfileKind, { label: string; color: string }> = {
  template: { label: 'Padrão', color: '#6b7280' },
  shared: { label: 'Compartilhado', color: '#7c3aed' },
  mine: { label: 'Meu', color: '#0891b2' },
};

interface Props {
  value: AnyAircraftProfile | null;
  onSelect: (aircraft: AnyAircraftProfile) => void;
  onClear: () => void;
  entries: TaggedAircraftProfile[];
  loading?: boolean;
  error?: string | null;
  onCreateProfile: () => void;
  onEditProfile?: (profile: UserAircraftProfile) => void;
}

export { formatOptionalMetric } from './weatherTimeUtils';

export function AircraftSelect({ value, onSelect, onClear, entries, loading, error, onCreateProfile, onEditProfile }: Props) {
  const { t } = useTranslation();

  const data = useMemo(
    () =>
      entries
        .filter((e) => e.profile.icaoType != null)
        .map((e) => ({
          label: `${e.profile.icaoType} — ${e.profile.manufacturer ?? ''} ${e.profile.model ?? e.profile.name}`.trim(),
          value: e.profile.id,
          search: `${e.profile.icaoType} ${e.profile.manufacturer ?? ''} ${e.profile.model ?? ''} ${e.profile.name}`.toLowerCase(),
          kind: e.kind,
          profile: e.profile,
        })),
    [entries],
  );

  const handleChange = useCallback(
    (item: (typeof data)[number]) => {
      onSelect(item.profile);
    },
    [onSelect],
  );

  const selectedValue = value?.id ?? null;

  const selectedKind = useMemo(() => {
    if (!value) return null;
    return entries.find((e) => e.profile.id === value.id)?.kind ?? null;
  }, [value, entries]);

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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text className="text-xs font-medium text-muted-foreground">
          {t('aircraft.selectAircraft')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {value && selectedKind === 'mine' && onEditProfile ? (
            <Pressable onPress={() => onEditProfile(value as UserAircraftProfile)}>
              <Text style={{ fontSize: 11, color: '#0891b2' }}>Editar</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onCreateProfile}>
            <Text style={{ fontSize: 11, color: '#2563eb', fontWeight: '600' }}>+ Criar perfil</Text>
          </Pressable>
          {value ? (
            <Pressable onPress={onClear}>
              <Text className="text-xs text-muted-foreground">{'✕'}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Dropdown
        data={data}
        labelField="label"
        valueField="value"
        searchField="search"
        value={selectedValue}
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
        maxHeight={300}
        renderItem={(item) => {
          const completeness = COMPLETENESS_LABELS[item.profile.dataCompleteness] ?? COMPLETENESS_LABELS.skeleton!;
          const kind = KIND_BADGES[item.kind as ProfileKind];
          return (
            <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#2563eb' }}>{item.profile.icaoType}</Text>
                <Text style={{ fontSize: 14, color: '#1a1d26', flex: 1 }} numberOfLines={1}>
                  {item.profile.manufacturer ?? ''} {item.profile.model ?? item.profile.name}
                </Text>
                {item.kind !== 'template' && kind ? (
                  <View style={{ backgroundColor: kind.color + '18', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}>
                    <Text style={{ fontSize: 9, fontWeight: '600', color: kind.color }}>{kind.label}</Text>
                  </View>
                ) : null}
                {completeness ? (
                  <View style={{ backgroundColor: completeness.color + '18', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}>
                    <Text style={{ fontSize: 9, fontWeight: '600', color: completeness.color }}>{completeness.label}</Text>
                  </View>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 2 }}>
                <Text style={{ fontSize: 10, color: '#6b7280' }}>{formatOptionalMetric(item.profile.cruiseSpeedKts, 'kt')}</Text>
                <Text style={{ fontSize: 10, color: '#6b7280' }}>{formatOptionalMetric(item.profile.fuelBurnLph, 'L/h')}</Text>
                <Text style={{ fontSize: 10, color: '#6b7280' }}>MTOW {formatOptionalMetric(item.profile.mtowKg, 'kg')}</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

// Re-export catalog entry type for backward compat
export type { AircraftCatalogEntry };
