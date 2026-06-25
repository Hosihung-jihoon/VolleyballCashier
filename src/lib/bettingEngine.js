// lib/bettingEngine.js
export const calculateSettlement = (teamA, teamB, winner, betAmount) => {
  const slotsA = Object.values(teamA?.slots || {});
  const slotsB = Object.values(teamB?.slots || {});

  // Tổng tiền = Số người đội ít hơn * Tiền cược
  const minSlots = Math.min(slotsA.length, slotsB.length);
  const totalMoney = minSlots * betAmount;

  const losingSlots = winner === 'teamA' ? slotsB : slotsA;
  const winningSlots = winner === 'teamA' ? slotsA : slotsB;

  // 1. Tính tiền bên thua trả (làm tròn lên 1000đ)
  const lossPerSlotRaw = totalMoney / losingSlots.length;
  const lossPerSlot = Math.ceil(lossPerSlotRaw / 1000) * 1000; 
  const totalCollected = lossPerSlot * losingSlots.length;
  const fundAddition = totalCollected - totalMoney;

  // 2. Tính tiền bên thắng nhận (chia đều, lẻ được chọn theo tổng thu)
  const winPerSlot = totalCollected / winningSlots.length;

  const balanceChanges = {};
  losingSlots.forEach(slot => {
    const share = lossPerSlot / slot.length;
    slot.forEach(pid => { balanceChanges[pid] = (balanceChanges[pid] || 0) - share; });
  });
  winningSlots.forEach(slot => {
    const share = winPerSlot / slot.length;
    slot.forEach(pid => { balanceChanges[pid] = (balanceChanges[pid] || 0) + share; });
  });

  return { balanceChanges, fundAddition, totalCollected };
};