import { Archivo_400Regular } from '@expo-google-fonts/archivo/400Regular';
import { Archivo_500Medium } from '@expo-google-fonts/archivo/500Medium';
import { Archivo_600SemiBold } from '@expo-google-fonts/archivo/600SemiBold';
import { Archivo_700Bold } from '@expo-google-fonts/archivo/700Bold';
import { Archivo_800ExtraBold } from '@expo-google-fonts/archivo/800ExtraBold';

/**
 * Archivo for native. The design's negative tracking is tuned to Archivo's
 * metrics, so a fallback sans reads as damaged rather than merely different.
 *
 * Imported per weight, not from the package root: the root re-exports all 18
 * faces and Metro pulls every `.ttf` it can reach, which added 2.2 MB to the
 * bundle for five weights we actually use.
 *
 * Web is served by the `@import` in `global.css`, so `appFonts.web.ts`
 * exports an empty map and ships no font binaries at all.
 */
export const appFonts = {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
};
