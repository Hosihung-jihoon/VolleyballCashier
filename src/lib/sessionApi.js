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
      isOffline: isOffline,
      teams: ['teamA', 'teamB', 'teamC']
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

    const teamsList = session.meta?.teams || ['teamA', 'teamB', 'teamC'];
    const teamsData = {};
    teamsList.forEach(t => {
      const letter = t.replace('team', '');
      teamsData[t] = {
        name: `Team ${letter}`,
        slots: previousTeams?.teams?.[t]?.slots || previousTeams?.[t]?.slots || {}
      };
    });

    if (!session.sets) session.sets = {};
    session.sets[setId] = {
      status: 'playing',
      winner: null,
      betAmount: betAmount,
      matchup: previousTeams?.matchup || 'teamA_teamB',
      playerBets: previousTeams?.playerBets || {},
      teams: teamsData,
      createdAt: Date.now(),
      // legacy fields
      teamA: teamsData.teamA || { slots: {} },
      teamB: teamsData.teamB || { slots: {} },
      teamC: teamsData.teamC || { slots: {} },
    };
    await saveSessionData(pin, session);
    return setId;
  }

  const sessionRef = ref(db, `sessions/${pin}`);
  const sessionSnap = await get(sessionRef);
  const session = sessionSnap.val() || {};
  const setCount = session.sets ? Object.keys(session.sets).length : 0;
  const setId = `set_${setCount + 1}`;

  const teamsList = session.meta?.teams || ['teamA', 'teamB', 'teamC'];
  const teamsData = {};
  teamsList.forEach(t => {
    const letter = t.replace('team', '');
    teamsData[t] = {
      name: `Team ${letter}`,
      slots: previousTeams?.teams?.[t]?.slots || previousTeams?.[t]?.slots || {}
    };
  });

  await set(ref(db, `sessions/${pin}/sets/${setId}`), {
    status: 'playing',
    winner: null,
    betAmount: betAmount,
    matchup: previousTeams?.matchup || 'teamA_teamB',
    playerBets: previousTeams?.playerBets || {},
    teams: teamsData,
    createdAt: Date.now(),
    // legacy fields
    teamA: teamsData.teamA || { slots: {} },
    teamB: teamsData.teamB || { slots: {} },
    teamC: teamsData.teamC || { slots: {} },
  });
  return setId;
};

// Cập nhật team (Thêm/Xóa người khỏi Team)
export const updateSetTeams = async (pin, setId, teams) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session || !session.sets || !session.sets[setId]) return;
    session.sets[setId].teams = teams;
    // Set legacy fields for compatibility
    if (teams.teamA) session.sets[setId].teamA = teams.teamA;
    if (teams.teamB) session.sets[setId].teamB = teams.teamB;
    if (teams.teamC) session.sets[setId].teamC = teams.teamC;
    await saveSessionData(pin, session);
    return;
  }

  const updates = { teams: teams };
  if (teams.teamA) updates.teamA = teams.teamA;
  if (teams.teamB) updates.teamB = teams.teamB;
  if (teams.teamC) updates.teamC = teams.teamC;
  await update(ref(db, `sessions/${pin}/sets/${setId}`), updates);
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
      setData.teams || { teamA: setData.teamA, teamB: setData.teamB, teamC: setData.teamC },
      setData.matchup,
      winner,
      setData.betAmount,
      setData.playerBets
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
    session.sets[setId].completedAt = Date.now();

    await saveSessionData(pin, session);
    return;
  }

  const setRef = ref(db, `sessions/${pin}/sets/${setId}`);
  const setSnap = await get(setRef);
  const setData = setSnap.val();

  if (!setData || setData.status !== 'playing') return;

  const { balanceChanges } = calculateSettlement(
    setData.teams || { teamA: setData.teamA, teamB: setData.teamB, teamC: setData.teamC },
    setData.matchup,
    winner,
    setData.betAmount,
    setData.playerBets
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
  updates[`sets/${setId}/completedAt`] = Date.now();

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
      setData.teams || { teamA: setData.teamA, teamB: setData.teamB, teamC: setData.teamC },
      setData.matchup,
      setData.winner,
      setData.betAmount,
      setData.playerBets
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
    session.sets[setId].completedAt = null;

    await saveSessionData(pin, session);
    return;
  }

  const setRef = ref(db, `sessions/${pin}/sets/${setId}`);
  const setSnap = await get(setRef);
  const setData = setSnap.val();

  if (!setData || setData.status !== 'completed') return;

  const { balanceChanges } = calculateSettlement(
    setData.teams || { teamA: setData.teamA, teamB: setData.teamB, teamC: setData.teamC },
    setData.matchup,
    setData.winner,
    setData.betAmount,
    setData.playerBets
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
  updates[`sets/${setId}/completedAt`] = null;

  await update(ref(db, `sessions/${pin}`), updates);
};

