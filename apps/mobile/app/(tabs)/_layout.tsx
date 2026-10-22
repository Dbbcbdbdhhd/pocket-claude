import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../src/components/Avatar';
import { OWN } from '../../src/content/fake';
import { colors } from '../../src/theme';

const ICON = 26;

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.text,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 50 + insets.bottom,
          paddingBottom: insets.bottom,
          elevation: 0,
        },
        tabBarItemStyle: { paddingVertical: 0, justifyContent: 'center' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ tabBarIcon: ({ focused }) => <Ionicons name={focused ? 'home' : 'home-outline'} size={ICON} color={colors.text} />, tabBarAccessibilityLabel: 'Home' }}
      />
      <Tabs.Screen
        name="explore"
        options={{ tabBarIcon: ({ focused }) => <Ionicons name={focused ? 'search' : 'search-outline'} size={ICON} color={colors.text} />, tabBarAccessibilityLabel: 'Search' }}
      />
      <Tabs.Screen
        name="create"
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push('/new-post');
          },
        }}
        options={{
          tabBarIcon: () => (
            <View style={[styles.plus, { borderColor: colors.text }]}>
              <Ionicons name="add" size={18} color={colors.text} />
            </View>
          ),
          tabBarAccessibilityLabel: 'New post',
        }}
      />
      <Tabs.Screen
        name="reels"
        options={{ tabBarIcon: ({ focused }) => <Ionicons name={focused ? 'film' : 'film-outline'} size={ICON} color={colors.text} />, tabBarAccessibilityLabel: 'Reels' }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ focused }) => (
            <View style={[styles.profile, focused && styles.profileOn]}>
              <Avatar uri={OWN.avatar} size={focused ? 22 : 24} />
            </View>
          ),
          tabBarAccessibilityLabel: 'Profile',
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  plus: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  profile: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  profileOn: { borderColor: colors.text },
});
