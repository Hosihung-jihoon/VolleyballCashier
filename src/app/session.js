import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { addPlayerToSession, finishSet, startNewSet, subscribeToSession, togglePlayerSettled, undoSet, updateSetTeams, updateSetBetAmount, addTeamToSession, updateMatchup, updatePlayerBet } from '../lib/sessionApi';
import { calculateSettlement } from '../lib/bettingEngine';

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

  if (!session) return <View style={styles.center}><Text>Đang tải...</Text></View>;

  const players = session.players || {};
  const latestSet = (latestSetId && session.sets) ? session.sets[latestSetId] : null;
  const isHost = role === 'host';

  const activeTeams = session.meta?.teams || ['teamA', 'teamB', 'teamC'];

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

  const handleAddNewPlayer = async () => {
    if (!newPlayerName.trim()) return;
    await addPlayerToSession(pin, newPlayerName.trim());
    setNewPlayerName('');
  };

  const handleAddToTeam = (pid, teamKey) => {
    if (!isHost || !latestSet || latestSet.status !== 'playing') return;

    const teamsMap = { ...latestSet.teams };
    const teamA = latestSet.teamA || { slots: {} };
    const teamB = latestSet.teamB || { slots: {} };
    const teamC = latestSet.teamC || { slots: {} };
    if (!teamsMap.teamA) teamsMap.teamA = teamA;
    if (!teamsMap.teamB) teamsMap.teamB = teamB;
    if (!teamsMap.teamC) teamsMap.teamC = teamC;

    const targetTeam = { ...teamsMap[teamKey] } || { slots: {} };
    const slots = { ...targetTeam.slots };
    slots[`slot_${Object.keys(slots).length + 1}`] = [pid];
    targetTeam.slots = slots;
    teamsMap[teamKey] = targetTeam;

    updateSetTeams(pin, latestSetId, teamsMap);
    setTeamPickerPlayerId(null);
  };

  const handleRemoveFromTeam = (pid, teamKey) => {
    if (!isHost || !latestSet || latestSet.status !== 'playing') return;
    
    const teamsMap = { ...latestSet.teams };
    const teamA = latestSet.teamA || { slots: {} };
    const teamB = latestSet.teamB || { slots: {} };
    const teamC = latestSet.teamC || { slots: {} };
    if (!teamsMap.teamA) teamsMap.teamA = teamA;
    if (!teamsMap.teamB) teamsMap.teamB = teamB;
    if (!teamsMap.teamC) teamsMap.teamC = teamC;

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

    updateSetTeams(pin, latestSetId, teamsMap);
  };

  const handleSelectSlotForSub = (teamKey, slotId) => {
    if (!isHost || !latestSet || latestSet.status !== 'playing') return;
    setSubTarget(subTarget && subTarget.team === teamKey && subTarget.slotId === slotId ? null : { team: teamKey, slotId });
  };

  const handleExecuteSub = (pid) => {
    if (!subTarget || !latestSet) return;
    const { team: teamKey, slotId } = subTarget;
    
    const teamsMap = { ...latestSet.teams };
    const teamA = latestSet.teamA || { slots: {} };
    const teamB = latestSet.teamB || { slots: {} };
    const teamC = latestSet.teamC || { slots: {} };
    if (!teamsMap.teamA) teamsMap.teamA = teamA;
    if (!teamsMap.teamB) teamsMap.teamB = teamB;
    if (!teamsMap.teamC) teamsMap.teamC = teamC;

    const targetTeam = { ...teamsMap[teamKey] };
    if (!targetTeam) return;
    const slots = { ...targetTeam.slots };
    if (slots[slotId] && !slots[slotId].includes(pid)) {
      slots[slotId] = [...slots[slotId], pid];
      targetTeam.slots = slots;
      teamsMap[teamKey] = targetTeam;

      updateSetTeams(pin, latestSetId, teamsMap);
    }
    setSubTarget(null);
  };

  const onWaitingPlayerPress = (pid) => {
    if (!isHost) return;
    if (subTarget) handleExecuteSub(pid);
    else {
      setTeamPickerPlayerId(teamPickerPlayerId === pid ? null : pid);
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
    setBetAmount(val);
    const amount = parseInt(val) || 0;
    if (latestSet && latestSet.status === 'playing' && isHost) {
      await updateSetBetAmount(pin, latestSetId, amount);
    }
  };

  const getOpponentsForPlayer = (pid) => {
    if (!latestSet) return [];
    const teamsMap = latestSet.teams || {
      teamA: latestSet.teamA || { slots: {} },
      teamB: latestSet.teamB || { slots: {} },
      teamC: latestSet.teamC || { slots: {} }
    };
    
    let playerTeamKey = null;
    Object.entries(teamsMap).forEach(([tKey, tData]) => {
      const slots = tData?.slots || {};
      Object.values(slots).forEach(pids => {
        if (pids.includes(pid)) playerTeamKey = tKey;
      });
    });
    
    if (!playerTeamKey) return [];
    
    const [l, r] = normalizeMatchup(latestSet.matchup);
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
    if (!isHost || !latestSet || latestSet.status !== 'playing') return;
    const currentBetVal = latestSet.playerBets?.[pid];
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
    
    if (customAmount.trim() === '') {
      await updatePlayerBet(pin, latestSetId, playerId, null);
    } else {
      const amount = parseInt(customAmount) || 0;
      if (targetPlayerId) {
        await updatePlayerBet(pin, latestSetId, playerId, {
          amount,
          targetPlayerId
        });
      } else {
        await updatePlayerBet(pin, latestSetId, playerId, amount);
      }
    }
    setCustomBetModalData(null);
  };

  const handleClearPlayerBet = async () => {
    if (!customBetModalData) return;
    await updatePlayerBet(pin, latestSetId, customBetModalData.playerId, null);
    setCustomBetModalData(null);
  };

  const getPlayerLedger = (pid) => {
    const ledger = [];
    if (!session || !session.sets) return ledger;
    
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
          setId,
          roleInSet,
          customBet,
          change,
        });
      }
    });

    return ledger;
  };

  const handleGoBack = () => {
    router.replace('/');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={handleGoBack} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.pinText}>PIN: {pin} ({isHost ? 'Host' : 'Mem'})</Text>
        </View>
      </View>

      {subTarget && (
        <View style={styles.subBanner}>
          <Ionicons name="warning" size={16} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.subBannerText}>Thay người Slot {subTarget.slotId} ({getTeamLabel(subTarget.team)}). Chọn người chờ!</Text>
          <TouchableOpacity onPress={() => setSubTarget(null)}><Text style={{color:'#fff', fontWeight: 'bold'}}>Hủy</Text></TouchableOpacity>
        </View>
      )}

      <ScrollView 
        style={styles.body} 
        contentContainerStyle={{ paddingBottom: isHost ? 100 : 20 }}
      >
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

        {/* Lịch sử các set */}
        <View style={styles.historyContainer}>
          <Text style={styles.sectionTitle}>Lịch sử:</Text>
          {Object.entries(session.sets || {}).sort((a, b) => {
            const numA = parseInt(a[0].replace('set_', '')) || 0;
            const numB = parseInt(b[0].replace('set_', '')) || 0;
            return numB - numA;
          }).map(([setId, s]) => {
            const [l, r] = normalizeMatchup(s.matchup);
            const hasCustomBets = s.playerBets && Object.keys(s.playerBets).length > 0;
            return (
              s.status === 'completed' && (
                <TouchableOpacity 
                  key={setId} 
                  style={styles.historyItem} 
                  onPress={() => setHistoryModalData({ setId, setData: s })}
                >
                  <Text style={styles.historyText}>Set {setId.replace('set_', '')}: {getTeamLabel(s.winner)} thắng</Text>
                  <Text style={styles.historySub}>
                    Cược: {parseInt(s.betAmount || 5000).toLocaleString('vi-VN')}đ | Trận: {getTeamLabel(l)} vs {getTeamLabel(r)}{hasCustomBets ? ' (Có cược riêng)' : ''}
                  </Text>
                </TouchableOpacity>
              )
            );
          })}
          {Object.values(session.sets || {}).filter(s => s.status === 'completed').length === 0 && (
            <Text style={{color:'#999', fontSize: 12}}>Chưa có set nào hoàn thành</Text>
          )}
        </View>

        {/* Bảng thanh toán cuối buổi */}
        <View style={styles.summaryContainer}>
          <Text style={styles.sectionTitle}>Thanh toán cuối buổi (Chạm tên xem chi tiết):</Text>
          {Object.entries(players).map(([pid, p]) => {
            const balance = Math.round(p.balance || 0);
            const isSettled = p.isSettled || false;
            return (
              <View key={pid} style={[styles.playerBalanceRow, isSettled && styles.settledRow]}>
                <TouchableOpacity 
                  style={{flex: 1, paddingVertical: 5, flexDirection: 'row', alignItems: 'center'}} 
                  onPress={() => setLedgerModalData({ playerId: pid, name: p.name })}
                >
                  <Text style={[styles.playerName, isSettled && styles.settledText]}>
                    {p.name} {isSettled ? '(Đã xong)' : ''}
                  </Text>
                  <Ionicons name="receipt-outline" size={14} color="#666" style={{ marginLeft: 6 }} />
                </TouchableOpacity>
                
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ 
                    color: balance > 0 ? 'green' : balance < 0 ? 'red' : 'black', 
                    fontWeight: 'bold', 
                    marginRight: 10,
                    textDecorationLine: isSettled ? 'line-through' : 'none'
                  }}>
                    {balance > 0 ? '+' : ''}{balance.toLocaleString('vi-VN')}đ
                  </Text>
                  
                  {isHost && (
                    <TouchableOpacity 
                      style={[styles.settleBtn, { backgroundColor: isSettled ? '#f9ab00' : '#34a853' }]} 
                      onPress={() => togglePlayerSettled(pin, pid, !isSettled)}
                    >
                      <Text style={styles.settleBtnText}>{isSettled ? 'Hoàn tác' : 'Xong'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
          {Object.keys(players).length === 0 && <Text style={{color:'#999'}}>Chưa có người chơi...</Text>}
        </View>

        {/* Modal chi tiết set */}
        <Modal
          visible={!!historyModalData}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setHistoryModalData(null)}
        >
          {historyModalData && (
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>
                  Chi tiết Set {historyModalData.setId.replace('set_', '')}
                </Text>
                <Text style={styles.modalSubTitle}>
                  {getTeamLabel(historyModalData.setData?.winner)} thắng
                </Text>
                <Text style={[styles.modalSubTitle, { marginTop: -15, marginBottom: 20 }]}>
                  Cược: {parseInt(historyModalData.setData?.betAmount || 5000).toLocaleString('vi-VN')}đ | Trận: {getTeamLabel(normalizeMatchup(historyModalData.setData?.matchup)[0])} vs {getTeamLabel(normalizeMatchup(historyModalData.setData?.matchup)[1])}
                </Text>

                <View style={styles.modalTeamsContainer}>
                  {Object.keys(historyModalData.setData?.teams || { teamA: 1, teamB: 1, teamC: 1 }).map(tKey => {
                    const [l, r] = normalizeMatchup(historyModalData.setData?.matchup);
                    const isResting = tKey !== l && tKey !== r;
                    const tData = historyModalData.setData?.teams?.[tKey] || historyModalData.setData?.[tKey] || { slots: {} };
                    return (
                      <View key={tKey} style={[styles.modalTeamCol, { opacity: isResting ? 0.4 : 1 }]}>
                        <Text style={styles.modalTeamTitle}>{getTeamLabel(tKey)} {isResting ? '(Nghỉ)' : ''}</Text>
                        {Object.entries(tData.slots || {}).map(([slotId, pids]) => (
                          <View key={slotId} style={styles.modalSlot}>
                            <Text style={styles.modalSlotText}>
                              {pids.map(pid => {
                                const pName = players[pid]?.name || pid;
                                const customBet = historyModalData.setData?.playerBets?.[pid];
                                if (customBet !== undefined && customBet !== null) {
                                  if (typeof customBet === 'object') {
                                    const oppName = players[customBet.targetPlayerId]?.name || 'Đối thủ';
                                    return `${pName} (Cược riêng: ${(customBet.amount / 1000)}k ➔ ${oppName})`;
                                  } else {
                                    return `${pName} (Cược riêng: ${(customBet / 1000)}k)`;
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
        >
          {customBetModalData && (
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Cược riêng: {customBetModalData.playerName}</Text>
                <Text style={styles.modalSubTitle}>Đặt mức cược riêng cho thành viên này trong set hiện tại (bỏ trống để dùng mức cược chung của set).</Text>
                
                <TextInput
                  style={[styles.addPlayerInput, { width: '100%', marginBottom: 15, paddingVertical: 10 }]}
                  keyboardType="numeric"
                  placeholder="Mức cược riêng (đ)..."
                  value={customBetModalData.customAmount}
                  onChangeText={(val) => setCustomBetModalData(prev => ({ ...prev, customAmount: val }))}
                  autoFocus
                />

                <Text style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 8, color: '#333' }}>
                  Đối thủ cược 1-on-1 (Không bắt buộc):
                </Text>
                
                {(() => {
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
            </View>
          )}
        </Modal>

        {/* Modal chi tiết lịch sử giao dịch thành viên (Ledger) */}
        <Modal
          visible={!!ledgerModalData}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setLedgerModalData(null)}
        >
          {ledgerModalData && (
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Lịch sử cược: {ledgerModalData.name}</Text>
                <Text style={styles.modalSubTitle}>Chi tiết cộng/trừ tiền từng set đấu</Text>

                <ScrollView style={{ maxHeight: 300, marginVertical: 10 }}>
                  {getPlayerLedger(ledgerModalData.playerId).map((item, index) => {
                    const chg = Math.round(item.change);
                    return (
                      <View key={index} style={styles.ledgerRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.ledgerText}>Set {item.setId.replace('set_', '')} ({item.roleInSet})</Text>
                          {item.customBet !== undefined && item.customBet !== null && (
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
                    <Text style={{ textAlign: 'center', color: '#999', marginVertical: 20 }}>Chưa tham gia set đấu nào.</Text>
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

      {isHost && (
        <View style={styles.footer}>
          <View style={styles.betInputContainer}>
            <TextInput 
              style={styles.betInput} 
              keyboardType="numeric" 
              value={betAmount} 
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
                const leftColor = l === 'teamA' ? '#1a73e8' : (l === 'teamB' ? '#ea4335' : (l === 'teamC' ? '#34a853' : '#673ab7'));
                const rightColor = r === 'teamA' ? '#1a73e8' : (r === 'teamB' ? '#ea4335' : (r === 'teamC' ? '#34a853' : '#673ab7'));
                return (
                  <>
                    <TouchableOpacity style={[styles.actionBtn, {backgroundColor: leftColor}]} onPress={() => handleFinishSet(l)}>
                      <Text style={styles.btnText}>{getTeamLabel(l).replace('Team ', '')} Thắng</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, {backgroundColor: rightColor}]} onPress={() => handleFinishSet(r)}>
                      <Text style={styles.btnText}>{getTeamLabel(r).replace('Team ', '')} Thắng</Text>
                    </TouchableOpacity>
                  </>
                );
              })()}
            </>
          ) : (
            <>
              <TouchableOpacity style={[styles.actionBtn, {backgroundColor: '#1a73e8'}]} onPress={handleStartSet}><Text style={styles.btnText}>Set tiếp</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, {backgroundColor: '#f9ab00'}]} onPress={() => undoSet(pin, latestSetId)}><Text style={styles.btnText}>Hoàn tác</Text></TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
}



const TeamColumn = ({ title, color, slots, players, isHost, isPlaying, subTarget, onSelectSlot, onRemovePlayer, playerBets, onEditPlayerBet, isResting }) => {
  const teamKey = 'team' + title.replace('Team ', '');
  return (
    <View style={[styles.teamCol, { backgroundColor: color, opacity: isResting ? 0.4 : 1 }]}>
      <Text style={styles.teamTitle}>{title} {isResting ? '(Nghỉ)' : ''}</Text>
      {Object.entries(slots).map(([slotId, pids]) => {
        const isSubTarget = subTarget && subTarget.team === teamKey && subTarget.slotId === slotId;
        return (
          <TouchableOpacity key={slotId} style={[styles.slotBox, isSubTarget && { backgroundColor: '#ffe0b2', borderColor: '#ff9800' }]} disabled={!isHost || !isPlaying || isResting} onPress={() => onSelectSlot(slotId)}>
            {pids.map(pid => {
              const customBetVal = playerBets && playerBets[pid];
              let displayBet = '';
              if (customBetVal !== undefined && customBetVal !== null) {
                if (typeof customBetVal === 'object') {
                  const oppName = players[customBetVal.targetPlayerId]?.name || 'Đối thủ';
                  displayBet = `(${(customBetVal.amount / 1000)}k ➔ ${oppName})`;
                } else {
                  displayBet = `(${(customBetVal / 1000)}k)`;
                }
              }
              return (
                <View key={pid} style={styles.playerBadgeContainer}>
                  <TouchableOpacity 
                    style={styles.playerBadge} 
                    disabled={!isHost || !isPlaying || isResting}
                    onPress={() => onEditPlayerBet(pid)}
                  >
                    <Text style={styles.playerBadgeText} numberOfLines={1}>{players[pid]?.name}</Text>
                    {displayBet !== '' && (
                      <Text style={styles.customBetText}>
                        {displayBet}
                      </Text>
                    )}
                  </TouchableOpacity>
                  {isHost && isPlaying && !isResting && (
                    <TouchableOpacity onPress={() => onRemovePlayer(pid)} style={styles.removePlayerBtn}>
                      <Ionicons name="close-circle" size={14} color="#d93025" />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </TouchableOpacity>
        );
      })}
      {Object.keys(slots).length === 0 && <Text style={{color:'#999', textAlign: 'center'}}>Trống</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { alignItems: 'center', padding: 20 },
  header: { padding: 15, backgroundColor: '#1a73e8', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pinText: { color: '#fff', fontWeight: 'bold', fontSize: 16 }, roleText: { color: '#fff' },
  subBanner: { backgroundColor: '#ff9800', padding: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subBannerText: { color: '#fff', fontSize: 12, flex: 1 },
  body: { flex: 1, padding: 10 },
  teamsContainer: { flexDirection: 'row', marginBottom: 20 },
  teamCol: { flex: 1, marginHorizontal: 3, borderRadius: 10, padding: 6, minHeight: 150 },
  teamTitle: { fontWeight: 'bold', fontSize: 13, marginBottom: 8, textAlign: 'center' },
  slotBox: { backgroundColor: 'rgba(255,255,255,0.8)', padding: 4, borderRadius: 5, marginBottom: 5, borderWidth: 1, borderStyle: 'dashed', borderColor: '#ccc' },
  playerBadgeContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2, paddingHorizontal: 2 },
  playerBadge: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  playerBadgeText: { fontSize: 12, color: '#333', flexShrink: 1 },
  customBetText: { fontSize: 10, color: '#ff9800', fontWeight: 'bold', marginLeft: 2 },
  removePlayerBtn: { padding: 2, marginLeft: 2 },
  waitingContainer: { marginBottom: 20, backgroundColor: '#f0f4f8', padding: 10, borderRadius: 10 },
  sectionTitle: { fontWeight: 'bold', marginBottom: 8 },
  addPlayerForm: { flexDirection: 'row', marginBottom: 10 },
  addPlayerInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#fff', marginRight: 10 },
  addBtn: { backgroundColor: '#1a73e8', width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  addBtnText: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  chipsContainer: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { backgroundColor: '#fff', padding: 8, borderRadius: 15, marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: '#ddd' },
  chipText: { fontSize: 13, color: '#333' },
  selectedChip: { backgroundColor: '#e8f0fe', borderColor: '#1a73e8' },
  teamPicker: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#d8e0ea' },
  teamPickerTitle: { fontWeight: 'bold', marginRight: 4 },
  teamPickerBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  teamPickerBtnText: { color: '#fff', fontWeight: 'bold' },
  teamPickerCancel: { paddingHorizontal: 12, paddingVertical: 8 },
  teamPickerCancelText: { color: '#666', fontWeight: 'bold' },
  historyContainer: { marginBottom: 20, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#eee' },
  historyItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  historyText: { fontSize: 14, fontWeight: 'bold' }, historySub: { fontSize: 12, color: '#666' },
  summaryContainer: { marginBottom: 20, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#eee' },
  playerBalanceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  playerName: { fontSize: 15 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', backgroundColor: '#fff', padding: 10, borderTopWidth: 1, borderColor: '#eee', alignItems: 'center' },
  betInputContainer: { flexDirection: 'row', alignItems: 'center', marginRight: 10 },
  betInput: { width: 60, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginRight: 5, textAlign: 'center' },
  actionBtn: { flex: 1, marginHorizontal: 5, padding: 15, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold' },
  settledRow: { opacity: 0.5, backgroundColor: '#f9f9f9' },
  settledText: { fontStyle: 'italic', color: '#888' },
  settleBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 5 },
  settleBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#fff', width: '90%', borderRadius: 15, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 5 },
  modalSubTitle: { fontSize: 13, color: '#666', textAlign: 'center', marginBottom: 20 },
  modalTeamsContainer: { flexDirection: 'row', justifyContent: 'space-between' },
  modalTeamCol: { flex: 1, marginHorizontal: 3, backgroundColor: '#f0f4f8', borderRadius: 10, padding: 6 },
  modalTeamTitle: { fontWeight: 'bold', fontSize: 12, marginBottom: 10, textAlign: 'center', color: '#1a73e8' },
  modalSlot: { backgroundColor: '#fff', padding: 6, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: '#eee' },
  modalSlotText: { fontSize: 12, textAlign: 'center' },
  subTag: { fontSize: 9, color: '#ff9800', textAlign: 'center', marginTop: 4, fontWeight: 'bold' },
  modalCloseBtn: { marginTop: 20, backgroundColor: '#1a73e8', padding: 12, borderRadius: 10, alignItems: 'center' },
  modalCloseText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  activeSetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f5f5f5', padding: 12, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: '#e0e0e0' },
  activeSetTitle: { fontWeight: 'bold', color: '#333', fontSize: 15 },
  activeSetBet: { fontWeight: 'bold', color: '#1a73e8', fontSize: 15 },
  backBtn: { marginRight: 8, paddingVertical: 2, paddingHorizontal: 4 },

  matchupSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f4f8', padding: 8, borderRadius: 10, marginBottom: 15 },
  matchupLabel: { fontWeight: 'bold', marginRight: 10, color: '#333' },
  matchupText: { fontWeight: 'bold', color: '#1a73e8' },
  
  matchupSideBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', gap: 4 },
  matchupSideText: { fontSize: 13, fontWeight: 'bold', color: '#1a73e8' },
  vsText: { fontSize: 12, fontWeight: 'bold', color: '#666' },
  addTeamBtn: { padding: 4, marginLeft: 5 },

  ledgerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  ledgerText: { fontSize: 13, color: '#333' },
  ledgerAmount: { fontWeight: 'bold', fontSize: 13 },

  dropdownModalContent: { backgroundColor: '#fff', width: '80%', borderRadius: 15, padding: 20 },
  dropdownModalTitle: { fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 5 },
  dropdownModalSubtitle: { fontSize: 12, color: '#666', textAlign: 'center', marginBottom: 15 },
  dropdownList: { gap: 8 },
  dropdownItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#eee', backgroundColor: '#f9f9f9' },
  dropdownItemActive: { borderColor: '#1a73e8', backgroundColor: '#e8f0fe' },
  dropdownItemText: { fontSize: 14, color: '#333', fontWeight: '500' },
  dropdownItemTextActive: { color: '#1a73e8', fontWeight: 'bold' },
});