import * as React from 'react';
import { Animated, View, type ViewProps } from 'react-native';

export interface SkeletonProps extends ViewProps {
  width?: number | string;
  height?: number;
  rounded?: boolean;
  className?: string;
}

export function Skeleton({
  width = '100%',
  height = 16,
  rounded = false,
  className = '',
  style,
  ...props
}: SkeletonProps) {
  const opacity = React.useRef(new Animated.Value(0.3)).current;

  React.useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <View
      className={[
        'overflow-hidden',
        rounded ? 'rounded-full' : 'rounded-card',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={[{ width: width as number, height }, style]}
      {...props}
    >
      <Animated.View className="flex-1 bg-muted" style={{ opacity }} />
    </View>
  );
}
