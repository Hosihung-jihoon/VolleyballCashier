import { router } from 'expo-router';
import { useState } from 'react';
import {
    Alert, KeyboardAvoidingView, Platform,
    StyleSheet,
    Text, TextInput, TouchableOpacity,
    View
} from 'react-native';
import { createSession, joinSession } from '../lib/sessionApi';

export default function HomeScreen() {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  // Xử lý TẠO PHÒNG
  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Lỗi', 'Vui lòng nhập tên!');
      return;
    }
    setLoading(true);
    try {
      const { pin: newPin } = await createSession(name.trim());
      router.push({ pathname: '/session', params: { pin: newPin, role: 'host' } });
    } catch (e) {
      Alert.alert('Lỗi', e.message);
    }
    setLoading(false);
  };

  // Xử lý THAM GIA PHÒNG
  const handleJoin = async () => {
    if (!name.trim() || !pin.trim()) {
      Alert.alert('Lỗi', 'Vui lòng nhập tên và mã PIN!');
      return;
    }
    setLoading(true);
    try {
      await joinSession(pin.trim(), name.trim());
      router.push({ pathname: '/session', params: { pin: pin.trim(), role: 'member' } });
    } catch (e) {
      Alert.alert('Lỗi', e.message);
    }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={styles.title}>🏐 Volleyball Cashier</Text>
        <Text style={styles.subtitle}>Quản lý tiền cược bóng chuyền</Text>

        <TextInput
          style={styles.input}
          placeholder="Nhập tên của bạn"
          value={name}
          onChangeText={setName}
        />

        <TextInput
          style={styles.input}
          placeholder="Mã PIN (để tham gia)"
          value={pin}
          onChangeText={setPin}
          keyboardType="numeric"
          maxLength={4}
        />

        <TouchableOpacity
          style={[styles.button, styles.createButton]}
          onPress={handleCreate}
          disabled={loading}
        >
          <Text style={styles.buttonText}>Tạo phòng mới</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.joinButton]}
          onPress={handleJoin}
          disabled={loading}
        >
          <Text style={styles.buttonText}>Tham gia phòng</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f8' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 30 },
  title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center', marginBottom: 5, color: '#1a73e8' },
  subtitle: { fontSize: 16, textAlign: 'center', marginBottom: 40, color: '#666' },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd',
    borderRadius: 10, padding: 15, fontSize: 16, marginBottom: 15,
  },
  button: { padding: 15, borderRadius: 10, alignItems: 'center', marginBottom: 12 },
  createButton: { backgroundColor: '#1a73e8' },
  joinButton: { backgroundColor: '#34a853' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});