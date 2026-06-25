import AsyncStorage from '@react-native-async-storage/async-storage';
import { get, onValue, push, ref, set, update } from 'firebase/database';
import { calculateSettlement } from './bettingEngine';
import { db } from './firebaseConfig';

// Pub/Sub cho offline mode
const localListeners = {};
const triggerLocalUpdate = async (pin, data) => {
  await AsyncStorage.setItem(`local_session_${pin}`, JSON.stringify(data));
  if (localListeners[pin]) {
    localListeners[pin].forEach(cb => cb(data));
  }
};

const getSessionData = async (pin) => {
  if (pin.startsWith('L-')) {
    const val = await AsyncStorage.getItem(`local_session_${pin}`);
    return val ? JSON.parse(val) : null;
  }
  const snap = await get(ref(db, `sessions/${pin}`));
  return snap.exists() ? snap.val() : null;
};

const saveSessionData = async (pin, data) => {
  if (pin.startsWith('L-')) {
    await triggerLocalUpdate(pin, data);
    return;
  }
  await set(ref(db, `sessions/${pin}`), data);
};

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
export const createSession = async (hostName, isOffline = false) => {
  const deviceId = await getDeviceId();
  const now = Date.now();

  const sessionData = {
    meta: {
      hostId: deviceId,
      hostName: hostName,
      createdAt: now,
      isOffline: isOffline
    },
    players: {},
    sets: {},
  };

  if (isOffline) {
    const pin = 'L-' + Math.floor(1000 + Math.random() * 9000).toString();
    await AsyncStorage.setItem(`local_session_${pin}`, JSON.stringify(sessionData));
    return { pin, deviceId };
  } else {
    const pin = await generateUniquePin();
    await set(ref(db, `sessions/${pin}`), sessionData);
    return { pin, deviceId };
  }
};

// THAM GIA PHÒNG (Member)
export const joinSession = async (pin, memberName) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session) {
      throw new Error('Phòng offline không tồn tại trên thiết bị này!');
    }
    const deviceId = await getDeviceId();
    const playerId = 'player_' + deviceId.slice(-6);

    if (!session.players) session.players = {};
    if (!session.players[playerId]) {
      session.players[playerId] = {
        name: memberName,
        balance: 0,
      };
      await saveSessionData(pin, session);
    }
    return { pin, playerId };
  }

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
  if (pin.startsWith('L-')) {
    if (!localListeners[pin]) {
      localListeners[pin] = [];
    }
    localListeners[pin].push(callback);

    // Đọc giá trị ban đầu bất đồng bộ và kiểm tra hạn sử dụng 24h
    getSessionData(pin).then(async (data) => {
      if (data && data.meta && data.meta.createdAt) {
        const ageMs = Date.now() - data.meta.createdAt;
        if (ageMs > 24 * 60 * 60 * 1000) {
          await AsyncStorage.removeItem(`local_session_${pin}`);
          callback(null);
          return;
        }
      }
      callback(data);
    });

    return () => {
      localListeners[pin] = localListeners[pin].filter(cb => cb !== callback);
    };
  }

  const sessionRef = ref(db, `sessions/${pin}`);
  const unsubscribe = onValue(sessionRef, async (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      if (data && data.meta && data.meta.createdAt) {
        const ageMs = Date.now() - data.meta.createdAt;
        if (ageMs > 24 * 60 * 60 * 1000) {
          // Xóa phòng online hết hạn
          await set(sessionRef, null);
          callback(null);
          return;
        }
      }
      callback(data);
    } else {
      callback(null); // Phòng bị xóa hoặc không tồn tại
    }
  });
  return unsubscribe;
};