// Thêm Đội mới (Dành cho Host)
export const addTeamToSession = async (pin, setId) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session) return null;
    if (!session.meta.teams) session.meta.teams = ['teamA', 'teamB', 'teamC'];
    
    let nextLetter = 'A';
    for (let i = 0; i < 26; i++) {
      const char = String.fromCharCode(65 + i);
      const key = `team${char}`;
      if (!session.meta.teams.includes(key)) {
        nextLetter = char;
        break;
      }
    }
    const nextTeamKey = `team${nextLetter}`;
    
    session.meta.teams.push(nextTeamKey);
    session.meta.teams.sort();
    
    if (session.sets && session.sets[setId]) {
      const setData = session.sets[setId];
      if (!setData.teams) {
        setData.teams = {
          teamA: setData.teamA || { slots: {} },
          teamB: setData.teamB || { slots: {} },
          teamC: setData.teamC || { slots: {} }
        };
      }
      setData.teams[nextTeamKey] = { name: `Team ${nextLetter}`, slots: {} };
      setData[nextTeamKey] = { slots: {} }; // legacy
    }
    
    await saveSessionData(pin, session);
    return nextTeamKey;
  }

  const metaRef = ref(db, `sessions/${pin}/meta`);
  const metaSnap = await get(metaRef);
  let currentTeams = ['teamA', 'teamB', 'teamC'];
  if (metaSnap.exists() && metaSnap.val().teams) {
    currentTeams = metaSnap.val().teams;
  }
  
  let nextLetter = 'A';
  for (let i = 0; i < 26; i++) {
    const char = String.fromCharCode(65 + i);
    const key = `team${char}`;
    if (!currentTeams.includes(key)) {
      nextLetter = char;
      break;
    }
  }
  const nextTeamKey = `team${nextLetter}`;
  const updatedTeams = [...currentTeams, nextTeamKey];
  updatedTeams.sort();

  const updates = {};
  updates[`meta/teams`] = updatedTeams;
  
  if (setId) {
    const setRef = ref(db, `sessions/${pin}/sets/${setId}`);
    const setSnap = await get(setRef);
    if (setSnap.exists()) {
      const setData = setSnap.val();
      if (setData.status === 'playing') {
        updates[`sets/${setId}/teams/${nextTeamKey}`] = { name: `Team ${nextLetter}`, slots: {} };
        updates[`sets/${setId}/${nextTeamKey}`] = { slots: {} }; // legacy
      }
    }
  }
  
  await update(ref(db, `sessions/${pin}`), updates);
  return nextTeamKey;
};

// Xóa Đội (Dành cho Host)
export const deleteTeamFromSession = async (pin, setId, teamKey) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session) return false;
    if (!session.meta.teams) return false;
    
    session.meta.teams = session.meta.teams.filter(t => t !== teamKey);
    
    if (session.sets && session.sets[setId]) {
      const setData = session.sets[setId];
      if (setData.teams) {
        delete setData.teams[teamKey];
      }
      delete setData[teamKey]; // legacy
    }
    
    if (session.sideMatches) {
      Object.keys(session.sideMatches).forEach(sideMatchId => {
        const sideMatch = session.sideMatches[sideMatchId];
        if (sideMatch.sets) {
          Object.keys(sideMatch.sets).forEach(sSetId => {
            const sSetData = sideMatch.sets[sSetId];
            if (sSetData.status === 'playing') {
              if (sSetData.teams) {
                delete sSetData.teams[teamKey];
              }
              delete sSetData[teamKey]; // legacy
            }
          });
        }
      });
    }

    await saveSessionData(pin, session);
    return true;
  }

  const metaRef = ref(db, `sessions/${pin}/meta`);
  const metaSnap = await get(metaRef);
  if (!metaSnap.exists() || !metaSnap.val().teams) return false;
  const currentTeams = metaSnap.val().teams;
  const updatedTeams = currentTeams.filter(t => t !== teamKey);

  const updates = {};
  updates[`meta/teams`] = updatedTeams;

  if (setId) {
    updates[`sets/${setId}/teams/${teamKey}`] = null;
    updates[`sets/${setId}/${teamKey}`] = null; // legacy
  }

  const sessionRef = ref(db, `sessions/${pin}`);
  const sessionSnap = await get(sessionRef);
  if (sessionSnap.exists()) {
    const sessionData = sessionSnap.val();
    if (sessionData.sideMatches) {
      Object.keys(sessionData.sideMatches).forEach(sideMatchId => {
        const sideMatch = sessionData.sideMatches[sideMatchId];
        if (sideMatch.sets) {
          Object.keys(sideMatch.sets).forEach(sSetId => {
            const sSetData = sideMatch.sets[sSetId];
            if (sSetData.status === 'playing') {
              updates[`sideMatches/${sideMatchId}/sets/${sSetId}/teams/${teamKey}`] = null;
              updates[`sideMatches/${sideMatchId}/sets/${sSetId}/${teamKey}`] = null; // legacy
            }
          });
        }
      });
    }
  }

  await update(ref(db, `sessions/${pin}`), updates);
  return true;
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

