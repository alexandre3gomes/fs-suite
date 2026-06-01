import { Input } from '@fs-suite/ui';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { useCurrentUser } from '../../../src/hooks/useCurrentUser';
import { isOptedOut, setFeatureContext, setOptOut, trackAction, trackFailure, trackSuccess, categorizeError } from '../../../src/services/analytics';
import { apiClient } from '../../../src/services/api.client';
import { useAuthStore } from '../../../src/stores/auth.store';
import {
  useUnitsStore,
  type WeightUnit,
  type FuelUnit,
  type SpeedUnit,
} from '../../../src/stores/units.store';

type AiProviderValue = 'openai' | 'anthropic' | 'google';

const AI_PROVIDERS: { label: string; value: AiProviderValue; keyUrl: string }[] = [
  { label: 'OpenAI', value: 'openai', keyUrl: 'https://platform.openai.com/api-keys' },
  { label: 'Anthropic', value: 'anthropic', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { label: 'Google (Gemini)', value: 'google', keyUrl: 'https://aistudio.google.com/apikey' },
];

function UnitPicker<T extends string>({ label, options, value, onChange }: { label: string; options: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <View className="flex-row items-center justify-between py-2">
      <Text className="text-sm text-foreground">{label}</Text>
      <View className="flex-row gap-1.5">
        {options.map((opt) => (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            className={`rounded-md border px-3 py-1.5 ${value === opt ? 'border-primary bg-primary/10' : 'border-border'}`}
          >
            <Text className={`text-xs font-medium ${value === opt ? 'text-primary' : 'text-foreground'}`}>{opt}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function UnitsSection() {
  const { t } = useTranslation();
  const { weight, fuel, speed, setWeight, setFuel, setSpeed } = useUnitsStore();

  return (
    <View className="border-b border-border px-4 py-5 md:px-6">
      <Text className="text-base font-bold text-foreground">{t('profile.units')}</Text>
      <Text className="mt-1 text-xs text-muted-foreground">{t('profile.unitsDescription')}</Text>
      <View className="mt-3 rounded-md border border-border bg-surface-muted px-4 py-1">
        <UnitPicker<WeightUnit> label={t('profile.unitWeight')} options={['kg', 'lbs']} value={weight} onChange={setWeight} />
        <UnitPicker<FuelUnit> label={t('profile.unitFuel')} options={['kg', 'lbs', 'L', 'gal']} value={fuel} onChange={setFuel} />
        <UnitPicker<SpeedUnit> label={t('profile.unitSpeed')} options={['kt', 'km/h', 'mph']} value={speed} onChange={setSpeed} />
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const setStoredUser = useAuthStore((s) => s.setUser);
  const router = useRouter();

  useEffect(() => { setFeatureContext('profile'); return () => setFeatureContext(null); }, []);

  // Email announcements opt-out (defaults on — legitimate interest, LGPD).
  const [emailConsent, setEmailConsent] = useState(true);
  const [emailConsentSaving, setEmailConsentSaving] = useState(false);
  useEffect(() => {
    if (user?.marketingEmailConsent !== undefined) setEmailConsent(user.marketingEmailConsent);
  }, [user?.marketingEmailConsent]);

  const handleToggleEmailConsent = useCallback(async () => {
    const next = !emailConsent;
    setEmailConsent(next); // optimistic
    setEmailConsentSaving(true);
    try {
      await apiClient.patch('/users/me', { marketingEmailConsent: next });
      if (user) setStoredUser({ ...user, marketingEmailConsent: next });
      trackAction(next ? 'email_consent_opt_in' : 'email_consent_opt_out');
    } catch (err) {
      setEmailConsent(!next); // revert
      const { errorType, statusCode } = categorizeError(err);
      trackFailure('email_consent_save_failed', errorType, { status_code: statusCode });
      Alert.alert(t('common.error'), t('profile.emailConsentError'));
    }
    setEmailConsentSaving(false);
  }, [emailConsent, user, setStoredUser, t]);

  // Analytics opt-out
  const [analyticsOptedOut, setAnalyticsOptedOut] = useState(isOptedOut());
  const handleToggleAnalytics = useCallback(async () => {
    const next = !analyticsOptedOut;
    await setOptOut(next);
    setAnalyticsOptedOut(next);
    if (!next) trackAction('analytics_opt_in');
  }, [analyticsOptedOut]);

  // SimBrief connection
  const [simbriefPilotId, setSimbriefPilotId] = useState('');
  const [simbriefLoading, setSimbriefLoading] = useState(true);
  const [simbriefSaving, setSimbriefSaving] = useState(false);
  const [simbriefSaved, setSimbriefSaved] = useState(false);

  useEffect(() => {
    setSimbriefLoading(true);
    apiClient
      .get<{ pilotId: string | null }>('/integrations/simbrief/connection')
      .then((data) => {
        if (data.pilotId) setSimbriefPilotId(data.pilotId);
      })
      .catch(() => {})
      .finally(() => setSimbriefLoading(false));
  }, []);

  const handleSaveSimbrief = useCallback(async () => {
    const id = simbriefPilotId.trim();
    if (!id) return;
    setSimbriefSaving(true);
    try {
      await apiClient.patch('/integrations/simbrief/connection', { pilotId: id });
      trackSuccess('simbrief_pilot_id_saved');
      setSimbriefSaved(true);
      setTimeout(() => setSimbriefSaved(false), 2000);
    } catch (err) {
      const { errorType, statusCode } = categorizeError(err);
      trackFailure('simbrief_pilot_id_save_failed', errorType, { status_code: statusCode });
      Alert.alert(t('common.error'), 'Could not save SimBrief pilot ID.');
    }
    setSimbriefSaving(false);
  }, [simbriefPilotId, t]);

  // AI Validation BYOK
  const [aiProvider, setAiProvider] = useState<AiProviderValue>('openai');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiLoading, setAiLoading] = useState(true);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiSaved, setAiSaved] = useState(false);
  const [aiHasKey, setAiHasKey] = useState(false);
  const [aiConnectedProvider, setAiConnectedProvider] = useState<string | null>(null);

  useEffect(() => {
    setAiLoading(true);
    apiClient
      .get<{ provider: string | null; hasKey: boolean }>('/integrations/ai-validation/connection')
      .then((data) => {
        setAiHasKey(data.hasKey);
        if (data.provider) {
          setAiProvider(data.provider as AiProviderValue);
          setAiConnectedProvider(data.provider);
        }
      })
      .catch(() => {})
      .finally(() => setAiLoading(false));
  }, []);

  const handleSaveAiKey = useCallback(async () => {
    const key = aiApiKey.trim();
    if (!key) return;
    setAiSaving(true);
    try {
      await apiClient.patch('/integrations/ai-validation/connection', { provider: aiProvider, apiKey: key });
      trackSuccess('ai_key_saved', { provider: aiProvider });
      setAiSaved(true);
      setAiHasKey(true);
      setAiConnectedProvider(aiProvider);
      setAiApiKey('');
      setTimeout(() => setAiSaved(false), 2000);
    } catch (err) {
      const { errorType, statusCode } = categorizeError(err);
      trackFailure('ai_key_save_failed', errorType, { provider: aiProvider, status_code: statusCode });
      Alert.alert(t('common.error'), 'Could not save API key.');
    }
    setAiSaving(false);
  }, [aiApiKey, aiProvider, t]);

  const handleDeleteAiKey = useCallback(async () => {
    try {
      await apiClient.delete('/integrations/ai-validation/connection');
      trackSuccess('ai_key_deleted');
      setAiHasKey(false);
      setAiConnectedProvider(null);
      setAiApiKey('');
    } catch {
      Alert.alert(t('common.error'), 'Could not delete API key.');
    }
  }, [t]);

  return (
      <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="md:mx-auto md:w-full md:max-w-2xl">
          {/* User info */}
          <View className="border-b border-border px-4 py-5 md:px-6">
            <Text className="text-base font-bold text-foreground">{t('dashboard.profile')}</Text>
            {user ? (
              <View className="mt-3">
                <Text className="text-sm text-foreground">{user.name}</Text>
                <Text className="text-xs text-muted-foreground">{user.email}</Text>
              </View>
            ) : null}
          </View>

          {/* Admin area — only for admins (isAdmin from /users/me) */}
          {user?.isAdmin ? (
            <Pressable
              className="border-b border-border px-4 py-5 active:opacity-70 md:px-6"
              onPress={() => router.push('/(auth)/admin')}
            >
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="text-base font-bold text-foreground">{t('admin.title')}</Text>
                  <Text className="mt-1 text-xs text-muted-foreground">{t('admin.communicationsDesc')}</Text>
                </View>
                <Text className="text-muted-foreground">›</Text>
              </View>
            </Pressable>
          ) : null}

          {/* Units */}
          <UnitsSection />

          {/* Privacy */}
          <View className="border-b border-border px-4 py-5 md:px-6">
            <Text className="text-base font-bold text-foreground">{t('profile.privacy')}</Text>
            <Text className="mt-1 text-xs text-muted-foreground">{t('profile.privacyDescription')}</Text>
            <View className="mt-3 flex-row items-center justify-between rounded-md border border-border bg-surface-muted px-4 py-3">
              <View className="flex-1 pr-3">
                <Text className="text-sm font-semibold text-foreground">{t('profile.analyticsToggle')}</Text>
                <Text className="mt-1 text-xs text-muted-foreground">{t('profile.analyticsToggleDescription')}</Text>
              </View>
              <Pressable
                onPress={() => { void handleToggleAnalytics(); }}
                className={`rounded-md border px-3 py-1.5 ${analyticsOptedOut ? 'border-border' : 'border-primary bg-primary/10'}`}
              >
                <Text className={`text-xs font-medium ${analyticsOptedOut ? 'text-foreground' : 'text-primary'}`}>
                  {analyticsOptedOut ? t('profile.analyticsOff') : t('profile.analyticsOn')}
                </Text>
              </Pressable>
            </View>

            {/* Product announcement emails (opt-out) */}
            <View className="mt-3 flex-row items-center justify-between rounded-md border border-border bg-surface-muted px-4 py-3">
              <View className="flex-1 pr-3">
                <Text className="text-sm font-semibold text-foreground">{t('profile.emailConsentToggle')}</Text>
                <Text className="mt-1 text-xs text-muted-foreground">{t('profile.emailConsentDescription')}</Text>
              </View>
              <Pressable
                onPress={() => { void handleToggleEmailConsent(); }}
                disabled={emailConsentSaving}
                className={`rounded-md border px-3 py-1.5 ${emailConsent ? 'border-primary bg-primary/10' : 'border-border'} ${emailConsentSaving ? 'opacity-50' : ''}`}
              >
                <Text className={`text-xs font-medium ${emailConsent ? 'text-primary' : 'text-foreground'}`}>
                  {emailConsent ? t('profile.emailConsentOn') : t('profile.emailConsentOff')}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Integrations */}
          <View className="border-b border-border px-4 py-5 md:px-6">
            <Text className="mb-3 text-base font-bold text-foreground">
              {t('profile.integrations')}
            </Text>

            {/* SimBrief */}
            <View className="rounded-md border border-border bg-surface-muted px-4 py-4">
              <View className="mb-2 flex-row items-center gap-2">
                <Text className="text-sm font-semibold text-foreground">SimBrief</Text>
                {!simbriefLoading && simbriefPilotId ? (
                  <View className="flex-row items-center gap-1">
                    <View className="h-2 w-2 rounded-full bg-green-500" />
                    <Text className="text-[10px] text-green-600">{t('vfr.simbriefConnected')}</Text>
                  </View>
                ) : null}
              </View>
              <Text className="mb-3 text-xs text-muted-foreground">
                {t('profile.simbriefDescription')}
              </Text>
              {simbriefLoading ? (
                <Text className="text-xs text-muted-foreground">{t('common.loading')}</Text>
              ) : (
                <View className="flex-row items-end gap-2">
                  <View className="flex-1">
                    <Input
                      label={t('vfr.simbriefPilotId')}
                      value={simbriefPilotId}
                      onChangeText={(v) => { setSimbriefPilotId(v); setSimbriefSaved(false); }}
                      placeholder={t('vfr.simbriefPilotIdPlaceholder')}
                    />
                  </View>
                  <Pressable
                    onPress={handleSaveSimbrief}
                    disabled={simbriefSaving || !simbriefPilotId.trim()}
                    className="rounded-button bg-primary px-4 py-2.5 active:opacity-80 disabled:opacity-50"
                  >
                    <Text className="text-xs font-medium text-primary-foreground">
                      {simbriefSaving ? t('common.saving') : simbriefSaved ? '✓' : t('common.save')}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>

            {/* AI Validation BYOK */}
            <View className="mt-3 rounded-md border border-border bg-surface-muted px-4 py-4">
              <View className="mb-2 flex-row items-center gap-2">
                <Text className="text-sm font-semibold text-foreground">
                  {t('profile.aiValidation')}
                </Text>
                {!aiLoading && aiHasKey ? (
                  <View className="flex-row items-center gap-1">
                    <View className="h-2 w-2 rounded-full bg-green-500" />
                    <Text className="text-[10px] text-green-600">
                      {t('profile.aiConnected')} ({aiConnectedProvider})
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text className="mb-3 text-xs text-muted-foreground">
                {t('profile.aiValidationDescription')}
              </Text>
              {aiLoading ? (
                <Text className="text-xs text-muted-foreground">{t('common.loading')}</Text>
              ) : (
                <View className="gap-3">
                  <View>
                    <Text className="mb-1.5 text-xs text-muted-foreground">{t('profile.aiProvider')}</Text>
                    <View className="flex-row gap-1.5">
                      {AI_PROVIDERS.map((p) => (
                        <Pressable
                          key={p.value}
                          onPress={() => setAiProvider(p.value)}
                          className={`rounded-md border px-3 py-1.5 ${aiProvider === p.value ? 'border-primary bg-primary/10' : 'border-border'}`}
                        >
                          <Text className={`text-xs font-medium ${aiProvider === p.value ? 'text-primary' : 'text-foreground'}`}>
                            {p.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <Pressable
                      onPress={() => {
                        const provider = AI_PROVIDERS.find((p) => p.value === aiProvider);
                        if (provider) Linking.openURL(provider.keyUrl);
                      }}
                      className="mt-1.5"
                    >
                      <Text className="text-xs text-primary underline">
                        {t('profile.aiGetKey', { provider: AI_PROVIDERS.find((p) => p.value === aiProvider)?.label })}
                      </Text>
                    </Pressable>
                  </View>
                  <View className="flex-row items-end gap-2">
                    <View className="flex-1">
                      <Input
                        label={t('profile.aiApiKey')}
                        value={aiApiKey}
                        onChangeText={(v) => { setAiApiKey(v); setAiSaved(false); }}
                        placeholder={t('profile.aiApiKeyPlaceholder')}
                        secureTextEntry
                      />
                    </View>
                    <Pressable
                      onPress={handleSaveAiKey}
                      disabled={aiSaving || !aiApiKey.trim()}
                      className="rounded-button bg-primary px-4 py-2.5 active:opacity-80 disabled:opacity-50"
                    >
                      <Text className="text-xs font-medium text-primary-foreground">
                        {aiSaving ? t('common.saving') : aiSaved ? '✓' : t('common.save')}
                      </Text>
                    </Pressable>
                  </View>
                  {aiHasKey ? (
                    <Pressable onPress={handleDeleteAiKey}>
                      <Text className="text-xs text-destructive">{t('profile.aiDeleteKey')}</Text>
                    </Pressable>
                  ) : null}
                </View>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
  );
}
