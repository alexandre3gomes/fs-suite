import { Button, Logo, Text } from '@fs-suite/ui';
import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { setLanguage, type SupportedLocale } from '../../../src/i18n';
import { setFeatureContext, trackAction, trackFailure, trackSuccess, categorizeError } from '../../../src/services/analytics';
import { apiClient } from '../../../src/services/api.client';
import { signInWithDev, signInWithGoogle } from '../../../src/services/auth.service';
import { useAuthStore } from '../../../src/stores/auth.store';

const LANGUAGES: { code: SupportedLocale; flag: string }[] = [
  { code: 'pt-BR', flag: '\u{1F1E7}\u{1F1F7}' },
  { code: 'en', flag: '\u{1F1FA}\u{1F1F8}' },
];

const FEATURES = [
  { key: 'Vfr', icon: '🗺', color: '#2563eb' },
  { key: 'Rea', icon: '🛫', color: '#dc2626' },
  { key: 'Fuel', icon: '⛽', color: '#d97706' },
  { key: 'Weight', icon: '⚖️', color: '#7c3aed' },
  { key: 'Simbrief', icon: '📋', color: '#0284c7' },
  { key: 'Charts', icon: '📄', color: '#16a34a' },
] as const;

const WX_ITEMS = [
  { key: 'Metar', icon: '📡' },
  { key: 'Taf', icon: '📅' },
  { key: 'Category', icon: '🎯' },
  { key: 'Sigmet', icon: '⚡' },
  { key: 'Precip', icon: '🌧' },
  { key: 'Satellite', icon: '🛰' },
  { key: 'Crosswind', icon: '💨' },
] as const;

const AI_CHECKS = [
  { key: 'Route', icon: '🧭' },
  { key: 'Weather', icon: '🌦' },
  { key: 'Fuel', icon: '⛽' },
  { key: 'Airspace', icon: '🗺' },
  { key: 'Regulations', icon: '📋' },
  { key: 'Risk', icon: '⚠️' },
] as const;

const REA_STEPS = [
  { key: '1' },
  { key: '2' },
  { key: '3' },
] as const;

const EXPORT_ITEMS = [
  { key: 'Plan', icon: '📝' },
  { key: 'Ai', icon: '🤖' },
  { key: 'Checklist', icon: '✅' },
  { key: 'Charts', icon: '🗺' },
  { key: 'Map', icon: '📍' },
  { key: 'Viability', icon: '🛡' },
] as const;

const METHODS = [
  { key: 'Semi', icon: '🧭' },
  { key: 'Fuel', icon: '🛢' },
  { key: 'Rea', icon: '✈️' },
] as const;

function LoginButtons({
  providers,
  loading,
  onGoogle,
  onDev,
  t,
}: {
  providers: string[];
  loading: 'google' | 'dev' | null;
  onGoogle: () => void;
  onDev: () => void;
  t: (k: string) => string;
}): JSX.Element {
  return (
    <View className="w-full max-w-sm gap-3">
      <Button
        variant="outline"
        size="lg"
        className="w-full gap-3 border-border bg-white shadow-sm"
        onPress={onGoogle}
        disabled={loading !== null}
      >
        {loading === 'google' ? (
          <ActivityIndicator size="small" color="#2563eb" />
        ) : (
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#4285F4' }}>G</Text>
        )}
        <Text className="text-sm font-medium text-foreground">{t('login.signInButton')}</Text>
      </Button>
      {providers.includes('dev') ? (
        <Button
          variant="outline"
          size="lg"
          className="w-full gap-3 border-dashed border-yellow-500/50 bg-yellow-50/10 shadow-sm"
          onPress={onDev}
          disabled={loading !== null}
        >
          {loading === 'dev' ? (
            <ActivityIndicator size="small" color="#eab308" />
          ) : (
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#eab308' }}>D</Text>
          )}
          <Text className="text-sm font-medium text-foreground">{t('login.signInDev')}</Text>
        </Button>
      ) : null}
    </View>
  );
}