// Kết thúc buổi chơi và chia tiền sân
export const finishSession = async (pin, totalCourtFee, splitMethod) => {
  const session = await getSessionData(pin);
  if (!session || !session.players) return;

  const players = session.players;
  const playerIds = Object.keys(players);
  if (playerIds.length === 0) return;

  const shares = {};

  if (splitMethod === 'proportional') {
    // Đếm số set đã chơi của mỗi người chơi
    const sets = session.sets || {};
    const setsPlayed = {};
    playerIds.forEach(pid => {
      setsPlayed[pid] = 0;
    });

    Object.values(sets).forEach(s => {
      if (s.status !== 'completed') return;
      const teams = s.teams || { teamA: s.teamA, teamB: s.teamB, teamC: s.teamC };
      const pidsInSet = new Set();
      Object.values(teams).forEach(team => {
        if (team && team.slots) {
          Object.values(team.slots).forEach(slotPids => {
            if (Array.isArray(slotPids)) {
              slotPids.forEach(pid => pidsInSet.add(pid));
            }
          });
        }
      });
      pidsInSet.forEach(pid => {
        if (setsPlayed[pid] !== undefined) {
          setsPlayed[pid]++;
        }
      });
    });

    const sideSets = session.sideSets || {};
    Object.values(sideSets).forEach(s => {
      if (s.status !== 'completed') return;
      const teams = s.teams || { teamA: s.teamA, teamB: s.teamB };
      const pidsInSet = new Set();
      Object.values(teams).forEach(team => {
        if (team && team.slots) {
          Object.values(team.slots).forEach(slotPids => {
            if (Array.isArray(slotPids)) {
              slotPids.forEach(pid => pidsInSet.add(pid));
            }
          });
        }
      });
      pidsInSet.forEach(pid => {
        if (setsPlayed[pid] !== undefined) {
          setsPlayed[pid]++;
        }
      });
    });

    const totalSetsPlayed = Object.values(setsPlayed).reduce((sum, count) => sum + count, 0);

    if (totalSetsPlayed === 0) {
      // Fallback về chia đều nếu chưa có ai chơi set nào
      const rawShare = totalCourtFee / playerIds.length;
      const roundedShare = Math.round(rawShare / 1000) * 1000;
      playerIds.forEach(pid => {
        shares[pid] = roundedShare;
      });
    } else {
      playerIds.forEach(pid => {
        const rawShare = totalCourtFee * (setsPlayed[pid] / totalSetsPlayed);
        shares[pid] = Math.round(rawShare / 1000) * 1000;
      });
    }
  } else {
    // Chia đều
    const rawShare = totalCourtFee / playerIds.length;
    const roundedShare = Math.round(rawShare / 1000) * 1000;
    playerIds.forEach(pid => {
      shares[pid] = roundedShare;
    });
  }

  // Bù trừ sai số làm tròn vào người có số set chơi nhiều nhất hoặc người đầu tiên
  let sumShares = Object.values(shares).reduce((sum, val) => sum + val, 0);
  let diff = totalCourtFee - sumShares;
  if (diff !== 0) {
    let bestPid = playerIds[0];
    let maxShare = shares[bestPid];
    playerIds.forEach(pid => {
      if (shares[pid] > maxShare) {
        maxShare = shares[pid];
        bestPid = pid;
      }
    });
    shares[bestPid] += diff;
  }

  // Trừ tiền sân vào balance
  playerIds.forEach(pid => {
    players[pid].balance = (players[pid].balance || 0) - shares[pid];
  });

  if (!session.meta) session.meta = {};
  session.meta.status = 'finished';
  session.courtFee = {
    total: totalCourtFee,
    splitMethod: splitMethod,
    shares: shares,
  };

  await saveSessionData(pin, session);
};

