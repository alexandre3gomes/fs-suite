import { Feather } from '@expo/vector-icons';
import { Avatar, Text, colors } from '@fs-suite/ui';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, View } from 'react-native';

import { useCurrentUser } from '../../hooks/useCurrentUser';
import { setLanguage, type SupportedLocale } from '../../i18n';
import { signOut } from '../../services/auth.service';
import { FeedbackModal } from '../feedback/FeedbackModal';

const LANGUAGES: { code: SupportedLocale; label: string }[] = [
  { code: 'pt-BR', label: 'PT' },
  { code: 'en', label: 'EN' },
];

/**
 * Signed-in identity, language switch, feedback and sign-out.
 * Behaviour is the old AppHeader menu's; only the presentation changed.
 *
 * Wayfinding is not duplicated (the second defect in slice 1). The menu lists
 * only destinations the surrounding navigation cannot reach:
 *   - `rail` (desktop): the rail already lists Profile and Admin, so the menu
 *     is sign-out only.
 *   - `bar` (mobile): Profile is a tab, but Admin is not, so Admin appears
 *     here and nowhere else.
 */
export function AccountBlock({ layout }: { layout: 'rail' | 'bar' }): JSX.Element {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { user } = useCurrentUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const anchorRef = useRef<View>(null);

  const showAdminEntry = layout === 'bar' && !!user?.isAdmin;

  const openMenu = useCallback(() => {
    anchorRef.current?.measureInWindow((x, y, _w, height) => {
      setMenuPosition({ top: y + height + 2, left: Math.max(8, x) });
      setMenuOpen(true);
    });
  }, []);

  const handleSignOut = useCallback(async () => {
    setMenuOpen(false);
    try {
      await signOut();
    } catch {
      /* handled by auth service */
    }
  }, []);

  const languageRow = (
    <View className="flex-row">
      {LANGUAGES.map((lang) => {
        const isCurrent = i18n.language === lang.code;
        return (
          <Pressable
            key={lang.code}
            onPress={() => {
              void setLanguage(lang.code);
            }}
            disabled={isCurrent}
            className={[
              'border-2 border-rule px-2 py-1',
              isCurrent ? 'bg-rule' : 'bg-transparent',
            ].join(' ')}
            style={{ marginLeft: -2, minHeight: 32, justifyContent: 'center' }}
            accessibilityRole="button"
            accessibilityLabel={lang.label}
          >
            <Text variant="labelInk" className={isCurrent ? 'text-background' : 'text-foreground'}>
              {lang.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <>
      {layout === 'rail' ? (
        <View className="px-6 py-4">
          <Text variant="label">{t('nav.signedIn')}</Text>
          <Pressable
            onPress={openMenu}
            testID="account-menu-trigger"
            className="mt-2 flex-row items-center gap-3"
            style={Platform.OS === 'web' ? ({ cursor: 'pointer' } as never) : undefined}
          >
            <View ref={anchorRef} collapsable={false}>
              <Avatar uri={user?.avatarUrl} name={user?.name} size={28} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="small" numberOfLines={1}>
                {user?.name ?? '—'}
              </Text>
            </View>
            <Feather name="more-horizontal" size={16} color={colors.mutedForeground} />
          </Pressable>
          <View className="mt-3 flex-row items-center justify-between">
            {languageRow}
            <Pressable
              onPress={() => setFeedbackOpen(true)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('feedback.title')}
              style={Platform.OS === 'web' ? ({ cursor: 'pointer' } as never) : undefined}
            >
              <Feather name="message-circle" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
        </View>
      ) : (
        <View className="flex-row items-center gap-3">
          {languageRow}
          <Pressable
            onPress={() => setFeedbackOpen(true)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('feedback.title')}
          >
            <Feather name="message-circle" size={18} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            onPress={openMenu}
            testID="account-menu-trigger"
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('nav.account')}
          >
            <View ref={anchorRef} collapsable={false}>
              <Avatar uri={user?.avatarUrl} name={user?.name} size={28} />
            </View>
          </Pressable>
        </View>
      )}

      <FeedbackModal visible={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable className="flex-1" onPress={() => setMenuOpen(false)}>
          <View
            style={{
              position: 'absolute',
              top: menuPosition.top,
              left: menuPosition.left,
              minWidth: 200,
            }}
            className="border-2 border-rule bg-card"
          >
            {showAdminEntry ? (
              <Pressable
                className={[
                  'border-b border-border px-4 py-3',
                  Platform.OS === 'web' ? 'cursor-pointer hover:bg-secondary' : 'active:bg-secondary',
                ].join(' ')}
                style={{ minHeight: 44, justifyContent: 'center' }}
                onPress={() => {
                  setMenuOpen(false);
                  router.push('/(auth)/admin' as never);
                }}
              >
                <Text variant="labelInk">{t('admin.title')}</Text>
              </Pressable>
            ) : null}
            <Pressable
              className={[
                'px-4 py-3',
                Platform.OS === 'web' ? 'cursor-pointer hover:bg-secondary' : 'active:bg-secondary',
              ].join(' ')}
              style={{ minHeight: 44, justifyContent: 'center' }}
              testID="sign-out"
              onPress={() => {
                void handleSignOut();
              }}
            >
              <Text variant="labelInk" className="text-destructive">
                {t('dashboard.signOut')}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
