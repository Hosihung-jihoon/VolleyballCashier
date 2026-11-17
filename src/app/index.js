import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useState } from 'react';
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
import { createSession, getPlayerRoster, savePlayerRoster } from '../lib/sessionApi';

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
  const [loading, setLoading] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [lastPin, setLastPin] = useState(null);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [installMode, setInstallMode] = useState(null); // 'prompt' | 'ios' | 'installed' | null
  const [offlineStatus, setOfflineStatus] = useState(null); // 'checking' | 'ready' | 'unsupported' | null
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [roster, setRoster] = useState([]);
  const [selectedRosterRows, setSelectedRosterRows] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState('');
  const [showRosterModal, setShowRosterModal] = useState(false);
  const [rosterDraft, setRosterDraft] = useState('');
  const [rosterDraftError, setRosterDraftError] = useState('');
  const [savingRoster, setSavingRoster] = useState(false);

  const loadRoster = useCallback(async () => {
    setRosterLoading(true);
    setRosterError('');
    try {
      const names = await getPlayerRoster();
      setRoster(names);
      setSelectedRosterRows(names.map((_, index) => index));
    } catch (e) {
      setRosterError(e.message || 'Không đọc được danh sách người chơi.');
    } finally {
      setRosterLoading(false);
    }
  }, []);

  useEffect(() => { loadRoster(); }, [loadRoster]);

  const toggleRosterRow = (index) => {
    setSelectedRosterRows(previous => previous.includes(index)
      ? previous.filter(value => value !== index)
      : [...previous, index]);
  };

  const openRosterEditor = () => {
    setRosterDraft(roster.join('\n'));
    setRosterDraftError('');
    setShowRosterModal(true);
  };

  const handleSaveRoster = async () => {
    if (savingRoster) return;
    setSavingRoster(true);
    setRosterDraftError('');
    try {
      const names = await savePlayerRoster(rosterDraft.split(/\r?\n/));
      setRoster(names);
      setSelectedRosterRows(names.map((_, index) => index));
      setShowRosterModal(false);
    } catch (e) {
      setRosterDraftError(e.message || 'Không lưu được danh sách. Hãy thử lại.');
    } finally {
      setSavingRoster(false);
    }
  };

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
    if (loading || rosterLoading || rosterError || savingRoster) return;
    setLoading(true);
    try {
      const names = roster.filter((_, index) => selectedRosterRows.includes(index));
      const { pin: newPin } = await createSession(names);
      router.push({ pathname: '/session', params: { pin: newPin, role: 'host' } });
    } catch (e) {
      showAlert('Lỗi', e.message);
    } finally {
      setLoading(false);
    }
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

  const handleCheckOtaUpdate = async () => {
    if (Platform.OS === 'web') return;
    if (__DEV__ || !Updates.isEnabled) {
      showAlert('Thông báo', 'OTA chỉ hoạt động trên bản APK/IPA đã build.');
      return;
    }
    setCheckingUpdate(true);
    try {
      const res = await Updates.checkForUpdateAsync();
      if (!res.isAvailable) {
        showAlert(
          'Đã là bản mới nhất',
          `Runtime: ${Updates.runtimeVersion || '1.0.0'}\nUpdate: ${Updates.updateId ? Updates.updateId.slice(0, 8) : 'embedded'}`
        );
      } else {
        await Updates.fetchUpdateAsync();
        Alert.alert(
          'Đã tải xong bản mới',
          'Bấm "Cập nhật ngay" để khởi động lại ứng dụng.',
          [
            { text: 'Để sau', style: 'cancel' },
            { text: 'Cập nhật ngay', onPress: () => Updates.reloadAsync().catch(() => {}) },
          ]
        );
      }
    } catch (e) {
      showAlert('Không kiểm tra được', 'Kiểm tra lại kết nối mạng: ' + (e?.message || ''));
    }
    setCheckingUpdate(false);
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
          <Text style={styles.inputLabel}>Danh sách người chơi mặc định</Text>
          <Text style={styles.rosterHint}>
            Chọn người tham gia buổi hôm nay, bỏ chọn người vắng. Khi chia đều tiền sân, tất cả người được chọn đều được tính tiền. Danh sách mặc định lưu trên thiết bị này.
          </Text>
          {rosterLoading ? (
            <Text style={styles.rosterHint}>Đang đọc danh sách...</Text>
          ) : rosterError ? (
            <View>
              <Text accessibilityRole="alert" style={styles.rosterError}>{rosterError}</Text>
              <Pressable accessibilityRole="button" style={styles.helpPill} onPress={loadRoster}>
                <Text style={styles.helpPillText}>Thử lại</Text>
              </Pressable>
            </View>
          ) : (
            <View>
              <View style={styles.rosterChips}>
                {roster.map((playerName, index) => {
                  const checked = selectedRosterRows.includes(index);
                  return (
                    <Pressable
                      key={index}
                      accessibilityRole="checkbox"
                      accessibilityLabel={`${playerName}, vị trí ${index + 1}`}
                      accessibilityState={{ checked, disabled: loading }}
                      aria-checked={checked}
                      disabled={loading}
                      onPress={() => toggleRosterRow(index)}
                      onKeyDown={Platform.OS === 'web' ? event => {
                        // ponytail: RN Web chỉ xử lý Space cho role=button; checkbox cần tự bắt phím này.
                        if (event.key === ' ') {
                          event.preventDefault();
                          if (!event.repeat && !loading) toggleRosterRow(index);
                        }
                      } : undefined}
                      style={[styles.rosterChip, checked && styles.rosterChipSelected]}
                    >
                      <Ionicons
                        name={checked ? 'checkbox-outline' : 'square-outline'}
                        size={18}
                        color={DuoTheme.colors.primaryDark}
                      />
                      <Text style={styles.installPillText}>{playerName}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {!roster.length && (
                <Text style={styles.rosterHint}>Chưa có danh sách. Nhập mỗi người một dòng để dùng lại ở các buổi sau.</Text>
              )}
              {!!roster.length && (
                <View style={styles.rosterActions}>
                  <Pressable accessibilityRole="button" style={styles.rosterSmallAction} disabled={loading} onPress={() => setSelectedRosterRows(roster.map((_, index) => index))}>
                    <Text style={styles.installPillText}>Chọn tất cả</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" style={styles.rosterSmallAction} disabled={loading} onPress={() => setSelectedRosterRows([])}>
                    <Text style={styles.installPillText}>Bỏ chọn tất cả</Text>
                  </Pressable>
                </View>
              )}
              <Pressable accessibilityRole="button" style={styles.helpPill} onPress={openRosterEditor} disabled={loading}>
                <Ionicons name="people-outline" size={18} color={DuoTheme.colors.primaryDark} />
                <Text style={styles.installPillText}>Chỉnh sửa danh sách</Text>
              </Pressable>
              <Text style={styles.rosterHint}>Đã chọn {selectedRosterRows.length}/{roster.length} người</Text>
            </View>
          )}

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
            accessibilityRole="button"
            disabled={loading || rosterLoading || !!rosterError || savingRoster}
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

          {Platform.OS !== 'web' && (
            <Pressable
              style={styles.installPill}
              onPress={handleCheckOtaUpdate}
              disabled={checkingUpdate}
            >
              <Ionicons name="refresh-circle-outline" size={18} color={DuoTheme.colors.primaryDark} />
              <Text style={styles.installPillText}>
                {checkingUpdate
                  ? 'Đang kiểm tra bản cập nhật...'
                  : `Kiểm tra cập nhật (${Updates.updateId ? Updates.updateId.slice(0, 8) : 'gốc'})`}
              </Text>
            </Pressable>
          )}

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

      <Modal
        visible={showRosterModal}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!savingRoster) setShowRosterModal(false); }}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            style={styles.modalContent}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <Text style={styles.modalTitle}>Danh sách người chơi mặc định</Text>
            <Text style={styles.rosterHint}>
              Mỗi dòng một người, tên không được trùng. Nếu hai người cùng tên, thêm biệt danh như An cao và An thấp. Chỉ dùng cho buổi mới.
            </Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <TextInput
                accessibilityLabel="Tên người chơi, mỗi dòng một người"
                multiline
                autoCorrect={false}
                textAlignVertical="top"
                style={[styles.input, styles.rosterTextArea]}
                placeholder={'Ví dụ:\nAn\nBình\nHùng'}
                placeholderTextColor={DuoTheme.colors.grayMuted}
                value={rosterDraft}
                editable={!savingRoster}
                onChangeText={setRosterDraft}
              />
              {!!rosterDraftError && (
                <Text accessibilityRole="alert" style={styles.rosterError}>{rosterDraftError}</Text>
              )}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              disabled={savingRoster}
              onPress={handleSaveRoster}
              style={[styles.actionBtn, styles.btnPrimary]}
            >
              <Text style={styles.btnTextPrimary}>{savingRoster ? 'Đang lưu...' : 'Lưu danh sách'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={savingRoster}
              onPress={() => setShowRosterModal(false)}
              style={styles.helpPill}
            >
              <Text style={styles.helpPillText}>Hủy</Text>
            </Pressable>
          </KeyboardAvoidingView>
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
  rosterHint: {
    color: DuoTheme.colors.grayText,
    fontSize: 13,
    lineHeight: 19,
    marginVertical: 10,
  },
  rosterChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rosterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
    borderRadius: DuoTheme.borderRadius.md,
  },
  rosterChipSelected: {
    backgroundColor: DuoTheme.colors.primaryLight,
    borderColor: DuoTheme.colors.primary,
  },
  rosterActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rosterSmallAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  rosterTextArea: {
    flex: 0,
    height: 180,
    minHeight: 140,
    width: '100%',
    borderWidth: 1,
    borderColor: DuoTheme.colors.borderDark,
    borderRadius: DuoTheme.borderRadius.md,
    padding: 12,
    marginBottom: 12,
  },
  rosterError: { color: DuoTheme.colors.red, fontSize: 13, marginVertical: 8 },
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