// Hoàn tác kết thúc buổi chơi
export const undoFinishSession = async (pin) => {
  const session = await getSessionData(pin);
  if (!session || !session.courtFee || !session.players) return;

  const players = session.players;
  const shares = session.courtFee.shares || {};

  Object.entries(shares).forEach(([pid, share]) => {
    if (players[pid]) {
      players[pid].balance = (players[pid].balance || 0) + share;
    }
  });

  if (session.meta) {
    session.meta.status = 'active';
  }
  delete session.courtFee;

  await saveSessionData(pin, session);
};

// Thêm kèo phụ mới
export const addSideMatch = async (pin, name, betAmount) => {
  const sideMatchId = 'sidematch_' + Date.now();
  const session = await getSessionData(pin);
  if (!session) return null;

  if (!session.sideMatches) session.sideMatches = {};
  session.sideMatches[sideMatchId] = {
    id: sideMatchId,
    name: name,
    betAmount: betAmount,
    createdAt: Date.now()
  };

  await saveSessionData(pin, session);

  // Tự động tạo set đấu đầu tiên cho kèo phụ này
  await startNewSideSet(pin, betAmount, sideMatchId);

  return sideMatchId;
};

// Xóa kèo phụ và tất cả các set liên quan
export const deleteSideMatch = async (pin, sideMatchId) => {
  const session = await getSessionData(pin);
  if (!session) return;
  const players = session.players || {};

  // Hoàn trả balance cho tất cả các set đã hoàn thành của kèo phụ này
  if (session.sideSets) {
    Object.entries(session.sideSets).forEach(([setId, s]) => {
      if (s.sideMatchId === sideMatchId) {
        if (s.status === 'completed' && s.balanceChanges) {
          Object.entries(s.balanceChanges).forEach(([pid, change]) => {
            if (players[pid]) {
              players[pid].balance = (players[pid].balance || 0) - change;
            }
          });
        }
        delete session.sideSets[setId];
      }
    });
  }

  if (session.sideMatches && session.sideMatches[sideMatchId]) {
    delete session.sideMatches[sideMatchId];
  }

  await saveSessionData(pin, session);
};

// ==================== SIDE SET OPERATIONS ====================

// Bắt đầu set kèo phụ mới
export const startNewSideSet = async (pin, betAmount, sideMatchId, previousTeams = null) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session) return null;
    const setCount = session.sideSets ? Object.keys(session.sideSets).length : 0;
    const setId = `side_set_${setCount + 1}`;

    const teamsList = ['teamA', 'teamB'];
    const teamsData = {};
    teamsList.forEach(t => {
      const letter = t.replace('team', '');
      teamsData[t] = {
        name: `Team ${letter}`,
        slots: previousTeams?.teams?.[t]?.slots || previousTeams?.[t]?.slots || {}
      };
    });

    if (!session.sideSets) session.sideSets = {};
    session.sideSets[setId] = {
      sideMatchId: sideMatchId,
      status: 'playing',
      winner: null,
      betAmount: betAmount,
      matchup: 'teamA_teamB',
      playerBets: {},
      teams: teamsData,
      createdAt: Date.now(),
    };
    await saveSessionData(pin, session);
    return setId;
  }

  const sessionRef = ref(db, `sessions/${pin}`);
  const sessionSnap = await get(sessionRef);
  const session = sessionSnap.val() || {};
  const setCount = session.sideSets ? Object.keys(session.sideSets).length : 0;
  const setId = `side_set_${setCount + 1}`;

  const teamsList = ['teamA', 'teamB'];
  const teamsData = {};
  teamsList.forEach(t => {
    const letter = t.replace('team', '');
    teamsData[t] = {
      name: `Team ${letter}`,
      slots: previousTeams?.teams?.[t]?.slots || previousTeams?.[t]?.slots || {}
    };
  });

  await set(ref(db, `sessions/${pin}/sideSets/${setId}`), {
    sideMatchId: sideMatchId,
    status: 'playing',
    winner: null,
    betAmount: betAmount,
    matchup: 'teamA_teamB',
    playerBets: {},
    teams: teamsData,
    createdAt: Date.now(),
  });
  return setId;
};

// Cập nhật đội kèo phụ (Thêm/Xóa người)
export const updateSideSetTeams = async (pin, setId, teams) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session || !session.sideSets || !session.sideSets[setId]) return;
    session.sideSets[setId].teams = teams;
    await saveSessionData(pin, session);
    return;
  }
  await update(ref(db, `sessions/${pin}/sideSets/${setId}`), { teams });
};

