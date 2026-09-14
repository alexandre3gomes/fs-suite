import { Text } from '@fs-suite/ui';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { useIsDesktop } from '../../hooks/useIsDesktop';

export type PlanStepId = 'route' | 'aircraft' | 'airspace' | 'fuel' | 'briefing';

export interface PlanStep {
  id: PlanStepId;
  /** Two-digit ordinal shown before the label. */
  num: string;
  /** i18n key, e.g. `steps.route`. */
  labelKey: string;
}

export const PLAN_STEPS: PlanStep[] = [
  { id: 'route', num: '01', labelKey: 'steps.route' },
  { id: 'aircraft', num: '02', labelKey: 'steps.aircraft' },
  { id: 'airspace', num: '03', labelKey: 'steps.airspace' },
  { id: 'fuel', num: '04', labelKey: 'steps.fuel' },
  { id: 'briefing', num: '05', labelKey: 'steps.briefing' },
];

/**
 * The five-step strip for the plan editor. **Fully controlled and stateless** —
 * it owns no step state, so it can be dropped into VfrPlanForm without any
 * provider, context or ownership question.
 *
 * `blocked` marks steps whose viability check is failing, so a pilot can see
 * from the strip which step needs attention rather than opening each one.
 * Horizontally scrollable on a phone so all five stay above 44px.
 */
export function PlanStepStrip({
  activeId,
  onSelect,
  blocked,
  steps = PLAN_STEPS,
}: {
  activeId: PlanStepId;
  onSelect: (id: PlanStepId) => void;
  blocked?: PlanStepId[];
  steps?: PlanStep[];
}): JSX.Element {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();

  const cells = steps.map((step) => {
    const isActive = step.id === activeId;
    const isBlocked = blocked?.includes(step.id) ?? false;
    return (
      <Pressable
        key={step.id}
        onPress={() => onSelect(step.id)}
        testID={'plan-step-' + step.id}
        className={['border-r border-border px-3', isActive ? 'bg-secondary' : ''].join(' ')}
        style={{
          flex: isDesktop ? 1 : undefined,
          minWidth: isDesktop ? 0 : 116,
          minHeight: 56,
          justifyContent: 'center',
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
      >
        <View className="flex-row items-center gap-2">
          <Text
            variant="labelInk"
            className={
              isBlocked ? 'text-destructive' : isActive ? 'text-primary' : 'text-muted-foreground'
            }
          >
            {step.num}
          </Text>
          <Text
            variant="labelInk"
            className={isActive ? 'text-foreground' : 'text-muted-foreground'}
            numberOfLines={1}
          >
            {t(step.labelKey)}
          </Text>
        </View>
        <View
          className={isBlocked ? 'bg-destructive' : isActive ? 'bg-primary' : 'bg-transparent'}
          style={{ height: 2, marginTop: 8 }}
        />
      </Pressable>
    );
  });

  return (
    <View className="border-b-2 border-rule bg-background" testID="plan-step-strip">
      {isDesktop ? (
        <View className="flex-row">{cells}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row">{cells}</View>
        </ScrollView>
      )}
    </View>
  );
}
