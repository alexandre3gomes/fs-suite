import { Avatar, Logo, Separator } from '@fs-suite/ui';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, Text, View } from 'react-native';

import { useCurrentUser } from '../hooks/useCurrentUser';
import { setLanguage, type SupportedLocale } from '../i18n';
import { signOut } from '../services/auth.service';

const LANGUAGES: { code: SupportedLocale; flag: string }[] = [
  { code: 'pt-BR', flag: '\u{1F1E7}\u{1F1F7}' },
  { code: 'en', flag: '\u{1F1FA}\u{1F1F8}' },
];

const BACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="#374151" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;

function BackIcon({ size = 20 }: { size?: number }) {
  const ref = useRef<View>(null);
  if (Platform.OS === 'web') {
    return (
      <View
        ref={(r) => {
          (ref as { current: View | null }).current = r;
          if (r) (r as unknown as { innerHTML: string }).innerHTML = BACK_SVG;
        }}
        style={{ width: size, height: size }}
      />
    );
  }
  return <Text style={{ fontSize: size, color: '#374151' }}>←</Text>;
}

export function AppHeader() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useCurrentUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const avatarRef = useRef<View>(null);

  const isDashboard = pathname === '/dashboard' || pathname === '/dashboard/';

  const openMenu = useCallback(() => {
    avatarRef.current?.measureInWindow((_x, y, _width, height) => {
      setMenuPosition({ top: y + height + 4, right: 12 });
      setMenuOpen(true);
    });
  }, []);

  const handleSignOut = useCallback(async () => {
    setMenuOpen(false);
    try { await signOut(); } catch { /* handled by auth service */ }
  }, []);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push('/(auth)/dashboard' as never);
    }
  }, [router]);

  return (
    <>
      <View
        className="flex-row items-center justify-between border-b border-border bg-background"
        style={{ paddingHorizontal: 12, paddingVertical: 6, minHeight: 44 }}
      >
        {/* Left */}
        <View className="flex-row items-center gap-2" style={{ minWidth: 80 }}>
          {isDashboard ? (
            <>
              <Logo height={32} />
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
                      <Text style={{ fontSize: 16 }}>{lang.flag}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : (
            <Pressable
              onPress={handleBack}
              className="flex-row items-center gap-1"
              style={Platform.OS === 'web' ? { cursor: 'pointer' } as never : undefined}
            >
              <BackIcon size={18} />
              <Text className="text-sm font-medium text-foreground">{t('common.back')}</Text>
            </Pressable>
          )}
        </View>

        {/* Right */}
        <View className="flex-row items-center gap-2.5 shrink">
          {user?.name ? (
            <Text className="hidden text-xs text-muted-foreground md:flex" numberOfLines={1}>{user.name}</Text>
          ) : null}
          <Pressable onPress={openMenu}>
            <View ref={avatarRef} collapsable={false}>
              <Avatar uri={user?.avatarUrl} name={user?.name} size={30} />
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
    </>
  );
}
