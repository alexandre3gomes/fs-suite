import { useTranslation } from 'react-i18next';
import { ScrollView, View, Text, Pressable } from 'react-native';

export default function ProfileScreen() {
  const { t } = useTranslation();

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="px-4 py-6">
        <Text className="mb-6 text-2xl font-bold text-foreground">{t('profile.title')}</Text>

        {/* TODO: Phase 2 — Load user profile from API */}
        <View className="gap-4">
          <Text className="text-muted-foreground">{t('profile.name')}</Text>
          <Text className="text-muted-foreground">{t('profile.email')}</Text>
          <Text className="text-muted-foreground">{t('profile.simbriefPilotId')}</Text>
        </View>

        <Pressable className="mt-8 rounded-button bg-destructive px-6 py-3">
          <Text className="text-center font-medium text-destructive-foreground">
            {t('profile.signOut')}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
