import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { DuoTheme } from '../constants/theme';
import { createSession } from '../lib/sessionApi';

const showAlert = (title, message, buttons = []) => {
  if (Platform.OS === 'web') {
    if (buttons && buttons.length > 0) {
      const confirmButton = buttons.find(b => b.text === 'Đúng' || b.text === 'OK') || buttons[buttons.length - 1];
      const hasCancel = buttons.some(b => b.text === 'Hủy' || b.text === 'Cancel');
      if (hasCancel) {
        const result = window.confirm(`${title}\n\n${message}`);
        if (result && confirmButton?.onPress) confirmButton.onPress();
        else {
          const cancelButton = buttons.find(b => b.text === 'Hủy' || b.text === 'Cancel');
          if (cancelButton?.onPress) cancelButton.onPress();
        }
      } else {
        window.alert(`${title}\n\n${message}`);
        if (confirmButton?.onPress) confirmButton.onPress();
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
  const [loading, setLoading] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [lastPin, setLastPin] = useState(null);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [installMode, setInstallMode] = useState(null); // 'prompt' | 'ios' | 'installed' | null
  const [offlineStatus, setOfflineStatus] = useState(null); // 'checking' | 'ready' | 'unsupported' | null

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || typeof caches === 'undefined') {
      setOfflineStatus('unsupported');
      return;
    }

    let cancelled = false;
    let timer = null;
    setOfflineStatus('checking');

    const checkCacheReady = async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const keys = await caches.keys();
        const pwaKey = keys.find((k) => k.startsWith('vc-pwa-'));
        if (pwaKey) {
          const cache = await caches.open(pwaKey);
          const hasRoot = (await cache.match('/')) || (await cache.match('/index.html'));
          if (!cancelled && reg?.active && hasRoot) {
            setOfflineStatus('ready');
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
          }
        }
      } catch (_e) {}
    };

    checkCacheReady();
    timer = setInterval(checkCacheReady, 1500);
    navigator.serviceWorker.addEventListener('controllerchange', checkCacheReady);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', checkCacheReady);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.navigator?.standalone === true;

    if (isStandalone) {
      setInstallMode('installed');
      return;
    }

    const ua = window.navigator?.userAgent || '';
    if (/iphone|ipad|ipod/i.test(ua)) {
      setInstallMode('ios');
    }

    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPromptEvent(e);
      setInstallMode('prompt');
    };
    const handleAppInstalled = () => {
      setInstallPromptEvent(null);
      setInstallMode('installed');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    const checkLastSession = async () => {
      try {
        const savedName = await AsyncStorage.getItem('saved_user_name');
        if (savedName) setName(savedName);

        const pinVal = await AsyncStorage.getItem('last_session_pin');
        if (pinVal) {
          setLastPin(pinVal);
        }

        // Dọn dẹp phòng offline quá 24h
        const keys = await AsyncStorage.getAllKeys();
        const localSessionKeys = keys.filter(k => k.startsWith('local_session_'));
        for (const key of localSessionKeys) {
          const dataStr = await AsyncStorage.getItem(key);
          if (dataStr) {
            try {
              const parsed = JSON.parse(dataStr);
              const created = parsed?.meta?.createdAt || parsed?.createdAt;
              if (created && Date.now() - created > 24 * 60 * 60 * 1000) {
                await AsyncStorage.removeItem(key);
              }
            } catch (_e) {
              await AsyncStorage.removeItem(key);
            }
          }
        }
      } catch (_e) {
        // ignore
      }
    };
    checkLastSession();
  }, []);

  const handleResume = () => {
    if (lastPin) {
      router.push({ pathname: '/session', params: { pin: lastPin, role: 'host' } });
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      showAlert('Lỗi', 'Vui lòng nhập tên của bạn!');
      return;
    }
    setLoading(true);
    try {
      await AsyncStorage.setItem('saved_user_name', name.trim());
      const { pin: newPin } = await createSession(name.trim());
      router.push({ pathname: '/session', params: { pin: newPin, role: 'host' } });
    } catch (e) {
      showAlert('Lỗi', e.message);
    }
    setLoading(false);
  };

  const handleInstallPwa = async () => {
    if (installMode === 'prompt' && installPromptEvent) {
      installPromptEvent.prompt();
      const choice = await installPromptEvent.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') {
        setInstallPromptEvent(null);
        setInstallMode('installed');
      }
      return;
    }
    if (installMode === 'ios') {
      showAlert(
        'Cài đặt dùng Offline (iPhone / iPad)',
        '1. Đợi dòng trạng thái bên dưới báo "Đã lưu offline".\n2. Bấm Chia sẻ (Share) trên Safari ➔ "Thêm vào MH chính".\n3. Mở icon vừa tạo trên màn hình chính 1 lần khi còn mạng để iOS kích hoạt bộ nhớ offline riêng.'
      );
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Brand Header */}
        <View style={styles.brandSection}>
          <View style={styles.logoBadge}>
            <Ionicons name="tennisball-outline" size={42} color="#FFFFFF" />
          </View>
          <Text style={styles.brandTitle}>SỔ KÈO BÓNG CHUYỀN</Text>
          <Text style={styles.brandSubtitle}>Ghi chép set đấu & chốt tiền thông minh</Text>
        </View>

        {/* Input Card Container */}
        <View style={styles.cardContainer}>
          <Text style={styles.inputLabel}>Người quản lý / Chủ xị</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="person-outline" size={20} color={DuoTheme.colors.primary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Nhập tên người quản lý..."
              placeholderTextColor={DuoTheme.colors.grayMuted}
              value={name}
              onChangeText={setName}
            />
          </View>

          {/* Action Buttons */}
          {lastPin && (
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                styles.btnResume,
                pressed && styles.btnPressed,
              ]}
              onPress={handleResume}
              disabled={loading}
            >
              <View style={styles.btnContent}>
                <Ionicons name="play-circle-outline" size={22} color={DuoTheme.colors.yellowDark} style={styles.btnIcon} />
                <Text style={styles.btnTextResume}>Tiếp tục buổi chơi</Text>
              </View>
            </Pressable>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              styles.btnPrimary,
              pressed && styles.btnPressed,
            ]}
            onPress={handleCreate}
            disabled={loading}
          >
            <View style={styles.btnContent}>
              <Ionicons name="add-circle" size={20} color="#FFFFFF" style={styles.btnIcon} />
              <Text style={styles.btnTextPrimary}>BẮT ĐẦU BUỔI CHƠI MỚI</Text>
            </View>
          </Pressable>

          <Pressable
            style={styles.helpPill}
            onPress={() => setShowHelpModal(true)}
          >
            <Ionicons name="help-circle-outline" size={18} color={DuoTheme.colors.grayText} />
            <Text style={styles.helpPillText}>Hướng dẫn luật chơi & tính năng</Text>
          </Pressable>

          {Platform.OS === 'web' && (installMode === 'prompt' || installMode === 'ios') && (
            <Pressable style={styles.installPill} onPress={handleInstallPwa}>
              <Ionicons name="download-outline" size={18} color={DuoTheme.colors.primaryDark} />
              <Text style={styles.installPillText}>
                {installMode === 'prompt'
                  ? 'Cài đặt ứng dụng để dùng offline'
                  : 'Hướng dẫn tạo lối tắt dùng offline (iOS)'}
              </Text>
            </Pressable>
          )}

          {Platform.OS === 'web' && offlineStatus && (
            <View style={styles.offlineBadgeRow}>
              <Ionicons
                name={
                  offlineStatus === 'ready'
                    ? 'cloud-done-outline'
                    : offlineStatus === 'unsupported'
                      ? 'warning-outline'
                      : 'cloud-download-outline'
                }
                size={14}
                color={
                  offlineStatus === 'ready'
                    ? DuoTheme.colors.primaryGreen
                    : offlineStatus === 'unsupported'
                      ? DuoTheme.colors.yellowDark
                      : DuoTheme.colors.grayText
                }
              />
              <Text
                style={[
                  styles.offlineBadgeText,
                  offlineStatus === 'ready' && styles.offlineBadgeTextReady,
                  offlineStatus === 'unsupported' && styles.offlineBadgeTextWarn,
                ]}
              >
                {offlineStatus === 'ready'
                  ? 'Đã lưu offline • Mở lại không cần mạng'
                  : offlineStatus === 'unsupported'
                    ? 'Cần mở qua HTTPS để lưu dùng offline'
                    : 'Đang tải gói dùng offline...'}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Modal Hướng dẫn chuẩn Sports-Fintech */}
      <Modal
        visible={showHelpModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowHelpModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderBadge}>
                <Ionicons name="book-outline" size={24} color={DuoTheme.colors.primary} />
              </View>
              <Text style={styles.modalTitle}>Cẩm Nang Trận Đấu</Text>
              <Text style={styles.modalSubtitle}>Quy tắc chia tiền & tính năng tự động</Text>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {/* Card 1: Mục đích */}
              <View style={[styles.guideCard, { borderLeftColor: DuoTheme.colors.primary }]}>
                <View style={styles.guideCardHeader}>
                  <Ionicons name="trophy-outline" size={18} color={DuoTheme.colors.primary} style={{ marginRight: 8 }} />
                  <Text style={styles.guideCardTitle}>Mục đích của App</Text>
                </View>
                <Text style={styles.guideCardDesc}>
                  Tự động ghi nhận set đấu, phân chia số tiền thắng/thua minh bạch theo từng slot thi đấu và người dự bị.
                </Text>
              </View>

              {/* Card 2: Quy tắc tính tiền */}
              <View style={[styles.guideCard, { borderLeftColor: DuoTheme.colors.green }]}>
                <View style={styles.guideCardHeader}>
                  <Ionicons name="cash-outline" size={18} color={DuoTheme.colors.green} style={{ marginRight: 8 }} />
                  <Text style={styles.guideCardTitle}>Quy tắc Thắng / Thua</Text>
                </View>
                <Text style={styles.guideCardDesc}>
                  • Mỗi người thua trả theo mức cược (mặc định 5.000đ/suất).{Platform.OS === 'web' ? '\n' : '\n'}
                  • Kèo lệch người (4 vs 5): bên 4 người có thể chọn 1 người &quot;Gánh 2 suất (10.000đ)&quot; để tròn tiền 25k vs 25k.{Platform.OS === 'web' ? '\n' : '\n'}
                  • Tiền sân cuối buổi làm tròn lên 1.000đ theo đầu người, phần dôi ra được giữ lại làm &quot;Tiền thừa buổi chơi&quot;.
                </Text>
              </View>

              {/* Card 3: Thay người giữa trận */}
              <View style={[styles.guideCard, { borderLeftColor: DuoTheme.colors.orange }]}>
                <View style={styles.guideCardHeader}>
                  <Ionicons name="swap-horizontal-outline" size={18} color={DuoTheme.colors.orange} style={{ marginRight: 8 }} />
                  <Text style={styles.guideCardTitle}>Cơ chế Thay người (Sub Slot)</Text>
                </View>
                <Text style={styles.guideCardDesc}>
                  1 Slot = 1 Đơn vị tiền. Khi 2 người chia sẻ 1 slot thay người, tiền thắng hoặc thua của slot đó được chia đôi 50/50 cực kỳ sòng phẳng!
                </Text>
              </View>

              {/* Card 4: Hoàn tác & Chốt sổ */}
              <View style={[styles.guideCard, { borderLeftColor: DuoTheme.colors.purple }]}>
                <View style={styles.guideCardHeader}>
                  <Ionicons name="receipt-outline" size={18} color={DuoTheme.colors.purple} style={{ marginRight: 8 }} />
                  <Text style={styles.guideCardTitle}>Chốt sổ & Tiền sân</Text>
                </View>
                <Text style={styles.guideCardDesc}>
                  Dễ dàng chỉnh sửa đội thắng set đấu cũ ngay trong Lịch sử. Cuối buổi nhập tiền sân để chia đều hoặc chia theo số set đã đấu.
                </Text>
              </View>
            </ScrollView>

            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                styles.btnPrimary,
                pressed && styles.btnPressed,
                { marginTop: 16 },
              ]}
              onPress={() => setShowHelpModal(false)}
            >
              <Text style={styles.btnTextPrimary}>ĐÃ HIỂU LUẬT CHƠI</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DuoTheme.colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 36,
  },
  brandSection: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logoBadge: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: DuoTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    ...DuoTheme.shadows.button,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: DuoTheme.colors.grayDark,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  brandSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: DuoTheme.colors.grayText,
    marginTop: 6,
  },
  cardContainer: {
    backgroundColor: DuoTheme.colors.card,
    borderRadius: DuoTheme.borderRadius.lg,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
    padding: 22,
    ...DuoTheme.shadows.card,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: DuoTheme.colors.grayDark,
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: DuoTheme.colors.borderDark,
    borderRadius: DuoTheme.borderRadius.md,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 50,
    fontSize: 15,
    fontWeight: '600',
    color: DuoTheme.colors.grayDark,
  },

  /* Buttons */
  actionBtn: {
    borderRadius: DuoTheme.borderRadius.md,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnIcon: {
    marginRight: 8,
  },
  btnPrimary: {
    backgroundColor: DuoTheme.colors.primary,
    ...DuoTheme.shadows.button,
  },
  btnResume: {
    backgroundColor: DuoTheme.colors.yellowLight,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  btnTextPrimary: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  btnTextResume: {
    color: '#92400E',
    fontSize: 15,
    fontWeight: '700',
  },
  helpPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 4,
    borderRadius: DuoTheme.borderRadius.full,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
  },
  helpPillText: {
    color: DuoTheme.colors.grayText,
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 6,
  },
  installPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    marginTop: 8,
    borderRadius: DuoTheme.borderRadius.full,
    backgroundColor: DuoTheme.colors.primaryLight,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  installPillText: {
    color: DuoTheme.colors.primaryDark,
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 6,
  },
  offlineBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  offlineBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: DuoTheme.colors.grayText,
    marginLeft: 5,
  },
  offlineBadgeTextReady: {
    color: DuoTheme.colors.primaryGreen,
  },
  offlineBadgeTextWarn: {
    color: DuoTheme.colors.yellowDark,
  },

  /* Modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    borderRadius: DuoTheme.borderRadius.lg,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
    padding: 22,
    ...DuoTheme.shadows.card,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  modalHeaderBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: DuoTheme.colors.primaryLight,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: DuoTheme.colors.grayDark,
  },
  modalSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: DuoTheme.colors.grayText,
    marginTop: 3,
  },
  modalScroll: {
    marginVertical: 4,
  },
  guideCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: DuoTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
    borderLeftWidth: 4,
    padding: 12,
    marginBottom: 10,
  },
  guideCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  guideCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: DuoTheme.colors.grayDark,
  },
  guideCardDesc: {
    fontSize: 13,
    fontWeight: '400',
    color: DuoTheme.colors.grayText,
    lineHeight: 19,
  },
});
