import * as React from 'react';
import { Image } from 'react-native';

const logoSource = require('../../assets/logo.png') as number;

export interface LogoProps {
  /** Height in pixels. Width is calculated from the image aspect ratio (~16:9). */
  height?: number;
}

export function Logo({ height = 48 }: LogoProps): React.JSX.Element {
  // Logo is a landscape badge — approximate 16:9 aspect ratio
  const width = Math.round(height * (16 / 9));

  return (
    <Image
      source={logoSource}
      style={{ width, height }}
      resizeMode="contain"
      accessibilityLabel="Simulando logo"
    />
  );
}
