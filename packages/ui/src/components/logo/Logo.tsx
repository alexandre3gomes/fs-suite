import * as React from 'react';
import { Image } from 'react-native';

export const logoSource = require('../../assets/logo.png') as number;

export interface LogoProps {
  /** Height in pixels. Width is calculated from the image aspect ratio (3:2). */
  height?: number;
}

export function Logo({ height = 48 }: LogoProps): React.JSX.Element {
  const width = Math.round(height * (3 / 2));

  return (
    <Image
      source={logoSource}
      style={{ width, height }}
      resizeMode="contain"
      accessibilityLabel="FS Suite logo"
    />
  );
}
