import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enMessages from '../messages/en.json';
import ptBRMessages from '../messages/pt-BR.json';

const STORAGE_KEY = '@fs-suite/language';

const resources = {
  en: { translation: enMessages },
  'pt-BR': { translation: ptBRMessages },
};

export const supportedLocales = ['pt-BR', 'en'] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
const defaultLocale: SupportedLocale = 'pt-BR';

i18n.use(initReactI18next).init({
  resources,
  lng: defaultLocale,
  fallbackLng: defaultLocale,
  interpolation: {
    escapeValue: false,
  },
});

/** Change language and persist the preference. */
export async function setLanguage(locale: SupportedLocale): Promise<void> {
  await i18n.changeLanguage(locale);
  await AsyncStorage.setItem(STORAGE_KEY, locale);
}

/** Restore persisted language preference (call once at startup). */
export async function restoreLanguage(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored && (supportedLocales as readonly string[]).includes(stored)) {
      await i18n.changeLanguage(stored);
    }
  } catch { /* ignore — use default */ }
}

export default i18n;
