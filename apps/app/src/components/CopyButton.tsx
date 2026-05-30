import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

interface CopyOption {
  label: string;
  text: string;
}

interface CopyButtonProps {
  /** Single-copy mode: text placed on the clipboard. */
  text?: string;
  /** Menu mode: tapping the icon reveals these options to choose what to copy. */
  options?: CopyOption[];
  /** Single-copy mode only: render the icon + this label. */
  label?: string;
  /** Overrides the screen-reader / title text (defaults to label or "Copy"). */
  accessibilityLabel?: string;
}

const ICON_SIZE = 13;
const MUTED = '#6b7280';
const SUCCESS = '#16a34a';

/**
 * Copy-to-clipboard button. A clean Feather "copy" glyph that flips to a green
 * check + "Copied!" for ~1.5s after a copy. Borderless and subtle.
 *
 * - `text`: single copy on tap.
 * - `options`: tapping reveals small choice chips (e.g. plain route vs full
 *   route); picking one copies it. Keeps a single unobtrusive icon instead of
 *   several labelled buttons.
 */
export function CopyButton({ text, options, label, accessibilityLabel }: CopyButtonProps): JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async (value: string): Promise<void> => {
    if (!value) return;
    await Clipboard.setStringAsync(value);
    setOpen(false);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  // Menu mode: icon → tap → choice chips.
  if (options) {
    return (
      <View className="flex-row items-center gap-1.5">
        <Pressable
          onPress={() => setOpen((o) => !o)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? t('common.copy')}
          className="px-1 py-0.5 active:opacity-50"
        >
          <Feather name={copied ? 'check' : 'copy'} size={ICON_SIZE} color={copied ? SUCCESS : MUTED} />
        </Pressable>
        {copied ? (
          <Text className="text-[11px] text-green-600">{t('common.copied')}</Text>
        ) : open ? (
          options.map((o) => (
            <Pressable
              key={o.label}
              onPress={() => copy(o.text)}
              disabled={!o.text}
              className={`rounded border border-border px-2 py-0.5 active:opacity-60 ${o.text ? 'bg-surface-muted' : 'opacity-40'}`}
            >
              <Text className="text-[11px] text-foreground">{o.label}</Text>
            </Pressable>
          ))
        ) : null}
      </View>
    );
  }

  // Single-copy mode.
  return (
    <Pressable
      onPress={() => copy(text ?? '')}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label ?? t('common.copy')}
      hitSlop={8}
      className="flex-row items-center gap-1 px-1 py-0.5 active:opacity-50"
    >
      <Feather name={copied ? 'check' : 'copy'} size={ICON_SIZE} color={copied ? SUCCESS : MUTED} />
      {label || copied ? (
        <Text className={`text-[11px] ${copied ? 'text-green-600' : 'text-muted-foreground'}`}>
          {copied ? t('common.copied') : label}
        </Text>
      ) : null}
    </Pressable>
  );
}
