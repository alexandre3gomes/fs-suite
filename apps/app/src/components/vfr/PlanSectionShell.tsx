import { Text } from '@fs-suite/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * Modernist replacement for the plan form's section chrome: a flush-left
 * uppercase label over a 2px rule, no card, no radius, no shadow. The rule
 * does the organising.
 *
 * Props match the `Section` currently defined inside `VfrPlanForm.tsx`
 * (`title`, `trailing`, `info`, `children`) so it is a drop-in for that
 * local component — plus `hidden`, which the form can drive from its own step
 * state. `hidden` uses `display: 'none'` rather than unmounting, so a section
 * outside the active step keeps its state, effects and subscriptions and no
 * in-progress input is lost when the pilot switches steps.
 *
 * Stateless. Owns nothing.
 */
export function PlanSectionShell({
  title,
  trailing,
  info,
  hidden = false,
  testID,
  children,
}: {
  title: string;
  trailing?: ReactNode;
  info?: string;
  hidden?: boolean;
  testID?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <View
      testID={testID}
      style={hidden ? { display: 'none' } : undefined}
      className="border-b border-border"
    >
      <View className="flex-row items-center justify-between gap-3 border-b-2 border-rule px-4 py-3">
        <Text variant="labelInk" numberOfLines={1} style={{ flexShrink: 1 }}>
          {title}
        </Text>
        {trailing ?? null}
      </View>
      {info ? (
        <View className="border-b border-border bg-secondary px-4 py-2">
          <Text variant="muted" className="text-[12px]">
            {info}
          </Text>
        </View>
      ) : null}
      <View className="px-4 py-4">{children}</View>
    </View>
  );
}
