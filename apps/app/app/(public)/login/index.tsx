import { Button, Logo, Text } from '@fs-suite/ui';
import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, ScrollView, useWindowDimensions, View } from 'react-native';

import { apiClient } from '../../../src/services/api.client';
import { signInWithDev, signInWithGoogle, signInWithVatsim } from '../../../src/services/auth.service';
import { useAuthStore } from '../../../src/stores/auth.store';

const FEATURES = [
  { key: 'Vfr', icon: '🗺', color: '#2563eb' },
  { key: 'Rea', icon: '🛫', color: '#dc2626' },
  { key: 'Fuel', icon: '⛽', color: '#d97706' },
  { key: 'Weight', icon: '⚖️', color: '#7c3aed' },
  { key: 'Simbrief', icon: '📋', color: '#0284c7' },
  { key: 'Charts', icon: '📄', color: '#16a34a' },
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
  onVatsim,
  onDev,
  t,
}: {
  providers: string[];
  loading: 'google' | 'vatsim' | 'dev' | null;
  onGoogle: () => void;
  onVatsim: () => void;
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
      {providers.includes('vatsim') ? (
        <Button
          variant="outline"
          size="lg"
          className="w-full gap-3 border-border bg-white shadow-sm"
          onPress={onVatsim}
          disabled={loading !== null}
        >
          {loading === 'vatsim' ? (
            <ActivityIndicator size="small" color="#29B473" />
          ) : (
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#29B473' }}>V</Text>
          )}
          <Text className="text-sm font-medium text-foreground">{t('login.signInVatsim')}</Text>
        </Button>
      ) : null}
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
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [loading, setLoading] = useState<'google' | 'vatsim' | 'dev' | null>(null);
  const [providers, setProviders] = useState<string[]>(['google']);
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const ctaRef = useRef<View>(null);
  const isWide = width >= 768;

  useEffect(() => {
    apiClient
      .get<{ providers: string[] }>('/auth/providers')
      .then((res) => setProviders(res.providers))
      .catch(() => {});
  }, []);

  if (isAuthenticated) {
    return <Redirect href="/(auth)/dashboard" />;
  }

  const handleGoogleSignIn = async (): Promise<void> => {
    setLoading('google');
    try { await signInWithGoogle(); } finally { setLoading(null); }
  };
  const handleVatsimSignIn = async (): Promise<void> => {
    setLoading('vatsim');
    try { await signInWithVatsim(); } finally { setLoading(null); }
  };
  const handleDevSignIn = async (): Promise<void> => {
    setLoading('dev');
    try { await signInWithDev(); } finally { setLoading(null); }
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

      {/* ===== SUPPORT SECTION ===== */}
      <View className="bg-background px-6 py-16 md:py-24">
        <View className="mx-auto w-full items-center" style={{ maxWidth: 640 }}>
          <Logo height={isWide ? 120 : 80} />
          <Text
            style={{
              fontSize: isWide ? 28 : 22,
              fontWeight: '700',
              color: '#1a1d26',
              textAlign: 'center',
              marginTop: 20,
            }}
          >
            {t('home.community')}
          </Text>
          <Text
            style={{
              fontSize: 15,
              color: '#6b7280',
              textAlign: 'center',
              lineHeight: 24,
              marginTop: 12,
              maxWidth: 520,
            }}
          >
            {t('home.communityDesc')}
          </Text>
          <View style={{ marginTop: 24 }}>
            <Button
              variant="outline"
              size="lg"
              className="gap-3 border-border bg-white shadow-sm"
              onPress={() => {
                if (Platform.OS === 'web') {
                  window.open('https://ko-fi.com/R5R51MLQM3', '_blank');
                }
              }}
            >
              <Text style={{ fontSize: 20 }}>☕</Text>
              <Text className="text-sm font-medium text-foreground">{t('home.kofi')}</Text>
            </Button>
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
              onVatsim={() => { void handleVatsimSignIn(); }}
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
      <View style={{ backgroundColor: '#080d18', paddingVertical: 24, paddingHorizontal: 24, alignItems: 'center' }}>
        <Text style={{ fontSize: 12, color: '#475569' }}>
          FS Suite © {new Date().getFullYear()}
        </Text>
      </View>
    </ScrollView>
  );
}
