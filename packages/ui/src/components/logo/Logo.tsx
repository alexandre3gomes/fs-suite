import * as React from 'react';
import { Platform, Text, View } from 'react-native';
import Svg, { Circle, G, Mask, Path, Polygon, Rect } from 'react-native-svg';

/**
 * FS Suite logo.
 *
 * The mark is vector geometry, not a trace. Its construction, measured off the
 * original raster: the ring is four diagonal arcs (r140, stroke 14) broken at
 * the cardinals, with the arrowheads sitting in those gaps and reaching r181;
 * a two-tone needle on the NE-SW axis (tips r132 blue / r118 navy, with short
 * barbs across); a dashed course that is an arc of a larger circle (r176,
 * centred up and left at 123,112) so it crosses the rose as a great circle
 * rather than echoing the ring; and a waypoint pin where that course ends.
 * The hub and pin centres are punched through to transparency, as in the
 * original, rather than filled with a page colour.
 *
 * The wordmark is live type in Archivo — the interface font — not an image and
 * not outlines. So it recolours with `tone`, stays crisp at any size, and
 * cannot drift from the UI's own typography.
 *
 * The PNG exports are kept so existing `logoSource` imports keep working.
 */
export const logoSource = require('../../assets/logo.png') as number;
export const logoMarkSource = require('../../assets/logo-mark.png') as number;

const NAVY = '#00276B';
const BLUE = '#006EFF';

/** Intrinsic proportions of the lockup, from the measured artwork. */
const MARK_RATIO = 363 / 355; // 1.023 — the mark alone. The full lockup is
//                              3.135 wide, but that is a property of logo.svg;
//                              the component's row sizes to its own content.
const GAP = 44 / 355; //          gap between mark and wordmark

/**
 * Wordmark size as a multiple of the lockup height.
 *
 * The original artwork's wordmark cap height is 135 against a 355 mark — 38%.
 * Reproducing that ratio exactly is correct at poster size and unreadable in
 * interface chrome: at a 24px rail logo it yields a 9px cap. This value sets
 * the wordmark larger than the original on purpose, so "FS Suite" stays
 * legible at 20-32px, which is the only range the app ever renders it at.
 */
const WORD_SIZE = 0.73;

export interface LogoProps {
  /** Height in pixels. Width follows the artwork's true proportions. */
  height?: number;
  /**
   * `full` is the compass plus the FS Suite wordmark.
   * `mark` is the compass alone — use it below ~20px, where the wordmark
   * stops being legible, and for an app icon or favicon.
   */
  variant?: 'full' | 'mark';
  /**
   * `brand` is navy + blue on a light ground.
   * `onAccent` is a single light tone, for the accent poster and any dark
   * field — brand blue on brand blue is invisible.
   * `ink` is a single navy, for print and one-colour contexts.
   */
  tone?: 'brand' | 'onAccent' | 'ink';
}

function tones(tone: NonNullable<LogoProps['tone']>): { dark: string; light: string } {
  if (tone === 'onAccent') return { dark: '#F0F2F6', light: '#F0F2F6' };
  if (tone === 'ink') return { dark: NAVY, light: NAVY };
  return { dark: NAVY, light: BLUE };
}

export function Logo({
  height = 32,
  variant = 'full',
  tone = 'brand',
}: LogoProps): React.JSX.Element {
  const { dark, light } = tones(tone);

  const mark = (
    <Svg width={Math.round(height * MARK_RATIO)} height={height} viewBox="0 0 364 356">
      <Mask id="fsLogoHoles">
        <Rect x="0" y="0" width="364" height="356" fill="#fff" />
        <Circle cx="182" cy="178" r="14" fill="#000" />
        <Circle cx="295" cy="61" r="10" fill="#000" />
      </Mask>
      <G mask="url(#fsLogoHoles)">
        <G fill="none" stroke={dark} strokeWidth="14">
          <Path d="M 199.1 39 A 140 140 0 0 1 321 160.9" />
          <Path d="M 321 195.1 A 140 140 0 0 1 199.1 317" />
          <Path d="M 164.9 317 A 140 140 0 0 1 43 195.1" />
          <Path d="M 43 160.9 A 140 140 0 0 1 164.9 39" />
        </G>
        <G fill={dark}>
          <Polygon points="182,-3 208.4,35.4 155.6,35.4" />
          <Polygon points="363,178 324.6,204.4 324.6,151.6" />
          <Polygon points="182,359 155.6,320.6 208.4,320.6" />
          <Polygon points="1,178 39.4,151.6 39.4,204.4" />
        </G>
        <Path
          d="M 298.9 105.9 A 176 176 0 0 1 71.5 280.3"
          fill="none"
          stroke={light}
          strokeWidth="8"
          strokeDasharray="14 11"
        />
        <Circle cx="295" cy="61" r="25" fill={light} />
        <Path d="M 276 76 L 292 108 L 314 78 Z" fill={light} />
        <G fill={dark}>
          <Polygon points="98.6,261.4 163.6,159.6 200.4,196.4" />
          <Polygon points="228.7,224.7 171.4,188.6 192.6,167.4" />
          <Polygon points="125.4,121.4 192.6,167.4 171.4,188.6" />
        </G>
        <G fill={light}>
          <Polygon points="275.3,84.7 196.1,192.1 167.9,163.9" />
        </G>
        <Circle cx="182" cy="178" r="17" fill="none" stroke={dark} strokeWidth="7" />
      </G>
    </Svg>
  );

  if (variant === 'mark') {
    return (
      <View accessibilityRole="image" accessibilityLabel="FS Suite">
        {mark}
      </View>
    );
  }

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="FS Suite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: Math.round(height * GAP),
        // No fixed width: the wordmark's real advance width depends on the
        // rendered font, so constraining the row to FULL_RATIO made the text
        // wrap to two lines whenever the metrics ran even slightly wide.
        // The row sizes to its content and `numberOfLines` guarantees one line.
        height,
      }}
    >
      {mark}
      <Text
        numberOfLines={1}
        style={{
          // expo-google-fonts registers per-weight families on native; the web
          // build gets Archivo from the stylesheet and uses fontWeight.
          fontFamily: Platform.select({ web: 'Archivo', default: 'Archivo_800ExtraBold' }),
          fontWeight: '800',
          fontSize: Math.round(height * WORD_SIZE),
          // lineHeight must match fontSize, not the lockup height, or the text
          // box grows taller than the mark and drags the row out of alignment.
          lineHeight: Math.round(height * WORD_SIZE),
          letterSpacing: height * -0.012,
          // Kills Android's extra ascent/descent padding, which otherwise
          // offsets the wordmark's baseline from the mark's centre.
          includeFontPadding: false,
          color: light,
        }}
      >
        FS Suite
      </Text>
    </View>
  );
}
