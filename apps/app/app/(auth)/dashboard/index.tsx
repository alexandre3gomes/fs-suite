import { Avatar, Badge, Card, Logo } from '@fs-suite/ui';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useCurrentUser } from '../../../src/hooks/useCurrentUser';

interface ModuleCardProps {
  icon: string;
  title: string;
  description: string;
  isActive?: boolean;
  href?: string;
  comingSoonLabel?: string;
}

function ModuleCard({
  icon,
  title,
  description,
  isActive = false,
  href,
  comingSoonLabel,
}: ModuleCardProps) {
  const inner = (
    <Card
      variant={isActive ? 'module' : 'default'}
      className={['p-4', isActive ? '' : 'opacity-60'].filter(Boolean).join(' ')}
    >
      <View className="mb-3 flex-row items-center justify-between">
        <Text style={{ fontSize: 28 }}>{icon}</Text>
        {!isActive && comingSoonLabel ? (
          <Badge variant="outline">{comingSoonLabel}</Badge>
        ) : null}
        {isActive ? (
          <Badge variant="success">✓</Badge>
        ) : null}
      </View>
      <Text
        className={[
          'text-base font-semibold',
          isActive ? 'text-foreground' : 'text-muted-foreground',
        ].join(' ')}
      >
        {title}
      </Text>
      <Text className="mt-1 text-sm text-muted-foreground">{description}</Text>
    </Card>
  );

  if (isActive && href) {
    return (
      <Link href={href as never} asChild className="flex-1">
        <Pressable className="active:opacity-80">{inner}</Pressable>
      </Link>
    );
  }

  return <View className="flex-1">{inner}</View>;
}

export default function DashboardScreen() {
  const { t } = useTranslation();
  const { user } = useCurrentUser();

  const firstName = user?.name?.split(' ')[0] ?? '';

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-8">
      {/* Header */}
      <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
        <Logo height={32} />
        <View className="flex-row items-center gap-3">
          {user?.name ? (
            <Text className="hidden text-sm text-muted-foreground md:flex">{user.name}</Text>
          ) : null}
          <Avatar uri={user?.avatarUrl} name={user?.name} size={36} />
        </View>
      </View>

      {/* Content */}
      <View className="mx-auto w-full max-w-4xl px-4 pt-6">
        {/* Welcome */}
        <View className="mb-6">
          <Text className="text-2xl font-bold text-foreground">
            {t('dashboard.welcome')}
            {firstName ? `, ${firstName}` : ''} ✈
          </Text>
        </View>

        {/* Module cards */}
        <View className="mb-8 gap-3">
          <View className="flex-row gap-3">
            <ModuleCard
              icon="✈"
              title={t('dashboard.modules.flightPlanning')}
              description={t('dashboard.modules.flightPlanningDesc')}
              isActive
              href="/(auth)/flight-plans"
            />
            <ModuleCard
              icon="📊"
              title={t('dashboard.modules.simbrief')}
              description={t('dashboard.modules.simbriefDesc')}
              comingSoonLabel={t('dashboard.modules.comingSoon')}
            />
          </View>

          <View className="flex-row gap-3">
            <ModuleCard
              icon="🗺"
              title={t('dashboard.modules.skyvector')}
              description={t('dashboard.modules.skyvectorDesc')}
              comingSoonLabel={t('dashboard.modules.comingSoon')}
            />
            <View className="flex-1" />
          </View>
        </View>

        {/* Recent flights */}
        <View>
          <Text className="mb-3 text-lg font-semibold text-foreground">
            {t('dashboard.recentFlights')}
          </Text>
          <Card className="p-6">
            <Text className="text-center text-muted-foreground">
              {t('dashboard.noRecentFlights')}
            </Text>
          </Card>
        </View>
      </View>
    </ScrollView>
  );
}
