import { GrandHotel_400Regular, useFonts } from '@expo-google-fonts/grand-hotel';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LockProvider } from '../src/lock';
import { PcClipboardProvider } from '../src/pc-clipboard';
import { SessionProvider, useSession } from '../src/session';
import { colors } from '../src/theme';

void SplashScreen.preventAutoHideAsync();

function Routes({ fontsReady }: { fontsReady: boolean }) {
  const { phase } = useSession();
  const ready = phase !== 'loading' && fontsReady;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  const paired = phase === 'paired';

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
      <Stack.Protected guard={paired}>
        <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
        <Stack.Screen name="direct/index" />
        <Stack.Screen name="direct/[id]" />
        <Stack.Screen name="direct/activity" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="direct/computers" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="settings" />
        <Stack.Screen name="new-post" options={{ presentation: 'transparentModal', animation: 'fade' }} />
      </Stack.Protected>
      <Stack.Protected guard={!paired}>
        <Stack.Screen name="pair" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ GrandHotel_400Regular });
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SessionProvider>
        <PcClipboardProvider>
          <LockProvider>
            <Routes fontsReady={fontsLoaded || fontError !== null} />
          </LockProvider>
        </PcClipboardProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
