import { useTranslation } from 'react-i18next';
import { View, Text, Pressable } from 'react-native';

export default function LoginScreen() {
  const { t } = useTranslation();

  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <View className="w-full max-w-sm items-center gap-8">
        <View className="items-center gap-2">
          <Text className="text-4xl font-bold text-foreground">{t('login.title')}</Text>
          <Text className="text-center text-muted-foreground">{t('login.subtitle')}</Text>
        </View>

        <Pressable
          className="w-full flex-row items-center justify-center gap-3 rounded-button bg-primary px-6 py-3"
          onPress={() => {
            // TODO: Phase 1 — Trigger Google OAuth via expo-web-browser
          }}
        >
          <Text className="text-base font-medium text-primary-foreground">
            {t('login.signInButton')}
          </Text>
        </Pressable>

        <Text className="text-center text-xs text-muted-foreground">{t('login.terms')}</Text>
      </View>
    </View>
  );
}
