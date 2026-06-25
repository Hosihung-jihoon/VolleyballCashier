import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    Alert, KeyboardAvoidingView, Modal, Platform, ScrollView,
    StyleSheet,
    Text, TextInput, TouchableOpacity,
    View
} from 'react-native';
import { createSession, joinSession } from '../lib/sessionApi';

const showAlert = (title, message, buttons = []) => {
  if (Platform.OS === 'web') {
    if (buttons && buttons.length > 0) {
      const confirmButton = buttons.find(b => b.text === 'Đúng' || b.text === 'OK') || buttons[buttons.length - 1];
      const hasCancel = buttons.some(b => b.text === 'Hủy' || b.text === 'Cancel');
      if (hasCancel) {
        const result = window.confirm(`${title}\n\n${message}`);
        if (result) {
          if (confirmButton && confirmButton.onPress) confirmButton.onPress();
        } else {
          const cancelButton = buttons.find(b => b.text === 'Hủy' || b.text === 'Cancel');
          if (cancelButton && cancelButton.onPress) cancelButton.onPress();
        }
      } else {
        window.alert(`${title}\n\n${message}`);
        if (confirmButton && confirmButton.onPress) confirmButton.onPress();
      }
    } else {
      window.alert(`${title}\n\n${message}`);
    }
  } else {
    Alert.alert(title, message, buttons);
  }
};

