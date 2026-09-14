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

/**
 * Hero proof figures. Values are literals in both locales — 91.151 is an RBAC
 * article number and DECEA an agency name, neither of which translates. Only
 * the labels go through i18n.
 */
const HERO_STATS = [
  { key: 'checks', value: '11', labelKey: 'home.statChecks' },
  { key: 'fuel', value: '91.151', labelKey: 'home.statFuelRule' },
  { key: 'charts', value: 'DECEA', labelKey: 'home.statCharts' },
] as const;

const LANGUAGES: { code: SupportedLocale; label: string }[] = [
  { code: 'pt-BR', label: 'PT' },
  { code: 'en', label: 'EN' },
];

/**
 * The landing content. Emoji and per-item colors were dropped: Modernist
 * numbers its cells and keeps the page ink-on-ground, and a six-color icon
 * set was the loudest thing on a page that is meant to read as an
 * instrument. The i18n keys are unchanged, so all existing copy still lands.
 */
const FEATURES = ['Vfr', 'Rea', 'Fuel', 'Weight', 'Simbrief', 'Charts'] as const;
const WX_ITEMS = ['Metar', 'Taf', 'Category', 'Sigmet', 'Precip', 'Satellite', 'Crosswind'] as const;
const AI_CHECKS = ['Route', 'Weather', 'Fuel', 'Airspace', 'Regulations', 'Risk'] as const;
const REA_STEPS = ['1', '2', '3'] as const;
const AI_STEPS = ['1', '2', '3'] as const;
const EXPORT_ITEMS = ['Plan', 'Ai', 'Checklist', 'Charts', 'Map', 'Viability'] as const;
const METHODS = ['Semi', 'Fuel', 'Rea'] as const;

function twoDigit(i: number): string {
  return String(i + 1).padStart(2, '0');
}

