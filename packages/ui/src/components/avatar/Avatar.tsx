import * as React from 'react';
import { Image, Text, View } from 'react-native';

export interface AvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: number;
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((word) => word[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Avatar({ uri, name, size = 40 }: AvatarProps): React.JSX.Element {
  const borderRadius = size / 2;
  const fontSize = Math.round(size * 0.36);

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius }}
        resizeMode="cover"
        accessibilityLabel={name ?? 'User avatar'}
      />
    );
  }

  return (
    <View
      style={{ width: size, height: size, borderRadius }}
      className="items-center justify-center bg-muted"
    >
      <Text
        className="font-bold text-foreground"
        style={{ fontSize }}
        accessibilityLabel={name ?? 'User avatar'}
      >
        {getInitials(name)}
      </Text>
    </View>
  );
}
