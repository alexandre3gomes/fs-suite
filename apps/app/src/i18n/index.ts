import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enMessages from '../messages/en.json';
import ptBRMessages from '../messages/pt-BR.json';

const resources = {
  en: { translation: enMessages },
  'pt-BR': { translation: ptBRMessages },
};

const deviceLocale = getLocales()[0]?.languageTag ?? 'pt-BR';
const supportedLocales = ['pt-BR', 'en'];
const defaultLocale = 'pt-BR';

const lng = supportedLocales.includes(deviceLocale) ? deviceLocale : defaultLocale;

i18n.use(initReactI18next).init({
  resources,
  lng,
  fallbackLng: defaultLocale,
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