export default function LoginScreen(): JSX.Element {
  const { t, i18n } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [loading, setLoading] = useState<'google' | 'dev' | null>(null);
  const [providers, setProviders] = useState<string[]>(['google']);
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const ctaRef = useRef<View>(null);
  const videoRef = useRef<View>(null);
  const isWide = width >= 768;

  // Inject the YouTube iframe once after mount (web only — RN doesn't render iframes).
  useEffect(() => {
    if (Platform.OS !== 'web' || !videoRef.current) return;
    const node = videoRef.current as unknown as { innerHTML: string; querySelector?: (s: string) => unknown };
    if (node.querySelector?.('iframe')) return; // already injected
    node.innerHTML = '<iframe src="https://www.youtube.com/embed/2v3pQ1lLpVM?rel=0" title="FS Suite walkthrough" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen style="width:100%;height:100%;border:0;display:block"></iframe>';
  }, []);

  useEffect(() => { setFeatureContext('auth'); return () => setFeatureContext(null); }, []);

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout>;
    const fetchProviders = (): void => {
      apiClient
        .get<{ providers: string[] }>('/auth/providers')
        .then((res) => {
          setProviders(res.providers);
          trackAction('auth_providers_loaded', { provider_count: res.providers.length });
        })
        .catch(() => { retryTimer = setTimeout(fetchProviders, 3000); });
    };
    fetchProviders();
    return () => clearTimeout(retryTimer);
  }, []);

  if (isAuthenticated) {
    return <Redirect href="/(auth)/dashboard" />;
  }

  const handleGoogleSignIn = async (): Promise<void> => {
    setLoading('google');
    trackAction('auth_sign_in_started', { provider: 'google' });
    try {
      await signInWithGoogle();
      trackSuccess('auth_sign_in_completed', { provider: 'google' });
    } catch (err) {
      const { errorType, statusCode } = categorizeError(err);
      trackFailure('auth_sign_in_failed', errorType, { provider: 'google', status_code: statusCode });
    } finally {
      setLoading(null);
    }
  };
  const handleDevSignIn = async (): Promise<void> => {
    setLoading('dev');
    trackAction('auth_sign_in_started', { provider: 'dev' });
    try {
      await signInWithDev();
      trackSuccess('auth_sign_in_completed', { provider: 'dev' });
    } catch (err) {
      const { errorType, statusCode } = categorizeError(err);
      trackFailure('auth_sign_in_failed', errorType, { provider: 'dev', status_code: statusCode });
    } finally {
      setLoading(null);
    }
  };

  const scrollToCta = (): void => {
    if (Platform.OS === 'web' && ctaRef.current) {
      const el = ctaRef.current as unknown as Record<string, unknown>;
      if (typeof el.scrollIntoView === 'function') {
        (el.scrollIntoView as (opts: Record<string, string>) => void)({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  return (
    <ScrollView ref={scrollRef} className="flex-1 bg-background" showsVerticalScrollIndicator={false}>
      {/* ===== HERO SECTION ===== */}
      <View
        style={{
          minHeight: 600,
          backgroundColor: '#0c1222',
          ...(Platform.OS === 'web' ? {
            backgroundImage: 'linear-gradient(135deg, #0c1222 0%, #162036 50%, #1a2744 100%)',
          } as never : {}),
        }}
      >
        {/* Subtle grid pattern overlay */}
        <View
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.03,
            ...(Platform.OS === 'web' ? {
              backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            } as never : {}),
          }}
          pointerEvents="none"
        />

        {/* Language switcher */}
        <View
          style={{
            position: 'absolute', top: 16, right: 16, zIndex: 10,
            flexDirection: 'row', gap: 8, alignItems: 'center',
            backgroundColor: 'rgba(255,255,255,0.08)',
            borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6,
          }}
        >
          {LANGUAGES.map((lang) => {
            const isActive = i18n.language === lang.code;
            return (
              <Pressable
                key={lang.code}
                onPress={() => { void setLanguage(lang.code); }}
                disabled={isActive}
                style={{ opacity: isActive ? 0.4 : 1 }}
              >
                <Text style={{ fontSize: 18 }}>{lang.flag}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Radial glow behind logo */}
        <View
          style={{
            position: 'absolute', top: '15%', left: '50%', width: 500, height: 500,
            marginLeft: -250, borderRadius: 250, opacity: 0.08,
            backgroundColor: '#2563eb',
            ...(Platform.OS === 'web' ? { filter: 'blur(100px)' } as never : {}),
          }}
          pointerEvents="none"
        />

        <View className="flex-1 items-center justify-center px-6 py-20">
          {/* Logo */}
          <Logo height={isWide ? 300 : 200} />

          {/* Tagline */}
          <Text
            style={{
              fontSize: isWide ? 22 : 17,
              fontWeight: '500',
              color: '#94a3b8',
              textAlign: 'center',
              marginTop: 24,
              maxWidth: 560,
              lineHeight: isWide ? 32 : 26,
            }}
          >
            {t('home.heroTagline')}
          </Text>

          {/* Description */}
          <Text
            style={{
              fontSize: isWide ? 16 : 14,
              color: '#64748b',
              textAlign: 'center',
              marginTop: 20,
              maxWidth: 620,
              lineHeight: isWide ? 26 : 22,
            }}
          >
            {t('home.heroDescription')}
          </Text>

          {/* CTA */}
          <View style={{ marginTop: 36 }}>
            <Button
              size="lg"
              className="rounded-full px-8 shadow-lg"
              style={{ backgroundColor: '#2563eb' }}
              onPress={scrollToCta}
            >
              <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}>
                {t('home.cta')}
              </Text>
            </Button>
          </View>

          {/* Decorative bottom fade */}
          <View
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: 1,
              backgroundColor: '#2563eb22',
            }}
            pointerEvents="none"
          />
        </View>
      </View>

      {/* ===== PRODUCT VIDEO ===== */}
      <View className="bg-background px-6 py-16 md:py-20">
        <View className="mx-auto w-full" style={{ maxWidth: 960 }}>
          <Text
            style={{
              fontSize: isWide ? 32 : 24,
              fontWeight: '700',
              color: '#1a1d26',
              textAlign: 'center',
              letterSpacing: -0.5,
            }}
          >
            {t('home.videoTitle')}
          </Text>
          <View
            style={{
              alignSelf: 'center',
              width: 60,
              height: 3,
              backgroundColor: '#2563eb',
              borderRadius: 2,
              marginTop: 16,
            }}
          />
          <Text
            style={{
              fontSize: isWide ? 16 : 14,
              color: '#64748b',
              textAlign: 'center',
              marginTop: 16,
            }}
          >
            {t('home.videoSubtitle')}
          </Text>
          <View
            ref={videoRef}
            style={{
              marginTop: 32,
              aspectRatio: 16 / 9,
              borderRadius: 12,
              overflow: 'hidden',
              backgroundColor: '#000',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.15,
              shadowRadius: 30,
              elevation: 8,
            }}
          />
        </View>
      </View>

      {/* ===== FEATURES SECTION ===== */}
      <View className="bg-background px-6 py-16 md:py-24">
        <View className="mx-auto w-full" style={{ maxWidth: 1000 }}>
          <Text
            style={{
              fontSize: isWide ? 32 : 24,
              fontWeight: '700',
              color: '#1a1d26',
              textAlign: 'center',
              letterSpacing: -0.5,
            }}
          >
            {t('home.featuresTitle')}
          </Text>

          {/* Accent line */}
          <View style={{ alignSelf: 'center', width: 60, height: 3, backgroundColor: '#2563eb', borderRadius: 2, marginTop: 16 }} />

          {/* Feature cards grid */}
          <View
            style={{
              marginTop: 48,
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: isWide ? 20 : 16,
              justifyContent: 'center',
            }}
          >
            {FEATURES.map((feat) => (
              <View
                key={feat.key}
                style={{
                  width: isWide ? '30%' : '100%',
                  minWidth: isWide ? 280 : undefined,
                  maxWidth: isWide ? 340 : undefined,
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  padding: isWide ? 28 : 20,
                  borderLeftWidth: 4,
                  borderLeftColor: feat.color,
                  ...(Platform.OS === 'web' ? {
                    boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
                  } as never : { elevation: 2 }),
                }}
              >
                <View className="flex-row items-center gap-3">
                  <Text style={{ fontSize: 24 }}>{feat.icon}</Text>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#1a1d26' }}>
                    {t(`home.feat${feat.key}`)}
                  </Text>
                </View>
                <Text style={{ fontSize: 13, color: '#6b7280', lineHeight: 20, marginTop: 10 }}>
                  {t(`home.feat${feat.key}Desc`)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* ===== WEATHER SECTION ===== */}
      <View
        style={{
          paddingHorizontal: 24,
          paddingVertical: isWide ? 96 : 64,
          backgroundColor: '#0c1222',
          ...(Platform.OS === 'web' ? {
            backgroundImage: 'linear-gradient(135deg, #0c1222 0%, #0f1d30 50%, #0c1222 100%)',
          } as never : {}),
        }}
      >
        {/* Glow accent */}
        <View
          style={{
            position: 'absolute', top: '30%', left: '50%', width: 400, height: 400,
            marginLeft: -200, borderRadius: 200, opacity: 0.06,
            backgroundColor: '#0ea5e9',
            ...(Platform.OS === 'web' ? { filter: 'blur(80px)' } as never : {}),
          }}
          pointerEvents="none"
        />

        <View className="mx-auto w-full" style={{ maxWidth: 1000 }}>
          {/* Badge */}
          <View style={{ alignSelf: 'center', backgroundColor: '#0ea5e920', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, marginBottom: 20 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#38bdf8', letterSpacing: 1 }}>
              {t('home.wxBadge')}
            </Text>
          </View>

          <Text
            style={{
              fontSize: isWide ? 32 : 24,
              fontWeight: '700',
              color: '#ffffff',
              textAlign: 'center',
              letterSpacing: -0.5,
            }}
          >
            {t('home.wxTitle')}
          </Text>
          <View style={{ alignSelf: 'center', width: 60, height: 3, backgroundColor: '#0ea5e9', borderRadius: 2, marginTop: 16 }} />

          <Text
            style={{
              fontSize: isWide ? 16 : 14,
              color: '#94a3b8',
              textAlign: 'center',
              lineHeight: isWide ? 26 : 22,
              marginTop: 24,
              maxWidth: 680,
              alignSelf: 'center',
            }}
          >
            {t('home.wxDescription')}
          </Text>

          {/* Weather items grid */}
          <View
            style={{
              marginTop: 48,
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: isWide ? 16 : 12,
              justifyContent: 'center',
            }}
          >
            {WX_ITEMS.map((item) => (
              <View
                key={item.key}
                style={{
                  width: isWide ? '30%' : '46%',
                  minWidth: isWide ? 180 : 140,
                  maxWidth: isWide ? 300 : undefined,
                  backgroundColor: '#ffffff08',
                  borderRadius: 12,
                  padding: isWide ? 20 : 16,
                  borderWidth: 1,
                  borderColor: '#ffffff10',
                }}
              >
                <Text style={{ fontSize: 24, marginBottom: 8 }}>{item.icon}</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#e2e8f0' }}>
                  {t(`home.wx${item.key}`)}
                </Text>
                <Text style={{ fontSize: 12, color: '#64748b', lineHeight: 18, marginTop: 6 }}>
                  {t(`home.wx${item.key}Desc`)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* ===== REA NAVIGATION ENGINE SECTION ===== */}
      <View
        style={{
          paddingHorizontal: 24,
          paddingVertical: isWide ? 96 : 64,
          backgroundColor: '#0c1222',
          ...(Platform.OS === 'web' ? {
            backgroundImage: 'linear-gradient(135deg, #0c1222 0%, #2a1215 50%, #0c1222 100%)',
          } as never : {}),
        }}
      >
        {/* Glow accent */}
        <View
          style={{
            position: 'absolute', top: '30%', left: '50%', width: 400, height: 400,
            marginLeft: -200, borderRadius: 200, opacity: 0.06,
            backgroundColor: '#dc2626',
            ...(Platform.OS === 'web' ? { filter: 'blur(80px)' } as never : {}),
          }}
          pointerEvents="none"
        />

        <View className="mx-auto w-full" style={{ maxWidth: 1000 }}>
          {/* Badge */}
          <View style={{ alignSelf: 'center', backgroundColor: '#dc262620', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, marginBottom: 20 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#f87171', letterSpacing: 1 }}>
              {t('home.reaBadge')}
            </Text>
          </View>

          <Text
            style={{
              fontSize: isWide ? 32 : 24,
              fontWeight: '700',
              color: '#ffffff',
              textAlign: 'center',
              letterSpacing: -0.5,
            }}
          >
            {t('home.reaTitle')}
          </Text>
          <View style={{ alignSelf: 'center', width: 60, height: 3, backgroundColor: '#dc2626', borderRadius: 2, marginTop: 16 }} />

          <Text
            style={{
              fontSize: isWide ? 16 : 14,
              color: '#94a3b8',
              textAlign: 'center',
              lineHeight: isWide ? 26 : 22,
              marginTop: 24,
              maxWidth: 680,
              alignSelf: 'center',
            }}
          >
            {t('home.reaDescription')}
          </Text>

          {/* How it works */}
          <View
            style={{
              marginTop: 48,
              backgroundColor: '#ffffff06',
              borderRadius: 16,
              padding: isWide ? 32 : 20,
              borderWidth: 1,
              borderColor: '#ffffff08',
            }}
          >
            <Text style={{ fontSize: isWide ? 18 : 16, fontWeight: '700', color: '#e2e8f0', textAlign: 'center', marginBottom: 24 }}>
              {t('home.aiHowTitle')}
            </Text>
            <View style={{ flexDirection: isWide ? 'row' : 'column', gap: isWide ? 32 : 20, justifyContent: 'center' }}>
              {REA_STEPS.map((step) => (
                <View key={step.key} style={{ flex: isWide ? 1 : undefined, alignItems: 'center' }}>
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#dc262620', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#f87171' }}>{step.key}</Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#e2e8f0', textAlign: 'center' }}>
                    {t(`home.reaStep${step.key}Title`)}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#64748b', textAlign: 'center', lineHeight: 18, marginTop: 6 }}>
                    {t(`home.reaStep${step.key}Desc`)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>

      {/* ===== AI INSTRUCTOR SECTION ===== */}
      <View
        style={{
          paddingHorizontal: 24,
          paddingVertical: isWide ? 96 : 64,
          backgroundColor: '#0c1222',
          ...(Platform.OS === 'web' ? {
            backgroundImage: 'linear-gradient(135deg, #0c1222 0%, #1a1040 50%, #0c1222 100%)',
          } as never : {}),
        }}
      >
        {/* Glow accent */}
        <View
          style={{
            position: 'absolute', top: '30%', left: '50%', width: 400, height: 400,
            marginLeft: -200, borderRadius: 200, opacity: 0.06,
            backgroundColor: '#8b5cf6',
            ...(Platform.OS === 'web' ? { filter: 'blur(80px)' } as never : {}),
          }}
          pointerEvents="none"
        />

        <View className="mx-auto w-full" style={{ maxWidth: 1000 }}>
          {/* Badge */}
          <View style={{ alignSelf: 'center', backgroundColor: '#8b5cf620', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, marginBottom: 20 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#a78bfa', letterSpacing: 1 }}>
              {t('home.aiBadge')}
            </Text>
          </View>

          <Text
            style={{
              fontSize: isWide ? 32 : 24,
              fontWeight: '700',
              color: '#ffffff',
              textAlign: 'center',
              letterSpacing: -0.5,
            }}
          >
            {t('home.aiTitle')}
          </Text>
          <View style={{ alignSelf: 'center', width: 60, height: 3, backgroundColor: '#8b5cf6', borderRadius: 2, marginTop: 16 }} />

          <Text
            style={{
              fontSize: isWide ? 16 : 14,
              color: '#94a3b8',
              textAlign: 'center',
              lineHeight: isWide ? 26 : 22,
              marginTop: 24,
              maxWidth: 680,
              alignSelf: 'center',
            }}
          >
            {t('home.aiDescription')}
          </Text>

          {/* AI checks grid */}
          <View
            style={{
              marginTop: 48,
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: isWide ? 16 : 12,
              justifyContent: 'center',
            }}
          >
            {AI_CHECKS.map((check) => (
              <View
                key={check.key}
                style={{
                  width: isWide ? '30%' : '46%',
                  minWidth: isWide ? 180 : 140,
                  maxWidth: isWide ? 300 : undefined,
                  backgroundColor: '#ffffff08',
                  borderRadius: 12,
                  padding: isWide ? 20 : 16,
                  borderWidth: 1,
                  borderColor: '#ffffff10',
                }}
              >
                <Text style={{ fontSize: 24, marginBottom: 8 }}>{check.icon}</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#e2e8f0' }}>
                  {t(`home.aiCheck${check.key}`)}
                </Text>
                <Text style={{ fontSize: 12, color: '#64748b', lineHeight: 18, marginTop: 6 }}>
                  {t(`home.aiCheck${check.key}Desc`)}
                </Text>
              </View>
            ))}
          </View>

          {/* How it works */}
          <View
            style={{
              marginTop: 48,
              backgroundColor: '#ffffff06',
              borderRadius: 16,
              padding: isWide ? 32 : 20,
              borderWidth: 1,
              borderColor: '#ffffff08',
            }}
          >
            <Text style={{ fontSize: isWide ? 18 : 16, fontWeight: '700', color: '#e2e8f0', textAlign: 'center', marginBottom: 24 }}>
              {t('home.aiHowTitle')}
            </Text>
            <View style={{ flexDirection: isWide ? 'row' : 'column', gap: isWide ? 32 : 20, justifyContent: 'center' }}>
              {(['1', '2', '3'] as const).map((step) => (
                <View key={step} style={{ flex: isWide ? 1 : undefined, alignItems: 'center' }}>
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#8b5cf620', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#a78bfa' }}>{step}</Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#e2e8f0', textAlign: 'center' }}>
                    {t(`home.aiStep${step}Title`)}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#64748b', textAlign: 'center', lineHeight: 18, marginTop: 6 }}>
                    {t(`home.aiStep${step}Desc`)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>

      {/* ===== ALL-IN-ONE EXPORT SECTION ===== */}
      <View className="bg-background px-6 py-16 md:py-24">
        <View className="mx-auto w-full" style={{ maxWidth: 1000 }}>
          <View style={{ alignSelf: 'center', backgroundColor: '#16a34a18', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, marginBottom: 20 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#16a34a', letterSpacing: 1 }}>
              {t('home.exportBadge')}
            </Text>
          </View>

          <Text
            style={{
              fontSize: isWide ? 32 : 24,
              fontWeight: '700',
              color: '#1a1d26',
              textAlign: 'center',
              letterSpacing: -0.5,
            }}
          >
            {t('home.exportTitle')}
          </Text>
          <View style={{ alignSelf: 'center', width: 60, height: 3, backgroundColor: '#16a34a', borderRadius: 2, marginTop: 16 }} />

          <Text
            style={{
              fontSize: isWide ? 16 : 14,
              color: '#6b7280',
              textAlign: 'center',
              lineHeight: isWide ? 26 : 22,
              marginTop: 24,
              maxWidth: 680,
              alignSelf: 'center',
            }}
          >
            {t('home.exportDescription')}
          </Text>

          {/* Export items grid */}
          <View
            style={{
              marginTop: 48,
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: isWide ? 16 : 12,
              justifyContent: 'center',
            }}
          >
            {EXPORT_ITEMS.map((item) => (
              <View
                key={item.key}
                style={{
                  width: isWide ? '30%' : '46%',
                  minWidth: isWide ? 180 : 140,
                  maxWidth: isWide ? 300 : undefined,
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  padding: isWide ? 20 : 16,
                  borderLeftWidth: 3,
                  borderLeftColor: '#16a34a',
                  ...(Platform.OS === 'web' ? {
                    boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
                  } as never : { elevation: 2 }),
                }}
              >
                <View className="flex-row items-center gap-2 mb-1.5">
                  <Text style={{ fontSize: 20 }}>{item.icon}</Text>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#1a1d26' }}>
                    {t(`home.exportItem${item.key}`)}
                  </Text>
                </View>
                <Text style={{ fontSize: 12, color: '#6b7280', lineHeight: 18 }}>
                  {t(`home.exportItem${item.key}Desc`)}
                </Text>
              </View>
            ))}
          </View>

          {/* Single PDF callout */}
          <View
            style={{
              marginTop: 32,
              backgroundColor: '#16a34a08',
              borderRadius: 12,
              padding: isWide ? 24 : 16,
              borderWidth: 1,
              borderColor: '#16a34a20',
              flexDirection: isWide ? 'row' : 'column',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <Text style={{ fontSize: 40 }}>📄</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: isWide ? 16 : 15, fontWeight: '700', color: '#1a1d26' }}>
                {t('home.exportSinglePdf')}
              </Text>
              <Text style={{ fontSize: 13, color: '#6b7280', lineHeight: 20, marginTop: 6 }}>
                {t('home.exportSinglePdfDesc')}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* ===== ICAO METHODOLOGY SECTION ===== */}
      <View
        style={{
          paddingHorizontal: 24,
          paddingVertical: isWide ? 96 : 64,
          backgroundColor: '#f0f4f8',
          ...(Platform.OS === 'web' ? {
            backgroundImage: 'linear-gradient(180deg, #f0f4f8 0%, #e8ecf2 100%)',
          } as never : {}),
        }}
      >
        <View className="mx-auto w-full" style={{ maxWidth: 1000 }}>
          <Text
            style={{
              fontSize: isWide ? 32 : 24,
              fontWeight: '700',
              color: '#1a1d26',
              textAlign: 'center',
              letterSpacing: -0.5,
            }}
          >
            {t('home.methodTitle')}
          </Text>
          <View style={{ alignSelf: 'center', width: 60, height: 3, backgroundColor: '#2563eb', borderRadius: 2, marginTop: 16 }} />

          <View style={{ marginTop: 48, gap: isWide ? 24 : 20 }}>
            {METHODS.map((m) => (
              <View
                key={m.key}
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  padding: isWide ? 32 : 20,
                  ...(Platform.OS === 'web' ? {
                    boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
                  } as never : { elevation: 2 }),
                }}
              >
                <View className="flex-row items-center gap-3">
                  <View
                    style={{
                      width: 40, height: 40, borderRadius: 10,
                      backgroundColor: '#2563eb12',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 20 }}>{m.icon}</Text>
                  </View>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#1a1d26' }}>
                    {t(`home.method${m.key}Title`)}
                  </Text>
                </View>
                <Text style={{ fontSize: 14, color: '#4b5563', lineHeight: 24, marginTop: 14 }}>
                  {t(`home.method${m.key}Desc`)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* ===== LOGIN CTA SECTION ===== */}
      <View
        style={{
          backgroundColor: '#0c1222',
          ...(Platform.OS === 'web' ? {
            backgroundImage: 'linear-gradient(135deg, #0c1222 0%, #162036 50%, #1a2744 100%)',
          } as never : {}),
        }}
      >
        <View
          ref={ctaRef}
          className="items-center px-6 py-16 md:py-24"
        >
          <Text
            style={{
              fontSize: isWide ? 32 : 24,
              fontWeight: '700',
              color: '#ffffff',
              textAlign: 'center',
              letterSpacing: -0.5,
            }}
          >
            {t('home.readyTitle')}
          </Text>
          <Text
            style={{
              fontSize: 15,
              color: '#94a3b8',
              textAlign: 'center',
              marginTop: 12,
              maxWidth: 480,
              lineHeight: 24,
            }}
          >
            {t('home.readyDesc')}
          </Text>

          <View className="mt-10 items-center">
            <LoginButtons
              providers={providers}
              loading={loading}
              onGoogle={() => { void handleGoogleSignIn(); }}
              onDev={() => { void handleDevSignIn(); }}
              t={t}
            />
          </View>

          <Text
            style={{
              fontSize: 11,
              color: '#475569',
              textAlign: 'center',
              marginTop: 32,
              maxWidth: 320,
              lineHeight: 18,
            }}
          >
            {t('login.terms')}
          </Text>
        </View>
      </View>

      {/* Footer */}
      <View style={{ backgroundColor: '#080d18', paddingVertical: 24, paddingHorizontal: 24, alignItems: 'center', gap: 12 }}>
        <Pressable
          onPress={() => { void Linking.openURL('https://github.com/alexandre3gomes/fs-suite'); }}
          accessibilityRole="link"
          accessibilityLabel="View FS Suite source on GitHub"
        >
          <Image
            source={{ uri: 'https://img.shields.io/github/stars/alexandre3gomes/fs-suite?style=social' }}
            style={{ width: 140, height: 20 }}
            resizeMode="contain"
          />
        </Pressable>
        <Text style={{ fontSize: 12, color: '#475569' }}>
          FS Suite © {new Date().getFullYear()}
        </Text>
      </View>
    </ScrollView>
  );
}
