import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import { colors, personaGradient } from '../theme';

export function ClaudeAvatar({ size, active }: { size: number; active?: boolean }) {
  const dot = Math.max(10, Math.round(size * 0.26));
  return (
    <View style={{ width: size, height: size }}>
      <LinearGradient colors={personaGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.circle, { borderRadius: size / 2 }]}>
        <MaterialCommunityIcons name="tea" size={Math.round(size * 0.52)} color={colors.personaInk} />
      </LinearGradient>
      {active ? <View style={[styles.dot, { width: dot, height: dot, borderRadius: dot / 2, borderWidth: Math.max(2, dot / 5) }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: 0, bottom: 0, backgroundColor: colors.ok, borderColor: colors.bg },
});
