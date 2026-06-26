import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    Alert, KeyboardAvoidingView, Modal, Platform, ScrollView,
    StyleSheet,
    Text, TextInput, TouchableOpacity,
    View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
        const savedName = await AsyncStorage.getItem('saved_user_name');
        if (savedName) {
          setName(savedName);
        }
        const pinVal = await AsyncStorage.getItem('last_session_pin');
        const roleVal = await AsyncStorage.getItem('last_session_role');
        if (pinVal && roleVal) {
          setLastPin(pinVal);
          setLastRole(roleVal);
        }

        // Dọn dẹp phòng offline quá 24h
        const keys = await AsyncStorage.getAllKeys();
        const localSessionKeys = keys.filter(k => k.startsWith('local_session_'));
        for (const key of localSessionKeys) {
          const dataStr = await AsyncStorage.getItem(key);
          if (dataStr) {
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed && parsed.createdAt) {
                const ageMs = Date.now() - parsed.createdAt;
                if (ageMs > 24 * 60 * 60 * 1000) {
                  await AsyncStorage.removeItem(key);
                  console.log(`Đã xóa phòng offline hết hạn: ${key}`);
                }
              }
            } catch (e) {
              await AsyncStorage.removeItem(key);
            }
          }
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
      await AsyncStorage.setItem('saved_user_name', name.trim());
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
      await AsyncStorage.setItem('saved_user_name', name.trim());
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
      await AsyncStorage.setItem('saved_user_name', name.trim());
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
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 5 }}>
          <Ionicons name="trophy" size={32} color="#1a73e8" style={{ marginRight: 8 }} />
          <Text style={styles.title}>Volleyball Cashier</Text>
        </View>
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
            style={[styles.button, styles.resumeButton, { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }]}
            onPress={handleResume}
            disabled={loading}
          >
            <Ionicons name="refresh-circle" size={20} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.buttonText}>Tiếp tục phòng đang chơi ({lastPin})</Text>
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
          style={[styles.helpButton, { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }]}
          onPress={() => setShowHelpModal(true)}
        >
          <Ionicons name="information-circle-outline" size={18} color="#1a73e8" style={{ marginRight: 5 }} />
          <Text style={styles.helpButtonText}>Hướng dẫn & Tính năng</Text>
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
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 5 }}>
              <Ionicons name="trophy" size={28} color="#1a73e8" style={{ marginRight: 8 }} />
              <Text style={styles.modalTitle}>Volleyball Cashier</Text>
            </View>
            <Text style={styles.modalSubtitle}>Ứng dụng quản lý tiền cược bóng chuyền tiện lợi</Text>
            
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 15, marginBottom: 8 }}>
                <Ionicons name="locate" size={20} color="#1a73e8" style={{ marginRight: 6 }} />
                <Text style={[styles.sectionTitle, { marginTop: 0, marginBottom: 0 }]}>Mục đích của app</Text>
              </View>
              <Text style={styles.descText}>
                Volleyball Cashier giúp nhóm chơi bóng chuyền (chơi cược/độ) dễ dàng phân chia đội hình, quản lý người chơi dự bị, tự động ghi nhận kết quả và tính toán số tiền thắng/thua của mỗi người sau mỗi set đấu một cách rõ ràng, minh bạch.
              </Text>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 15, marginBottom: 8 }}>
                <Ionicons name="flash" size={20} color="#1a73e8" style={{ marginRight: 6 }} />
                <Text style={[styles.sectionTitle, { marginTop: 0, marginBottom: 0 }]}>Các tính năng chính</Text>
              </View>
              
              <View style={styles.featureItem}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                  <Ionicons name="wifi" size={16} color="#1a73e8" style={{ marginRight: 6 }} />
                  <Text style={styles.featureTitle}>Tạo phòng Online</Text>
                </View>
                <Text style={styles.featureDesc}>Host tạo phòng lấy mã PIN, các thành viên khác nhập PIN để tham gia tự chọn đội hoặc xem kết quả thời gian thực trên máy cá nhân.</Text>
              </View>

              <View style={styles.featureItem}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                  <Ionicons name="phone-portrait-outline" size={16} color="#1a73e8" style={{ marginRight: 6 }} />
                  <Text style={styles.featureTitle}>Tạo phòng Offline (1 máy)</Text>
                </View>
                <Text style={styles.featureDesc}>Hoạt động hoàn toàn không cần internet. Một máy của Host tự quản lý danh sách người chơi, chia đội và ghi nhận toàn bộ kết quả.</Text>
              </View>

              <View style={styles.featureItem}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                  <Ionicons name="people" size={16} color="#1a73e8" style={{ marginRight: 6 }} />
                  <Text style={styles.featureTitle}>Chia đội & Thay người</Text>
                </View>
                <Text style={styles.featureDesc}>Thêm người chơi vào các Đội. Hỗ trợ cơ chế thay người linh hoạt trong lúc set đấu đang diễn ra.</Text>
              </View>

              <View style={styles.featureItem}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                  <Ionicons name="cash" size={16} color="#1a73e8" style={{ marginRight: 6 }} />
                  <Text style={styles.featureTitle}>Tự động tính toán tiền cược</Text>
                </View>
                <Text style={styles.featureDesc}>Số tiền thắng/thua được tính tự động dựa trên mức cược và số người chơi riêng biệt cho từng thành viên.</Text>
              </View>

              <View style={styles.featureItem}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                  <Ionicons name="receipt" size={16} color="#1a73e8" style={{ marginRight: 6 }} />
                  <Text style={styles.featureTitle}>Lịch sử & Thanh toán</Text>
                </View>
                <Text style={styles.featureDesc}>Xem lại lịch sử chi tiết từng set đấu, hỗ trợ tính năng Hoàn tác (Undo) và tích chọn thanh toán cuối buổi cho từng thành viên.</Text>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 10 }}>
                <Ionicons name="calculator" size={20} color="#1a73e8" style={{ marginRight: 6 }} />
                <Text style={[styles.sectionTitle, { marginTop: 0, marginBottom: 0 }]}>Quy định & Luật Cược (Betting)</Text>
              </View>

              <View style={styles.featureItem}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                  <Ionicons name="cash-outline" size={16} color="#1a73e8" style={{ marginRight: 6 }} />
                  <Text style={styles.featureTitle}>Mức cược chung của Set</Text>
                </View>
                <Text style={styles.featureDesc}>Mức cược mặc định của set đấu (ví dụ 5k, 10k, 20k) áp dụng cho tất cả thành viên tham gia. Tiền thắng/thua được gộp chung theo đội và chia đều cho từng người thi đấu của đội đó.</Text>
              </View>

              <View style={styles.featureItem}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                  <Ionicons name="person-outline" size={16} color="#1a73e8" style={{ marginRight: 6 }} />
                  <Text style={styles.featureTitle}>Mức cược riêng (Cược cá nhân)</Text>
                </View>
                <Text style={styles.featureDesc}>Nếu một người muốn cược nhiều hơn hoặc ít hơn mức cược chung, họ có thể đặt mức cược riêng. Khi kết thúc set đấu, kết quả thắng/thua của họ sẽ dựa trên mức cược riêng này thay vì mức cược chung của set.</Text>
              </View>

              <View style={styles.featureItem}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                  <Ionicons name="swap-horizontal-outline" size={16} color="#1a73e8" style={{ marginRight: 6 }} />
                  <Text style={styles.featureTitle}>Cược đối đầu trực tiếp 1-on-1</Text>
                </View>
                <Text style={styles.featureDesc}>Cho phép người chơi đặt cược riêng nhắm thẳng vào một đối thủ cụ thể ở đội kia. Khi kết thúc set đấu, người thắng sẽ nhận tiền trực tiếp từ người thua của cặp đấu này, độc lập hoàn toàn với việc chia quỹ đội chung.</Text>
              </View>

              <View style={styles.featureItem}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                  <Ionicons name="people-outline" size={16} color="#1a73e8" style={{ marginRight: 6 }} />
                  <Text style={styles.featureTitle}>Chia sẻ tiền cược khi Thay người</Text>
                </View>
                <Text style={styles.featureDesc}>Nếu một slot trong đội có thay người giữa trận (bao gồm cả Starter khởi động và Sub dự bị vào thay), số tiền thắng/thua của slot đó sẽ được chia đôi (50-50) giữa hai người chơi để đảm bảo tính công bằng.</Text>
              </View>

              <View style={styles.featureItem}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                  <Ionicons name="git-commit-outline" size={16} color="#1a73e8" style={{ marginRight: 6 }} />
                  <Text style={styles.featureTitle}>Quy tắc làm tròn số tiền</Text>
                </View>
                <Text style={styles.featureDesc}>Để dễ dàng trao đổi tiền lẻ ngoài đời, mọi số tiền lẻ phát sinh từ việc chia đều hoặc chia đôi thay người sẽ tự động được làm tròn đến bội số gần nhất của 1.000đ. Hệ thống tự động cân đối quỹ để đảm bảo tổng số tiền thay đổi của tất cả người chơi luôn bằng 0đ.</Text>
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