import { Stack } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS === 'web' || __DEV__ || !Updates.isEnabled) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await Updates.checkForUpdateAsync();
        if (!res.isAvailable || cancelled) return;
        await Updates.fetchUpdateAsync();
        if (cancelled) return;
        Alert.alert(
          'Đã tải bản cập nhật mới',
          'Khởi động lại app ngay để áp dụng phiên bản mới nhất.',
          [
            { text: 'Để sau', style: 'cancel' },
            { text: 'Cập nhật ngay', onPress: () => Updates.reloadAsync().catch(() => {}) },
          ]
        );
      } catch (_e) {
        // Bỏ qua im lặng khi sân mất mạng / offline
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, title: 'Sổ Kèo Bóng Chuyền' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="session" />
      </Stack>
    </GestureHandlerRootView>
  );
}