import AsyncStorage from '@react-native-async-storage/async-storage';
import { calculateSettlement } from './bettingEngine';

// Pub/Sub cho offline mode
const localListeners = {};
const triggerLocalUpdate = async (pin, data) => {
  await AsyncStorage.setItem(`local_session_${pin}`, JSON.stringify(data));
  if (localListeners[pin]) {
    localListeners[pin].forEach(cb => cb(data));
  }
};

const getSessionData = async (pin) => {
  const val = await AsyncStorage.getItem(`local_session_${pin}`);
  return val ? JSON.parse(val) : null;
};

const saveSessionData = async (pin, data) => {
  await triggerLocalUpdate(pin, data);
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

// TẠO PHÒNG MỚI (100% Offline)
export const createSession = async (hostName) => {
  const deviceId = await getDeviceId();
  const now = Date.now();

  const sessionData = {
    meta: {
      hostId: deviceId,
      hostName: hostName,
      createdAt: now,
      isOffline: true,
      teams: ['teamA', 'teamB', 'teamC']
    },
    players: {},
    sets: {},
  };

  const pin = 'L-' + Math.floor(1000 + Math.random() * 9000).toString();
  await AsyncStorage.setItem(`local_session_${pin}`, JSON.stringify(sessionData));
  return { pin, deviceId };
};

// THAM GIA PHÒNG (Dành cho tương thích)
export const joinSession = async (pin, memberName) => {
  const session = await getSessionData(pin);
  if (!session) {
    throw new Error('Phòng không tồn tại trên thiết bị này!');
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
};

// LẮNG NGHE REALTIME
export const subscribeToSession = (pin, callback) => {
  if (!localListeners[pin]) {
    localListeners[pin] = [];
  }
  localListeners[pin].push(callback);

  // Đọc giá trị ban đầu và kiểm tra hạn sử dụng 24h
  getSessionData(pin).then(async (data) => {
    const createdAt = data?.meta?.createdAt || data?.createdAt;
    if (createdAt) {
      const ageMs = Date.now() - createdAt;
      if (ageMs > 24 * 60 * 60 * 1000) {
        await AsyncStorage.removeItem(`local_session_${pin}`);
        callback(null);
        return;
      }
    }
    callback(data);
  });

  return () => {
    localListeners[pin] = (localListeners[pin] || []).filter(cb => cb !== callback);
  };
};

// Bắt đầu set mới (Host)
export const startNewSet = async (pin, betAmount, previousTeams = null) => {
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
};

// Cập nhật team (Thêm/Xóa người khỏi Team)
export const updateSetTeams = async (pin, setId, teams) => {
  const session = await getSessionData(pin);
  if (!session || !session.sets || !session.sets[setId]) return;
  session.sets[setId].teams = teams;
  // Set legacy fields for compatibility
  if (teams.teamA) session.sets[setId].teamA = teams.teamA;
  if (teams.teamB) session.sets[setId].teamB = teams.teamB;
  if (teams.teamC) session.sets[setId].teamC = teams.teamC;
  await saveSessionData(pin, session);
};

// Cập nhật tiền cược của set đang đấu
export const updateSetBetAmount = async (pin, setId, betAmount) => {
  const session = await getSessionData(pin);
  if (!session || !session.sets || !session.sets[setId]) return;
  session.sets[setId].betAmount = betAmount;
  await saveSessionData(pin, session);
};

// Cập nhật matchup (Đội đấu)
export const updateMatchup = async (pin, setId, matchup) => {
  const session = await getSessionData(pin);
  if (!session || !session.sets || !session.sets[setId]) return;
  session.sets[setId].matchup = matchup;
  await saveSessionData(pin, session);
};

// Cập nhật tiền cược của cá nhân trong set
export const updatePlayerBet = async (pin, setId, playerId, amount) => {
  const session = await getSessionData(pin);
  if (!session || !session.sets || !session.sets[setId]) return;
  if (!session.sets[setId].playerBets) session.sets[setId].playerBets = {};
  if (amount === null || amount === undefined) {
    delete session.sets[setId].playerBets[playerId];
  } else {
    session.sets[setId].playerBets[playerId] = amount;
  }
  await saveSessionData(pin, session);
};

// Kết thúc set (Host bấm Thắng)
export const finishSet = async (pin, setId, winner) => {
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
  if (!session.sets[setId].originalWinner) {
    session.sets[setId].originalWinner = winner;
  }
  session.sets[setId].completedAt = Date.now();
  session.sets[setId].balanceChanges = balanceChanges; // ponytail: snapshot balance changes for exact undo

  await saveSessionData(pin, session);
};

// Chỉnh sửa đội thắng của set trong lịch sử (đổi kết quả và gán/hủy tag isEdited)
export const updateSetWinner = async (pin, setId, newWinner) => {
  const session = await getSessionData(pin);
  if (!session || !session.sets || !session.sets[setId]) return false;
  const setData = session.sets[setId];
  if (setData.status !== 'completed' || setData.winner === newWinner) return false;

  if (!setData.originalWinner) {
    setData.originalWinner = setData.winner;
  }

  // 1. Hoàn trả balance cũ
  const oldChanges = setData.balanceChanges || calculateSettlement(
    setData.teams || { teamA: setData.teamA, teamB: setData.teamB, teamC: setData.teamC },
    setData.matchup,
    setData.winner,
    setData.betAmount,
    setData.playerBets
  ).balanceChanges;

  if (!session.players) session.players = {};
  Object.entries(oldChanges).forEach(([pid, change]) => {
    if (session.players[pid]) {
      const currentBalance = session.players[pid].balance || 0;
      session.players[pid].balance = currentBalance - change;
    }
  });

  // 2. Tính balance mới
  const { balanceChanges: newChanges } = calculateSettlement(
    setData.teams || { teamA: setData.teamA, teamB: setData.teamB, teamC: setData.teamC },
    setData.matchup,
    newWinner,
    setData.betAmount,
    setData.playerBets
  );

  // 3. Cộng balance mới
  Object.entries(newChanges).forEach(([pid, change]) => {
    if (session.players[pid]) {
      const currentBalance = session.players[pid].balance || 0;
      session.players[pid].balance = currentBalance + change;
    }
  });

  setData.winner = newWinner;
  setData.balanceChanges = newChanges;
  setData.isEdited = (newWinner !== setData.originalWinner);

  await saveSessionData(pin, session);
  return true;
};

// HOÀN TÁC set (Undo)
export const undoSet = async (pin, setId) => {
  const session = await getSessionData(pin);
  if (!session || !session.sets || !session.sets[setId]) return;
  const setData = session.sets[setId];
  if (setData.status !== 'completed') return;

  // ponytail: use snapshot balanceChanges when available to avoid recalculation drifts
  const balanceChanges = setData.balanceChanges || calculateSettlement(
    setData.teams || { teamA: setData.teamA, teamB: setData.teamB, teamC: setData.teamC },
    setData.matchup,
    setData.winner,
    setData.betAmount,
    setData.playerBets
  ).balanceChanges;

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
  session.sets[setId].isEdited = true; // ponytail: mark set as edited
  delete session.sets[setId].balanceChanges;

  await saveSessionData(pin, session);
};

// Thêm Đội mới (Dành cho Host)
export const addTeamToSession = async (pin, setId) => {
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
};

// Xóa Đội (Dành cho Host)
export const deleteTeamFromSession = async (pin, setId, teamKey) => {
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
};

// Thêm người chơi thủ công (Dành cho Host)
export const addPlayerToSession = async (pin, playerName) => {
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
};

// Đánh dấu đã thanh toán / Hoàn tác thanh toán
export const togglePlayerSettled = async (pin, playerId, isSettled) => {
  const session = await getSessionData(pin);
  if (!session || !session.players || !session.players[playerId]) return;
  session.players[playerId].isSettled = isSettled;
  await saveSessionData(pin, session);
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
      const roundedShare = Math.ceil(rawShare / 1000) * 1000;
      playerIds.forEach(pid => {
        shares[pid] = roundedShare;
      });
    } else {
      playerIds.forEach(pid => {
        const rawShare = totalCourtFee * (setsPlayed[pid] / totalSetsPlayed);
        shares[pid] = Math.ceil(rawShare / 1000) * 1000;
      });
    }
  } else {
    // Chia đều: làm tròn lên 1.000đ cho tất cả
    const rawShare = totalCourtFee / playerIds.length;
    const roundedShare = Math.ceil(rawShare / 1000) * 1000;
    playerIds.forEach(pid => {
      shares[pid] = roundedShare;
    });
  }

  // ponytail: surplus stays as extra buffer rather than artificially discounting the first player
  const totalCollected = Object.values(shares).reduce((sum, val) => sum + val, 0);
  const surplus = Math.max(0, totalCollected - totalCourtFee);

  // Trừ tiền sân vào balance
  playerIds.forEach(pid => {
    players[pid].balance = (players[pid].balance || 0) - shares[pid];
  });

  if (!session.meta) session.meta = {};
  session.meta.status = 'finished';
  session.courtFee = {
    total: totalCourtFee,
    totalCollected: totalCollected,
    surplus: surplus,
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
};

// Cập nhật đội kèo phụ (Thêm/Xóa người)
export const updateSideSetTeams = async (pin, setId, teams) => {
  const session = await getSessionData(pin);
  if (!session || !session.sideSets || !session.sideSets[setId]) return;
  session.sideSets[setId].teams = teams;
  await saveSessionData(pin, session);
};

// Cập nhật tiền cược kèo phụ đang đấu
export const updateSideSetBetAmount = async (pin, setId, betAmount) => {
  const session = await getSessionData(pin);
  if (!session || !session.sideSets || !session.sideSets[setId]) return;
  session.sideSets[setId].betAmount = betAmount;
  await saveSessionData(pin, session);
};

// Kết thúc set kèo phụ
export const finishSideSet = async (pin, setId, winner) => {
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
  if (!session.sideSets[setId].originalWinner) {
    session.sideSets[setId].originalWinner = winner;
  }
  session.sideSets[setId].completedAt = Date.now();
  session.sideSets[setId].balanceChanges = balanceChanges;

  await saveSessionData(pin, session);
};

// Chỉnh sửa đội thắng của kèo phụ trong lịch sử
export const updateSideSetWinner = async (pin, setId, newWinner) => {
  const session = await getSessionData(pin);
  if (!session || !session.sideSets || !session.sideSets[setId]) return false;
  const setData = session.sideSets[setId];
  if (setData.status !== 'completed' || setData.winner === newWinner) return false;

  if (!setData.originalWinner) {
    setData.originalWinner = setData.winner;
  }

  const oldChanges = setData.balanceChanges || calculateSettlement(
    setData.teams,
    setData.matchup,
    setData.winner,
    setData.betAmount,
    setData.playerBets || {}
  ).balanceChanges;

  if (!session.players) session.players = {};
  Object.entries(oldChanges).forEach(([pid, change]) => {
    if (session.players[pid]) {
      session.players[pid].balance = (session.players[pid].balance || 0) - change;
    }
  });

  const { balanceChanges: newChanges } = calculateSettlement(
    setData.teams,
    setData.matchup,
    newWinner,
    setData.betAmount,
    setData.playerBets || {}
  );

  Object.entries(newChanges).forEach(([pid, change]) => {
    if (session.players[pid]) {
      session.players[pid].balance = (session.players[pid].balance || 0) + change;
    }
  });

  setData.winner = newWinner;
  setData.balanceChanges = newChanges;
  setData.isEdited = (newWinner !== setData.originalWinner);

  await saveSessionData(pin, session);
  return true;
};

// Hoàn tác set kèo phụ
export const undoSideSet = async (pin, setId) => {
  const session = await getSessionData(pin);
  if (!session || !session.sideSets || !session.sideSets[setId]) return;
  const setData = session.sideSets[setId];
  if (setData.status !== 'completed') return;

  const balanceChanges = setData.balanceChanges || calculateSettlement(
    setData.teams,
    setData.matchup,
    setData.winner,
    setData.betAmount,
    setData.playerBets || {}
  ).balanceChanges;

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
  session.sideSets[setId].isEdited = true;
  delete session.sideSets[setId].balanceChanges;

  await saveSessionData(pin, session);
};

// Cập nhật cược riêng của thành viên trong kèo phụ
export const updateSidePlayerBet = async (pin, setId, playerId, amount) => {
  const session = await getSessionData(pin);
  if (!session || !session.sideSets || !session.sideSets[setId]) return;
  if (!session.sideSets[setId].playerBets) session.sideSets[setId].playerBets = {};
  if (amount === null || amount === undefined) {
    delete session.sideSets[setId].playerBets[playerId];
  } else {
    session.sideSets[setId].playerBets[playerId] = amount;
  }
  await saveSessionData(pin, session);
};
