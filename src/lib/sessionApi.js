import AsyncStorage from '@react-native-async-storage/async-storage';
import { get, onValue, push, ref, set, update } from 'firebase/database';
import { calculateSettlement } from './bettingEngine';
import { db } from './firebaseConfig';

// Lấy hoặc tạo Device ID để định danh Host
export const getDeviceId = async () => {
  let deviceId = await AsyncStorage.getItem('device_id');
  if (!deviceId) {
    deviceId = 'dev_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    await AsyncStorage.setItem('device_id', deviceId);
  }
  return deviceId;
};

// Sinh mã PIN 4 số không trùng
const generateUniquePin = async () => {
  for (let i = 0; i < 20; i++) {
    const pin = Math.floor(1000 + Math.random() * 9000).toString();
    const snapshot = await get(ref(db, `sessions/${pin}`));
    if (!snapshot.exists()) return pin;
  }
  throw new Error('Không thể sinh mã PIN. Thử lại!');
};

// TẠO PHÒNG MỚI (Host)
export const createSession = async (hostName) => {
  const deviceId = await getDeviceId();
  const pin = await generateUniquePin();
  const now = Date.now();

  const sessionData = {
    meta: {
      hostId: deviceId,
      hostName: hostName,
      createdAt: now,
      fund: 0,
    },
    players: {},
    sets: {},
  };

  await set(ref(db, `sessions/${pin}`), sessionData);
  return { pin, deviceId };
};

// THAM GIA PHÒNG (Member)
export const joinSession = async (pin, memberName) => {
  const sessionRef = ref(db, `sessions/${pin}`);
  const snapshot = await get(sessionRef);

  if (!snapshot.exists()) {
    throw new Error('Phòng không tồn tại!');
  }

  const deviceId = await getDeviceId();
  const playerId = 'player_' + deviceId.slice(-6);

  // Thêm member vào danh sách người chơi (nếu chưa có)
  const playerRef = ref(db, `sessions/${pin}/players/${playerId}`);
  const playerSnap = await get(playerRef);
  if (!playerSnap.exists()) {
    await set(playerRef, {
      name: memberName,
      balance: 0,
    });
  }
  return { pin, playerId };
};

// LẮNG NGHE REALTIME (Cả Host và Member đều dùng)
export const subscribeToSession = (pin, callback) => {
  const sessionRef = ref(db, `sessions/${pin}`);
  const unsubscribe = onValue(sessionRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val());
    } else {
      callback(null); // Phòng bị xóa hoặc không tồn tại
    }
  });
  return unsubscribe;
};

// Bắt đầu set mới (Host)
export const startNewSet = async (pin, betAmount, previousTeams = null) => {
  const setsRef = ref(db, `sessions/${pin}/sets`);
  const snapshot = await get(setsRef);
  const setCount = snapshot.exists() ? Object.keys(snapshot.val()).length : 0;
  const setId = `set_${setCount + 1}`;

  await set(ref(db, `sessions/${pin}/sets/${setId}`), {
    status: 'playing',
    winner: null,
    betAmount: betAmount,
    teamA: previousTeams?.teamA || { slots: {} },
    teamB: previousTeams?.teamB || { slots: {} },
  });
  return setId;
};

// Cập nhật team (Thêm/Xóa người khỏi Team A/B)
export const updateSetTeams = async (pin, setId, teamA, teamB) => {
  await update(ref(db, `sessions/${pin}/sets/${setId}`), {
    teamA: teamA,
    teamB: teamB,
  });
};

// Kết thúc set (Host bấm Team A/B thắng)
export const finishSet = async (pin, setId, winner) => {
  const setRef = ref(db, `sessions/${pin}/sets/${setId}`);
  const setSnap = await get(setRef);
  const setData = setSnap.val();

  if (!setData || setData.status !== 'playing') return;

  // Truyền setData.betAmount vào hàm tính
  const { balanceChanges, fundAddition } = calculateSettlement(
    setData.teamA, setData.teamB, winner, setData.betAmount
  );

  const playersSnap = await get(ref(db, `sessions/${pin}/players`));
  const players = playersSnap.val() || {};
  const updates = {};

  Object.entries(balanceChanges).forEach(([pid, change]) => {
    const currentBalance = players[pid]?.balance || 0;
    updates[`players/${pid}/balance`] = currentBalance + change;
  });

  const metaSnap = await get(ref(db, `sessions/${pin}/meta`));
  updates[`meta/fund`] = (metaSnap.val()?.fund || 0) + fundAddition;
  updates[`sets/${setId}/status`] = 'completed';
  updates[`sets/${setId}/winner`] = winner;

  await update(ref(db, `sessions/${pin}`), updates);
};

// HOÀN TÁC set (Undo)
export const undoSet = async (pin, setId) => {
  const setRef = ref(db, `sessions/${pin}/sets/${setId}`);
  const setSnap = await get(setRef);
  const setData = setSnap.val();

  if (!setData || setData.status !== 'completed') return;

  const { balanceChanges, fundAddition } = calculateSettlement(
    setData.teamA, setData.teamB, setData.winner, setData.totalMoney
  );

  const playersSnap = await get(ref(db, `sessions/${pin}/players`));
  const players = playersSnap.val() || {};
  const updates = {};

  // Trừ ngược lại số tiền đã cộng
  Object.entries(balanceChanges).forEach(([pid, change]) => {
    const currentBalance = players[pid]?.balance || 0;
    updates[`players/${pid}/balance`] = currentBalance - change;
  });

  // Trừ ngược lại quỹ
  const metaSnap = await get(ref(db, `sessions/${pin}/meta`));
  updates[`meta/fund`] = (metaSnap.val()?.fund || 0) - fundAddition;

  // Đổi trạng thái về đang chơi
  updates[`sets/${setId}/status`] = 'playing';
  updates[`sets/${setId}/winner`] = null;

  await update(ref(db, `sessions/${pin}`), updates);
};

// Thêm người chơi thủ công (Dành cho Host)
export const addPlayerToSession = async (pin, playerName) => {
  const playersRef = ref(db, `sessions/${pin}/players`);
  const newPlayerRef = push(playersRef); // Tạo ID ngẫu nhiên cho người chơi mới
  await set(newPlayerRef, {
    name: playerName,
    balance: 0,
  });
  return newPlayerRef.key;
};

// Đánh dấu đã thanh toán / Hoàn tác thanh toán
export const togglePlayerSettled = async (pin, playerId, isSettled) => {
  const playerRef = ref(db, `sessions/${pin}/players/${playerId}`);
  await update(playerRef, { isSettled: isSettled });
};