// Bắt đầu set mới (Host)
export const startNewSet = async (pin, betAmount, previousTeams = null) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session) return null;
    const setCount = session.sets ? Object.keys(session.sets).length : 0;
    const setId = `set_${setCount + 1}`;

    if (!session.sets) session.sets = {};
    session.sets[setId] = {
      status: 'playing',
      winner: null,
      betAmount: betAmount,
      matchup: previousTeams?.matchup || 'A_B',
      playerBets: previousTeams?.playerBets || {},
      teamA: previousTeams?.teamA || { slots: {} },
      teamB: previousTeams?.teamB || { slots: {} },
      teamC: previousTeams?.teamC || { slots: {} },
    };
    await saveSessionData(pin, session);
    return setId;
  }

  const setsRef = ref(db, `sessions/${pin}/sets`);
  const snapshot = await get(setsRef);
  const setCount = snapshot.exists() ? Object.keys(snapshot.val()).length : 0;
  const setId = `set_${setCount + 1}`;

  await set(ref(db, `sessions/${pin}/sets/${setId}`), {
    status: 'playing',
    winner: null,
    betAmount: betAmount,
    matchup: previousTeams?.matchup || 'A_B',
    playerBets: previousTeams?.playerBets || {},
    teamA: previousTeams?.teamA || { slots: {} },
    teamB: previousTeams?.teamB || { slots: {} },
    teamC: previousTeams?.teamC || { slots: {} },
  });
  return setId;
};

// Cập nhật team (Thêm/Xóa người khỏi Team A/B/C)
export const updateSetTeams = async (pin, setId, teamA, teamB, teamC) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session || !session.sets || !session.sets[setId]) return;
    session.sets[setId].teamA = teamA;
    session.sets[setId].teamB = teamB;
    session.sets[setId].teamC = teamC || { slots: {} };
    await saveSessionData(pin, session);
    return;
  }

  await update(ref(db, `sessions/${pin}/sets/${setId}`), {
    teamA: teamA,
    teamB: teamB,
    teamC: teamC || { slots: {} },
  });
};

// Cập nhật tiền cược của set đang đấu
export const updateSetBetAmount = async (pin, setId, betAmount) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session || !session.sets || !session.sets[setId]) return;
    session.sets[setId].betAmount = betAmount;
    await saveSessionData(pin, session);
    return;
  }

  await update(ref(db, `sessions/${pin}/sets/${setId}`), {
    betAmount: betAmount,
  });
};

// Cập nhật matchup (Đội đấu)
export const updateMatchup = async (pin, setId, matchup) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session || !session.sets || !session.sets[setId]) return;
    session.sets[setId].matchup = matchup;
    await saveSessionData(pin, session);
    return;
  }

  await update(ref(db, `sessions/${pin}/sets/${setId}`), {
    matchup: matchup,
  });
};

// Cập nhật tiền cược của cá nhân trong set
export const updatePlayerBet = async (pin, setId, playerId, amount) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session || !session.sets || !session.sets[setId]) return;
    if (!session.sets[setId].playerBets) session.sets[setId].playerBets = {};
    if (amount === null || amount === undefined) {
      delete session.sets[setId].playerBets[playerId];
    } else {
      session.sets[setId].playerBets[playerId] = amount;
    }
    await saveSessionData(pin, session);
    return;
  }

  const pBetRef = ref(db, `sessions/${pin}/sets/${setId}/playerBets/${playerId}`);
  if (amount === null || amount === undefined) {
    await set(pBetRef, null);
  } else {
    await set(pBetRef, amount);
  }
};

