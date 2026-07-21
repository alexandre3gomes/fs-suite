import type { UserAircraftProfile } from '@fs-suite/types';
import { Card, CardContent, Spinner, Text } from '@fs-suite/ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { AircraftProfileModal } from '../../../src/components/vfr/AircraftProfileModal';
import { useAircraftProfiles } from '../../../src/hooks/useAircraftProfiles';
import { confirmDialog } from '../../../src/lib/notify';
import { apiClient } from '../../../src/services/api.client';

export default function AircraftProfilesScreen() {
  const { t } = useTranslation();
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
        apiClient.delete(`/aircraft-profiles/${profile.id}`)
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

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-1 px-4 py-6 md:mx-auto md:w-full md:max-w-3xl md:px-8 md:py-10">
          <Text variant="h3" className="mb-6">
            {t('aircraftProfiles.title')}
          </Text>

          {error ? (
            <View style={{ padding: 14, backgroundColor: '#fef2f2', borderRadius: 10, borderWidth: 1, borderColor: '#fecaca', marginBottom: 16 }}>
              <Text style={{ color: '#dc2626', fontSize: 14 }}>{error}</Text>
            </View>
          ) : null}

          {mine.length === 0 && !loading ? (
            <View style={{ alignItems: 'center', paddingVertical: 48, gap: 8 }}>
              <Text className="text-base font-semibold text-foreground">
                {t('aircraftProfiles.empty')}
              </Text>
              <Text variant="muted" style={{ textAlign: 'center', maxWidth: 280 }}>
                {t('aircraftProfiles.emptyDesc')}
              </Text>
            </View>
          ) : (
            <View className="gap-3">
              {mine.map((profile) => (
                <ProfileRow
                  key={profile.id}
                  profile={profile}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  editLabel={t('aircraftProfiles.edit')}
                  sharedLabel={t('aircraftProfiles.shared')}
                />
              ))}
            </View>
          )}

          <Pressable
            onPress={handleAdd}
            style={{
              marginTop: 20,
              paddingVertical: 14,
              borderRadius: 10,
              borderWidth: 1.5,
              borderColor: '#2563eb',
              borderStyle: 'dashed',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#2563eb', fontSize: 15, fontWeight: '600' }}>
              {t('aircraftProfiles.newProfile')}
            </Text>
          </Pressable>
        </View>
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
  profile, onEdit, onDelete, editLabel, sharedLabel,
}: {
  profile: UserAircraftProfile;
  onEdit: (p: UserAircraftProfile) => void;
  onDelete: (p: UserAircraftProfile) => void;
  editLabel: string;
  sharedLabel: string;
}) {
  return (
    <Card>
      <CardContent className="md:px-8 md:py-5">
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#2563eb' }}>
                {profile.icaoType ?? '—'}
              </Text>
              <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
                {profile.name}
              </Text>
              {profile.isShared ? (
                <View style={{ backgroundColor: '#7c3aed18', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                  <Text style={{ fontSize: 10, fontWeight: '600', color: '#7c3aed' }}>{sharedLabel}</Text>
                </View>
              ) : null}
            </View>
            {profile.manufacturer || profile.model ? (
              <Text variant="muted" style={{ fontSize: 13 }} numberOfLines={1}>
                {[profile.manufacturer, profile.model].filter(Boolean).join(' ')}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
              {profile.cruiseSpeedKts != null ? (
                <Text style={{ fontSize: 11, color: '#9ca3af' }}>{profile.cruiseSpeedKts} kt</Text>
              ) : null}
              {profile.mtowKg != null ? (
                <Text style={{ fontSize: 11, color: '#9ca3af' }}>MTOW {profile.mtowKg} kg</Text>
              ) : null}
              {profile.fuelBurnLph != null ? (
                <Text style={{ fontSize: 11, color: '#9ca3af' }}>{profile.fuelBurnLph} L/h</Text>
              ) : null}
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Pressable
              onPress={() => onEdit(profile)}
              style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#e5e7eb' }}
            >
              <Text style={{ fontSize: 13, color: '#374151', fontWeight: '500' }}>{editLabel}</Text>
            </Pressable>
            <Pressable
              onPress={() => onDelete(profile)}
              style={{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6 }}
            >
              <Text style={{ fontSize: 16, color: '#dc2626' }}>✕</Text>
            </Pressable>
          </View>
        </View>
      </CardContent>
    </Card>
  );
}