/** A ruled grid of numbered cells. The grid showing is the point. */
function CellGrid({
  items,
  columns,
}: {
  items: { num: string; title: string; desc: string }[];
  columns: number;
}) {
  return (
    <View className="flex-row flex-wrap border-t-2 border-rule">
      {items.map((item) => (
        <View
          key={item.num + item.title}
          className="border-b border-r border-border p-4"
          style={{ flexBasis: `${Math.floor(100 / columns)}%`, flexGrow: 1, minWidth: 200 }}
        >
          <Text variant="kicker">{item.num}</Text>
          <Text variant="h4" className="mt-2">
            {item.title}
          </Text>
          <Text variant="muted" className="mt-2 text-[13px]">
            {item.desc}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Kicker + title + description, flush left, over a 2px rule. */
function SectionIntro({
  badge,
  title,
  description,
  pad,
  isWide,
}: {
  badge?: string;
  title: string;
  description?: string;
  pad: string;
  isWide: boolean;
}) {
  return (
    <View className={'py-8 ' + pad}>
      {badge ? <Text variant="kicker">{badge}</Text> : null}
      <Text variant={isWide ? 'h2' : 'h3'} className={badge ? 'mt-3' : ''} style={{ maxWidth: 640 }}>
        {title}
      </Text>
      {description ? (
        <Text variant="lead" className="mt-3" style={{ maxWidth: 620 }}>
          {description}
        </Text>
      ) : null}
    </View>
  );
}

function LoginButtons({
  providers,
  loading,
  onGoogle,
  onDev,
  onAccent,
  t,
}: {
  providers: string[];
  loading: 'google' | 'dev' | null;
  onGoogle: () => void;
  onDev: () => void;
  /** True when sitting on the accent poster, where the ground is dark. */
  onAccent?: boolean;
  t: (k: string) => string;
}): JSX.Element {
  return (
    <View className="flex-row flex-wrap gap-3">
      <Pressable
        onPress={onGoogle}
        disabled={loading !== null}
        className={[
          'flex-row items-center gap-3 border-2 px-5',
          onAccent ? 'border-primary-foreground bg-primary-foreground' : 'border-rule bg-rule',
          loading !== null ? 'opacity-45' : '',
        ].join(' ')}
        style={{ height: 48 }}
        accessibilityRole="button"
      >
        {loading === 'google' ? (
          <ActivityIndicator size="small" color={onAccent ? '#1a4fd8' : '#f0f2f6'} />
        ) : null}
        <Text
          className={[
            'font-sans text-[15px] font-bold',
            onAccent ? 'text-primary' : 'text-background',
          ].join(' ')}
        >
          {t('login.signInButton')}
        </Text>
      </Pressable>

      {providers.includes('dev') ? (
        <Pressable
          onPress={onDev}
          disabled={loading !== null}
          className={[
            'flex-row items-center gap-3 border-2 px-5',
            onAccent ? 'border-primary-foreground' : 'border-rule',
            loading !== null ? 'opacity-45' : '',
          ].join(' ')}
          style={{ height: 48 }}
          accessibilityRole="button"
        >
          {loading === 'dev' ? (
            <ActivityIndicator size="small" color={onAccent ? '#f0f2f6' : '#16203a'} />
          ) : null}
          <Text
            className={[
              'font-sans text-[15px] font-bold',
              onAccent ? 'text-primary-foreground' : 'text-foreground',
            ].join(' ')}
          >
            {t('login.signInDev')}
          </Text>
        </Pressable>
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

  // Same behaviour as before (scroll the closing CTA into view) via the
  // ScrollView's own ref rather than the DOM, so it works on native too.
  const scrollToCta = (): void => {
    const cta = ctaRef.current;
    const scroller = scrollRef.current;
    if (!cta || !scroller) return;
    cta.measureLayout(
      scroller.getInnerViewNode(),
      (_x: number, y: number) => {
        scroller.scrollTo({ y: Math.max(0, y - 24), animated: true });
      },
      () => undefined,
    );
  };

  const pad = isWide ? 'px-10' : 'px-5';

  return (
    <ScrollView ref={scrollRef} className="flex-1 bg-background" showsVerticalScrollIndicator={false}>
      {/* ===== TOP BAR ===== */}
      <View
        className={'flex-row items-center justify-between border-b-2 border-rule py-4 ' + pad}
      >
        <Logo height={28} />
        <View className="flex-row items-center gap-4">
          <View className="flex-row">
            {LANGUAGES.map((lang) => {
              const isCurrent = i18n.language === lang.code;
              return (
                <Pressable
                  key={lang.code}
                  onPress={() => { void setLanguage(lang.code); }}
                  disabled={isCurrent}
                  className={['border-2 border-rule px-2 py-1', isCurrent ? 'bg-rule' : 'bg-transparent'].join(' ')}
                  style={{ marginLeft: -2 }}
                  accessibilityLabel={lang.label}
                >
                  <Text variant="labelInk" className={isCurrent ? 'text-background' : 'text-foreground'}>
                    {lang.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Button onPress={scrollToCta}>
            <Text>{t('home.cta')}</Text>
          </Button>
        </View>
      </View>

      {/* ===== HERO ===== */}
      {/* Two columns on wide: copy left, walkthrough right. The video moved
          into the hero because it was the page's strongest proof and sat
          below the fold as its own section. On narrow it stacks, copy first. */}
      <View className={'border-b-2 border-rule ' + (isWide ? 'flex-row' : '')}>
        <View
          className={'py-12 ' + pad}
          style={isWide ? { flexBasis: '52%', flexGrow: 0, minWidth: 0 } : undefined}
        >
          <Text variant={isWide ? 'display' : 'h1'} style={{ maxWidth: 900 }}>
            {t('home.heroTagline')}
          </Text>
          <Text variant="lead" className="mt-5" style={{ maxWidth: 620 }}>
            {t('home.heroDescription')}
          </Text>
          <View className="mt-8">
            <LoginButtons
              providers={providers}
              loading={loading}
              onGoogle={() => { void handleGoogleSignIn(); }}
              onDev={() => { void handleDevSignIn(); }}
              t={t}
            />
          </View>
        </View>

        <View
          className={isWide ? 'border-l-2 border-l-rule' : 'border-t-2 border-rule'}
          style={isWide ? { flexBasis: '48%', flexGrow: 1, minWidth: 0 } : undefined}
        >
          {/* The dark ground takes the column's spare height and holds the
              player centred at 16:9, so the cell can match the copy column
              without stretching the video or the stats. */}
          <View
            className="items-start justify-center px-5 py-5"
            style={{
              flex: isWide ? 1 : undefined,
              minHeight: isWide ? 320 : 240,
              backgroundColor: '#0b1020',
            }}
          >
            <Text
              className="font-sans text-[11px] font-bold uppercase"
              style={{ letterSpacing: 1.5, color: '#8f9bb8' }}
            >
              {t('home.videoTitle')}
            </Text>
            <View
              ref={videoRef}
              collapsable={false}
              className="my-4"
              style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#16203a' }}
            />
            <Text
              className="font-sans text-[15px] font-extrabold"
              style={{ letterSpacing: -0.15, color: '#f0f2f6', maxWidth: 320 }}
            >
              {t('home.videoSubtitle')}
            </Text>
          </View>

          {/* Three proof figures. Dividers sit BETWEEN cells only — a border on
              every cell would leave a stray rule inside the column's padding.
              1px at 20% keeps them subordinate to the 2px structural rules. */}
          <View className="flex-row px-5" style={{ borderTopWidth: 1, borderTopColor: '#16203a33' }}>
            {HERO_STATS.map((stat, i) => (
              <View
                key={stat.key}
                className="py-4"
                style={{
                  flex: 1,
                  minWidth: 0,
                  paddingLeft: i === 0 ? 0 : 16,
                  paddingRight: 12,
                  ...(i === 0
                    ? {}
                    : { borderLeftWidth: 1, borderLeftColor: '#16203a33' }),
                }}
              >
                <Text
                  className="font-sans text-[24px] font-extrabold text-foreground"
                  style={{ letterSpacing: -0.24 }}
                  numberOfLines={1}
                >
                  {stat.value}
                </Text>
                <Text variant="label" className="mt-1 text-[10px]" numberOfLines={2}>
                  {t(stat.labelKey)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* ===== FEATURES ===== */}
      <View className="border-b-2 border-rule">
        <SectionIntro title={t('home.featuresTitle')} pad={pad} isWide={isWide} />
        <CellGrid
          columns={isWide ? 3 : 1}
          items={FEATURES.map((key, i) => ({
            num: twoDigit(i),
            title: t('home.feat' + key),
            desc: t('home.feat' + key + 'Desc'),
          }))}
        />
      </View>

      {/* ===== WEATHER ===== */}
      <View className="border-b-2 border-rule">
        <SectionIntro
          badge={t('home.wxBadge')}
          title={t('home.wxTitle')}
          description={t('home.wxDescription')}
          pad={pad}
          isWide={isWide}
        />
        <CellGrid
          columns={isWide ? 4 : 2}
          items={WX_ITEMS.map((key, i) => ({
            num: twoDigit(i),
            title: t('home.wx' + key),
            desc: t('home.wx' + key + 'Desc'),
          }))}
        />
      </View>

      {/* ===== REA ===== */}
      <View className="border-b-2 border-rule">
        <SectionIntro
          badge={t('home.reaBadge')}
          title={t('home.reaTitle')}
          description={t('home.reaDescription')}
          pad={pad}
          isWide={isWide}
        />
        <View className={'pb-8 ' + pad}>
          <Text variant="label">{t('home.aiHowTitle')}</Text>
        </View>
        <CellGrid
          columns={3}
          items={REA_STEPS.map((step, i) => ({
            num: twoDigit(i),
            title: t('home.reaStep' + step + 'Title'),
            desc: t('home.reaStep' + step + 'Desc'),
          }))}
        />
      </View>

      {/* ===== AI VALIDATION ===== */}
      <View className="border-b-2 border-rule">
        <SectionIntro
          badge={t('home.aiBadge')}
          title={t('home.aiTitle')}
          description={t('home.aiDescription')}
          pad={pad}
          isWide={isWide}
        />
        <CellGrid
          columns={isWide ? 3 : 2}
          items={AI_CHECKS.map((key, i) => ({
            num: twoDigit(i),
            title: t('home.aiCheck' + key),
            desc: t('home.aiCheck' + key + 'Desc'),
          }))}
        />
        <View className={'py-8 ' + pad}>
          <Text variant="label">{t('home.aiHowTitle')}</Text>
        </View>
        <CellGrid
          columns={3}
          items={AI_STEPS.map((step, i) => ({
            num: twoDigit(i),
            title: t('home.aiStep' + step + 'Title'),
            desc: t('home.aiStep' + step + 'Desc'),
          }))}
        />
      </View>

      {/* ===== EXPORT ===== */}
      <View className="border-b-2 border-rule">
        <SectionIntro
          badge={t('home.exportBadge')}
          title={t('home.exportTitle')}
          description={t('home.exportDescription')}
          pad={pad}
          isWide={isWide}
        />
        <CellGrid
          columns={isWide ? 3 : 2}
          items={EXPORT_ITEMS.map((key, i) => ({
            num: twoDigit(i),
            title: t('home.exportItem' + key),
            desc: t('home.exportItem' + key + 'Desc'),
          }))}
        />
        <View className={'border-t-2 border-rule py-8 ' + pad}>
          <Text variant="h3" style={{ maxWidth: 560 }}>
            {t('home.exportSinglePdf')}
          </Text>
          <Text variant="muted" className="mt-3" style={{ maxWidth: 560 }}>
            {t('home.exportSinglePdfDesc')}
          </Text>
        </View>
      </View>

      {/* ===== METHODS ===== */}
      <View className="border-b-2 border-rule">
        <SectionIntro title={t('home.methodTitle')} pad={pad} isWide={isWide} />
        <CellGrid
          columns={3}
          items={METHODS.map((key, i) => ({
            num: twoDigit(i),
            title: t('home.method' + key + 'Title'),
            desc: t('home.method' + key + 'Desc'),
          }))}
        />
      </View>

      {/* ===== CLOSE — the one place the accent runs as a field ===== */}
      <View ref={ctaRef} collapsable={false} className={'bg-primary py-14 ' + pad}>
        <Text
          className="font-sans text-[11px] font-bold uppercase text-primary-foreground"
          style={{ letterSpacing: 1.8 }}
        >
          AGPL-3.0 · FS-SUITE.COM
        </Text>
        <Text
          className={[
            'mt-4 font-sans font-extrabold text-primary-foreground',
            isWide ? 'text-[48px] leading-[0.98]' : 'text-[32px] leading-[1.04]',
          ].join(' ')}
          style={{ letterSpacing: -1, maxWidth: 760 }}
        >
          {t('home.readyTitle')}
        </Text>
        <Text
          className="mt-5 font-sans text-[17px] leading-[1.5] text-primary-foreground"
          style={{ maxWidth: 560, opacity: 0.9 }}
        >
          {t('home.readyDesc')}
        </Text>
        <View className="mt-8">
          <LoginButtons
            providers={providers}
            loading={loading}
            onGoogle={() => { void handleGoogleSignIn(); }}
            onDev={() => { void handleDevSignIn(); }}
            onAccent
            t={t}
          />
        </View>
        <Text
          className="mt-6 font-sans text-[12px] leading-[1.5] text-primary-foreground"
          style={{ maxWidth: 460, opacity: 0.8 }}
        >
          {t('login.terms')}
        </Text>
      </View>

      {/* ===== FOOTER ===== */}
      <View className={'flex-row items-center justify-between border-t-2 border-rule py-6 ' + pad}>
        <Text variant="label">AGPL-3.0</Text>
        <Pressable
          onPress={() => { void Linking.openURL('https://github.com/alexandre3gomes/fs-suite'); }}
          accessibilityRole="link"
          accessibilityLabel="View FS Suite source on GitHub"
        >
          <Image
            source={{ uri: 'https://img.shields.io/github/stars/alexandre3gomes/fs-suite?style=social' }}
            style={{ width: 96, height: 20 }}
            resizeMode="contain"
          />
        </Pressable>
      </View>
    </ScrollView>
  );
}
