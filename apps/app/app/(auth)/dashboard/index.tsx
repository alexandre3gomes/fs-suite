import { Avatar, Card, CardContent, Logo, Separator, Spinner, Text } from '@fs-suite/ui';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, View } from 'react-native';

import { setLanguage, type SupportedLocale } from '../../../src/i18n';
import { useCurrentUser } from '../../../src/hooks/useCurrentUser';
import { signOut } from '../../../src/services/auth.service';

const LANGUAGES: { code: SupportedLocale; flag: string }[] = [
  { code: 'pt-BR', flag: '\u{1F1E7}\u{1F1F7}' },
  { code: 'en', flag: '\u{1F1FA}\u{1F1F8}' },
];

export default function DashboardScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { user, isLoading } = useCurrentUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const avatarRef = useRef<View>(null);

  const openMenu = useCallback(() => {
    avatarRef.current?.measureInWindow((x, y, width, height) => {
      setMenuPosition({ top: y + height + 8, right: 16 });
      setMenuOpen(true);
    });
  }, []);

  const handleSignOut = useCallback(async () => {
    setMenuOpen(false);
    try {
      await signOut();
    } catch { /* handled by auth service */ }
  }, []);

  if (isLoading && !user) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner size="lg" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <View className="flex-row items-center justify-between border-b border-border px-4 py-3 md:px-8">
        <View className="flex-row items-center gap-3">
          <Logo height={32} />
          {/* Language flags */}
          <View className="flex-row items-center gap-1">
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
        </View>
        <View className="flex-row items-center gap-3">
          {user?.name ? (
            <Text className="text-sm text-muted-foreground">{user.name}</Text>
          ) : null}
          <Pressable onPress={openMenu}>
            <View ref={avatarRef} collapsable={false}>
              <Avatar uri={user?.avatarUrl} name={user?.name} size={36} />
            </View>
          </Pressable>
        </View>
      </View>

      {/* Avatar dropdown menu */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable className="flex-1" onPress={() => setMenuOpen(false)}>
          <View
            style={{ position: 'absolute', top: menuPosition.top, right: menuPosition.right }}
            className="min-w-[180px] overflow-hidden rounded-card border border-border bg-card shadow-lg"
          >
            <Pressable
              className={`px-4 py-3 ${Platform.OS === 'web' ? 'cursor-pointer transition-colors hover:bg-secondary' : 'active:bg-secondary'}`}
              onPress={() => { setMenuOpen(false); router.push('/(auth)/profile' as never); }}
            >
              <Text className="text-sm font-medium text-foreground">{t('dashboard.profile')}</Text>
            </Pressable>

            <Separator />

            <Pressable
              className={`px-4 py-3 ${Platform.OS === 'web' ? 'cursor-pointer transition-colors hover:bg-secondary' : 'active:bg-secondary'}`}
              onPress={() => { void handleSignOut(); }}
            >
              <Text className="text-sm text-destructive">{t('dashboard.signOut')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Content — centered container on desktop */}
      <View className="flex-1 px-4 py-6 md:mx-auto md:w-full md:max-w-3xl md:px-8 md:py-10">
        <Text variant="h3" className="mb-6">
          {t('dashboard.welcome')}
        </Text>

        {/* Modules */}
        <Card className="active:opacity-80">
          <Pressable onPress={() => router.push('/(auth)/flight-plans')}>
            <CardContent className="md:px-8 md:py-6">
              <Text className="text-base font-bold md:text-lg">
                {t('dashboard.flightPlanning')}
              </Text>
              <Text variant="muted" className="mt-1">
                {t('dashboard.flightPlanningDesc')}
              </Text>
            </CardContent>
          </Pressable>
        </Card>
      </View>
    </View>
  );
}