// Cập nhật tiền cược kèo phụ đang đấu
export const updateSideSetBetAmount = async (pin, setId, betAmount) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session || !session.sideSets || !session.sideSets[setId]) return;
    session.sideSets[setId].betAmount = betAmount;
    await saveSessionData(pin, session);
    return;
  }
  await update(ref(db, `sessions/${pin}/sideSets/${setId}`), { betAmount });
};

// Kết thúc set kèo phụ
export const finishSideSet = async (pin, setId, winner) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session || !session.sideSets || !session.sideSets[setId]) return;
    const setData = session.sideSets[setId];
    if (setData.status !== 'playing') return;

    const { balanceChanges } = calculateSettlement(
      setData.teams,
      setData.matchup,
      winner,
      setData.betAmount,
      setData.playerBets || {}
    );

    if (!session.players) session.players = {};
    Object.entries(balanceChanges).forEach(([pid, change]) => {
      if (session.players[pid]) {
        const currentBalance = session.players[pid].balance || 0;
        session.players[pid].balance = currentBalance + change;
      }
    });

    session.sideSets[setId].status = 'completed';
    session.sideSets[setId].winner = winner;
    session.sideSets[setId].completedAt = Date.now();
    session.sideSets[setId].balanceChanges = balanceChanges;

    await saveSessionData(pin, session);
    return;
  }

  const setRef = ref(db, `sessions/${pin}/sideSets/${setId}`);
  const setSnap = await get(setRef);
  const setData = setSnap.val();

  if (!setData || setData.status !== 'playing') return;

  const { balanceChanges } = calculateSettlement(
    setData.teams,
    setData.matchup,
    winner,
    setData.betAmount,
    setData.playerBets || {}
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

  updates[`sideSets/${setId}/status`] = 'completed';
  updates[`sideSets/${setId}/winner`] = winner;
  updates[`sideSets/${setId}/completedAt`] = Date.now();
  updates[`sideSets/${setId}/balanceChanges`] = balanceChanges;

  await update(ref(db, `sessions/${pin}`), updates);
};

// Hoàn tác set kèo phụ
export const undoSideSet = async (pin, setId) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session || !session.sideSets || !session.sideSets[setId]) return;
    const setData = session.sideSets[setId];
    if (setData.status !== 'completed') return;

    const { balanceChanges } = calculateSettlement(
      setData.teams,
      setData.matchup,
      setData.winner,
      setData.betAmount,
      setData.playerBets || {}
    );

    if (!session.players) session.players = {};
    Object.entries(balanceChanges).forEach(([pid, change]) => {
      if (session.players[pid]) {
        const currentBalance = session.players[pid].balance || 0;
        session.players[pid].balance = currentBalance - change;
      }
    });

    session.sideSets[setId].status = 'playing';
    session.sideSets[setId].winner = null;
    session.sideSets[setId].completedAt = null;
    session.sideSets[setId].balanceChanges = null;

    await saveSessionData(pin, session);
    return;
  }

  const setRef = ref(db, `sessions/${pin}/sideSets/${setId}`);
  const setSnap = await get(setRef);
  const setData = setSnap.val();

  if (!setData || setData.status !== 'completed') return;

  const { balanceChanges } = calculateSettlement(
    setData.teams,
    setData.matchup,
    setData.winner,
    setData.betAmount,
    setData.playerBets || {}
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

  updates[`sideSets/${setId}/status`] = 'playing';
  updates[`sideSets/${setId}/winner`] = null;
  updates[`sideSets/${setId}/completedAt`] = null;
  updates[`sideSets/${setId}/balanceChanges`] = null;

  await update(ref(db, `sessions/${pin}`), updates);
};

// Cập nhật cược riêng của thành viên trong kèo phụ
export const updateSidePlayerBet = async (pin, setId, playerId, amount) => {
  if (pin.startsWith('L-')) {
    const session = await getSessionData(pin);
    if (!session || !session.sideSets || !session.sideSets[setId]) return;
    if (!session.sideSets[setId].playerBets) session.sideSets[setId].playerBets = {};
    if (amount === null || amount === undefined) {
      delete session.sideSets[setId].playerBets[playerId];
    } else {
      session.sideSets[setId].playerBets[playerId] = amount;
    }
    await saveSessionData(pin, session);
    return;
  }

  const pBetRef = ref(db, `sessions/${pin}/sideSets/${setId}/playerBets/${playerId}`);
  if (amount === null || amount === undefined) {
    await set(pBetRef, null);
  } else {
    await set(pBetRef, amount);
  }
};