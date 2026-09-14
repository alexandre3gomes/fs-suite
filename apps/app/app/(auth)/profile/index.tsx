import { Button, Input, Text } from '@fs-suite/ui';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, View } from 'react-native';

import { useCurrentUser } from '../../../src/hooks/useCurrentUser';
import { useIsDesktop } from '../../../src/hooks/useIsDesktop';
import { notify } from '../../../src/lib/notify';
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

type PaneId = 'account' | 'units' | 'integrations' | 'privacy';

const PANES: { id: PaneId; labelKey: string }[] = [
  { id: 'account', labelKey: 'profile.paneAccount' },
  { id: 'units', labelKey: 'profile.paneUnits' },
  { id: 'integrations', labelKey: 'profile.paneIntegrations' },
  { id: 'privacy', labelKey: 'profile.panePrivacy' },
];

/** A segmented control drawn as abutting ruled cells — no radius, no gap. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View className="flex-row">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            className={['border-2 border-rule px-3 py-2', active ? 'bg-rule' : 'bg-transparent'].join(' ')}
            style={{ marginRight: -2 }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text variant="labelInk" className={active ? 'text-background' : 'text-foreground'}>
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Label on the left, control on the right, separated by a 1px row rule. */
function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="flex-row items-center justify-between gap-4 border-b border-border py-3">
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="small">{label}</Text>
        {hint ? (
          <Text variant="muted" className="mt-1 text-[12px]">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function SectionHead({ title, desc }: { title: string; desc?: string }) {
  return (
    <View className="border-b-2 border-rule pb-2">
      <Text variant="labelInk">{title}</Text>
      {desc ? (
        <Text variant="muted" className="mt-2 text-[12px]" style={{ maxWidth: 520 }}>
          {desc}
        </Text>
      ) : null}
    </View>
  );
}

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const setStoredUser = useAuthStore((s) => s.setUser);
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const [pane, setPane] = useState<PaneId>('account');

  const { weight, fuel, speed, setWeight, setFuel, setSpeed } = useUnitsStore();

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
      notify(t('common.error'), t('profile.emailConsentError'));
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
      notify(t('common.error'), 'Could not save SimBrief pilot ID.');
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
      notify(t('common.error'), 'Could not save API key.');
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
      notify(t('common.error'), 'Could not delete API key.');
    }
  }, [t]);

  const pad = isDesktop ? 'px-8' : 'px-4';

  const paneNav = (
    <View className={isDesktop ? '' : 'flex-row flex-wrap'}>
      {PANES.map((p) => {
        const active = pane === p.id;
        return (
          <Pressable
            key={p.id}
            onPress={() => setPane(p.id)}
            className={
              isDesktop
                ? [
                    'flex-row items-center gap-3 border-b border-border py-3 pr-4',
                    active ? 'bg-secondary' : '',
                  ].join(' ')
                : ['border-2 border-rule px-3 py-2', active ? 'bg-rule' : 'bg-transparent'].join(' ')
            }
            style={isDesktop ? undefined : { marginRight: -2 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            {isDesktop ? (
              <View
                style={{ width: 4, alignSelf: 'stretch', minHeight: 18 }}
                className={active ? 'bg-primary' : 'bg-transparent'}
              />
            ) : null}
            <Text
              variant="labelInk"
              className={
                isDesktop
                  ? active
                    ? 'text-primary'
                    : 'text-foreground'
                  : active
                    ? 'text-background'
                    : 'text-foreground'
              }
            >
              {t(p.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const body = (
    <View className={isDesktop ? 'px-8 py-6' : 'px-4 py-5'}>
      {pane === 'account' ? (
        <View>
          <SectionHead title={t('profile.paneAccount')} />
          {user ? (
            <View className="pt-3">
              <SettingRow label={t('profile.fieldName')}>
                <Text variant="small">{user.name}</Text>
              </SettingRow>
              <SettingRow label={t('profile.fieldEmail')}>
                <Text variant="small">{user.email}</Text>
              </SettingRow>
            </View>
          ) : null}

          {/* Admin area — only for admins (isAdmin from /users/me) */}
          {user?.isAdmin ? (
            <View className="mt-6 flex-row">
              <Button variant="secondary" onPress={() => router.push('/(auth)/admin')}>
                <Text>{t('admin.title')}</Text>
              </Button>
            </View>
          ) : null}
        </View>
      ) : null}

      {pane === 'units' ? (
        <View>
          <SectionHead title={t('profile.units')} desc={t('profile.unitsDescription')} />
          <View className="pt-3">
            <SettingRow label={t('profile.unitWeight')}>
              <Segmented<WeightUnit> options={['kg', 'lbs']} value={weight} onChange={setWeight} />
            </SettingRow>
            <SettingRow label={t('profile.unitFuel')}>
              <Segmented<FuelUnit> options={['kg', 'lbs', 'L', 'gal']} value={fuel} onChange={setFuel} />
            </SettingRow>
            <SettingRow label={t('profile.unitSpeed')}>
              <Segmented<SpeedUnit> options={['kt', 'km/h', 'mph']} value={speed} onChange={setSpeed} />
            </SettingRow>
          </View>
        </View>
      ) : null}

      {pane === 'integrations' ? (
        <View>
          <SectionHead title={t('profile.integrations')} />

          {/* SimBrief */}
          <View className="border-b border-border py-5">
            <View className="flex-row items-center justify-between gap-3">
              <Text variant="h4">SimBrief</Text>
              {!simbriefLoading && simbriefPilotId ? (
                <Text variant="labelInk" className="text-success">
                  {t('vfr.simbriefConnected')}
                </Text>
              ) : null}
            </View>
            <Text variant="muted" className="mt-2 text-[12px]" style={{ maxWidth: 520 }}>
              {t('profile.simbriefDescription')}
            </Text>
            {simbriefLoading ? (
              <Text variant="muted" className="mt-3">
                {t('common.loading')}
              </Text>
            ) : (
              <View className="mt-3 flex-row items-end gap-3">
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Input
                    label={t('vfr.simbriefPilotId')}
                    value={simbriefPilotId}
                    onChangeText={(v) => { setSimbriefPilotId(v); setSimbriefSaved(false); }}
                    placeholder={t('vfr.simbriefPilotIdPlaceholder')}
                  />
                </View>
                <Button
                  onPress={handleSaveSimbrief}
                  disabled={simbriefSaving || !simbriefPilotId.trim()}
                >
                  <Text>
                    {simbriefSaving ? t('common.saving') : simbriefSaved ? '✓' : t('common.save')}
                  </Text>
                </Button>
              </View>
            )}
          </View>

          {/* AI Validation BYOK */}
          <View className="py-5">
            <View className="flex-row items-center justify-between gap-3">
              <Text variant="h4">{t('profile.aiValidation')}</Text>
              {!aiLoading && aiHasKey ? (
                <Text variant="labelInk" className="text-success">
                  {t('profile.aiConnected')} ({aiConnectedProvider})
                </Text>
              ) : null}
            </View>
            <Text variant="muted" className="mt-2 text-[12px]" style={{ maxWidth: 520 }}>
              {t('profile.aiValidationDescription')}
            </Text>
            {aiLoading ? (
              <Text variant="muted" className="mt-3">
                {t('common.loading')}
              </Text>
            ) : (
              <View className="mt-3">
                <Text variant="label">{t('profile.aiProvider')}</Text>
                <View className="mt-2 flex-row">
                  {AI_PROVIDERS.map((p) => {
                    const active = aiProvider === p.value;
                    return (
                      <Pressable
                        key={p.value}
                        onPress={() => setAiProvider(p.value)}
                        className={['border-2 border-rule px-3 py-2', active ? 'bg-rule' : 'bg-transparent'].join(' ')}
                        style={{ marginRight: -2 }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text variant="labelInk" className={active ? 'text-background' : 'text-foreground'}>
                          {p.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  onPress={() => {
                    const provider = AI_PROVIDERS.find((p) => p.value === aiProvider);
                    if (provider) Linking.openURL(provider.keyUrl);
                  }}
                  className="mt-3"
                >
                  <Text variant="label" className="text-accent">
                    {t('profile.aiGetKey', { provider: AI_PROVIDERS.find((p) => p.value === aiProvider)?.label })}
                  </Text>
                </Pressable>

                <View className="mt-4 flex-row items-end gap-3">
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Input
                      label={t('profile.aiApiKey')}
                      value={aiApiKey}
                      onChangeText={(v) => { setAiApiKey(v); setAiSaved(false); }}
                      placeholder={t('profile.aiApiKeyPlaceholder')}
                      secureTextEntry
                    />
                  </View>
                  <Button onPress={handleSaveAiKey} disabled={aiSaving || !aiApiKey.trim()}>
                    <Text>{aiSaving ? t('common.saving') : aiSaved ? '✓' : t('common.save')}</Text>
                  </Button>
                </View>

                {aiHasKey ? (
                  <Pressable onPress={handleDeleteAiKey} className="mt-4">
                    <Text variant="label" className="text-destructive">
                      {t('profile.aiDeleteKey')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>
        </View>
      ) : null}

      {pane === 'privacy' ? (
        <View>
          <SectionHead title={t('profile.privacy')} desc={t('profile.privacyDescription')} />
          <View className="pt-3">
            <SettingRow
              label={t('profile.analyticsToggle')}
              hint={t('profile.analyticsToggleDescription')}
            >
              <Pressable
                onPress={() => { void handleToggleAnalytics(); }}
                className={['border-2 border-rule px-3 py-2', analyticsOptedOut ? 'bg-transparent' : 'bg-rule'].join(' ')}
                accessibilityRole="switch"
                accessibilityState={{ checked: !analyticsOptedOut }}
              >
                <Text variant="labelInk" className={analyticsOptedOut ? 'text-foreground' : 'text-background'}>
                  {analyticsOptedOut ? t('profile.analyticsOff') : t('profile.analyticsOn')}
                </Text>
              </Pressable>
            </SettingRow>

            {/* Product announcement emails (opt-out) */}
            <SettingRow
              label={t('profile.emailConsentToggle')}
              hint={t('profile.emailConsentDescription')}
            >
              <Pressable
                onPress={() => { void handleToggleEmailConsent(); }}
                disabled={emailConsentSaving}
                className={[
                  'border-2 border-rule px-3 py-2',
                  emailConsent ? 'bg-rule' : 'bg-transparent',
                  emailConsentSaving ? 'opacity-45' : '',
                ].join(' ')}
                accessibilityRole="switch"
                accessibilityState={{ checked: emailConsent }}
              >
                <Text variant="labelInk" className={emailConsent ? 'text-background' : 'text-foreground'}>
                  {emailConsent ? t('profile.emailConsentOn') : t('profile.emailConsentOff')}
                </Text>
              </Pressable>
            </SettingRow>
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <View className="flex-1 bg-background">
      <View className={'border-b-2 border-rule py-6 ' + pad}>
        <Text variant="kicker">{t('profile.kicker')}</Text>
        <Text variant={isDesktop ? 'h1' : 'h2'} className="mt-2">
          {t('dashboard.profile')}
        </Text>
      </View>

      {isDesktop ? (
        <View className="flex-1 flex-row">
          <View className="border-r-2 border-rule" style={{ width: 200, flexGrow: 0, flexShrink: 0 }}>
            {paneNav}
          </View>
          <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
            {body}
          </ScrollView>
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
          <View className="border-b border-border px-4 py-3">{paneNav}</View>
          {body}
        </ScrollView>
      )}
    </View>
  );
}
