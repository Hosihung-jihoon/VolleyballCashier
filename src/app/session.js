import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { addPlayerToSession, finishSet, startNewSet, subscribeToSession, togglePlayerSettled, undoSet, updateSetTeams } from '../lib/sessionApi';

export default function SessionScreen() {
  const { pin, role } = useLocalSearchParams();
  const [session, setSession] = useState(null);
  const [latestSetId, setLatestSetId] = useState(null);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [betAmount, setBetAmount] = useState('5000'); // State tiền cược
  const [subTarget, setSubTarget] = useState(null);
  const [historyModalData, setHistoryModalData] = useState(null); // { setId, setData }

  useEffect(() => {
    const unsub = subscribeToSession(pin, (data) => {
      setSession(data);
      if (data?.sets) {
        const sortedSets = Object.entries(data.sets).sort((a, b) => b[0].localeCompare(a[0]));
        setLatestSetId(sortedSets[0][0]);
      } else { setLatestSetId(null); }
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
    return Object.keys(players).filter(pid => !inA.includes(pid) && !inB.includes(pid));
  };

  const handleAddNewPlayer = async () => {
    if (!newPlayerName.trim()) return;
    await addPlayerToSession(pin, newPlayerName.trim());
    setNewPlayerName('');
  };

  const handleAddToTeam = (pid, team) => {
    if (!isHost || !latestSet || latestSet.status !== 'playing') return;
    const teamData = latestSet[team] || { slots: {} };
    const slots = { ...teamData.slots };
    slots[`slot_${Object.keys(slots).length + 1}`] = [pid];
    const updateObj = team === 'teamA' 
      ? { teamA: { slots }, teamB: latestSet?.teamB || { slots: {} } } 
      : { teamA: latestSet?.teamA || { slots: {} }, teamB: { slots } };
    updateSetTeams(pin, latestSetId, updateObj.teamA, updateObj.teamB);
  };

  const handleRemoveFromTeam = (pid, team) => {
    if (!isHost || !latestSet || latestSet.status !== 'playing') return;
    const teamData = latestSet[team];
    if (!teamData) return;
    const slots = { ...teamData.slots };
    Object.keys(slots).forEach(slotKey => {
      if (slots[slotKey].includes(pid)) {
        if (slots[slotKey].length === 1) delete slots[slotKey];
        else slots[slotKey] = slots[slotKey].filter(id => id !== pid);
      }
    });
    const updateObj = team === 'teamA' 
      ? { teamA: { slots }, teamB: latestSet?.teamB || { slots: {} } } 
      : { teamA: latestSet?.teamA || { slots: {} }, teamB: { slots } };
    updateSetTeams(pin, latestSetId, updateObj.teamA, updateObj.teamB);
  };

  const handleSelectSlotForSub = (team, slotId) => {
    if (!isHost || !latestSet || latestSet.status !== 'playing') return;
    setSubTarget(subTarget && subTarget.team === team && subTarget.slotId === slotId ? null : { team, slotId });
  };

  const handleExecuteSub = (pid) => {
    if (!subTarget || !latestSet) return;
    const { team, slotId } = subTarget;
    const teamData = latestSet[team];
    if (!teamData) return;
    const slots = { ...teamData.slots };
    if (slots[slotId] && !slots[slotId].includes(pid)) {
      slots[slotId] = [...slots[slotId], pid];
      const updateObj = team === 'teamA' 
        ? { teamA: { slots }, teamB: latestSet?.teamB || { slots: {} } } 
        : { teamA: latestSet?.teamA || { slots: {} }, teamB: { slots } };
      updateSetTeams(pin, latestSetId, updateObj.teamA, updateObj.teamB);
    }
    setSubTarget(null);
  };

  const onWaitingPlayerPress = (pid) => {
    if (!isHost) return;
    if (subTarget) handleExecuteSub(pid);
    else Alert.alert("Chọn đội", `Thêm ${players[pid].name} vào:`, [
      { text: "Team A", onPress: () => handleAddToTeam(pid, 'teamA') },
      { text: "Team B", onPress: () => handleAddToTeam(pid, 'teamB') },
      { text: "Hủy" }
    ]);
  };

  const handleFinishSet = (winner) => {
    if (!latestSet) return;
    if (Object.keys(latestSet?.teamA?.slots || {}).length === 0 || Object.keys(latestSet?.teamB?.slots || {}).length === 0) {
      Alert.alert("Lỗi", "Vui lòng chia đủ người!"); return;
    }
    Alert.alert("Xác nhận", `${winner === 'teamA' ? 'Team A' : 'Team B'} thắng?`, [
      { text: "Hủy" }, { text: "Đúng", onPress: () => finishSet(pin, latestSetId, winner) }
    ]);
  };

  // Xử lý bắt đầu set (giữ đội cũ nếu có)
  const handleStartSet = async () => {
    const amount = parseInt(betAmount) || 5000;
    const prevTeams = latestSet?.status === 'completed' ? { teamA: latestSet?.teamA, teamB: latestSet?.teamB } : null;
    await startNewSet(pin, amount, prevTeams);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.pinText}>PIN: {pin}</Text>
        <Text style={styles.roleText}>{isHost ? '👑 Host' : '👤 Member'}</Text>
        <Text style={styles.fundText}>Quỹ: {session.meta?.fund || 0}đ</Text>
      </View>

      {subTarget && (
        <View style={styles.subBanner}>
          <Text style={styles.subBannerText}>⚠️ Thay người Slot {subTarget.slotId} ({subTarget.team === 'teamA' ? 'A' : 'B'}). Chọn người chờ!</Text>
          <TouchableOpacity onPress={() => setSubTarget(null)}><Text style={{color:'#fff'}}>Hủy</Text></TouchableOpacity>
        </View>
      )}

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: isHost ? 100 : 20 }}>
        {latestSet ? (
          <View style={styles.teamsContainer}>
            <TeamColumn title="Team A" color="#e8f0fe" slots={latestSet?.teamA?.slots || {}} players={players} isHost={isHost} isPlaying={latestSet?.status === 'playing'} subTarget={subTarget} onSelectSlot={(id) => handleSelectSlotForSub('teamA', id)} onRemovePlayer={(pid) => handleRemoveFromTeam(pid, 'teamA')} />
            <TeamColumn title="Team B" color="#fce8e6" slots={latestSet?.teamB?.slots || {}} players={players} isHost={isHost} isPlaying={latestSet?.status === 'playing'} subTarget={subTarget} onSelectSlot={(id) => handleSelectSlotForSub('teamB', id)} onRemovePlayer={(pid) => handleRemoveFromTeam(pid, 'teamB')} />
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
              <TouchableOpacity key={pid} style={[styles.chip, subTarget && { backgroundColor: '#ffe0b2', borderColor: '#ff9800' }]} onPress={() => onWaitingPlayerPress(pid)}>
                <Text>{players[pid]?.name}</Text>
              </TouchableOpacity>
            ))}
            {getWaitingPlayers().length === 0 && <Text style={{color:'#999'}}>Tất cả đã lên sân!</Text>}
          </View>
        </View>

        {/* Lịch sử các set */}
        <View style={styles.historyContainer}>
          <Text style={styles.sectionTitle}>Lịch sử:</Text>
          {Object.entries(session.sets || {}).reverse().map(([setId, s]) => (
            s.status === 'completed' && (
              <TouchableOpacity 
                key={setId} 
                style={styles.historyItem} 
                onPress={() => setHistoryModalData({ setId, setData: s })}
              >
                <Text style={styles.historyText}>Set {setId.replace('set_', '')}: Đội {s.winner === 'teamA' ? 'A' : 'B'} thắng</Text>
                <Text style={styles.historySub}>{s.betAmount}đ - {Object.keys(s.teamA?.slots||{}).length} vs {Object.keys(s.teamB?.slots||{}).length}</Text>
              </TouchableOpacity>
            )
          ))}
          {Object.values(session.sets || {}).filter(s => s.status === 'completed').length === 0 && (
            <Text style={{color:'#999', fontSize: 12}}>Chưa có set nào hoàn thành</Text>
          )}
        </View>

        {/* Bảng thanh toán cuối buổi */}
        <View style={styles.summaryContainer}>
          <Text style={styles.sectionTitle}>Thanh toán cuối buổi:</Text>
          {Object.entries(players).map(([pid, p]) => {
            const balance = Math.round(p.balance || 0);
            const isSettled = p.isSettled || false;
            return (
              <View key={pid} style={[styles.playerBalanceRow, isSettled && styles.settledRow]}>
                <Text style={[styles.playerName, isSettled && styles.settledText]}>
                  {p.name} {isSettled ? '(Đã xong)' : ''}
                </Text>
                
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ 
                    color: balance > 0 ? 'green' : balance < 0 ? 'red' : 'black', 
                    fontWeight: 'bold', 
                    marginRight: 10,
                    textDecorationLine: isSettled ? 'line-through' : 'none'
                  }}>
                    {Math.abs(balance).toLocaleString('vi-VN')}
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
                  Đội {historyModalData.setData?.winner === 'teamA' ? 'A' : 'B'} thắng - Cược {historyModalData.setData?.betAmount}đ
                </Text>

                <View style={styles.modalTeamsContainer}>
                  {/* Team A */}
                  <View style={styles.modalTeamCol}>
                    <Text style={styles.modalTeamTitle}>Team A</Text>
                    {Object.entries(historyModalData.setData?.teamA?.slots || {}).map(([slotId, pids]) => (
                      <View key={slotId} style={styles.modalSlot}>
                        <Text style={styles.modalSlotText}>
                          {pids.map(pid => players[pid]?.name).join(' & ')}
                        </Text>
                        {pids.length > 1 && <Text style={styles.subTag}>Thay người</Text>}
                      </View>
                    ))}
                    {Object.keys(historyModalData.setData?.teamA?.slots || {}).length === 0 && <Text>Trống</Text>}
                  </View>

                  {/* Team B */}
                  <View style={styles.modalTeamCol}>
                    <Text style={styles.modalTeamTitle}>Team B</Text>
                    {Object.entries(historyModalData.setData?.teamB?.slots || {}).map(([slotId, pids]) => (
                      <View key={slotId} style={styles.modalSlot}>
                        <Text style={styles.modalSlotText}>
                          {pids.map(pid => players[pid]?.name).join(' & ')}
                        </Text>
                        {pids.length > 1 && <Text style={styles.subTag}>Thay người</Text>}
                      </View>
                    ))}
                    {Object.keys(historyModalData.setData?.teamB?.slots || {}).length === 0 && <Text>Trống</Text>}
                  </View>
                </View>

                <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setHistoryModalData(null)}>
                  <Text style={styles.modalCloseText}>Đóng</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Modal>
      </ScrollView>

      {isHost && (
        <View style={styles.footer}>
          {/* Input tiền cược chỉ hiện khi chưa có set hoặc set đã xong */}
          {(!latestSet || latestSet.status === 'completed') && (
            <View style={styles.betInputContainer}>
              <TextInput style={styles.betInput} keyboardType="numeric" value={betAmount} onChangeText={setBetAmount} />
              <Text style={{color:'#666'}}>đ/set</Text>
            </View>
          )}
          {!latestSet ? (
            <TouchableOpacity style={[styles.actionBtn, {backgroundColor: '#1a73e8'}]} onPress={handleStartSet}>
              <Text style={styles.btnText}>Bắt đầu</Text>
            </TouchableOpacity>
          ) : latestSet?.status === 'playing' ? (
            <>
              <TouchableOpacity style={[styles.actionBtn, {backgroundColor: '#34a853'}]} onPress={() => handleFinishSet('teamA')}><Text style={styles.btnText}>A Thắng</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, {backgroundColor: '#ea4335'}]} onPress={() => handleFinishSet('teamB')}><Text style={styles.btnText}>B Thắng</Text></TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity style={[styles.actionBtn, {backgroundColor: '#1a73e8'}]} onPress={handleStartSet}><Text style={styles.btnText}>Set tiếp theo</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, {backgroundColor: '#f9ab00'}]} onPress={() => undoSet(pin, latestSetId)}><Text style={styles.btnText}>Hoàn tác</Text></TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const TeamColumn = ({ title, color, slots, players, isHost, isPlaying, subTarget, onSelectSlot, onRemovePlayer }) => {
  const teamKey = title.includes('A') ? 'teamA' : 'teamB';
  return (
    <View style={[styles.teamCol, { backgroundColor: color }]}>
      <Text style={styles.teamTitle}>{title}</Text>
      {Object.entries(slots).map(([slotId, pids]) => {
        const isSubTarget = subTarget && subTarget.team === teamKey && subTarget.slotId === slotId;
        return (
          <TouchableOpacity key={slotId} style={[styles.slotBox, isSubTarget && { backgroundColor: '#ffe0b2', borderColor: '#ff9800' }]} disabled={!isHost || !isPlaying} onPress={() => onSelectSlot(slotId)}>
            {pids.map(pid => (
              <View key={pid} style={styles.playerBadge}>
                <Text>{players[pid]?.name}</Text>
                {isHost && isPlaying && <TouchableOpacity onPress={() => onRemovePlayer(pid)} style={{marginLeft: 5}}><Text style={{fontSize: 12, color: 'red'}}>✖</Text></TouchableOpacity>}
              </View>
            ))}
          </TouchableOpacity>
        );
      })}
      {Object.keys(slots).length === 0 && <Text style={{color:'#999'}}>Trống</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { alignItems: 'center', padding: 20 },
  header: { padding: 15, backgroundColor: '#1a73e8', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pinText: { color: '#fff', fontWeight: 'bold', fontSize: 16 }, roleText: { color: '#fff' }, fundText: { color: '#fff', fontWeight: 'bold' },
  subBanner: { backgroundColor: '#ff9800', padding: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subBannerText: { color: '#fff', fontSize: 12, flex: 1 },
  body: { flex: 1, padding: 10 },
  teamsContainer: { flexDirection: 'row', marginBottom: 20 },
  teamCol: { flex: 1, marginHorizontal: 5, borderRadius: 10, padding: 10, minHeight: 150 },
  teamTitle: { fontWeight: 'bold', marginBottom: 10, textAlign: 'center' },
  slotBox: { backgroundColor: 'rgba(255,255,255,0.8)', padding: 8, borderRadius: 5, marginBottom: 5, borderWidth: 1, borderStyle: 'dashed', borderColor: '#ccc' },
  playerBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 4 },
  waitingContainer: { marginBottom: 20, backgroundColor: '#f0f4f8', padding: 10, borderRadius: 10 },
  sectionTitle: { fontWeight: 'bold', marginBottom: 8 },
  addPlayerForm: { flexDirection: 'row', marginBottom: 10 },
  addPlayerInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#fff', marginRight: 10 },
  addBtn: { backgroundColor: '#1a73e8', width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  addBtnText: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  chipsContainer: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { backgroundColor: '#fff', padding: 8, borderRadius: 15, marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: '#ddd' },
  historyContainer: { marginBottom: 20, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#eee' },
  historyItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  historyText: { fontSize: 14, fontWeight: 'bold' }, historySub: { fontSize: 12, color: '#666' },
  summaryContainer: { marginBottom: 20, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#eee' },
  playerBalanceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  playerName: { fontSize: 16 },
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
  modalTitle: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 5 },
  modalSubTitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 20 },
  modalTeamsContainer: { flexDirection: 'row', justifyContent: 'space-between' },
  modalTeamCol: { flex: 1, marginHorizontal: 5, backgroundColor: '#f0f4f8', borderRadius: 10, padding: 10 },
  modalTeamTitle: { fontWeight: 'bold', marginBottom: 10, textAlign: 'center', color: '#1a73e8' },
  modalSlot: { backgroundColor: '#fff', padding: 10, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: '#eee' },
  modalSlotText: { fontSize: 14, textAlign: 'center' },
  subTag: { fontSize: 10, color: '#ff9800', textAlign: 'center', marginTop: 4, fontWeight: 'bold' },
  modalCloseBtn: { marginTop: 20, backgroundColor: '#1a73e8', padding: 12, borderRadius: 10, alignItems: 'center' },
  modalCloseText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});