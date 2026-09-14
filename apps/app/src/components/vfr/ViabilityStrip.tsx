import { Text, colors } from '@fs-suite/ui';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { useIsDesktop } from '../../hooks/useIsDesktop';

import type { PlanViability, ValidationItem, ViabilityStatus } from './weatherTimeUtils';

/**
 * The viability strip, docked directly under the map.
 *
 * It renders `planViability` — the verdict `VfrPlanForm` already computes at
 * line 1125 via `validateVfrPlan` — and nothing else. It does not derive,
 * fetch, recompute or second-guess that verdict, and it deliberately does NOT
 * use `src/lib/readiness.ts`: that module is a presence checker written for the
 * saved-plan ops board, and running it beside `validateVfrPlan` would put two
 * different rulebooks on the same screen. A cruise level above the Brazilian
 * VFR maximum is `not-viable` to the validator and would read "Legal" to a
 * presence check — a disagreement the pilot must never see.
 *
 * Severity maps to a visual state, and that is the whole of the logic here:
 *
 *   blocking     -> fail     (destructive; red only ever means blocked)
 *   actionable   -> warn
 *   warning      -> warn
 *   unverifiable -> unknown  (grey; never a green pass)
 *
 * Types are imported from `weatherTimeUtils` rather than redeclared.
 */

type CellState = 'ok' | 'warn' | 'fail' | 'unknown';

const SEVERITY_STATE: Record<ValidationItem['severity'], CellState> = {
  blocking: 'fail',
  actionable: 'warn',
  warning: 'warn',
  unverifiable: 'unknown',
};

const STATE_COLOR: Record<CellState, string> = {
  ok: colors.rule,
  warn: colors.primary,
  fail: colors.destructive,
  unknown: colors.ruleSoft,
};

const STATE_TEXT: Record<CellState, string> = {
  ok: 'text-foreground',
  warn: 'text-primary',
  fail: 'text-destructive',
  unknown: 'text-muted-foreground',
};

const STATUS_STATE: Record<ViabilityStatus, CellState> = {
  viable: 'ok',
  'viable-with-warnings': 'warn',
  incomplete: 'unknown',
  'not-viable': 'fail',
  unverifiable: 'unknown',
};

/** Blocking first, then actionable, then warning, then unverifiable. */
const SEVERITY_ORDER: Record<ValidationItem['severity'], number> = {
  blocking: 0,
  actionable: 1,
  warning: 2,
  unverifiable: 3,
};

export function ViabilityStrip({
  viability,
  onPressItem,
  isNavigable,
  maxItems,
}: {
  /** `planViability` from VfrPlanForm — the authoritative verdict. */
  viability: PlanViability | null;
  /** Optional: take the pilot to the step an item refers to. */
  onPressItem?: (item: ValidationItem) => void;
  /**
   * Optional gate on `onPressItem`. Cells that answer false render as plain
   * text — an unmapped item still shows its message, it just offers no press
   * affordance it cannot honour. Without this, every cell is pressable.
   */
  isNavigable?: (item: ValidationItem) => boolean;
  /** Cells shown before collapsing into a "+N" overflow. */
  maxItems?: number;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();

  if (!viability) return null;

  const limit = maxItems ?? (isDesktop ? 4 : 2);
  const sorted = [...viability.items].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  const shown = sorted.slice(0, limit);
  const overflow = sorted.length - shown.length;

  const statusState = STATUS_STATE[viability.status];
  const cellBasis = isDesktop ? '20%' : '50%';

  return (
    <View
      className="flex-row flex-wrap border-t-2 border-rule bg-background"
      testID="viability-strip"
    >
      {/* The overall verdict, always first and always present. */}
      <View
        className="border-b border-r border-border px-3 py-2"
        style={{ flexBasis: cellBasis, flexGrow: 1, minWidth: isDesktop ? 0 : 130 }}
        testID="viability-status"
      >
        <View className="flex-row items-center gap-2">
          <View style={{ height: 4, width: 20, backgroundColor: STATE_COLOR[statusState] }} />
          <Text variant="label" className="text-[10px]">
            {t('viability.label')}
          </Text>
        </View>
        <Text variant="small" className={'mt-1 ' + STATE_TEXT[statusState]} numberOfLines={1}>
          {t('viability.status.' + viability.status, { defaultValue: viability.status })}
        </Text>
      </View>

      {shown.map((item) => {
        const state = SEVERITY_STATE[item.severity];
        const body = (
          <>
            <View className="flex-row items-center gap-2">
              <View style={{ height: 4, width: 20, backgroundColor: STATE_COLOR[state] }} />
              <Text variant="label" className="text-[10px]" numberOfLines={1}>
                {t('viability.severity.' + item.severity, { defaultValue: item.severity })}
              </Text>
            </View>
            <Text variant="small" className={'mt-1 ' + STATE_TEXT[state]} numberOfLines={2}>
              {item.message}
            </Text>
            {item.action ? (
              <Text variant="muted" className="mt-1 text-[10px]" numberOfLines={1}>
                {item.action}
              </Text>
            ) : null}
          </>
        );
        const style = { flexBasis: cellBasis, flexGrow: 1, minWidth: isDesktop ? 0 : 130 } as const;
        const pressable = !!onPressItem && (isNavigable ? isNavigable(item) : true);

        return pressable && onPressItem ? (
          <Pressable
            key={item.id}
            testID={'viability-item-' + item.id}
            onPress={() => onPressItem(item)}
            className="border-b border-r border-border px-3 py-2 active:bg-secondary"
            style={style}
            accessibilityRole="button"
          >
            {body}
          </Pressable>
        ) : (
          <View
            key={item.id}
            testID={'viability-item-' + item.id}
            className="border-b border-r border-border px-3 py-2"
            style={style}
          >
            {body}
          </View>
        );
      })}

      {overflow > 0 ? (
        <View
          className="border-b border-r border-border px-3 py-2"
          style={{ flexBasis: cellBasis, flexGrow: 1, minWidth: isDesktop ? 0 : 130 }}
          testID="viability-overflow"
        >
          <Text variant="label" className="text-[10px]">
            {t('viability.more', { count: overflow })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