export default function HomeScreen() {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [lastPin, setLastPin] = useState(null);
  const [lastRole, setLastRole] = useState(null);

  useEffect(() => {
    const checkLastSession = async () => {
      try {
        const pinVal = await AsyncStorage.getItem('last_session_pin');
        const roleVal = await AsyncStorage.getItem('last_session_role');
        if (pinVal && roleVal) {
          setLastPin(pinVal);
          setLastRole(roleVal);
        }
      } catch (e) {
        console.log(e);
      }
    };
    checkLastSession();
  }, []);

  const handleResume = () => {
    if (lastPin && lastRole) {
      router.push({ pathname: '/session', params: { pin: lastPin, role: lastRole } });
    }
  };

  // Xử lý TẠO PHÒNG ONLINE
  const handleCreate = async () => {
    if (!name.trim()) {
      showAlert('Lỗi', 'Vui lòng nhập tên!');
      return;
    }
    setLoading(true);
    try {
      const { pin: newPin } = await createSession(name.trim(), false);
      router.push({ pathname: '/session', params: { pin: newPin, role: 'host' } });
    } catch (e) {
      showAlert('Lỗi', e.message);
    }
    setLoading(false);
  };

  // Xử lý TẠO PHÒNG OFFLINE
  const handleCreateOffline = async () => {
    if (!name.trim()) {
      showAlert('Lỗi', 'Vui lòng nhập tên!');
      return;
    }
    setLoading(true);
    try {
      const { pin: newPin } = await createSession(name.trim(), true);
      router.push({ pathname: '/session', params: { pin: newPin, role: 'host' } });
    } catch (e) {
      showAlert('Lỗi', e.message);
    }
    setLoading(false);
  };

  // Xử lý THAM GIA PHÒNG
  const handleJoin = async () => {
    if (!name.trim() || !pin.trim()) {
      showAlert('Lỗi', 'Vui lòng nhập tên và mã PIN!');
      return;
    }
    setLoading(true);
    try {
      await joinSession(pin.trim(), name.trim());
      router.push({ pathname: '/session', params: { pin: pin.trim(), role: 'member' } });
    } catch (e) {
      showAlert('Lỗi', e.message);
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

        {lastPin && (
          <TouchableOpacity
            style={[styles.button, styles.resumeButton]}
            onPress={handleResume}
            disabled={loading}
          >
            <Text style={styles.buttonText}>🔄 Tiếp tục phòng đang chơi ({lastPin})</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.button, styles.createButton]}
          onPress={handleCreate}
          disabled={loading}
        >
          <Text style={styles.buttonText}>Tạo phòng Online</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.offlineButton]}
          onPress={handleCreateOffline}
          disabled={loading}
        >
          <Text style={styles.buttonText}>Tạo phòng Offline (1 máy)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.joinButton]}
          onPress={handleJoin}
          disabled={loading}
        >
          <Text style={styles.buttonText}>Tham gia phòng (Online)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.helpButton}
          onPress={() => setShowHelpModal(true)}
        >
          <Text style={styles.helpButtonText}>ℹ️ Hướng dẫn & Tính năng</Text>
        </TouchableOpacity>
      </View>

      {/* Modal Hướng dẫn & Tính năng */}
      <Modal
        visible={showHelpModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowHelpModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🏐 Volleyball Cashier</Text>
            <Text style={styles.modalSubtitle}>Ứng dụng quản lý tiền cược bóng chuyền tiện lợi</Text>
            
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.sectionTitle}>🎯 Mục đích của app</Text>
              <Text style={styles.descText}>
                Volleyball Cashier giúp nhóm chơi bóng chuyền (chơi cược/độ) dễ dàng phân chia đội hình, quản lý người chơi dự bị, tự động ghi nhận kết quả và tính toán số tiền thắng/thua của mỗi người sau mỗi set đấu một cách rõ ràng, minh bạch.
              </Text>

              <Text style={styles.sectionTitle}>🚀 Các tính năng chính</Text>
              
              <View style={styles.featureItem}>
                <Text style={styles.featureTitle}>📶 Tạo phòng Online</Text>
                <Text style={styles.featureDesc}>Host tạo phòng lấy mã PIN, các thành viên khác nhập PIN để tham gia tự chọn đội hoặc xem kết quả thời gian thực trên máy cá nhân.</Text>
              </View>

              <View style={styles.featureItem}>
                <Text style={styles.featureTitle}>📴 Tạo phòng Offline (1 máy)</Text>
                <Text style={styles.featureDesc}>Hoạt động hoàn toàn không cần internet. Một máy của Host tự quản lý danh sách người chơi, chia đội và ghi nhận toàn bộ kết quả.</Text>
              </View>

              <View style={styles.featureItem}>
                <Text style={styles.featureTitle}>👥 Chia đội & Thay người</Text>
                <Text style={styles.featureDesc}>Thêm người chơi vào Team A và Team B. Hỗ trợ cơ chế thay người linh hoạt trong lúc set đấu đang diễn ra.</Text>
              </View>

              <View style={styles.featureItem}>
                <Text style={styles.featureTitle}>💰 Tự động tính toán tiền cược</Text>
                <Text style={styles.featureDesc}>Số tiền thắng/thua được tính tự động dựa trên mức cược và số người chơi (đội thắng nhận tiền từ đội thua; nếu lệch người, phần tiền chênh lệch sẽ được tự động gom vào Quỹ chung của sân).</Text>
              </View>

              <View style={styles.featureItem}>
                <Text style={styles.featureTitle}>📊 Lịch sử & Thanh toán</Text>
                <Text style={styles.featureDesc}>Xem lại lịch sử chi tiết từng set đấu, hỗ trợ tính năng Hoàn tác (Undo) và tích chọn thanh toán cuối buổi cho từng thành viên.</Text>
              </View>
            </ScrollView>

            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setShowHelpModal(false)}
            >
              <Text style={styles.modalCloseText}>Đóng</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  resumeButton: { backgroundColor: '#f9ab00' },
  offlineButton: { backgroundColor: '#5f6368' },
  joinButton: { backgroundColor: '#34a853' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  helpButton: { marginTop: 15, alignItems: 'center', padding: 10 },
  helpButtonText: { color: '#1a73e8', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#fff', width: '90%', maxHeight: '80%', borderRadius: 15, padding: 20 },
  modalScroll: { marginVertical: 15 },
  modalTitle: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', color: '#1a73e8', marginBottom: 5 },
  modalSubtitle: { fontSize: 13, color: '#666', textAlign: 'center', marginBottom: 10, fontStyle: 'italic' },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginTop: 15, marginBottom: 8, color: '#333' },
  descText: { fontSize: 14, color: '#555', lineHeight: 20 },
  featureItem: { marginBottom: 12, borderLeftWidth: 3, borderLeftColor: '#1a73e8', paddingLeft: 10 },
  featureTitle: { fontSize: 14, fontWeight: 'bold', color: '#333', marginBottom: 2 },
  featureDesc: { fontSize: 13, color: '#666', lineHeight: 18 },
  modalCloseBtn: { backgroundColor: '#1a73e8', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  modalCloseText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});