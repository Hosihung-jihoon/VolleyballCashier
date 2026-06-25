import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { addPlayerToSession, finishSet, startNewSet, subscribeToSession, togglePlayerSettled, undoSet, updateSetTeams, updateSetBetAmount, updateMatchup, updatePlayerBet } from '../lib/sessionApi';
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

  const getWaitingPlayers = () => {
    if (!latestSet) return Object.keys(players);
    const inA = Object.values(latestSet?.teamA?.slots || {}).flat();
    const inB = Object.values(latestSet?.teamB?.slots || {}).flat();
    const inC = Object.values(latestSet?.teamC?.slots || {}).flat();
    return Object.keys(players).filter(pid => !inA.includes(pid) && !inB.includes(pid) && !inC.includes(pid));
  };

  const handleAddNewPlayer = async () => {
    if (!newPlayerName.trim()) return;
    await addPlayerToSession(pin, newPlayerName.trim());
    setNewPlayerName('');
  };

  const handleAddToTeam = (pid, team) => {
    if (!isHost || !latestSet || latestSet.status !== 'playing') return;
    
    // Check if the team is resting in the current matchup
    const matchup = latestSet.matchup || 'A_B';
    const playingKeys = (matchup === 'B_C') ? ['teamB', 'teamC'] : (matchup === 'A_C' ? ['teamA', 'teamC'] : ['teamA', 'teamB']);
    if (!playingKeys.includes(team)) {
      showAlert('Lỗi', 'Đội này đang nghỉ trong set đấu hiện tại!');
      return;
    }

    const teamA = { ...latestSet?.teamA } || { slots: {} };
    const teamB = { ...latestSet?.teamB } || { slots: {} };
    const teamC = { ...latestSet?.teamC } || { slots: {} };

    const teamData = team === 'teamA' ? teamA : (team === 'teamB' ? teamB : teamC);
    const slots = { ...teamData.slots };
    slots[`slot_${Object.keys(slots).length + 1}`] = [pid];
    
    if (team === 'teamA') teamA.slots = slots;
    else if (team === 'teamB') teamB.slots = slots;
    else if (team === 'teamC') teamC.slots = slots;

    updateSetTeams(pin, latestSetId, teamA, teamB, teamC);
    setTeamPickerPlayerId(null);
  };

  const handleRemoveFromTeam = (pid, team) => {
    if (!isHost || !latestSet || latestSet.status !== 'playing') return;
    
    const teamA = { ...latestSet?.teamA } || { slots: {} };
    const teamB = { ...latestSet?.teamB } || { slots: {} };
    const teamC = { ...latestSet?.teamC } || { slots: {} };

    const teamData = team === 'teamA' ? teamA : (team === 'teamB' ? teamB : teamC);
    if (!teamData) return;
    const slots = { ...teamData.slots };
    Object.keys(slots).forEach(slotKey => {
      if (slots[slotKey].includes(pid)) {
        if (slots[slotKey].length === 1) delete slots[slotKey];
        else slots[slotKey] = slots[slotKey].filter(id => id !== pid);
      }
    });

    if (team === 'teamA') teamA.slots = slots;
    else if (team === 'teamB') teamB.slots = slots;
    else if (team === 'teamC') teamC.slots = slots;

    updateSetTeams(pin, latestSetId, teamA, teamB, teamC);
  };

  const handleSelectSlotForSub = (team, slotId) => {
    if (!isHost || !latestSet || latestSet.status !== 'playing') return;
    setSubTarget(subTarget && subTarget.team === team && subTarget.slotId === slotId ? null : { team, slotId });
  };

  const handleExecuteSub = (pid) => {
    if (!subTarget || !latestSet) return;
    const { team, slotId } = subTarget;
    
    const teamA = { ...latestSet?.teamA } || { slots: {} };
    const teamB = { ...latestSet?.teamB } || { slots: {} };
    const teamC = { ...latestSet?.teamC } || { slots: {} };

    const teamData = team === 'teamA' ? teamA : (team === 'teamB' ? teamB : teamC);
    if (!teamData) return;
    const slots = { ...teamData.slots };
    if (slots[slotId] && !slots[slotId].includes(pid)) {
      slots[slotId] = [...slots[slotId], pid];
      
      if (team === 'teamA') teamA.slots = slots;
      else if (team === 'teamB') teamB.slots = slots;
      else if (team === 'teamC') teamC.slots = slots;

      updateSetTeams(pin, latestSetId, teamA, teamB, teamC);
    }
    setSubTarget(null);
  };

  const onWaitingPlayerPress = (pid) => {
    if (!isHost) return;
    if (subTarget) handleExecuteSub(pid);
    else if (Platform.OS === 'web') {
      setTeamPickerPlayerId(teamPickerPlayerId === pid ? null : pid);
    }
    else {
      const matchup = latestSet?.matchup || 'A_B';
      const playingKeys = (matchup === 'B_C') ? ['teamB', 'teamC'] : (matchup === 'A_C' ? ['teamA', 'teamC'] : ['teamA', 'teamB']);
      
      const buttons = [];
      if (playingKeys.includes('teamA')) {
        buttons.push({ text: "Team A", onPress: () => handleAddToTeam(pid, 'teamA') });
      }
      if (playingKeys.includes('teamB')) {
        buttons.push({ text: "Team B", onPress: () => handleAddToTeam(pid, 'teamB') });
      }
      if (playingKeys.includes('teamC')) {
        buttons.push({ text: "Team C", onPress: () => handleAddToTeam(pid, 'teamC') });
      }
      buttons.push({ text: "Hủy" });
      
      showAlert("Chọn đội", `Thêm ${players[pid].name} vào:`, buttons);
    }
  };

  const handleFinishSet = (winner) => {
    if (!latestSet) return;
    const matchup = latestSet.matchup || 'A_B';
    
    // Check players in playing teams
    if (matchup === 'A_B') {
      if (Object.keys(latestSet.teamA?.slots || {}).length === 0 || Object.keys(latestSet.teamB?.slots || {}).length === 0) {
        showAlert("Lỗi", "Vui lòng chia đủ người cho Team A và Team B!"); return;
      }
    } else if (matchup === 'B_C') {
      if (Object.keys(latestSet.teamB?.slots || {}).length === 0 || Object.keys(latestSet.teamC?.slots || {}).length === 0) {
        showAlert("Lỗi", "Vui lòng chia đủ người cho Team B và Team C!"); return;
      }
    } else if (matchup === 'A_C') {
      if (Object.keys(latestSet.teamA?.slots || {}).length === 0 || Object.keys(latestSet.teamC?.slots || {}).length === 0) {
        showAlert("Lỗi", "Vui lòng chia đủ người cho Team A và Team C!"); return;
      }
    }

    const winnerName = winner === 'teamA' ? 'Team A' : (winner === 'teamB' ? 'Team B' : 'Team C');

    showAlert("Xác nhận", `${winnerName} thắng?`, [
      { text: "Hủy" }, 
      { text: "Đúng", onPress: () => finishSet(pin, latestSetId, winner) }
    ]);
  };

  // Xử lý bắt đầu set (giữ đội cũ nếu có)
  const handleStartSet = async () => {
    const amount = parseInt(betAmount) || 5000;
    const prevTeams = latestSet?.status === 'completed' ? { 
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

  const onEditPlayerBet = (pid) => {
    if (!isHost || !latestSet || latestSet.status !== 'playing') return;
    const currentBet = latestSet.playerBets?.[pid] || '';
    setCustomBetModalData({
      playerId: pid,
      playerName: players[pid]?.name,
      customAmount: currentBet.toString(),
    });
  };

  const handleSavePlayerBet = async () => {
    if (!customBetModalData) return;
    const { playerId, customAmount } = customBetModalData;
    const amount = customAmount.trim() === '' ? null : parseInt(customAmount);
    await updatePlayerBet(pin, latestSetId, playerId, amount);
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
      const teamA = s.teamA || { slots: {} };
      const teamB = s.teamB || { slots: {} };
      const teamC = s.teamC || { slots: {} };
      const matchup = s.matchup || 'A_B';
      const winner = s.winner;
      const betAmount = s.betAmount || 5000;
      const playerBets = s.playerBets || {};

      const inA = Object.values(teamA.slots).flat().includes(pid);
      const inB = Object.values(teamB.slots).flat().includes(pid);
      const inC = Object.values(teamC.slots).flat().includes(pid);

      if (inA || inB || inC) {
        const { balanceChanges } = calculateSettlement(
          teamA, teamB, teamC, matchup, winner, betAmount, playerBets
        );
        const change = balanceChanges[pid] || 0;
        
        let roleInSet = '';
        if (inA) {
          const slot = Object.entries(teamA.slots).find(([_, pids]) => pids.includes(pid));
          roleInSet = `Team A${slot && slot[1].length > 1 ? ' (Thay người)' : ''}`;
        } else if (inB) {
          const slot = Object.entries(teamB.slots).find(([_, pids]) => pids.includes(pid));
          roleInSet = `Team B${slot && slot[1].length > 1 ? ' (Thay người)' : ''}`;
        } else if (inC) {
          const slot = Object.entries(teamC.slots).find(([_, pids]) => pids.includes(pid));
          roleInSet = `Team C${slot && slot[1].length > 1 ? ' (Thay người)' : ''}`;
        }

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
            <Text style={styles.backBtnText}>⬅</Text>
          </TouchableOpacity>
          <Text style={styles.pinText}>PIN: {pin} ({isHost ? 'Host' : 'Mem'})</Text>
        </View>
      </View>

      {subTarget && (
        <View style={styles.subBanner}>
          <Text style={styles.subBannerText}>⚠️ Thay người Slot {subTarget.slotId} ({subTarget.team === 'teamA' ? 'A' : (subTarget.team === 'teamB' ? 'B' : 'C')}). Chọn người chờ!</Text>
          <TouchableOpacity onPress={() => setSubTarget(null)}><Text style={{color:'#fff'}}>Hủy</Text></TouchableOpacity>
        </View>
      )}

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: isHost ? 100 : 20 }}>
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
              <View style={{ flexDirection: 'row' }}>
                <TouchableOpacity 
                  style={[styles.matchupOption, latestSet.matchup === 'A_B' && styles.matchupOptionActive]} 
                  onPress={() => updateMatchup(pin, latestSetId, 'A_B')}
                >
                  <Text style={[styles.matchupOptionText, latestSet.matchup === 'A_B' && styles.matchupOptionTextActive]}>A vs B</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.matchupOption, latestSet.matchup === 'B_C' && styles.matchupOptionActive]} 
                  onPress={() => updateMatchup(pin, latestSetId, 'B_C')}
                >
                  <Text style={[styles.matchupOptionText, latestSet.matchup === 'B_C' && styles.matchupOptionTextActive]}>B vs C</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.matchupOption, latestSet.matchup === 'A_C' && styles.matchupOptionActive]} 
                  onPress={() => updateMatchup(pin, latestSetId, 'A_C')}
                >
                  <Text style={[styles.matchupOptionText, latestSet.matchup === 'A_C' && styles.matchupOptionTextActive]}>A vs C</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.matchupText}>
                {latestSet.matchup === 'B_C' ? 'Team B vs Team C' : (latestSet.matchup === 'A_C' ? 'Team A vs Team C' : 'Team A vs Team B')}
              </Text>
            )}
          </View>
        )}

        {latestSet ? (
          <View style={styles.teamsContainer}>
            <TeamColumn 
              title="Team A" 
              color="#e8f0fe" 
              slots={latestSet?.teamA?.slots || {}} 
              players={players} 
              isHost={isHost} 
              isPlaying={latestSet?.status === 'playing'} 
              subTarget={subTarget} 
              onSelectSlot={(id) => handleSelectSlotForSub('teamA', id)} 
              onRemovePlayer={(pid) => handleRemoveFromTeam(pid, 'teamA')}
              playerBets={latestSet?.playerBets || {}}
              onEditPlayerBet={onEditPlayerBet}
              isResting={(latestSet?.matchup || 'A_B') === 'B_C'}
            />
            <TeamColumn 
              title="Team B" 
              color="#fce8e6" 
              slots={latestSet?.teamB?.slots || {}} 
              players={players} 
              isHost={isHost} 
              isPlaying={latestSet?.status === 'playing'} 
              subTarget={subTarget} 
              onSelectSlot={(id) => handleSelectSlotForSub('teamB', id)} 
              onRemovePlayer={(pid) => handleRemoveFromTeam(pid, 'teamB')}
              playerBets={latestSet?.playerBets || {}}
              onEditPlayerBet={onEditPlayerBet}
              isResting={(latestSet?.matchup || 'A_B') === 'A_C'}
            />
            <TeamColumn 
              title="Team C" 
              color="#e6f4ea" 
              slots={latestSet?.teamC?.slots || {}} 
              players={players} 
              isHost={isHost} 
              isPlaying={latestSet?.status === 'playing'} 
              subTarget={subTarget} 
              onSelectSlot={(id) => handleSelectSlotForSub('teamC', id)} 
              onRemovePlayer={(pid) => handleRemoveFromTeam(pid, 'teamC')}
              playerBets={latestSet?.playerBets || {}}
              onEditPlayerBet={onEditPlayerBet}
              isResting={(latestSet?.matchup || 'A_B') === 'A_B'}
            />
          </View>
        ) : (
          <View style={styles.center}><Text>Chưa có set nào. Bấm {"'Bắt đầu'"} bên dưới!</Text></View>
        )}

        <View style={styles.waitingContainer}>
          <Text style={styles.sectionTitle}>Danh sách chờ:</Text>
          {isHost && (
            <View style={styles.addPlayerForm}>
              <TextInput style={styles.addPlayerInput} placeholder="Nhập tên..." value={newPlayerName} onChangeText={setNewPlayerName} onSubmitEditing={handleAddNewPlayer} />
              <TouchableOpacity style={styles.addBtn} onPress={handleAddNewPlayer}><Text style={styles.addBtnText}>+</Text></TouchableOpacity>
            </View>
          )}
          <View style={styles.chipsContainer}>
            {getWaitingPlayers().map(pid => (
              <TouchableOpacity key={pid} style={[styles.chip, teamPickerPlayerId === pid && styles.selectedChip, subTarget && { backgroundColor: '#ffe0b2', borderColor: '#ff9800' }]} onPress={() => onWaitingPlayerPress(pid)}>
                <Text>{players[pid]?.name}</Text>
              </TouchableOpacity>
            ))}
            {getWaitingPlayers().length === 0 && <Text style={{color:'#999'}}>Tất cả đã lên sân!</Text>}
          </View>
          {Platform.OS === 'web' && teamPickerPlayerId && players[teamPickerPlayerId] && (
            <View style={styles.teamPicker}>
              <Text style={styles.teamPickerTitle}>Thêm {players[teamPickerPlayerId]?.name} vào:</Text>
              {((latestSet?.matchup || 'A_B') === 'A_B' || (latestSet?.matchup || 'A_B') === 'A_C') && (
                <TouchableOpacity style={[styles.teamPickerBtn, { backgroundColor: '#1a73e8' }]} onPress={() => handleAddToTeam(teamPickerPlayerId, 'teamA')}>
                  <Text style={styles.teamPickerBtnText}>Team A</Text>
                </TouchableOpacity>
              )}
              {((latestSet?.matchup || 'A_B') === 'A_B' || (latestSet?.matchup || 'A_B') === 'B_C') && (
                <TouchableOpacity style={[styles.teamPickerBtn, { backgroundColor: '#ea4335' }]} onPress={() => handleAddToTeam(teamPickerPlayerId, 'teamB')}>
                  <Text style={styles.teamPickerBtnText}>Team B</Text>
                </TouchableOpacity>
              )}
              {((latestSet?.matchup || 'A_B') === 'B_C' || (latestSet?.matchup || 'A_B') === 'A_C') && (
                <TouchableOpacity style={[styles.teamPickerBtn, { backgroundColor: '#34a853' }]} onPress={() => handleAddToTeam(teamPickerPlayerId, 'teamC')}>
                  <Text style={styles.teamPickerBtnText}>Team C</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.teamPickerCancel} onPress={() => setTeamPickerPlayerId(null)}>
                <Text style={styles.teamPickerCancelText}>Hủy</Text>
              </TouchableOpacity>
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
          }).map(([setId, s]) => (
            s.status === 'completed' && (
              <TouchableOpacity 
                key={setId} 
                style={styles.historyItem} 
                onPress={() => setHistoryModalData({ setId, setData: s })}
              >
                <Text style={styles.historyText}>Set {setId.replace('set_', '')}: Đội {s.winner === 'teamA' ? 'A' : (s.winner === 'teamB' ? 'B' : 'C')} thắng</Text>
                <Text style={styles.historySub}>
                  Cược: {parseInt(s.betAmount || 5000).toLocaleString('vi-VN')}đ | Trận: {s.matchup || 'A_B'}
                </Text>
              </TouchableOpacity>
            )
          ))}
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
                  style={{flex: 1, paddingVertical: 5}} 
                  onPress={() => setLedgerModalData({ playerId: pid, name: p.name })}
                >
                  <Text style={[styles.playerName, isSettled && styles.settledText]}>
                    {p.name} {isSettled ? '(Đã xong)' : ''} 🔍
                  </Text>
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
                  Đội {historyModalData.setData?.winner === 'teamA' ? 'A' : (historyModalData.setData?.winner === 'teamB' ? 'B' : 'C')} thắng
                </Text>
                <Text style={[styles.modalSubTitle, { marginTop: -15, marginBottom: 20 }]}>
                  Cược: {parseInt(historyModalData.setData?.betAmount || 5000).toLocaleString('vi-VN')}đ | Trận: {historyModalData.setData?.matchup || 'A_B'}
                </Text>

                <View style={styles.modalTeamsContainer}>
                  {/* Team A */}
                  <View style={[styles.modalTeamCol, { opacity: historyModalData.setData?.matchup === 'B_C' ? 0.4 : 1 }]}>
                    <Text style={styles.modalTeamTitle}>Team A</Text>
                    {Object.entries(historyModalData.setData?.teamA?.slots || {}).map(([slotId, pids]) => (
                      <View key={slotId} style={styles.modalSlot}>
                        <Text style={styles.modalSlotText}>
                          {pids.map(pid => players[pid]?.name).join(' & ')}
                        </Text>
                        {pids.length > 1 && <Text style={styles.subTag}>Thay người</Text>}
                      </View>
                    ))}
                    {Object.keys(historyModalData.setData?.teamA?.slots || {}).length === 0 && <Text style={{textAlign:'center',color:'#999'}}>Trống</Text>}
                  </View>

                  {/* Team B */}
                  <View style={[styles.modalTeamCol, { opacity: historyModalData.setData?.matchup === 'A_C' ? 0.4 : 1 }]}>
                    <Text style={styles.modalTeamTitle}>Team B</Text>
                    {Object.entries(historyModalData.setData?.teamB?.slots || {}).map(([slotId, pids]) => (
                      <View key={slotId} style={styles.modalSlot}>
                        <Text style={styles.modalSlotText}>
                          {pids.map(pid => players[pid]?.name).join(' & ')}
                        </Text>
                        {pids.length > 1 && <Text style={styles.subTag}>Thay người</Text>}
                      </View>
                    ))}
                    {Object.keys(historyModalData.setData?.teamB?.slots || {}).length === 0 && <Text style={{textAlign:'center',color:'#999'}}>Trống</Text>}
                  </View>

                  {/* Team C */}
                  <View style={[styles.modalTeamCol, { opacity: historyModalData.setData?.matchup === 'A_B' ? 0.4 : 1 }]}>
                    <Text style={styles.modalTeamTitle}>Team C</Text>
                    {Object.entries(historyModalData.setData?.teamC?.slots || {}).map(([slotId, pids]) => (
                      <View key={slotId} style={styles.modalSlot}>
                        <Text style={styles.modalSlotText}>
                          {pids.map(pid => players[pid]?.name).join(' & ')}
                        </Text>
                        {pids.length > 1 && <Text style={styles.subTag}>Thay người</Text>}
                      </View>
                    ))}
                    {Object.keys(historyModalData.setData?.teamC?.slots || {}).length === 0 && <Text style={{textAlign:'center',color:'#999'}}>Trống</Text>}
                  </View>
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
                            <Text style={{ fontSize: 11, color: '#ff9800' }}>Cược riêng: {item.customBet.toLocaleString('vi-VN')}đ</Text>
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
              {((latestSet.matchup || 'A_B') === 'A_B' || (latestSet.matchup || 'A_B') === 'A_C') && (
                <TouchableOpacity style={[styles.actionBtn, {backgroundColor: '#1a73e8'}]} onPress={() => handleFinishSet('teamA')}>
                  <Text style={styles.btnText}>A Thắng</Text>
                </TouchableOpacity>
              )}
              {((latestSet.matchup || 'A_B') === 'A_B' || (latestSet.matchup || 'A_B') === 'B_C') && (
                <TouchableOpacity style={[styles.actionBtn, {backgroundColor: '#ea4335'}]} onPress={() => handleFinishSet('teamB')}>
                  <Text style={styles.btnText}>B Thắng</Text>
                </TouchableOpacity>
              )}
              {((latestSet.matchup || 'A_B') === 'B_C' || (latestSet.matchup || 'A_B') === 'A_C') && (
                <TouchableOpacity style={[styles.actionBtn, {backgroundColor: '#34a853'}]} onPress={() => handleFinishSet('teamC')}>
                  <Text style={styles.btnText}>C Thắng</Text>
                </TouchableOpacity>
              )}
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
  const teamKey = title.includes('A') ? 'teamA' : (title.includes('B') ? 'teamB' : 'teamC');
  return (
    <View style={[styles.teamCol, { backgroundColor: color, opacity: isResting ? 0.4 : 1 }]}>
      <Text style={styles.teamTitle}>{title} {isResting ? '(Nghỉ)' : ''}</Text>
      {Object.entries(slots).map(([slotId, pids]) => {
        const isSubTarget = subTarget && subTarget.team === teamKey && subTarget.slotId === slotId;
        return (
          <TouchableOpacity key={slotId} style={[styles.slotBox, isSubTarget && { backgroundColor: '#ffe0b2', borderColor: '#ff9800' }]} disabled={!isHost || !isPlaying || isResting} onPress={() => onSelectSlot(slotId)}>
            {pids.map(pid => {
              const customBet = playerBets && playerBets[pid];
              return (
                <View key={pid} style={styles.playerBadgeContainer}>
                  <TouchableOpacity 
                    style={styles.playerBadge} 
                    disabled={!isHost || !isPlaying || isResting}
                    onPress={() => onEditPlayerBet(pid)}
                  >
                    <Text style={styles.playerBadgeText} numberOfLines={1}>{players[pid]?.name}</Text>
                    {customBet !== undefined && customBet !== null && (
                      <Text style={styles.customBetText}>
                        ({(customBet / 1000)}k)
                      </Text>
                    )}
                  </TouchableOpacity>
                  {isHost && isPlaying && !isResting && (
                    <TouchableOpacity onPress={() => onRemovePlayer(pid)} style={styles.removePlayerBtn}>
                      <Text style={{fontSize: 12, color: 'red'}}>✖</Text>
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
  backBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  
  matchupSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f4f8', padding: 8, borderRadius: 10, marginBottom: 15 },
  matchupLabel: { fontWeight: 'bold', marginRight: 10, color: '#333' },
  matchupText: { fontWeight: 'bold', color: '#1a73e8' },
  matchupOption: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 15, backgroundColor: '#fff', marginHorizontal: 4, borderWidth: 1, borderColor: '#ddd' },
  matchupOptionActive: { backgroundColor: '#1a73e8', borderColor: '#1a73e8' },
  matchupOptionText: { color: '#666', fontSize: 12, fontWeight: 'bold' },
  matchupOptionTextActive: { color: '#fff' },

  ledgerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  ledgerText: { fontSize: 13, color: '#333' },
  ledgerAmount: { fontWeight: 'bold', fontSize: 13 },
});