// Kết thúc set (Host bấm Thắng)
export const finishSet = async (pin, setId, winner) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session || !session.sets || !session.sets[setId]) return;
    const setData = session.sets[setId];
    if (setData.status !== 'playing') return;

    const { balanceChanges } = calculateSettlement(
      setData.teamA, setData.teamB, setData.teamC, setData.matchup, winner, setData.betAmount, setData.playerBets
    );

    if (!session.players) session.players = {};
    Object.entries(balanceChanges).forEach(([pid, change]) => {
      if (session.players[pid]) {
        const currentBalance = session.players[pid].balance || 0;
        session.players[pid].balance = currentBalance + change;
      }
    });

    session.sets[setId].status = 'completed';
    session.sets[setId].winner = winner;

    await saveSessionData(pin, session);
    return;
  }

  const setRef = ref(db, `sessions/${pin}/sets/${setId}`);
  const setSnap = await get(setRef);
  const setData = setSnap.val();

  if (!setData || setData.status !== 'playing') return;

  const { balanceChanges } = calculateSettlement(
    setData.teamA, setData.teamB, setData.teamC, setData.matchup, winner, setData.betAmount, setData.playerBets
  );

  const playersSnap = await get(ref(db, `sessions/${pin}/players`));
  const players = playersSnap.val() || {};
  const updates = {};

  Object.entries(balanceChanges).forEach(([pid, change]) => {
    if (players[pid]) {
      const currentBalance = players[pid].balance || 0;
      updates[`players/${pid}/balance`] = currentBalance + change;
    }
  });

  updates[`sets/${setId}/status`] = 'completed';
  updates[`sets/${setId}/winner`] = winner;

  await update(ref(db, `sessions/${pin}`), updates);
};

// HOÀN TÁC set (Undo)
export const undoSet = async (pin, setId) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session || !session.sets || !session.sets[setId]) return;
    const setData = session.sets[setId];
    if (setData.status !== 'completed') return;

    const { balanceChanges } = calculateSettlement(
      setData.teamA, setData.teamB, setData.teamC, setData.matchup, setData.winner, setData.betAmount, setData.playerBets
    );

    if (!session.players) session.players = {};
    Object.entries(balanceChanges).forEach(([pid, change]) => {
      if (session.players[pid]) {
        const currentBalance = session.players[pid].balance || 0;
        session.players[pid].balance = currentBalance - change;
      }
    });

    session.sets[setId].status = 'playing';
    session.sets[setId].winner = null;

    await saveSessionData(pin, session);
    return;
  }

  const setRef = ref(db, `sessions/${pin}/sets/${setId}`);
  const setSnap = await get(setRef);
  const setData = setSnap.val();

  if (!setData || setData.status !== 'completed') return;

  const { balanceChanges } = calculateSettlement(
    setData.teamA, setData.teamB, setData.teamC, setData.matchup, setData.winner, setData.betAmount, setData.playerBets
  );

  const playersSnap = await get(ref(db, `sessions/${pin}/players`));
  const players = playersSnap.val() || {};
  const updates = {};

  Object.entries(balanceChanges).forEach(([pid, change]) => {
    if (players[pid]) {
      const currentBalance = players[pid].balance || 0;
      updates[`players/${pid}/balance`] = currentBalance - change;
    }
  });

  updates[`sets/${setId}/status`] = 'playing';
  updates[`sets/${setId}/winner`] = null;

  await update(ref(db, `sessions/${pin}`), updates);
};

// Thêm người chơi thủ công (Dành cho Host)
export const addPlayerToSession = async (pin, playerName) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session) return null;
    if (!session.players) session.players = {};
    const newPlayerId = 'player_local_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    session.players[newPlayerId] = {
      name: playerName,
      balance: 0,
    };
    await saveSessionData(pin, session);
    return newPlayerId;
  }

  const playersRef = ref(db, `sessions/${pin}/players`);
  const newPlayerRef = push(playersRef);
  await set(newPlayerRef, {
    name: playerName,
    balance: 0,
  });
  return newPlayerRef.key;
};

// Đánh dấu đã thanh toán / Hoàn tác thanh toán
export const togglePlayerSettled = async (pin, playerId, isSettled) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session || !session.players || !session.players[playerId]) return;
    session.players[playerId].isSettled = isSettled;
    await saveSessionData(pin, session);
    return;
  }

  const playerRef = ref(db, `sessions/${pin}/players/${playerId}`);
  await update(playerRef, { isSettled: isSettled });
};