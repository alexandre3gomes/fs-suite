import type { UserAircraftProfile } from '@fs-suite/types';
import { Button, Spinner, Text } from '@fs-suite/ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { AircraftProfileModal } from '../../../src/components/vfr/AircraftProfileModal';
import { useAircraftProfiles } from '../../../src/hooks/useAircraftProfiles';
import { useIsDesktop } from '../../../src/hooks/useIsDesktop';
import { confirmDialog } from '../../../src/lib/notify';
import { apiClient } from '../../../src/services/api.client';
import { formatWeight, useUnitsStore } from '../../../src/stores/units.store';

export default function AircraftProfilesScreen() {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const { mine, catalog, shared, loading, error, refresh } = useAircraftProfiles();

  const [showModal, setShowModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<UserAircraftProfile | null>(null);

  const handleAdd = useCallback(() => {
    setEditingProfile(null);
    setShowModal(true);
  }, []);

  const handleEdit = useCallback((profile: UserAircraftProfile) => {
    setEditingProfile(profile);
    setShowModal(true);
  }, []);

  const handleDelete = useCallback((profile: UserAircraftProfile) => {
    confirmDialog({
      title: t('aircraftProfiles.deleteConfirmTitle'),
      message: t('aircraftProfiles.deleteConfirmMessage', { name: profile.name }),
      confirmLabel: t('aircraftProfiles.deleteConfirmLabel'),
      destructive: true,
      onConfirm: () => {
        apiClient.delete('/aircraft-profiles/' + profile.id)
          .then(() => refresh())
          .catch(() => {});
      },
    });
  }, [t, refresh]);

  const handleSaved = useCallback((profile: UserAircraftProfile) => {
    void refresh();
    setShowModal(false);
    setEditingProfile(null);
    // update the editing ref in case the user edits again before the list refreshes
    if (editingProfile) setEditingProfile(profile);
  }, [refresh, editingProfile]);

  const handleDeleted = useCallback(() => {
    void refresh();
    setShowModal(false);
    setEditingProfile(null);
  }, [refresh]);

  if (loading && mine.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner size="lg" />
      </View>
    );
  }

  const pad = isDesktop ? 'px-8' : 'px-4';
  const sharedCount = mine.filter((p) => p.isShared).length;

  return (
    <View className="flex-1 bg-background">
      <View
        className={
          'border-b-2 border-rule ' + pad + (isDesktop ? ' flex-row items-end justify-between py-6' : ' py-5')
        }
      >
        <View style={{ minWidth: 0 }}>
          <Text variant="kicker">
            {t('aircraftProfiles.kicker', { count: mine.length, shared: sharedCount })}
          </Text>
          <Text variant={isDesktop ? 'h1' : 'h2'} className="mt-2">
            {t('aircraftProfiles.title')}
          </Text>
        </View>
        <View className={isDesktop ? '' : 'mt-4 flex-row'}>
          <Button onPress={handleAdd}>
            <Text>{t('aircraftProfiles.newProfile')}</Text>
          </Button>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        {error ? (
          <View className={'bg-destructive py-4 ' + pad}>
            <Text className="font-sans text-[14px] font-bold text-destructive-foreground">{error}</Text>
          </View>
        ) : null}

        {mine.length === 0 && !loading ? (
          <View className={'py-16 ' + pad}>
            <Text variant={isDesktop ? 'h3' : 'h4'} style={{ maxWidth: 460 }}>
              {t('aircraftProfiles.empty')}
            </Text>
            <Text variant="muted" className="mt-3" style={{ maxWidth: 420 }}>
              {t('aircraftProfiles.emptyDesc')}
            </Text>
            <View className="mt-6 flex-row">
              <Button onPress={handleAdd}>
                <Text>{t('aircraftProfiles.newProfile')}</Text>
              </Button>
            </View>
          </View>
        ) : (
          mine.map((profile) => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              onEdit={handleEdit}
              onDelete={handleDelete}
              editLabel={t('aircraftProfiles.edit')}
              sharedLabel={t('aircraftProfiles.shared')}
              pad={pad}
            />
          ))
        )}
      </ScrollView>

      <AircraftProfileModal
        visible={showModal}
        editingProfile={editingProfile}
        catalog={catalog}
        shared={shared}
        onClose={() => { setShowModal(false); setEditingProfile(null); }}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />
    </View>
  );
}

function ProfileRow({
  profile, onEdit, onDelete, editLabel, sharedLabel, pad,
}: {
  profile: UserAircraftProfile;
  onEdit: (p: UserAircraftProfile) => void;
  onDelete: (p: UserAircraftProfile) => void;
  editLabel: string;
  sharedLabel: string;
  pad: string;
}) {
  const { t } = useTranslation();
  const weightUnit = useUnitsStore((s) => s.weight);

  /** ICAO type is the identifier a pilot scans for, so it leads. */
  const specs = [
    {
      key: 'cruise',
      label: t('aircraftProfiles.specCruise'),
      value: profile.cruiseSpeedKts != null ? profile.cruiseSpeedKts + ' kt' : '—',
    },
    {
      key: 'mtow',
      label: t('aircraftProfiles.specMtow'),
      value: profile.mtowKg != null ? formatWeight(profile.mtowKg, weightUnit) : '—',
    },
    {
      key: 'burn',
      // fuelBurnLph is litres per hour by definition, so it is not converted.
      label: t('aircraftProfiles.specBurn'),
      value: profile.fuelBurnLph != null ? profile.fuelBurnLph + ' L/h' : '—',
    },
  ];

  return (
    <View className={'border-b border-border py-4 ' + pad}>
      <View className="flex-row items-start justify-between gap-4">
        <View style={{ flex: 1, minWidth: 0 }}>
          <View className="flex-row items-baseline gap-3">
            <Text variant="labelInk" className="text-primary">
              {profile.icaoType ?? '—'}
            </Text>
            <Text variant="h4" numberOfLines={1} style={{ flexShrink: 1 }}>
              {profile.name}
            </Text>
            {profile.isShared ? (
              <View className="bg-secondary px-2 py-1">
                <Text variant="label" className="text-[10px]">
                  {sharedLabel}
                </Text>
              </View>
            ) : null}
          </View>
          {profile.manufacturer || profile.model ? (
            <Text variant="muted" className="mt-1 text-[13px]" numberOfLines={1}>
              {[profile.manufacturer, profile.model].filter(Boolean).join(' ')}
            </Text>
          ) : null}
        </View>

        <View className="flex-row items-center">
          <Pressable
            onPress={() => onEdit(profile)}
            className="border-2 border-rule px-3 py-2"
            accessibilityRole="button"
          >
            <Text variant="labelInk">{editLabel}</Text>
          </Pressable>
          <Pressable
            onPress={() => onDelete(profile)}
            className="border-2 border-l-0 border-rule px-3 py-2"
            accessibilityRole="button"
            accessibilityLabel={t('common.delete')}
          >
            <Text variant="labelInk" className="text-destructive">
              ✕
            </Text>
          </Pressable>
        </View>
      </View>

      <View className="mt-3 flex-row border-t-2 border-rule">
        {specs.map((spec) => (
          <View key={spec.key} className="border-r border-border pr-3 pt-2" style={{ flex: 1, minWidth: 0 }}>
            <Text variant="label" className="text-[10px]">
              {spec.label}
            </Text>
            <Text variant="small" className="mt-1" numberOfLines={1}>
              {spec.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
