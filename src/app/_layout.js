import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, title: 'Sổ Kèo Bóng Chuyền' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="session" />
    </Stack>
  );
}