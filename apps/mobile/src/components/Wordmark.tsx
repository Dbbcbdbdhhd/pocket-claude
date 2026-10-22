import { Text, type StyleProp, type TextStyle } from 'react-native';
import { colors, font } from '../theme';

export function Wordmark({ size = 32, style }: { size?: number; style?: StyleProp<TextStyle> }) {
  return <Text style={[{ color: colors.text, fontFamily: font.wordmark, fontSize: size, lineHeight: size * 1.25, includeFontPadding: false }, style]}>Pocket</Text>;
}
