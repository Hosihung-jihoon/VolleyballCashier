import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { DuoTheme } from '../constants/theme';
import { calculateSettlement } from '../lib/bettingEngine';
import { addPlayerToSession, addSideMatch, deleteSideMatch, addTeamToSession, deleteTeamFromSession, finishSession, finishSet, finishSideSet, startNewSet, startNewSideSet, subscribeToSession, togglePlayerSettled, undoFinishSession, undoSet, undoSideSet, updateMatchup, updatePlayerBet, updateSetBetAmount, updateSetTeams, updateSetWinner, updateSidePlayerBet, updateSideSetBetAmount, updateSideSetTeams, updateSideSetWinner } from '../lib/sessionApi';

const formatMoney = (val) => {
  if (val === null || val === undefined || val === '') return '';
  const num = parseInt(val.toString().replace(/\D/g, ''), 10);
  return isNaN(num) ? '' : num.toLocaleString('vi-VN');
};

const parseMoney = (str) => {
  if (!str) return 0;
  return parseInt(str.toString().replace(/\D/g, ''), 10) || 0;
};

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
    Alert.alert(title, message, buttons && buttons.length > 0 ? buttons : [{ text: "OK" }]);
  }
};

export default function SessionScreen() {
  const { pin, role } = useLocalSearchParams();
  const [session, setSession] = useState(null);
  const [latestSetId, setLatestSetId] = useState(null);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [betAmount, setBetAmount] = useState('5000'); // State tiền cược
  const [subTarget, setSubTarget] = useState(null);
  const [historyModalData, setHistoryModalData] = useState(null); // { setId, setData }
  const [teamPickerPlayerId, setTeamPickerPlayerId] = useState(null);
  
  // Custom states for the new features
  const [customBetModalData, setCustomBetModalData] = useState(null); // { playerId, playerName, customAmount }
  const [ledgerModalData, setLedgerModalData] = useState(null); // { playerId, name }
  const [matchupDropdownData, setMatchupDropdownData] = useState(null); // { side, currentLeft, currentRight }

  // States for Finish Session
  const [finishModalVisible, setFinishModalVisible] = useState(false);
  const [courtFeeInput, setCourtFeeInput] = useState('');
  const [courtFeeSplitMethod, setCourtFeeSplitMethod] = useState('equal'); // 'equal' | 'proportional'

  // States for dynamic matches selection
  const [selectedMatchId, setSelectedMatchId] = useState('main');
  const [matchSelectionModalVisible, setMatchSelectionModalVisible] = useState(false);
  const [addSideMatchModalVisible, setAddSideMatchModalVisible] = useState(false);
  const [newSideMatchName, setNewSideMatchName] = useState('');
  const [newSideMatchBetAmount, setNewSideMatchBetAmount] = useState('5000');

  // States for fully featured Side Match (Kèo phụ)
  const [sideBetAmountInput, setSideBetAmountInput] = useState('5000');
  const [sideSubTarget, setSideSubTarget] = useState(null);
  const [sideTeamPickerPlayerId, setSideTeamPickerPlayerId] = useState(null);

  useEffect(() => {
    if (pin && role) {
      AsyncStorage.setItem('last_session_pin', pin);
      AsyncStorage.setItem('last_session_role', role);
    }
  }, [pin, role]);

  useEffect(() => {
    const unsub = subscribeToSession(pin, (data) => {
      setSession(data);
      if (data?.sets) {
        // Fix 9-set limit bug by sorting numerically
        const sortedSets = Object.entries(data.sets).sort((a, b) => {
          const numA = parseInt(a[0].replace('set_', '')) || 0;
          const numB = parseInt(b[0].replace('set_', '')) || 0;
          return numB - numA;
        });
        const latestId = sortedSets[0][0];
        setLatestSetId(latestId);
        
        // Đồng bộ số tiền cược từ database (tránh ghi đè khi Host đang nhập)
        const lSet = data.sets[latestId];
        if (lSet && lSet.betAmount !== undefined) {
          setBetAmount(prev => {
            if (prev === lSet.betAmount.toString()) return prev;
            return lSet.betAmount.toString();
          });
        }
      } else { 
        setLatestSetId(null); 
      }
    });
    return () => unsub();
  }, [pin]);

  // Sync side match bet amount input when selectedMatchId or database updates
  useEffect(() => {
    if (!session || selectedMatchId === 'main') return;
    const matchSets = Object.entries(session.sideSets || {})
      .filter(([_, s]) => s.sideMatchId === selectedMatchId)
      .sort((a, b) => {
        const numA = parseInt(a[0].replace('side_set_', '')) || 0;
        const numB = parseInt(b[0].replace('side_set_', '')) || 0;
        return numB - numA;
      });
    const latestId = matchSets[0]?.[0];
    const lSideSet = latestId ? session.sideSets[latestId] : null;
    if (lSideSet && lSideSet.betAmount !== undefined) {
      setSideBetAmountInput(prev => {
        if (prev === lSideSet.betAmount.toString()) return prev;
        return lSideSet.betAmount.toString();
      });
    } else {
      // default to match betAmount if no sets exist yet
      const matchObj = session.sideMatches?.[selectedMatchId];
      if (matchObj && matchObj.betAmount !== undefined) {
        setSideBetAmountInput(matchObj.betAmount.toString());
      }
    }
  }, [selectedMatchId, session?.sideSets, session?.sideMatches]);

  if (!session) return <View style={styles.center}><Text>Đang tải...</Text></View>;

  const players = session.players || {};
  const latestSet = (latestSetId && session.sets) ? session.sets[latestSetId] : null;
  const isHost = role === 'host';

  const activeTeams = session.meta?.teams || ['teamA', 'teamB', 'teamC'];

  // Derived Side Match values
  const activeTab = selectedMatchId === 'main' ? 'main' : 'side';
  const sideSetsForSelectedMatch = Object.entries(session.sideSets || {})
    .filter(([_, s]) => s.sideMatchId === selectedMatchId)
    .sort((a, b) => {
      const numA = parseInt(a[0].replace('side_set_', '')) || 0;
      const numB = parseInt(b[0].replace('side_set_', '')) || 0;
      return numB - numA;
    });
  const latestSideSetId = sideSetsForSelectedMatch[0]?.[0] || null;
  const latestSideSet = latestSideSetId ? session.sideSets[latestSideSetId] : null;

  const normalizeMatchup = (matchup) => {
    if (!matchup) return ['teamA', 'teamB'];
    const parts = matchup.split('_');
    const normalizedParts = parts.map(p => {
      if (p === 'A') return 'teamA';
      if (p === 'B') return 'teamB';
      if (p === 'C') return 'teamC';
      return p;
    });
    return normalizedParts;
  };

  const getTeamLabel = (teamKey) => {
    if (!teamKey) return '';
    const letter = teamKey.replace('team', '');
    return `Team ${letter}`;
  };

  const getWaitingPlayers = () => {
    if (!latestSet) return Object.keys(players);
    const teamsData = latestSet.teams || { teamA: latestSet.teamA, teamB: latestSet.teamB, teamC: latestSet.teamC };
    const playersInTeams = [];
    Object.values(teamsData).forEach(team => {
      if (team && team.slots) {
        Object.values(team.slots).forEach(slotPids => {
          if (Array.isArray(slotPids)) {
            playersInTeams.push(...slotPids);
          }
        });
      }
    });
    return Object.keys(players).filter(pid => !playersInTeams.includes(pid));
  };

  const getWaitingPlayersForSide = () => {
    if (!latestSideSet) return Object.keys(players);
    const teamsData = latestSideSet.teams || { teamA: latestSideSet.teamA, teamB: latestSideSet.teamB };
    const playersInTeams = [];
    Object.values(teamsData).forEach(team => {
      if (team && team.slots) {
        Object.values(team.slots).forEach(slotPids => {
          if (Array.isArray(slotPids)) {
            playersInTeams.push(...slotPids);
          }
        });
      }
    });
    return Object.keys(players).filter(pid => !playersInTeams.includes(pid));
  };

  // ponytail: single source of truth calculateSettlement for accurate payout preview
  const computePayoutWarning = (setData, isSide = false) => {
    if (!setData || setData.status !== 'playing') return null;

    const [lKey, rKey] = isSide ? ['teamA', 'teamB'] : normalizeMatchup(setData.matchup);
    const teamsMap = setData.teams || {
      teamA: setData.teamA || { slots: {} },
      teamB: setData.teamB || { slots: {} },
      teamC: !isSide ? (setData.teamC || { slots: {} }) : undefined
    };

    const lData = teamsMap[lKey] || { slots: {} };
    const rData = teamsMap[rKey] || { slots: {} };

    const leftPids = [];
    Object.values(lData.slots || {}).forEach(slot => {
      if (Array.isArray(slot)) leftPids.push(...slot);
    });
    const rightPids = [];
    Object.values(rData.slots || {}).forEach(slot => {
      if (Array.isArray(slot)) rightPids.push(...slot);
    });

    const nL = leftPids.length;
    const nR = rightPids.length;
    if (nL === 0 || nR === 0) return null;

    const defaultBet = setData.betAmount || 5000;
    const playerBets = setData.playerBets || {};

    // Mô phỏng chính xác bằng calculateSettlement
    const simLeft = calculateSettlement(teamsMap, setData.matchup, lKey, defaultBet, playerBets).balanceChanges;
    const simRight = calculateSettlement(teamsMap, setData.matchup, rKey, defaultBet, playerBets).balanceChanges;

    const getExpectedWin = (pid) => {
      const raw = playerBets[pid];
      if (raw && typeof raw === 'object') return Number(raw.amount) || defaultBet;
      if (typeof raw === 'number' || typeof raw === 'string') return Number(raw) || defaultBet;
      return defaultBet;
    };

    // Kiểm tra xem có người chơi nào nhận payout lệch khỏi mức cược không
    const isLeftImbalanced = leftPids.some(pid => Math.abs((simLeft[pid] || 0) - getExpectedWin(pid)) >= 500);
    const isRightImbalanced = rightPids.some(pid => Math.abs((simRight[pid] || 0) - getExpectedWin(pid)) >= 500);

    // Nếu cả 2 đội đều nhận đúng 100% tiền cược (đã cân tiền) -> Không cần hiện banner cảnh báo
    if (!isLeftImbalanced && !isRightImbalanced) return null;

    const leftLabel = isSide ? 'Team A' : getTeamLabel(lKey);
    const rightLabel = isSide ? 'Team B' : getTeamLabel(rKey);

    const leftPayouts = leftPids.map(pid => ({
      name: players[pid]?.name || pid,
      win: Math.max(0, simLeft[pid] || 0)
    }));

    const rightPayouts = rightPids.map(pid => ({
      name: players[pid]?.name || pid,
      win: Math.max(0, simRight[pid] || 0)
    }));

    return {
      nL,
      nR,
      leftLabel,
      rightLabel,
      leftPayouts,
      rightPayouts
    };
  };

  const handleCreateSideMatch = async () => {
    if (!newSideMatchName.trim()) {
      showAlert("Lỗi", "Vui lòng nhập tên kèo phụ!");
      return;
    }
    const amount = parseInt(newSideMatchBetAmount) || 0;
    if (amount <= 0) {
      showAlert("Lỗi", "Số tiền cược phải lớn hơn 0!");
      return;
    }
    const sideMatchId = await addSideMatch(pin, newSideMatchName.trim(), amount);
    if (sideMatchId) {
      setSelectedMatchId(sideMatchId);
      setNewSideMatchName('');
      setNewSideMatchBetAmount('5000');
      setAddSideMatchModalVisible(false);
      setMatchSelectionModalVisible(false);
      showAlert("Thành công", "Đã tạo kèo phụ mới!");
    }
  };

  const handleDeleteSideMatch = async (sideMatchId) => {
    if (!isHost) return;
    const matchName = session.sideMatches?.[sideMatchId]?.name || 'kèo phụ';
    showAlert("Xác nhận", `Bạn chắc chắn muốn xóa "${matchName}"? Tất cả set đấu liên quan sẽ bị xóa và hoàn tiền.`, [
      { text: "Hủy" },
      {
        text: "Xóa",
        style: "destructive",
        onPress: async () => {
          await deleteSideMatch(pin, sideMatchId);
          if (selectedMatchId === sideMatchId) {
            setSelectedMatchId('main');
          }
          showAlert("Thành công", `Đã xóa "${matchName}"!`);
        }
      }
    ]);
  };

  const handleAddNewPlayer = async () => {
    if (!newPlayerName.trim()) return;
    await addPlayerToSession(pin, newPlayerName.trim());
    setNewPlayerName('');
  };

  const handleAddToTeam = (pid, teamKey) => {
    if (!isHost) return;
    const isSide = activeTab === 'side';
    const activeSetData = isSide ? latestSideSet : latestSet;
    const activeSetIdVal = isSide ? latestSideSetId : latestSetId;
    const updateTeamsFn = isSide ? updateSideSetTeams : updateSetTeams;

    if (!activeSetData || activeSetData.status !== 'playing') return;

    const teamsMap = { ...activeSetData.teams };
    const teamA = activeSetData.teamA || { slots: {} };
    const teamB = activeSetData.teamB || { slots: {} };
    const teamC = activeSetData.teamC || { slots: {} };
    if (!teamsMap.teamA) teamsMap.teamA = teamA;
    if (!teamsMap.teamB) teamsMap.teamB = teamB;
    if (!isSide && !teamsMap.teamC) teamsMap.teamC = teamC;

    const targetTeam = { ...teamsMap[teamKey] } || { slots: {} };
    const slots = { ...targetTeam.slots };
    const existingNums = Object.keys(slots).map(k => parseInt(k.replace('slot_', '')) || 0);
    const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
    slots[`slot_${nextNum}`] = [pid];
    targetTeam.slots = slots;
    teamsMap[teamKey] = targetTeam;

    updateTeamsFn(pin, activeSetIdVal, teamsMap);
    if (isSide) {
      setSideTeamPickerPlayerId(null);
    } else {
      setTeamPickerPlayerId(null);
    }
  };

  const handleRemoveFromTeam = (pid, teamKey) => {
    if (!isHost) return;
    const isSide = activeTab === 'side';
    const activeSetData = isSide ? latestSideSet : latestSet;
    const activeSetIdVal = isSide ? latestSideSetId : latestSetId;
    const updateTeamsFn = isSide ? updateSideSetTeams : updateSetTeams;

    if (!activeSetData || activeSetData.status !== 'playing') return;
    
    const teamsMap = { ...activeSetData.teams };
    const teamA = activeSetData.teamA || { slots: {} };
    const teamB = activeSetData.teamB || { slots: {} };
    const teamC = activeSetData.teamC || { slots: {} };
    if (!teamsMap.teamA) teamsMap.teamA = teamA;
    if (!teamsMap.teamB) teamsMap.teamB = teamB;
    if (!isSide && !teamsMap.teamC) teamsMap.teamC = teamC;

    const targetTeam = { ...teamsMap[teamKey] };
    if (!targetTeam) return;
    const slots = { ...targetTeam.slots };
    Object.keys(slots).forEach(slotKey => {
      if (slots[slotKey].includes(pid)) {
        if (slots[slotKey].length === 1) delete slots[slotKey];
        else slots[slotKey] = slots[slotKey].filter(id => id !== pid);
      }
    });
    targetTeam.slots = slots;
    teamsMap[teamKey] = targetTeam;

    updateTeamsFn(pin, activeSetIdVal, teamsMap);
  };

  const handleSelectSlotForSub = (teamKey, slotId) => {
    if (!isHost) return;
    const isSide = activeTab === 'side';
    const activeSetData = isSide ? latestSideSet : latestSet;
    if (!activeSetData || activeSetData.status !== 'playing') return;

    if (isSide) {
      setSideSubTarget(sideSubTarget && sideSubTarget.team === teamKey && sideSubTarget.slotId === slotId ? null : { team: teamKey, slotId });
    } else {
      setSubTarget(subTarget && subTarget.team === teamKey && subTarget.slotId === slotId ? null : { team: teamKey, slotId });
    }
  };

  const handleExecuteSub = (pid) => {
    const isSide = activeTab === 'side';
    const activeSetData = isSide ? latestSideSet : latestSet;
    const activeSetIdVal = isSide ? latestSideSetId : latestSetId;
    const updateTeamsFn = isSide ? updateSideSetTeams : updateSetTeams;
    const targetSub = isSide ? sideSubTarget : subTarget;

    if (!targetSub || !activeSetData) return;
    const { team: teamKey, slotId } = targetSub;
    
    const teamsMap = { ...activeSetData.teams };
    const teamA = activeSetData.teamA || { slots: {} };
    const teamB = activeSetData.teamB || { slots: {} };
    const teamC = activeSetData.teamC || { slots: {} };
    if (!teamsMap.teamA) teamsMap.teamA = teamA;
    if (!teamsMap.teamB) teamsMap.teamB = teamB;
    if (!isSide && !teamsMap.teamC) teamsMap.teamC = teamC;

    const targetTeam = { ...teamsMap[teamKey] };
    if (!targetTeam) return;
    const slots = { ...targetTeam.slots };
    if (slots[slotId] && !slots[slotId].includes(pid)) {
      slots[slotId] = [...slots[slotId], pid];
      targetTeam.slots = slots;
      teamsMap[teamKey] = targetTeam;

      updateTeamsFn(pin, activeSetIdVal, teamsMap);
    }
    if (isSide) {
      setSideSubTarget(null);
    } else {
      setSubTarget(null);
    }
  };

  const onWaitingPlayerPress = (pid) => {
    if (!isHost) return;
    const isSide = activeTab === 'side';
    const activeSubTarget = isSide ? sideSubTarget : subTarget;
    if (activeSubTarget) handleExecuteSub(pid);
    else {
      if (isSide) {
        setSideTeamPickerPlayerId(sideTeamPickerPlayerId === pid ? null : pid);
      } else {
        setTeamPickerPlayerId(teamPickerPlayerId === pid ? null : pid);
      }
    }
  };



  const handleSelectMatchupSide = (side, currentLeft, currentRight) => {
    setMatchupDropdownData({ side, currentLeft, currentRight });
  };

  const handleAddTeam = async () => {
    if (!isHost || !latestSetId) return;
    const nextTeamKey = await addTeamToSession(pin, latestSetId);
    if (nextTeamKey) {
      const nextLetter = nextTeamKey.replace('team', '');
      showAlert("Thành công", `Đã thêm Đội ${nextLetter}!`);
    }
  };

  const handleDeleteTeam = async (teamKey) => {
    if (!isHost || !latestSetId) return;
    const letter = teamKey.replace('team', '');
    showAlert("Xác nhận", `Bạn có chắc chắn muốn xóa Đội ${letter}? Tất cả người chơi trong đội này sẽ quay về danh sách chờ.`, [
      { text: "Hủy" },
      { 
        text: "Xóa", 
        onPress: async () => {
          const success = await deleteTeamFromSession(pin, latestSetId, teamKey);
          if (success) {
            showAlert("Thành công", `Đã xóa Đội ${letter}!`);
          }
        }
      }
    ]);
  };

  const handleFinishSet = (winner) => {
    if (!latestSet) return;
    const [l, r] = normalizeMatchup(latestSet.matchup);
    
    const lData = latestSet.teams?.[l] || latestSet[l] || { slots: {} };
    const rData = latestSet.teams?.[r] || latestSet[r] || { slots: {} };
    if (Object.keys(lData.slots || {}).length === 0 || Object.keys(rData.slots || {}).length === 0) {
      showAlert("Lỗi", `Vui lòng chia đủ người cho ${getTeamLabel(l)} và ${getTeamLabel(r)}!`);
      return;
    }

    const winnerName = getTeamLabel(winner);

    showAlert("Xác nhận", `${winnerName} thắng?`, [
      { text: "Hủy" }, 
      { text: "Đúng", onPress: () => finishSet(pin, latestSetId, winner) }
    ]);
  };

  const handleStartSet = async () => {
    const amount = parseInt(betAmount) || 5000;
    const prevTeams = latestSet?.status === 'completed' ? { 
      teams: latestSet?.teams,
      teamA: latestSet?.teamA, 
      teamB: latestSet?.teamB,
      teamC: latestSet?.teamC,
      matchup: latestSet?.matchup,
    } : null;
    await startNewSet(pin, amount, prevTeams);
  };

  // Xử lý thay đổi tiền cược set đang đấu
  const handleBetAmountChange = async (val) => {
    const amount = parseMoney(val);
    setBetAmount(amount ? amount.toString() : '');
    if (latestSet && latestSet.status === 'playing' && isHost) {
      await updateSetBetAmount(pin, latestSetId, amount);
    }
  };

  const handleFinishSideSet = (winner) => {
    if (!latestSideSet) return;
    const lData = latestSideSet.teams?.['teamA'] || { slots: {} };
    const rData = latestSideSet.teams?.['teamB'] || { slots: {} };
    if (Object.keys(lData.slots || {}).length === 0 || Object.keys(rData.slots || {}).length === 0) {
      showAlert("Lỗi", "Vui lòng chia đủ người cho Team A và Team B!");
      return;
    }

    const winnerName = winner === 'teamA' ? 'Team A' : 'Team B';

    showAlert("Xác nhận", `${winnerName} thắng?`, [
      { text: "Hủy" }, 
      { text: "Đúng", onPress: () => finishSideSet(pin, latestSideSetId, winner) }
    ]);
  };

  const handleStartSideSet = async () => {
    const amount = parseInt(sideBetAmountInput) || 5000;
    const prevTeams = latestSideSet?.status === 'completed' ? { 
      teams: latestSideSet?.teams,
      teamA: latestSideSet?.teamA, 
      teamB: latestSideSet?.teamB,
    } : null;
    await startNewSideSet(pin, amount, selectedMatchId, prevTeams);
  };

  // Xử lý thay đổi tiền cược set kèo phụ đang đấu
  const handleSideBetAmountChange = async (val) => {
    const amount = parseMoney(val);
    setSideBetAmountInput(amount ? amount.toString() : '');
    if (latestSideSet && latestSideSet.status === 'playing' && isHost) {
      await updateSideSetBetAmount(pin, latestSideSetId, amount);
    }
  };

  const getPlayerTeamSize = (pid) => {
    const isSide = activeTab === 'side';
    const activeSetData = isSide ? latestSideSet : latestSet;
    if (!activeSetData) return 0;
    const teamsMap = activeSetData.teams || {
      teamA: activeSetData.teamA || { slots: {} },
      teamB: activeSetData.teamB || { slots: {} },
      teamC: !isSide ? (activeSetData.teamC || { slots: {} }) : undefined
    };
    for (const tData of Object.values(teamsMap)) {
      if (!tData) continue;
      const pids = Object.values(tData.slots || {}).flat();
      if (pids.includes(pid)) return pids.length;
    }
    return 0;
  };

  const getOpponentsForPlayer = (pid) => {
    const isSide = activeTab === 'side';
    const activeSetData = isSide ? latestSideSet : latestSet;
    if (!activeSetData) return [];
    const teamsMap = activeSetData.teams || {
      teamA: activeSetData.teamA || { slots: {} },
      teamB: activeSetData.teamB || { slots: {} },
      teamC: !isSide ? (activeSetData.teamC || { slots: {} }) : undefined
    };
    
    let playerTeamKey = null;
    Object.entries(teamsMap).forEach(([tKey, tData]) => {
      if (!tData) return;
      const slots = tData?.slots || {};
      Object.values(slots).forEach(pids => {
        if (pids.includes(pid)) playerTeamKey = tKey;
      });
    });
    
    if (!playerTeamKey) return [];
    
    const [l, r] = isSide ? ['teamA', 'teamB'] : normalizeMatchup(activeSetData.matchup);
    if (playerTeamKey !== l && playerTeamKey !== r) return [];
    
    const opponentTeamKey = playerTeamKey === l ? r : l;
    const opponentTeam = teamsMap[opponentTeamKey];
    if (!opponentTeam) return [];
    
    const opponentPids = [];
    Object.values(opponentTeam.slots || {}).forEach(pids => {
      pids.forEach(opid => {
        opponentPids.push(opid);
      });
    });
    
    return opponentPids;
  };

  const onEditPlayerBet = (pid) => {
    if (!isHost) return;
    const isSide = activeTab === 'side';
    const activeSetData = isSide ? latestSideSet : latestSet;
    if (!activeSetData || activeSetData.status !== 'playing') return;

    const currentBetVal = activeSetData.playerBets?.[pid];
    let amountStr = '';
    let targetPlayerId = '';
    
    if (currentBetVal !== undefined && currentBetVal !== null) {
      if (typeof currentBetVal === 'object') {
        amountStr = (currentBetVal.amount || '').toString();
        targetPlayerId = currentBetVal.targetPlayerId || '';
      } else {
        amountStr = currentBetVal.toString();
      }
    }
    
    setCustomBetModalData({
      playerId: pid,
      playerName: players[pid]?.name,
      customAmount: amountStr,
      targetPlayerId: targetPlayerId,
    });
  };

  const handleSavePlayerBet = async () => {
    if (!customBetModalData) return;
    const { playerId, customAmount, targetPlayerId } = customBetModalData;
    const isSide = activeTab === 'side';
    const activeSetIdVal = isSide ? latestSideSetId : latestSetId;
    const updateFn = isSide ? updateSidePlayerBet : updatePlayerBet;
    
    if (customAmount.trim() === '') {
      await updateFn(pin, activeSetIdVal, playerId, null);
    } else {
      const amount = parseInt(customAmount) || 0;
      if (targetPlayerId) {
        await updateFn(pin, activeSetIdVal, playerId, {
          amount,
          targetPlayerId
        });
      } else {
        await updateFn(pin, activeSetIdVal, playerId, amount);
      }
    }
    setCustomBetModalData(null);
  };

  const handleClearPlayerBet = async () => {
    if (!customBetModalData) return;
    const isSide = activeTab === 'side';
    const activeSetIdVal = isSide ? latestSideSetId : latestSetId;
    const updateFn = isSide ? updateSidePlayerBet : updatePlayerBet;
    await updateFn(pin, activeSetIdVal, customBetModalData.playerId, null);
    setCustomBetModalData(null);
  };

  const getPlayerLedger = (pid) => {
    const ledger = [];
    if (!session) return ledger;
    
    if (session.sets) {
      const sortedSets = Object.entries(session.sets)
        .filter(([_, s]) => s.status === 'completed')
        .sort((a, b) => {
          const numA = parseInt(a[0].replace('set_', '')) || 0;
          const numB = parseInt(b[0].replace('set_', '')) || 0;
          return numA - numB;
        });

      sortedSets.forEach(([setId, s]) => {
        const teamsMap = s.teams || { teamA: s.teamA || { slots: {} }, teamB: s.teamB || { slots: {} }, teamC: s.teamC || { slots: {} } };
        const matchup = s.matchup || 'teamA_teamB';
        const winner = s.winner;
        const betAmount = s.betAmount || 5000;
        const playerBets = s.playerBets || {};

        let userTeamKey = null;
        let roleInSet = '';
        
        Object.entries(teamsMap).forEach(([tKey, tData]) => {
          const slots = tData?.slots || {};
          const inTeam = Object.values(slots).flat().includes(pid);
          if (inTeam) {
            userTeamKey = tKey;
            const slot = Object.entries(slots).find(([_, pids]) => pids.includes(pid));
            const letter = tKey.replace('team', '');
            roleInSet = `Team ${letter}${slot && slot[1].length > 1 ? ' (Thay người)' : ''}`;
          }
        });

        if (userTeamKey) {
          const { balanceChanges } = calculateSettlement(
            teamsMap, matchup, winner, betAmount, playerBets
          );
          const change = balanceChanges[pid] || 0;
          const customBet = playerBets[pid];

          ledger.push({
            type: 'set',
            id: setId,
            title: `Set ${setId.replace('set_', '')}`,
            roleInSet,
            customBet,
            change,
            createdAt: s.createdAt || (parseInt(setId.replace('set_', '')) * 1000),
          });
        }
      });
    }

    if (session.sideSets) {
      const sortedSideSets = Object.entries(session.sideSets)
        .filter(([_, s]) => s.status === 'completed')
        .sort((a, b) => {
          const numA = parseInt(a[0].replace('side_set_', '')) || 0;
          const numB = parseInt(b[0].replace('side_set_', '')) || 0;
          return numA - numB;
        });

      sortedSideSets.forEach(([setId, s]) => {
        const teamsMap = s.teams || { teamA: { slots: {} }, teamB: { slots: {} } };
        const matchup = s.matchup || 'teamA_teamB';
        const winner = s.winner;
        const betAmount = s.betAmount || 5000;
        const playerBets = s.playerBets || {};

        let userTeamKey = null;
        let roleInSet = '';
        
        Object.entries(teamsMap).forEach(([tKey, tData]) => {
          const slots = tData?.slots || {};
          const inTeam = Object.values(slots).flat().includes(pid);
          if (inTeam) {
            userTeamKey = tKey;
            const slot = Object.entries(slots).find(([_, pids]) => pids.includes(pid));
            roleInSet = `${tKey === 'teamA' ? 'Team A' : 'Team B'}${slot && slot[1].length > 1 ? ' (Thay người)' : ''}`;
          }
        });

        if (userTeamKey) {
          const { balanceChanges } = calculateSettlement(
            teamsMap, matchup, winner, betAmount, playerBets
          );
          const change = balanceChanges[pid] || 0;
          const customBet = playerBets[pid];

          // Compute local set index for this side match
          const siblings = sortedSideSets.filter(([_, otherSet]) => otherSet.sideMatchId === s.sideMatchId);
          const subIndex = siblings.findIndex(([id]) => id === setId);
          const localSetNumber = subIndex !== -1 ? subIndex + 1 : 1;
          const matchName = session.sideMatches?.[s.sideMatchId]?.name || 'Kèo phụ';

          ledger.push({
            type: 'sideSet',
            id: setId,
            title: `${matchName} (Set ${localSetNumber})`,
            roleInSet,
            customBet,
            change,
            createdAt: s.createdAt || (parseInt(setId.replace('side_set_', '')) * 1000),
          });
        }
      });
    }

    ledger.sort((a, b) => a.createdAt - b.createdAt);

    return ledger;
  };

  const handleGoBack = () => {
    router.replace('/');
  };

  const getStreakInfo = () => {
    if (!session?.sets) return null;
    const sortedSets = Object.entries(session.sets)
      .filter(([_, s]) => s.status === 'completed' && s.winner)
      .sort((a, b) => {
        const numA = parseInt(a[0].replace('set_', '')) || 0;
        const numB = parseInt(b[0].replace('set_', '')) || 0;
        return numB - numA;
      });
    if (sortedSets.length === 0) return null;
    const lastWinner = sortedSets[0][1].winner;
    let count = 0;
    for (const [_, s] of sortedSets) {
      if (s.winner === lastWinner) count++;
      else break;
    }
    return { winner: lastWinner, count };
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity onPress={handleGoBack} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={20} color={DuoTheme.colors.grayDark} />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>Sổ Kèo Trận Đấu</Text>
            <Text style={styles.headerSubtitle}>
              {latestSetId ? `Set ${latestSetId.replace('set_', '')} • ${latestSet?.status === 'playing' ? 'Đang diễn ra' : 'Đã xong'}` : 'Chưa bắt đầu'}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {/* Tiền thừa sân (Surplus) */}
          {(session.courtFee?.surplus > 0) && (
            <View style={styles.surplusChip}>
              <Ionicons name="cash-outline" size={14} color="#059669" style={{ marginRight: 4 }} />
              <Text style={styles.surplusChipText}>Thừa: {formatMoney(session.courtFee.surplus)}đ</Text>
            </View>
          )}

          {/* Win Streak vector */}
          {(() => {
            const streak = getStreakInfo();
            if (!streak || streak.count < 2) return null;
            return (
              <View style={styles.streakBadge}>
                <Ionicons name="flame" size={15} color="#EA580C" style={{ marginRight: 2 }} />
                <Text style={styles.streakText}>{streak.count}</Text>
              </View>
            );
          })()}
        </View>
      </View>

      {subTarget && (
        <View style={styles.subBanner}>
          <Ionicons name="warning" size={16} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.subBannerText}>Thay người Slot {subTarget.slotId} ({getTeamLabel(subTarget.team)}). Chọn người chờ!</Text>
          <TouchableOpacity onPress={() => setSubTarget(null)}><Text style={{color:'#fff', fontWeight: 'bold'}}>Hủy</Text></TouchableOpacity>
        </View>
      )}

      {sideSubTarget && (
        <View style={styles.subBanner}>
          <Ionicons name="warning" size={16} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.subBannerText}>Thay người Slot {sideSubTarget.slotId} ({sideSubTarget.team === 'teamA' ? 'Team A' : 'Team B'}). Chọn người chờ!</Text>
          <TouchableOpacity onPress={() => setSideSubTarget(null)}><Text style={{color:'#fff', fontWeight: 'bold'}}>Hủy</Text></TouchableOpacity>
        </View>
      )}

      <ScrollView 
        style={styles.body} 
        contentContainerStyle={{ paddingBottom: (isHost && (activeTab === 'main' || activeTab === 'side' || session.meta?.status === 'finished')) ? 120 : 20 }}
      >
        {session.meta?.status === 'finished' && (
          <View style={styles.checkoutBanner}>
            <Ionicons name="checkmark-done-circle" size={24} color="#34a853" style={{ marginRight: 8 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.checkoutTitle}>Buổi chơi đã kết thúc</Text>
              <Text style={styles.checkoutSub}>
                Tổng tiền sân: {parseInt(session.courtFee?.total || 0).toLocaleString('vi-VN')}đ ({session.courtFee?.splitMethod === 'equal' ? 'Chia đều' : 'Chia theo set'}).
                {session.courtFee?.surplus > 0 ? ` Tiền thừa: ${session.courtFee.surplus.toLocaleString('vi-VN')}đ.` : ''}
              </Text>
            </View>
          </View>
        )}

        {/* Dropdown Selection */}
        <View style={styles.dropdownContainer}>
          <TouchableOpacity 
            style={styles.dropdownButton} 
            onPress={() => setMatchSelectionModalVisible(true)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <Ionicons 
                name={selectedMatchId === 'main' ? "trophy-outline" : "gift-outline"} 
                size={18} 
                color="#1a73e8" 
                style={{ marginRight: 8 }} 
              />
              <Text style={styles.dropdownButtonText} numberOfLines={1}>
                {selectedMatchId === 'main' 
                  ? 'Trận đấu chính' 
                  : `Kèo phụ: ${session.sideMatches?.[selectedMatchId]?.name || 'Không xác định'} (${(session.sideMatches?.[selectedMatchId]?.betAmount || 5000).toLocaleString('vi-VN')}đ)`
                }
              </Text>
            </View>
            <Ionicons name="chevron-down" size={16} color="#666" />
          </TouchableOpacity>
        </View>

        {activeTab === 'main' && (
          <>
            {latestSet && (
              <View style={styles.activeSetHeader}>
            <Text style={styles.activeSetTitle}>
              Set {latestSetId.replace('set_', '')}: {latestSet.status === 'playing' ? 'Đang đấu' : 'Đã xong'}
            </Text>
            <Text style={styles.activeSetBet}>
              Cược: {parseInt(latestSet.betAmount || 5000).toLocaleString('vi-VN')}đ
            </Text>
          </View>
        )}

        {latestSet && (
          <View style={styles.matchupSelector}>
            <Text style={styles.matchupLabel}>Trận đấu:</Text>
            {isHost && latestSet.status === 'playing' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <TouchableOpacity 
                  style={styles.matchupSideBtn} 
                  onPress={() => handleSelectMatchupSide('left', normalizeMatchup(latestSet.matchup)[0], normalizeMatchup(latestSet.matchup)[1])}
                >
                  <Text style={styles.matchupSideText}>
                    {getTeamLabel(normalizeMatchup(latestSet.matchup)[0])}
                  </Text>
                  <Ionicons name="caret-down" size={14} color="#1a73e8" />
                </TouchableOpacity>
                
                <Text style={styles.vsText}>vs</Text>
                
                <TouchableOpacity 
                  style={styles.matchupSideBtn} 
                  onPress={() => handleSelectMatchupSide('right', normalizeMatchup(latestSet.matchup)[0], normalizeMatchup(latestSet.matchup)[1])}
                >
                  <Text style={styles.matchupSideText}>
                    {getTeamLabel(normalizeMatchup(latestSet.matchup)[1])}
                  </Text>
                  <Ionicons name="caret-down" size={14} color="#1a73e8" />
                </TouchableOpacity>
                
                <TouchableOpacity style={styles.addTeamBtn} onPress={handleAddTeam}>
                  <Ionicons name="add-circle" size={18} color="#1a73e8" />
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.matchupText}>
                {getTeamLabel(normalizeMatchup(latestSet.matchup)[0])} vs {getTeamLabel(normalizeMatchup(latestSet.matchup)[1])}
              </Text>
            )}
          </View>
        )}

        {(() => {
          const warning = computePayoutWarning(latestSet, false);
          if (!warning) return null;
          return (
            <View style={styles.warningCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Ionicons name="warning" size={18} color="#ea4335" style={{ marginRight: 6 }} />
                <Text style={styles.warningTitle}>Lực lượng cược chưa cân ({warning.nL} vs {warning.nR})</Text>
              </View>
              <Text style={styles.warningText}>
                {Math.abs(warning.nL - warning.nR) === 1
                  ? `Đội ${warning.nL < warning.nR ? warning.leftLabel : warning.rightLabel} đang ít hơn 1 người. 1 người có thể cược ${formatMoney((latestSet?.betAmount || 5000) * 2)}đ để 2 đội cân tiền. Payout dự kiến nếu giữ nguyên:`
                  : 'Tiền cược 2 bên đang chênh lệch. Payout dự kiến nếu thắng:'}
              </Text>
              <View style={styles.warningDetails}>
                <View style={styles.warningCol}>
                  <Text style={styles.warningColHeader}>{warning.leftLabel} thắng:</Text>
                  {warning.leftPayouts.map((p, idx) => (
                    <Text key={idx} style={styles.warningPayoutText}>• {p.name}: +{formatMoney(p.win)}đ</Text>
                  ))}
                </View>
                <View style={styles.warningCol}>
                  <Text style={styles.warningColHeader}>{warning.rightLabel} thắng:</Text>
                  {warning.rightPayouts.map((p, idx) => (
                    <Text key={idx} style={styles.warningPayoutText}>• {p.name}: +{formatMoney(p.win)}đ</Text>
                  ))}
                </View>
              </View>
            </View>
          );
        })()}

        {latestSet ? (
          <View style={styles.teamsContainer}>
            {activeTeams.map(tKey => {
              const [l, r] = normalizeMatchup(latestSet?.matchup);
              const isResting = tKey !== l && tKey !== r;
              const tData = latestSet?.teams?.[tKey] || latestSet?.[tKey] || { slots: {} };
              
              const teamColors = {
                teamA: '#e8f0fe',
                teamB: '#fce8e6',
                teamC: '#e6f4ea',
                teamD: '#f3e8fd',
                teamE: '#fff7e6',
              };
              const color = teamColors[tKey] || '#f1f3f4';

              return (
                <TeamColumn 
                  key={tKey}
                  title={getTeamLabel(tKey)}
                  color={color} 
                  slots={tData?.slots || {}} 
                  players={players} 
                  isHost={isHost} 
                  isPlaying={latestSet?.status === 'playing'} 
                  subTarget={subTarget} 
                  onSelectSlot={(id) => handleSelectSlotForSub(tKey, id)} 
                  onRemovePlayer={(pid) => handleRemoveFromTeam(pid, tKey)}
                  playerBets={latestSet?.playerBets || {}}
                  onEditPlayerBet={onEditPlayerBet}
                  isResting={isResting}
                  onDeleteTeam={handleDeleteTeam}
                  canDelete={isHost && isResting && activeTeams.length > 2 && latestSet?.status === 'playing'}
                />
              );
            })}
          </View>
        ) : (
          <View style={styles.center}><Text>Chưa có set nào. Bấm {"'Bắt đầu'"} bên dưới!</Text></View>
        )}

        <View style={styles.waitingContainer}>
          <Text style={styles.sectionTitle}>Danh sách chờ (Bấm để chọn đội):</Text>
          {isHost && (
            <View style={styles.addPlayerForm}>
              <TextInput style={styles.addPlayerInput} placeholder="Nhập tên..." value={newPlayerName} onChangeText={setNewPlayerName} onSubmitEditing={handleAddNewPlayer} />
              <TouchableOpacity style={styles.addBtn} onPress={handleAddNewPlayer}><Text style={styles.addBtnText}>+</Text></TouchableOpacity>
            </View>
          )}
          <View style={styles.chipsContainer}>
            {getWaitingPlayers().map(pid => (
              <TouchableOpacity
                key={pid}
                style={[
                  styles.chip,
                  teamPickerPlayerId === pid && styles.selectedChip
                ]}
                disabled={!isHost || latestSet?.status !== 'playing' || !!subTarget}
                onPress={() => onWaitingPlayerPress(pid)}
              >
                <Text style={styles.chipText}>{players[pid]?.name}</Text>
              </TouchableOpacity>
            ))}
            {getWaitingPlayers().length === 0 && <Text style={{color:'#999'}}>Tất cả đã lên sân!</Text>}
          </View>
          {teamPickerPlayerId && players[teamPickerPlayerId] && (
            <View style={styles.teamPicker}>
              <Text style={styles.teamPickerTitle}>Thêm {players[teamPickerPlayerId]?.name} vào:</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 5 }}>
                {activeTeams.map(tKey => {
                  const [l, r] = normalizeMatchup(latestSet?.matchup);
                  const isResting = tKey !== l && tKey !== r;
                  const btnColors = {
                    teamA: '#1a73e8',
                    teamB: '#ea4335',
                    teamC: '#34a853',
                  };
                  const btnBg = isResting ? '#70757a' : (btnColors[tKey] || '#673ab7');
                  return (
                    <TouchableOpacity 
                      key={tKey}
                      style={[styles.teamPickerBtn, { backgroundColor: btnBg }]} 
                      onPress={() => handleAddToTeam(teamPickerPlayerId, tKey)}
                    >
                      <Text style={styles.teamPickerBtnText}>
                        {getTeamLabel(tKey)}{isResting ? ' (Nghỉ)' : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity style={styles.teamPickerCancel} onPress={() => setTeamPickerPlayerId(null)}>
                  <Text style={styles.teamPickerCancelText}>Hủy</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </>
    )}

        {/* Kèo phụ */}
        {activeTab === 'side' && (
          <>
            {latestSideSet && (
              <View style={styles.activeSetHeader}>
                <Text style={styles.activeSetTitle}>
                  Set Kèo phụ {latestSideSetId.replace('side_set_', '')}: {latestSideSet.status === 'playing' ? 'Đang đấu' : 'Đã xong'}
                </Text>
                <Text style={styles.activeSetBet}>
                  Cược: {parseInt(latestSideSet.betAmount || 5000).toLocaleString('vi-VN')}đ
                </Text>
              </View>
            )}

            {latestSideSet && (
              <View style={styles.matchupSelector}>
                <Text style={styles.matchupLabel}>Trận đấu:</Text>
                <Text style={styles.matchupText}>Team A vs Team B</Text>
              </View>
            )}

            {(() => {
              const warning = computePayoutWarning(latestSideSet, true);
              if (!warning) return null;
              return (
                <View style={styles.warningCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                    <Ionicons name="warning" size={18} color="#ea4335" style={{ marginRight: 6 }} />
                    <Text style={styles.warningTitle}>Lực lượng cược chưa cân ({warning.nL} vs {warning.nR})</Text>
                  </View>
                  <Text style={styles.warningText}>
                    {Math.abs(warning.nL - warning.nR) === 1
                      ? `Đội ${warning.nL < warning.nR ? warning.leftLabel : warning.rightLabel} đang ít hơn 1 người. 1 người có thể cược ${formatMoney((latestSideSet?.betAmount || 5000) * 2)}đ để 2 đội cân tiền. Payout dự kiến nếu giữ nguyên:`
                      : 'Tiền cược 2 bên đang chênh lệch. Payout dự kiến nếu thắng:'}
                  </Text>
                  <View style={styles.warningDetails}>
                    <View style={styles.warningCol}>
                      <Text style={styles.warningColHeader}>{warning.leftLabel} thắng:</Text>
                      {warning.leftPayouts.map((p, idx) => (
                        <Text key={idx} style={styles.warningPayoutText}>• {p.name}: +{formatMoney(p.win)}đ</Text>
                      ))}
                    </View>
                    <View style={styles.warningCol}>
                      <Text style={styles.warningColHeader}>{warning.rightLabel} thắng:</Text>
                      {warning.rightPayouts.map((p, idx) => (
                        <Text key={idx} style={styles.warningPayoutText}>• {p.name}: +{formatMoney(p.win)}đ</Text>
                      ))}
                    </View>
                  </View>
                </View>
              );
            })()}

            {latestSideSet ? (
              <View style={styles.teamsContainer}>
                {['teamA', 'teamB'].map(tKey => {
                  const tData = latestSideSet?.teams?.[tKey] || latestSideSet?.[tKey] || { slots: {} };
                  
                  const teamColors = {
                    teamA: '#e8f0fe',
                    teamB: '#fce8e6',
                  };
                  const color = teamColors[tKey] || '#f1f3f4';

                  return (
                    <TeamColumn 
                      key={tKey}
                      title={tKey === 'teamA' ? 'Team A' : 'Team B'}
                      color={color} 
                      slots={tData?.slots || {}} 
                      players={players} 
                      isHost={isHost} 
                      isPlaying={latestSideSet?.status === 'playing'} 
                      subTarget={sideSubTarget} 
                      onSelectSlot={(id) => handleSelectSlotForSub(tKey, id)} 
                      onRemovePlayer={(pid) => handleRemoveFromTeam(pid, tKey)}
                      playerBets={latestSideSet?.playerBets || {}}
                      onEditPlayerBet={onEditPlayerBet}
                      isResting={false}
                    />
                  );
                })}
              </View>
            ) : (
              <View style={styles.center}><Text>Chưa có set kèo phụ nào. Bấm {"'Bắt đầu'"} bên dưới!</Text></View>
            )}

            <View style={styles.waitingContainer}>
              <Text style={styles.sectionTitle}>Danh sách chờ (Bấm để chọn đội):</Text>
              {isHost && (
                <View style={styles.addPlayerForm}>
                  <TextInput style={styles.addPlayerInput} placeholder="Nhập tên..." value={newPlayerName} onChangeText={setNewPlayerName} onSubmitEditing={handleAddNewPlayer} />
                  <TouchableOpacity style={styles.addBtn} onPress={handleAddNewPlayer}><Text style={styles.addBtnText}>+</Text></TouchableOpacity>
                </View>
              )}
              <View style={styles.chipsContainer}>
                {getWaitingPlayersForSide().map(pid => (
                  <TouchableOpacity
                    key={pid}
                    style={[
                      styles.chip,
                      sideTeamPickerPlayerId === pid && styles.selectedChip
                    ]}
                    disabled={!isHost || latestSideSet?.status !== 'playing' || !!sideSubTarget}
                    onPress={() => onWaitingPlayerPress(pid)}
                  >
                    <Text style={styles.chipText}>{players[pid]?.name}</Text>
                  </TouchableOpacity>
                ))}
                {getWaitingPlayersForSide().length === 0 && <Text style={{color:'#999'}}>Tất cả đã lên sân!</Text>}
              </View>
              {sideTeamPickerPlayerId && players[sideTeamPickerPlayerId] && (
                <View style={styles.teamPicker}>
                  <Text style={styles.teamPickerTitle}>Thêm {players[sideTeamPickerPlayerId]?.name} vào:</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 5 }}>
                    {['teamA', 'teamB'].map(tKey => {
                      const btnColors = {
                        teamA: '#1a73e8',
                        teamB: '#ea4335',
                      };
                      const btnBg = btnColors[tKey];
                      return (
                        <TouchableOpacity 
                          key={tKey}
                          style={[styles.teamPickerBtn, { backgroundColor: btnBg }]} 
                          onPress={() => handleAddToTeam(sideTeamPickerPlayerId, tKey)}
                        >
                          <Text style={styles.teamPickerBtnText}>
                            {tKey === 'teamA' ? 'Team A' : 'Team B'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                    <TouchableOpacity style={styles.teamPickerCancel} onPress={() => setSideTeamPickerPlayerId(null)}>
                      <Text style={styles.teamPickerCancelText}>Hủy</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

          </>
        )}

        {/* Lịch sử các set */}
        <View style={styles.historyContainer}>
          <Text style={styles.sectionTitle}>Lịch sử:</Text>
          {(() => {
            const completedMainSets = Object.entries(session.sets || {})
              .filter(([_, s]) => s.status === 'completed')
              .map(([setId, s]) => {
                const setIndex = parseInt(setId.replace('set_', '')) || 0;
                return {
                  id: setId,
                  setIndex,
                  type: 'main_set',
                  completedAt: s.completedAt || (session.createdAt ? (session.createdAt + setIndex * 1000 * 60 * 30) : 0),
                  data: s
                };
              });

            const allSideSetsCompleted = Object.entries(session.sideSets || {})
              .filter(([_, s]) => s.status === 'completed')
              .sort((a, b) => {
                const numA = parseInt(a[0].replace('side_set_', '')) || 0;
                const numB = parseInt(b[0].replace('side_set_', '')) || 0;
                return numA - numB;
              });

            const completedSideSets = allSideSetsCompleted.map(([setId, s]) => {
              const siblings = allSideSetsCompleted.filter(([_, otherSet]) => otherSet.sideMatchId === s.sideMatchId);
              const subIndex = siblings.findIndex(([id]) => id === setId);
              const localSetNumber = subIndex !== -1 ? subIndex + 1 : 1;
              const matchName = session.sideMatches?.[s.sideMatchId]?.name || 'Kèo phụ';
              
              const setIndex = parseInt(setId.replace('side_set_', '')) || 0;
              return {
                id: setId,
                setIndex,
                type: 'side_set',
                completedAt: s.completedAt || (session.createdAt ? (session.createdAt + setIndex * 1000 * 60 * 30) : 0),
                localSetNumber,
                matchName,
                data: s
              };
            });

            const mergedList = [...completedMainSets, ...completedSideSets].sort((a, b) => {
              if (b.setIndex !== a.setIndex) return b.setIndex - a.setIndex;
              return (b.completedAt || 0) - (a.completedAt || 0);
            });

            if (mergedList.length === 0) {
              return <Text style={{color:'#999', fontSize: 12}}>Chưa có set đấu hay kèo phụ nào hoàn thành</Text>;
            }

            return mergedList.map(item => {
              if (item.type === 'main_set') {
                const s = item.data;
                const setId = item.id;
                const [l, r] = normalizeMatchup(s.matchup);
                const hasCustomBets = s.playerBets && Object.keys(s.playerBets).length > 0;
                return (
                  <TouchableOpacity 
                    key={setId} 
                    style={styles.historyItem} 
                    onPress={() => setHistoryModalData({ type: 'main_set', setId, setData: s })}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="bookmark-outline" size={14} color="#1a73e8" style={{ marginRight: 6 }} />
                      <Text style={styles.historyText}>Set {setId.replace('set_', '')}: {getTeamLabel(s.winner)} thắng</Text>
                      {s.isEdited && (
                        <View style={{ backgroundColor: '#fff3e0', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, marginLeft: 6, borderWidth: 1, borderColor: '#ff9800' }}>
                          <Text style={{ fontSize: 10, color: '#e65100', fontWeight: 'bold' }}>Đã sửa</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.historySub}>
                      Cược: {parseInt(s.betAmount || 5000).toLocaleString('vi-VN')}đ | Trận: {getTeamLabel(l)} vs {getTeamLabel(r)}{hasCustomBets ? ' (Có cược riêng)' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              } else {
                const s = item.data;
                const setId = item.id;
                const hasCustomBets = s.playerBets && Object.keys(s.playerBets).length > 0;
                return (
                  <TouchableOpacity 
                    key={setId} 
                    style={[styles.historyItem, { borderLeftColor: '#34a853' }]} 
                    onPress={() => setHistoryModalData({ type: 'side_set', setId, setData: s })}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="bookmark" size={14} color="#34a853" style={{ marginRight: 6 }} />
                      <Text style={styles.historyText}>{item.matchName} - Set {item.localSetNumber}: {s.winner === 'teamA' ? 'Team A' : 'Team B'} thắng</Text>
                      {s.isEdited && (
                        <View style={{ backgroundColor: '#fff3e0', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, marginLeft: 6, borderWidth: 1, borderColor: '#ff9800' }}>
                          <Text style={{ fontSize: 10, color: '#e65100', fontWeight: 'bold' }}>Đã sửa</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.historySub}>
                      Cược: {parseInt(s.betAmount || 5000).toLocaleString('vi-VN')}đ | Trận: Team A vs Team B{hasCustomBets ? ' (Có cược riêng)' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              }
            });
          })()}
        </View>

        {/* Bảng thanh toán cuối buổi */}
        <View style={styles.summaryContainer}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
              <Ionicons name="trophy" size={20} color={DuoTheme.colors.yellowDark} style={{ marginRight: 6 }} />
              <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Thanh toán & Chốt sổ</Text>
            </View>
            {isHost && session.meta?.status !== 'finished' && (
              <TouchableOpacity 
                style={styles.finishSessionBtn}
                onPress={() => {
                  setCourtFeeInput('');
                  setFinishModalVisible(true);
                }}
              >
                <Text style={styles.finishSessionBtnText}>Kết thúc buổi</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Duolingo Gamification Progress Bar */}
          {(() => {
            const playerList = Object.entries(players);
            const totalP = playerList.length;
            const settledP = playerList.filter(([_, p]) => p.isSettled).length;
            const pct = totalP > 0 ? Math.round((settledP / totalP) * 100) : 0;
            return (
              <View style={styles.progressContainer}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={styles.progressLabel}>Tiến độ thanh toán:</Text>
                  <Text style={styles.progressValue}>{settledP}/{totalP} người ({pct}%)</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${pct}%` }]} />
                </View>
              </View>
            );
          })()}

          {Object.entries(players).map(([pid, p]) => {
            const balance = Math.round(p.balance || 0);
            const isSettled = p.isSettled || false;
            
            const courtFeeShare = session.courtFee?.shares?.[pid] || 0;
            const balanceBeforeCourtFee = balance + courtFeeShare;

            return (
              <View key={pid} style={[styles.playerBalanceRow, isSettled && styles.settledRow]}>
                <TouchableOpacity 
                  style={{ flex: 1, paddingVertical: 4, flexDirection: 'row', alignItems: 'center' }} 
                  onPress={() => setLedgerModalData({ playerId: pid, name: p.name })}
                >
                  <View style={[styles.playerAvatar, { backgroundColor: isSettled ? '#E2E8F0' : '#EFF6FF' }]}>
                    <Text style={[styles.playerAvatarText, { color: isSettled ? '#64748B' : DuoTheme.colors.primary }]}>
                      {(p.name || 'P').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={[styles.playerName, isSettled && styles.settledText]}>
                        {p.name}
                      </Text>
                      {isSettled && (
                        <View style={styles.settledBadge}>
                          <Ionicons name="checkmark-circle" size={13} color={DuoTheme.colors.green} />
                          <Text style={styles.settledBadgeText}>Đã thu</Text>
                        </View>
                      )}
                    </View>
                    {session.meta?.status === 'finished' && courtFeeShare > 0 ? (
                      <Text style={styles.playerBreakdownText}>
                        Cược: {balanceBeforeCourtFee > 0 ? '+' : ''}{formatMoney(balanceBeforeCourtFee)}đ | Sân: -{formatMoney(courtFeeShare)}đ
                      </Text>
                    ) : (
                      <Text style={styles.playerTapLedgerHint}>
                        Xem chi tiết sổ cái
                      </Text>
                    )}
                  </View>
                  <Ionicons name="receipt-outline" size={15} color={DuoTheme.colors.grayMuted} style={{ marginLeft: 6, marginRight: 8 }} />
                </TouchableOpacity>
                
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ 
                    color: balance > 0 ? DuoTheme.colors.green : balance < 0 ? DuoTheme.colors.red : DuoTheme.colors.grayDark, 
                    fontWeight: '800', 
                    fontSize: 15,
                    marginRight: 10,
                    textDecorationLine: isSettled ? 'line-through' : 'none'
                  }}>
                    {balance > 0 ? '+' : ''}{formatMoney(balance)}đ
                  </Text>
                  
                  {isHost && (
                    <TouchableOpacity 
                      style={[
                        styles.settleBtn, 
                        isSettled ? styles.settleBtnUndo : styles.settleBtnDone
                      ]} 
                      onPress={() => togglePlayerSettled(pin, pid, !isSettled)}
                    >
                      <Text style={styles.settleBtnText}>{isSettled ? 'Sửa' : 'Thu'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
          {Object.keys(players).length === 0 && <Text style={{color:'#999'}}>Chưa có người chơi...</Text>}
        </View>

        {/* Modal Kết thúc buổi chơi */}
        <Modal
          visible={finishModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setFinishModalVisible(false)}
          statusBarTranslucent={true}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { maxHeight: '85%' }]}>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-between' }}>
                  <View>
                    <Text style={styles.modalTitle}>Kết thúc buổi chơi</Text>
                    <Text style={styles.modalSubTitle}>Nhập tổng tiền sân để tính toán chia phí cho các thành viên.</Text>
                    
                    <TextInput
                      style={[styles.addPlayerInput, { width: '100%', marginBottom: 15, paddingVertical: 10 }]}
                      keyboardType="numeric"
                      placeholder="Tổng tiền sân (đ)..."
                      value={formatMoney(courtFeeInput)}
                      onChangeText={(val) => setCourtFeeInput(parseMoney(val).toString())}
                      autoFocus
                    />

                    <Text style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 8, color: '#333' }}>
                      Phương thức chia tiền sân:
                    </Text>
                    
                    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
                      <TouchableOpacity
                        style={{
                          flex: 1,
                          paddingVertical: 12,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: courtFeeSplitMethod === 'equal' ? '#1a73e8' : '#ccc',
                          backgroundColor: courtFeeSplitMethod === 'equal' ? '#e8f0fe' : '#fff',
                          alignItems: 'center'
                        }}
                        onPress={() => setCourtFeeSplitMethod('equal')}
                      >
                        <Text style={{ fontSize: 12, color: courtFeeSplitMethod === 'equal' ? '#1a73e8' : '#666', fontWeight: 'bold' }}>
                          Chia đều
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{
                          flex: 1,
                          paddingVertical: 12,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: courtFeeSplitMethod === 'proportional' ? '#1a73e8' : '#ccc',
                          backgroundColor: courtFeeSplitMethod === 'proportional' ? '#e8f0fe' : '#fff',
                          alignItems: 'center'
                        }}
                        onPress={() => setCourtFeeSplitMethod('proportional')}
                      >
                        <Text style={{ fontSize: 12, color: courtFeeSplitMethod === 'proportional' ? '#1a73e8' : '#666', fontWeight: 'bold' }}>
                          Chia theo set đấu
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                    <TouchableOpacity 
                      style={[styles.actionBtn, { backgroundColor: '#666' }]} 
                      onPress={() => setFinishModalVisible(false)}
                    >
                      <Text style={styles.btnText}>Hủy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.actionBtn, { backgroundColor: '#34a853' }]} 
                      onPress={async () => {
                        const fee = parseInt(courtFeeInput) || 0;
                        if (fee <= 0) {
                          showAlert("Lỗi", "Vui lòng nhập tiền sân hợp lệ!");
                          return;
                        }
                        await finishSession(pin, fee, courtFeeSplitMethod);
                        setFinishModalVisible(false);
                        showAlert("Thành công", "Đã kết thúc buổi chơi và chia tiền sân!");
                      }}
                    >
                      <Text style={styles.btnText}>Xác nhận</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Modal Chọn trận đấu / kèo */}
        <Modal
          visible={matchSelectionModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setMatchSelectionModalVisible(false)}
          statusBarTranslucent={true}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '80%' }]}>
              <Text style={styles.modalTitle}>Chọn trận đấu / kèo</Text>
              <Text style={styles.modalSubTitle}>Chọn trận đấu chính hoặc kèo phụ đang diễn ra</Text>

              <ScrollView style={{ marginVertical: 10 }}>
                {/* Trận đấu chính */}
                <TouchableOpacity
                  style={[
                    styles.dropdownItem,
                    selectedMatchId === 'main' && styles.dropdownItemActive,
                    { marginBottom: 8 }
                  ]}
                  onPress={() => {
                    setSelectedMatchId('main');
                    setMatchSelectionModalVisible(false);
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <Ionicons 
                      name="trophy-outline" 
                      size={18} 
                      color={selectedMatchId === 'main' ? "#1a73e8" : "#666"} 
                      style={{ marginRight: 8 }} 
                    />
                    <Text style={[styles.dropdownItemText, selectedMatchId === 'main' && styles.dropdownItemTextActive]}>
                      Trận đấu chính
                    </Text>
                  </View>
                  {selectedMatchId === 'main' && <Ionicons name="checkmark-circle" size={18} color="#1a73e8" />}
                </TouchableOpacity>

                {/* Danh sách kèo phụ */}
                {Object.entries(session.sideMatches || {}).map(([smId, sm]) => {
                  const isSelected = selectedMatchId === smId;
                  return (
                    <View 
                      key={smId} 
                      style={[
                        styles.dropdownItem,
                        isSelected && styles.dropdownItemActive,
                        { marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }
                      ]}
                    >
                      <TouchableOpacity
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                        onPress={() => {
                          setSelectedMatchId(smId);
                          setMatchSelectionModalVisible(false);
                        }}
                      >
                        <Ionicons 
                          name="gift-outline" 
                          size={18} 
                          color={isSelected ? "#1a73e8" : "#666"} 
                          style={{ marginRight: 8 }} 
                        />
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={[styles.dropdownItemText, isSelected && styles.dropdownItemTextActive]} numberOfLines={1}>
                            {sm.name}
                          </Text>
                          <Text style={{ fontSize: 11, color: '#666' }}>
                            Cược: {parseInt(sm.betAmount || 5000).toLocaleString('vi-VN')}đ
                          </Text>
                        </View>
                        {isSelected && <Ionicons name="checkmark-circle" size={18} color="#1a73e8" style={{ marginRight: 8 }} />}
                      </TouchableOpacity>

                      {isHost && session.meta?.status !== 'finished' && (
                        <TouchableOpacity
                          style={{ padding: 4 }}
                          onPress={() => {
                            showAlert("Xác nhận", `Xóa kèo phụ "${sm.name}"? Tất cả set đấu và lịch sử của kèo phụ này sẽ bị xóa hoàn toàn.`, [
                              { text: "Hủy" },
                              { 
                                text: "Xóa", 
                                style: "destructive", 
                                onPress: () => {
                                  handleDeleteSideMatch(smId);
                                } 
                              }
                            ]);
                          }}
                        >
                          <Ionicons name="trash-outline" size={18} color="#d93025" />
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </ScrollView>

              {isHost && session.meta?.status !== 'finished' && (
                <TouchableOpacity
                  style={[styles.addSideBetBtn, { width: '100%', justifyContent: 'center', marginVertical: 10 }]}
                  onPress={() => {
                    setMatchSelectionModalVisible(false);
                    setAddSideMatchModalVisible(true);
                  }}
                >
                  <Ionicons name="add-circle" size={18} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.addSideBetBtnText}>+ Thêm kèo phụ mới</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity 
                style={[styles.modalCloseBtn, { backgroundColor: '#666', marginTop: 10 }]} 
                onPress={() => setMatchSelectionModalVisible(false)}
              >
                <Text style={styles.modalCloseText}>Hủy</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Modal Thêm kèo phụ mới */}
        <Modal
          visible={addSideMatchModalVisible}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setAddSideMatchModalVisible(false)}
          statusBarTranslucent={true}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { maxHeight: '85%' }]}>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-between' }}>
                  <View>
                    <Text style={styles.modalTitle}>Thêm kèo phụ mới</Text>
                    <Text style={styles.modalSubTitle}>Tạo một kèo phụ tự lập mới chia sẻ thành viên và lịch sử</Text>

                    <View style={{ marginBottom: 15 }}>
                      <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#333', marginBottom: 6 }}>Tên kèo phụ:</Text>
                      <TextInput
                        style={[styles.addPlayerInput, { width: '100%', paddingVertical: 8 }]}
                        placeholder="VD: Kèo phụ Sân 2, Kèo bia..."
                        value={newSideMatchName}
                        onChangeText={setNewSideMatchName}
                      />
                    </View>

                    <View style={{ marginBottom: 20 }}>
                      <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#333', marginBottom: 6 }}>Mức cược chung của set (đ):</Text>
                      <TextInput
                        style={[styles.addPlayerInput, { width: '100%', paddingVertical: 8 }]}
                        keyboardType="numeric"
                        placeholder="VD: 5.000"
                        value={formatMoney(newSideMatchBetAmount)}
                        onChangeText={(val) => setNewSideMatchBetAmount(parseMoney(val).toString())}
                      />
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                    <TouchableOpacity 
                      style={[styles.actionBtn, { backgroundColor: '#666' }]} 
                      onPress={() => setAddSideMatchModalVisible(false)}
                    >
                      <Text style={styles.btnText}>Hủy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.actionBtn, { backgroundColor: '#1a73e8' }]} 
                      onPress={handleCreateSideMatch}
                    >
                      <Text style={styles.btnText}>Tạo kèo</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Modal chi tiết set hoặc kèo phụ */}
        <Modal
          visible={!!historyModalData}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setHistoryModalData(null)}
          statusBarTranslucent={true}
        >
          {historyModalData && (
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View>
                  <Text style={styles.modalTitle}>
                    {historyModalData.type === 'main_set'
                      ? `Chi tiết Set ${historyModalData.setId.replace('set_', '')}`
                      : `Chi tiết Kèo phụ: ${session.sideMatches?.[historyModalData.setData?.sideMatchId]?.name || 'Kèo phụ'} - Set ${historyModalData.setId.replace('side_set_', '')}`
                    }
                  </Text>
                  <Text style={styles.modalSubTitle}>
                    {getTeamLabel(historyModalData.setData?.winner)} thắng
                  </Text>
                  <Text style={[styles.modalSubTitle, { marginTop: -15, marginBottom: 20 }]}>
                    Cược: {parseInt(historyModalData.setData?.betAmount || 5000).toLocaleString('vi-VN')}đ | Trận:{' '}
                    {historyModalData.type === 'main_set'
                      ? `${getTeamLabel(normalizeMatchup(historyModalData.setData?.matchup)[0])} vs ${getTeamLabel(normalizeMatchup(historyModalData.setData?.matchup)[1])}`
                      : 'Team A vs Team B'
                    }
                  </Text>

                  <View style={styles.modalTeamsContainer}>
                    {Object.keys(historyModalData.setData?.teams || (historyModalData.type === 'side_set' ? { teamA: 1, teamB: 1 } : { teamA: 1, teamB: 1, teamC: 1 }))
                      .filter(tKey => {
                        const [l, r] = historyModalData.type === 'side_set' ? ['teamA', 'teamB'] : normalizeMatchup(historyModalData.setData?.matchup);
                        return tKey === l || tKey === r;
                      })
                      .map(tKey => {
                        const isWinner = tKey === historyModalData.setData?.winner;
                        const tData = historyModalData.setData?.teams?.[tKey] || historyModalData.setData?.[tKey] || { slots: {} };
                        return (
                          <View key={tKey} style={[
                            styles.modalTeamCol,
                            isWinner && { backgroundColor: '#e6f4ea', borderColor: '#34a853' }
                          ]}>
                            <Text style={[styles.modalTeamTitle, isWinner && { color: '#137333' }]}>
                              {getTeamLabel(tKey)}
                            </Text>
                          {Object.entries(tData.slots || {}).map(([slotId, pids]) => (
                            <View key={slotId} style={styles.modalSlot}>
                              <Text style={styles.modalSlotText}>
                                {pids.map(pid => {
                                  const pName = players[pid]?.name || pid;
                                  const customBet = historyModalData.setData?.playerBets?.[pid];
                                  if (customBet !== undefined && customBet !== null) {
                                    if (typeof customBet === 'object') {
                                      const oppName = players[customBet.targetPlayerId]?.name || 'Đối thủ';
                                      return `${pName} (Cược riêng: ${formatMoney(customBet.amount)}đ ➔ ${oppName})`;
                                    } else {
                                      return `${pName} (Cược riêng: ${formatMoney(customBet)}đ)`;
                                    }
                                  }
                                  return pName;
                                }).join(' & ')}
                              </Text>
                              {pids.length > 1 && <Text style={styles.subTag}>Thay người</Text>}
                            </View>
                          ))}
                          {Object.keys(tData.slots || {}).length === 0 && <Text style={{textAlign:'center',color:'#999', fontSize: 10}}>Trống</Text>}
                        </View>
                      );
                    })}
                  </View>

                  {isHost && session.meta?.status !== 'finished' && (() => {
                    const [tL, tR] = historyModalData.type === 'side_set'
                      ? ['teamA', 'teamB']
                      : normalizeMatchup(historyModalData.setData?.matchup);
                    const currentWinner = historyModalData.setData?.winner;
                    const targetWinner = currentWinner === tL ? tR : tL;
                    const targetWinnerName = getTeamLabel(targetWinner);

                    return (
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 15, marginBottom: 10 }}>
                        <TouchableOpacity
                          style={[styles.actionBtn, { backgroundColor: '#1a73e8', flex: 1 }]}
                          onPress={() => {
                            showAlert("Xác nhận đổi kết quả", `Đổi kết quả Set này thành ${targetWinnerName} thắng?`, [
                              { text: "Hủy" },
                              {
                                text: "Đồng ý",
                                onPress: async () => {
                                  const updateFn = historyModalData.type === 'side_set' ? updateSideSetWinner : updateSetWinner;
                                  const ok = await updateFn(pin, historyModalData.setId, targetWinner);
                                  if (ok) {
                                    setHistoryModalData(prev => ({
                                      ...prev,
                                      setData: {
                                        ...prev.setData,
                                        winner: targetWinner,
                                        isEdited: targetWinner !== (prev.setData.originalWinner || currentWinner)
                                      }
                                    }));
                                    showAlert("Thành công", `Đã đổi kết quả thành ${targetWinnerName} thắng!`);
                                  }
                                }
                              }
                            ]);
                          }}
                        >
                          <Text style={styles.btnText}>Chỉnh sửa: Đổi sang {targetWinnerName} thắng</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })()}
                </View>

                <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setHistoryModalData(null)}>
                  <Text style={styles.modalCloseText}>Đóng</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Modal>

        {/* Modal nhập cược cá nhân */}
        <Modal
          visible={!!customBetModalData}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setCustomBetModalData(null)}
          statusBarTranslucent={true}
        >
          {customBetModalData && (
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={{ flex: 1 }}
            >
              <View style={styles.modalOverlay}>
                <View style={[styles.modalContent, { maxHeight: '85%' }]}>
                  <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-between' }}>
                    <View>
                      <Text style={styles.modalTitle}>Cược riêng: {customBetModalData.playerName}</Text>
                      <Text style={styles.modalSubTitle}>Đặt mức cược riêng cho thành viên này trong set hiện tại (bỏ trống để dùng mức cược chung của set).</Text>
                      
                      <TextInput
                        style={[styles.addPlayerInput, { width: '100%', marginBottom: 15, paddingVertical: 10 }]}
                        keyboardType="numeric"
                        placeholder="Mức cược riêng (đ)..."
                        value={formatMoney(customBetModalData.customAmount)}
                        onChangeText={(val) => setCustomBetModalData(prev => ({ ...prev, customAmount: parseMoney(val).toString() }))}
                        autoFocus
                      />

                      <Text style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 8, color: '#333' }}>
                        Đối thủ cược 1-on-1 (Không bắt buộc):
                      </Text>
                      
                      {(() => {
                        const teamSize = getPlayerTeamSize(customBetModalData.playerId);
                        if (teamSize <= 1) {
                          return (
                            <Text style={{ fontSize: 12, color: '#666', fontStyle: 'italic', marginBottom: 15 }}>
                              Đội chỉ có 1 người: mức cược sẽ áp dụng cho cả đội đối thủ (Pool).
                            </Text>
                          );
                        }

                        const opponents = getOpponentsForPlayer(customBetModalData.playerId);
                        if (opponents.length === 0) {
                          return (
                            <Text style={{ fontSize: 12, color: '#999', marginBottom: 15, fontStyle: 'italic' }}>
                              Không có đối thủ khả dụng (người chơi phải thuộc đội đang đấu).
                            </Text>
                          );
                        }
                        
                        return (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 15 }}>
                            <TouchableOpacity
                              style={{
                                paddingVertical: 6,
                                paddingHorizontal: 12,
                                borderRadius: 8,
                                borderWidth: 1,
                                borderColor: !customBetModalData.targetPlayerId ? '#34a853' : '#ccc',
                                backgroundColor: !customBetModalData.targetPlayerId ? '#e6f4ea' : '#fff'
                              }}
                              onPress={() => setCustomBetModalData(prev => ({ ...prev, targetPlayerId: '' }))}
                            >
                              <Text style={{ fontSize: 12, color: !customBetModalData.targetPlayerId ? '#34a853' : '#666', fontWeight: !customBetModalData.targetPlayerId ? 'bold' : 'normal' }}>
                                Cả đội đối thủ (Pool)
                              </Text>
                            </TouchableOpacity>
                            {opponents.map(opid => {
                              const isSelected = customBetModalData.targetPlayerId === opid;
                              return (
                                <TouchableOpacity
                                  key={opid}
                                  style={{
                                    paddingVertical: 6,
                                    paddingHorizontal: 12,
                                    borderRadius: 8,
                                    borderWidth: 1,
                                    borderColor: isSelected ? '#1a73e8' : '#ccc',
                                    backgroundColor: isSelected ? '#e8f0fe' : '#fff'
                                  }}
                                  onPress={() => setCustomBetModalData(prev => ({ ...prev, targetPlayerId: opid }))}
                                >
                                  <Text style={{ fontSize: 12, color: isSelected ? '#1a73e8' : '#666', fontWeight: isSelected ? 'bold' : 'normal' }}>
                                    ➔ {players[opid]?.name || opid}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        );
                      })()}
                    </View>

                    <View style={{ marginTop: 10 }}>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#ea4335' }]} onPress={handleClearPlayerBet}>
                          <Text style={styles.btnText}>Xóa cược riêng</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#34a853' }]} onPress={handleSavePlayerBet}>
                          <Text style={styles.btnText}>Lưu</Text>
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity style={[styles.modalCloseBtn, { backgroundColor: '#666', marginTop: 10 }]} onPress={() => setCustomBetModalData(null)}>
                        <Text style={styles.modalCloseText}>Đóng</Text>
                      </TouchableOpacity>
                    </View>
                  </ScrollView>
                </View>
              </View>
            </KeyboardAvoidingView>
          )}
        </Modal>

        {/* Modal chi tiết lịch sử giao dịch thành viên (Ledger) */}
        <Modal
          visible={!!ledgerModalData}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setLedgerModalData(null)}
          statusBarTranslucent={true}
        >
          {ledgerModalData && (
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                 <Text style={styles.modalTitle}>Lịch sử cược: {ledgerModalData.name}</Text>
                 <Text style={styles.modalSubTitle}>Chi tiết cộng/trừ tiền từng set đấu và kèo phụ</Text>
 
                 <ScrollView style={{ maxHeight: 300, marginVertical: 10 }}>
                   {getPlayerLedger(ledgerModalData.playerId).map((item, index) => {
                     const chg = Math.round(item.change);
                     return (
                       <View key={index} style={styles.ledgerRow}>
                         <View style={{ flex: 1 }}>
                           <Text style={styles.ledgerText}>{item.title} ({item.roleInSet})</Text>
                           {(item.type === 'set' || item.type === 'sideSet') && item.customBet !== undefined && item.customBet !== null && (
                             <Text style={{ fontSize: 11, color: '#ff9800' }}>
                               Cược riêng: {
                                 typeof item.customBet === 'object'
                                   ? `${item.customBet.amount.toLocaleString('vi-VN')}đ ➔ ${players[item.customBet.targetPlayerId]?.name || 'Đối thủ'}`
                                   : `${item.customBet.toLocaleString('vi-VN')}đ`
                               }
                             </Text>
                           )}
                         </View>
                         <Text style={[styles.ledgerAmount, { color: chg > 0 ? 'green' : chg < 0 ? 'red' : 'black' }]}>
                           {chg > 0 ? '+' : ''}{chg.toLocaleString('vi-VN')}đ
                         </Text>
                       </View>
                     );
                   })}
                   {getPlayerLedger(ledgerModalData.playerId).length === 0 && (
                     <Text style={{ textAlign: 'center', color: '#999', marginVertical: 20 }}>Chưa tham gia set đấu hay kèo phụ nào.</Text>
                   )}
                 </ScrollView>

                <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setLedgerModalData(null)}>
                  <Text style={styles.modalCloseText}>Đóng</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Modal>

        {/* Modal chọn đội thi đấu (Matchup Dropdown) */}
        <Modal
          visible={!!matchupDropdownData}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setMatchupDropdownData(null)}
          statusBarTranslucent={true}
        >
          {matchupDropdownData && (
            <View style={styles.modalOverlay}>
              <View style={styles.dropdownModalContent}>
                <Text style={styles.dropdownModalTitle}>
                  Chọn Đội bên {matchupDropdownData.side === 'left' ? 'Trái' : 'Phải'}
                </Text>
                <Text style={styles.dropdownModalSubtitle}>Chọn đội thi đấu cho bên này</Text>
                
                <View style={styles.dropdownList}>
                  {activeTeams
                    .filter(t => t !== (matchupDropdownData.side === 'left' ? matchupDropdownData.currentRight : matchupDropdownData.currentLeft))
                    .map(t => {
                      const isSelected = t === (matchupDropdownData.side === 'left' ? matchupDropdownData.currentLeft : matchupDropdownData.currentRight);
                      return (
                        <TouchableOpacity
                          key={t}
                          style={[styles.dropdownItem, isSelected && styles.dropdownItemActive]}
                          onPress={() => {
                            const newLeft = matchupDropdownData.side === 'left' ? t : matchupDropdownData.currentLeft;
                            const newRight = matchupDropdownData.side === 'right' ? t : matchupDropdownData.currentRight;
                            const sorted = [newLeft, newRight].sort();
                            updateMatchup(pin, latestSetId, `${sorted[0]}_${sorted[1]}`);
                            setMatchupDropdownData(null);
                          }}
                        >
                          <Text style={[styles.dropdownItemText, isSelected && styles.dropdownItemTextActive]}>
                            {getTeamLabel(t)}
                          </Text>
                          {isSelected && <Ionicons name="checkmark-circle" size={18} color="#1a73e8" />}
                        </TouchableOpacity>
                      );
                    })}
                </View>
                
                <TouchableOpacity 
                  style={[styles.modalCloseBtn, { backgroundColor: '#666', marginTop: 15 }]} 
                  onPress={() => setMatchupDropdownData(null)}
                >
                  <Text style={styles.modalCloseText}>Hủy</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Modal>
      </ScrollView>

      {isHost && (activeTab === 'main' || activeTab === 'side' || session.meta?.status === 'finished') && (
        <View style={styles.footer}>
          {session.meta?.status === 'finished' ? (
            <TouchableOpacity 
              style={[styles.actionBtn, { backgroundColor: '#f9ab00', flex: 1, paddingVertical: 12 }]} 
              onPress={async () => {
                await undoFinishSession(pin);
                showAlert("Thành công", "Đã khôi phục lại buổi chơi!");
              }}
            >
              <Text style={styles.btnText}>Hoàn tác kết thúc buổi chơi</Text>
            </TouchableOpacity>
          ) : activeTab === 'main' ? (
            <>
              <View style={styles.betInputContainer}>
                <TextInput 
                  style={styles.betInput} 
                  keyboardType="numeric" 
                  value={formatMoney(betAmount)} 
                  onChangeText={handleBetAmountChange} 
                />
                <Text style={{color:'#666'}}>đ</Text>
              </View>
              {!latestSet ? (
                <TouchableOpacity style={[styles.actionBtn, {backgroundColor: '#1a73e8'}]} onPress={handleStartSet}>
                  <Text style={styles.btnText}>Bắt đầu</Text>
                </TouchableOpacity>
              ) : latestSet?.status === 'playing' ? (
                <>
                  {(() => {
                    const [l, r] = normalizeMatchup(latestSet.matchup);
                    const getBtnStyle = (tKey) => {
                      if (tKey === 'teamA') return styles.actionBtnBlue;
                      if (tKey === 'teamB') return styles.actionBtnRed;
                      if (tKey === 'teamC') return styles.actionBtnGreen;
                      return styles.actionBtnPurple;
                    };
                    return (
                      <>
                        <TouchableOpacity style={[styles.actionBtn, getBtnStyle(l)]} onPress={() => handleFinishSet(l)}>
                          <Text style={styles.btnText}>{getTeamLabel(l).replace('Team ', '')} Thắng</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.actionBtn, getBtnStyle(r)]} onPress={() => handleFinishSet(r)}>
                          <Text style={styles.btnText}>{getTeamLabel(r).replace('Team ', '')} Thắng</Text>
                        </TouchableOpacity>
                      </>
                    );
                  })()}
                </>
              ) : (
                <>
                  <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGreen]} onPress={handleStartSet}><Text style={styles.btnText}>Set tiếp</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.actionBtnYellow]} onPress={() => undoSet(pin, latestSetId)}><Text style={styles.btnText}>Hoàn tác</Text></TouchableOpacity>
                </>
              )}
            </>
          ) : (
            <>
              <View style={styles.betInputContainer}>
                <TextInput 
                  style={styles.betInput} 
                  keyboardType="numeric" 
                  value={formatMoney(sideBetAmountInput)} 
                  onChangeText={handleSideBetAmountChange} 
                />
                <Text style={{color: DuoTheme.colors.grayDark, fontWeight: '700'}}>đ</Text>
              </View>
              {!latestSideSet ? (
                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGreen]} onPress={handleStartSideSet}>
                  <Text style={styles.btnText}>Bắt đầu</Text>
                </TouchableOpacity>
              ) : latestSideSet?.status === 'playing' ? (
                <>
                  <TouchableOpacity style={[styles.actionBtn, styles.actionBtnBlue]} onPress={() => handleFinishSideSet('teamA')}>
                    <Text style={styles.btnText}>A Thắng</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.actionBtnRed]} onPress={() => handleFinishSideSet('teamB')}>
                    <Text style={styles.btnText}>B Thắng</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGreen]} onPress={handleStartSideSet}><Text style={styles.btnText}>Set tiếp</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.actionBtnYellow]} onPress={() => undoSideSet(pin, latestSideSetId)}><Text style={styles.btnText}>Hoàn tác</Text></TouchableOpacity>
                </>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

const TeamColumn = ({ title, color, slots, players, isHost, isPlaying, subTarget, onSelectSlot, onRemovePlayer, playerBets, onEditPlayerBet, isResting, onDeleteTeam, canDelete }) => {
  const teamKey = 'team' + title.replace('Team ', '');
  const themeStyles = DuoTheme.colors[teamKey] || (isResting ? DuoTheme.colors.teamResting : DuoTheme.colors.teamC);

  return (
    <View style={[
      styles.teamCol, 
      { 
        backgroundColor: isResting ? '#F8FAFC' : themeStyles.bg,
        borderColor: isResting ? '#E2E8F0' : themeStyles.border,
        opacity: isResting ? 0.6 : 1 
      }
    ]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingHorizontal: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
          <Ionicons name="shirt" size={15} color={isResting ? '#64748B' : themeStyles.primary} />
          <Text style={[styles.teamTitle, { color: isResting ? '#64748B' : themeStyles.text, marginBottom: 0, textAlign: 'left' }]} numberOfLines={1}>
            {title} {isResting ? '(Nghỉ)' : ''}
          </Text>
        </View>
        {canDelete && (
          <TouchableOpacity onPress={() => onDeleteTeam(teamKey)} style={{ padding: 2 }}>
            <Ionicons name="trash-outline" size={15} color={DuoTheme.colors.red} />
          </TouchableOpacity>
        )}
      </View>
      {Object.entries(slots).map(([slotId, pids]) => {
        const isSubTarget = subTarget && subTarget.team === teamKey && subTarget.slotId === slotId;
        return (
          <TouchableOpacity 
            key={slotId} 
            style={[
              styles.slotBox, 
              isSubTarget && { backgroundColor: DuoTheme.colors.yellowLight, borderColor: DuoTheme.colors.yellow, borderWidth: 2 }
            ]} 
            disabled={!isHost || !isPlaying || isResting} 
            onPress={() => onSelectSlot(slotId)}
          >
            {pids.map(pid => {
              const customBetVal = playerBets && playerBets[pid];
              let displayBet = '';
              if (customBetVal !== undefined && customBetVal !== null) {
                if (typeof customBetVal === 'object') {
                  const oppName = players[customBetVal.targetPlayerId]?.name || 'Đối thủ';
                  displayBet = `(${formatMoney(customBetVal.amount)}đ ➔ ${oppName})`;
                } else {
                  displayBet = `(${formatMoney(customBetVal)}đ)`;
                }
              }
              return (
                <View key={pid} style={styles.playerBadgeContainer}>
                  <TouchableOpacity 
                    style={styles.playerBadge} 
                    disabled={!isHost || !isPlaying || isResting}
                    onPress={() => onEditPlayerBet(pid)}
                  >
                    <View style={[styles.playerAvatarSmall, { backgroundColor: isResting ? '#E2E8F0' : themeStyles.badge }]}>
                      <Text style={[styles.playerAvatarSmallText, { color: isResting ? '#64748B' : themeStyles.primary }]}>
                        {(players[pid]?.name || 'P').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.playerBadgeText} numberOfLines={1}>{players[pid]?.name}</Text>
                    {displayBet !== '' && (
                      <Text style={styles.customBetText}>
                        {displayBet}
                      </Text>
                    )}
                  </TouchableOpacity>
                  {isHost && isPlaying && !isResting && (
                    <TouchableOpacity onPress={() => onRemovePlayer(pid)} style={styles.removePlayerBtn}>
                      <Ionicons name="close-circle" size={16} color={DuoTheme.colors.red} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </TouchableOpacity>
        );
      })}
      {Object.keys(slots).length === 0 && <Text style={{color: '#94A3B8', fontSize: 12, fontWeight: '500', textAlign: 'center', marginVertical: 10}}>+ Trống</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DuoTheme.colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: DuoTheme.colors.background },

  /* Header */
  header: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: DuoTheme.colors.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: DuoTheme.colors.grayDark,
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: DuoTheme.colors.grayText,
    marginTop: 1,
  },
  surplusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: DuoTheme.colors.greenLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: DuoTheme.borderRadius.full,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  surplusChipText: {
    color: DuoTheme.colors.greenDark,
    fontSize: 12,
    fontWeight: '700',
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEDD5',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: DuoTheme.borderRadius.full,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  streakText: {
    color: '#EA580C',
    fontWeight: '800',
    fontSize: 12,
  },

  /* Banners */
  subBanner: {
    backgroundColor: '#EA580C',
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  subBannerText: { color: '#FFF', fontSize: 13, fontWeight: '700', flex: 1 },

  body: { flex: 1, padding: 12 },

  /* Teams Container */
  teamsContainer: { flexDirection: 'row', marginBottom: 16 },
  teamCol: {
    flex: 1,
    marginHorizontal: 4,
    borderRadius: DuoTheme.borderRadius.md,
    padding: 10,
    minHeight: 160,
    borderWidth: 1.5,
  },
  teamTitle: { fontWeight: '800', fontSize: 13.5, marginBottom: 0 },
  slotBox: {
    backgroundColor: '#FFFFFF',
    padding: 8,
    borderRadius: DuoTheme.borderRadius.sm,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
    ...DuoTheme.shadows.card,
  },
  playerBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  playerBadge: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  playerAvatarSmall: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  playerAvatarSmallText: {
    fontSize: 11,
    fontWeight: '800',
  },
  playerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerAvatarText: {
    fontSize: 14,
    fontWeight: '800',
  },
  playerBadgeText: { fontSize: 13, color: DuoTheme.colors.grayDark, fontWeight: '600', flexShrink: 1 },
  customBetText: { fontSize: 11, color: DuoTheme.colors.orangeDark, fontWeight: '700', marginLeft: 4 },
  removePlayerBtn: { padding: 2, marginLeft: 4 },

  /* Waiting Container */
  waitingContainer: {
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: DuoTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
    ...DuoTheme.shadows.card,
  },
  sectionTitle: {
    fontWeight: '800',
    fontSize: 15,
    color: DuoTheme.colors.grayDark,
    marginBottom: 8,
  },
  addPlayerForm: { flexDirection: 'row', marginBottom: 10 },
  addPlayerInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: DuoTheme.colors.borderDark,
    borderRadius: DuoTheme.borderRadius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F8FAFC',
    marginRight: 8,
    fontSize: 14,
    fontWeight: '600',
    color: DuoTheme.colors.grayDark,
  },
  addBtn: {
    backgroundColor: DuoTheme.colors.primary,
    width: 42,
    height: 42,
    borderRadius: DuoTheme.borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    ...DuoTheme.shadows.button,
  },
  addBtnText: { color: '#FFF', fontSize: 20, fontWeight: '800' },
  chipsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: DuoTheme.borderRadius.full,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
  },
  chipText: { fontSize: 13, color: DuoTheme.colors.grayDark, fontWeight: '600' },
  selectedChip: {
    backgroundColor: DuoTheme.colors.primaryLight,
    borderColor: DuoTheme.colors.primary,
  },
  teamPicker: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: DuoTheme.colors.border,
  },
  teamPickerTitle: { fontWeight: '700', color: DuoTheme.colors.grayDark, marginBottom: 8, fontSize: 13 },
  teamPickerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: DuoTheme.borderRadius.sm,
  },
  teamPickerBtnText: { color: '#FFF', fontWeight: '700', fontSize: 12.5 },
  teamPickerCancel: { paddingHorizontal: 12, paddingVertical: 8 },
  teamPickerCancelText: { color: DuoTheme.colors.grayText, fontWeight: '600' },

  /* History Container */
  historyContainer: {
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: DuoTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
    ...DuoTheme.shadows.card,
  },
  historyItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  historyText: { fontSize: 13.5, fontWeight: '700', color: DuoTheme.colors.grayDark },
  historySub: { fontSize: 12, color: DuoTheme.colors.grayText, marginTop: 2 },

  /* Summary & Settlement Container */
  summaryContainer: {
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: DuoTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
    ...DuoTheme.shadows.card,
  },
  progressContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: DuoTheme.borderRadius.sm,
    padding: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
  },
  progressLabel: { fontSize: 12.5, fontWeight: '700', color: DuoTheme.colors.grayDark },
  progressValue: { fontSize: 12.5, fontWeight: '800', color: DuoTheme.colors.green },
  progressTrack: {
    height: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressFill: {
    height: '100%',
    backgroundColor: DuoTheme.colors.green,
    borderRadius: 4,
  },
  playerBalanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  playerName: { fontSize: 14.5, fontWeight: '700', color: DuoTheme.colors.grayDark },
  playerTapLedgerHint: { fontSize: 11, color: DuoTheme.colors.grayMuted, marginTop: 1 },
  settledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: DuoTheme.colors.greenLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  settledBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: DuoTheme.colors.greenDark,
    marginLeft: 2,
  },
  settledRow: { opacity: 0.6 },
  settledText: { color: DuoTheme.colors.grayText },
  settleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: DuoTheme.borderRadius.full,
    borderWidth: 1,
  },
  settleBtnDone: {
    backgroundColor: DuoTheme.colors.greenLight,
    borderColor: '#86EFAC',
  },
  settleBtnUndo: {
    backgroundColor: '#F1F5F9',
    borderColor: DuoTheme.colors.borderDark,
  },
  settleBtnText: { color: DuoTheme.colors.grayDark, fontWeight: '700', fontSize: 12 },

  /* Footer & Action Buttons */
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderColor: DuoTheme.colors.border,
    alignItems: 'center',
    ...DuoTheme.shadows.card,
  },
  betInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: DuoTheme.colors.borderDark,
    borderRadius: DuoTheme.borderRadius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 8,
  },
  betInput: {
    width: 62,
    paddingHorizontal: 4,
    paddingVertical: 4,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    color: DuoTheme.colors.grayDark,
  },
  actionBtn: {
    flex: 1,
    marginHorizontal: 4,
    height: 48,
    borderRadius: DuoTheme.borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnBlue: {
    backgroundColor: DuoTheme.colors.blue,
  },
  actionBtnRed: {
    backgroundColor: DuoTheme.colors.red,
  },
  actionBtnGreen: {
    backgroundColor: DuoTheme.colors.green,
  },
  actionBtnYellow: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: DuoTheme.colors.borderDark,
  },
  actionBtnPurple: {
    backgroundColor: DuoTheme.colors.purple,
  },
  btnText: { color: '#FFF', fontWeight: '800', fontSize: 14.5 },

  /* Modals */
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
    borderRadius: DuoTheme.borderRadius.lg,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
    padding: 22,
    ...DuoTheme.shadows.card,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: DuoTheme.colors.grayDark, textAlign: 'center', marginBottom: 4 },
  modalSubTitle: { fontSize: 13, color: DuoTheme.colors.grayText, textAlign: 'center', marginBottom: 16 },
  modalTeamsContainer: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  modalTeamCol: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: DuoTheme.borderRadius.sm,
    padding: 10,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
  },
  modalTeamTitle: { fontWeight: '800', fontSize: 13, marginBottom: 8, textAlign: 'center', color: DuoTheme.colors.primary },
  modalSlot: {
    backgroundColor: '#FFF',
    padding: 6,
    borderRadius: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
  },
  modalSlotText: { fontSize: 12, fontWeight: '600', textAlign: 'center', color: DuoTheme.colors.grayDark },
  subTag: { fontSize: 10, color: DuoTheme.colors.orangeDark, textAlign: 'center', marginTop: 2, fontWeight: '700' },
  modalCloseBtn: {
    marginTop: 16,
    backgroundColor: DuoTheme.colors.primary,
    paddingVertical: 12,
    borderRadius: DuoTheme.borderRadius.md,
    alignItems: 'center',
  },
  modalCloseText: { color: '#FFF', fontWeight: '700', fontSize: 14.5 },

  /* Set Header & Matchup */
  activeSetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: DuoTheme.borderRadius.md,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  activeSetTitle: { fontWeight: '800', color: DuoTheme.colors.primaryDark, fontSize: 14 },
  activeSetBet: { fontWeight: '700', color: DuoTheme.colors.primaryDark, fontSize: 13 },
  matchupSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: DuoTheme.borderRadius.md,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
    ...DuoTheme.shadows.card,
  },
  matchupLabel: { fontWeight: '700', marginRight: 8, color: DuoTheme.colors.grayDark, fontSize: 13 },
  matchupText: { fontWeight: '800', color: DuoTheme.colors.primary, fontSize: 14 },
  matchupSideBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: DuoTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
    gap: 4,
  },
  matchupSideText: { fontSize: 13, fontWeight: '700', color: DuoTheme.colors.primary },
  vsText: { fontSize: 12, fontWeight: '800', color: DuoTheme.colors.grayMuted, marginHorizontal: 4 },
  addTeamBtn: { padding: 4, marginLeft: 4 },

  ledgerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  ledgerText: { fontSize: 13, color: DuoTheme.colors.grayDark, fontWeight: '600' },
  ledgerAmount: { fontWeight: '800', fontSize: 13.5 },

  dropdownModalContent: {
    backgroundColor: '#FFF',
    width: '85%',
    maxWidth: 380,
    borderRadius: DuoTheme.borderRadius.lg,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
    padding: 20,
    ...DuoTheme.shadows.card,
  },
  dropdownModalTitle: { fontSize: 16, fontWeight: '800', textAlign: 'center', color: DuoTheme.colors.grayDark, marginBottom: 4 },
  dropdownModalSubtitle: { fontSize: 12, color: DuoTheme.colors.grayText, textAlign: 'center', marginBottom: 14 },
  dropdownList: { gap: 8 },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: DuoTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
    backgroundColor: '#F8FAFC',
  },
  dropdownItemActive: {
    borderColor: DuoTheme.colors.primary,
    backgroundColor: DuoTheme.colors.primaryLight,
  },
  dropdownItemText: { fontSize: 14, color: DuoTheme.colors.grayDark, fontWeight: '600' },
  dropdownItemTextActive: { color: DuoTheme.colors.primary, fontWeight: '800' },

  checkoutBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: DuoTheme.colors.greenLight,
    padding: 12,
    borderRadius: DuoTheme.borderRadius.md,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  checkoutTitle: { fontSize: 15, fontWeight: '800', color: DuoTheme.colors.greenDark },
  checkoutSub: { fontSize: 12.5, color: DuoTheme.colors.grayDark, marginTop: 2, fontWeight: '500' },

  warningCard: {
    backgroundColor: '#FFFBEB',
    padding: 14,
    borderRadius: DuoTheme.borderRadius.md,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
  },
  warningTitle: { fontSize: 13.5, fontWeight: '800', color: '#B45309' },
  warningText: { fontSize: 12.5, color: '#78350F', marginVertical: 4, lineHeight: 18 },
  warningDetails: { flexDirection: 'row', gap: 10, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#FDE68A' },
  warningCol: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 8, padding: 8, borderWidth: 1, borderColor: '#FEF3C7' },
  warningColHeader: { fontWeight: '700', fontSize: 12, color: DuoTheme.colors.grayDark, marginBottom: 4 },
  warningPayoutText: { fontSize: 11.5, color: DuoTheme.colors.grayText, fontWeight: '600' },

  sideBetsContainer: {
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: DuoTheme.borderRadius.md,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
    ...DuoTheme.shadows.card,
  },
  collapsibleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addSideBetBtn: {
    backgroundColor: DuoTheme.colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: DuoTheme.borderRadius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginVertical: 8,
  },
  addSideBetBtnText: { color: '#FFF', fontSize: 12.5, fontWeight: '700' },
  sideBetItem: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: DuoTheme.borderRadius.sm,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  completedSideBet: { opacity: 0.8, backgroundColor: '#F1F5F9' },
  sideBetName: { fontSize: 13.5, fontWeight: '700', color: DuoTheme.colors.grayDark },
  sideBetAmountText: { fontSize: 12, fontWeight: '700', color: DuoTheme.colors.grayDark, marginVertical: 2 },
  sideBetSides: { fontSize: 11.5, color: DuoTheme.colors.grayText, lineHeight: 16 },
  sideBetWinnerTag: { fontSize: 12, fontWeight: '700', color: DuoTheme.colors.green, marginTop: 3 },
  sideBetActions: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  sbSettleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: DuoTheme.borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sbDeleteBtn: {
    padding: 6,
    borderRadius: DuoTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: '#FECDD3',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF',
  },
  sbActionText: { color: '#FFF', fontSize: 11, fontWeight: '700' },

  finishSessionBtn: {
    backgroundColor: DuoTheme.colors.redLight,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: DuoTheme.borderRadius.full,
    borderWidth: 1,
    borderColor: '#FECDD3',
  },
  finishSessionBtnText: { color: DuoTheme.colors.red, fontSize: 12, fontWeight: '700' },
  playerBreakdownText: { fontSize: 11, color: DuoTheme.colors.grayText, marginTop: 2 },

  dropdownContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: DuoTheme.borderRadius.md,
    padding: 2,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: DuoTheme.colors.border,
    ...DuoTheme.shadows.card,
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: DuoTheme.borderRadius.md,
  },
  dropdownButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: DuoTheme.colors.primary,
  },
});
