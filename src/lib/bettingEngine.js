// lib/bettingEngine.js
export const calculateSettlement = (teamA, teamB, teamC, matchup, winner, betAmount, playerBets = {}) => {
  const playingKeys = (matchup === 'B_C') ? ['teamB', 'teamC'] : (matchup === 'A_C' ? ['teamA', 'teamC'] : ['teamA', 'teamB']);
  const winnerKey = winner; // 'teamA', 'teamB', or 'teamC'
  const loserKey = playingKeys.find(k => k !== winnerKey) || playingKeys[1];
  
  const winningTeam = winnerKey === 'teamA' ? teamA : (winnerKey === 'teamB' ? teamB : teamC);
  const losingTeam = loserKey === 'teamA' ? teamA : (loserKey === 'teamB' ? teamB : teamC);

  const winningSlots = Object.values(winningTeam?.slots || {});
  const losingSlots = Object.values(losingTeam?.slots || {});

  let totalCollected = 0;
  const balanceChanges = {};

  // 1. Tính tiền bên thua trả (làm tròn lên 1000đ cho mỗi người chơi)
  losingSlots.forEach(slot => {
    slot.forEach(pid => {
      const pBet = (playerBets && playerBets[pid] !== undefined) ? playerBets[pid] : betAmount;
      const rawLoss = pBet / slot.length;
      const roundedLoss = Math.ceil(rawLoss / 1000) * 1000;
      balanceChanges[pid] = (balanceChanges[pid] || 0) - roundedLoss;
      totalCollected += roundedLoss;
    });
  });

  // 2. Tính tiền bên thắng dự kiến nhận
  let totalExpected = 0;
  winningSlots.forEach(slot => {
    slot.forEach(pid => {
      const pBet = (playerBets && playerBets[pid] !== undefined) ? playerBets[pid] : betAmount;
      const rawWin = pBet / slot.length;
      totalExpected += rawWin;
    });
  });

  // 3. Phân phối tiền thu được cho bên thắng (tỷ lệ theo tiền cược)
  winningSlots.forEach(slot => {
    slot.forEach(pid => {
      const pBet = (playerBets && playerBets[pid] !== undefined) ? playerBets[pid] : betAmount;
      const rawWin = pBet / slot.length;
      const winRaw = totalExpected > 0 ? rawWin * (totalCollected / totalExpected) : 0;
      const roundedWin = Math.round(winRaw / 1000) * 1000;
      balanceChanges[pid] = (balanceChanges[pid] || 0) + roundedWin;
    });
  });

  // 4. Đảm bảo tổng số tiền thay đổi bằng 0 (Zero-sum) bằng cách bù trừ sai số làm tròn vào người thắng nhiều nhất
  let sumChanges = 0;
  const keys = Object.keys(balanceChanges);
  keys.forEach(k => { sumChanges += balanceChanges[k]; });

  if (sumChanges !== 0 && keys.length > 0) {
    let bestKey = null;
    let maxVal = -1;
    winningSlots.forEach(slot => {
      slot.forEach(pid => {
        if (balanceChanges[pid] !== undefined && Math.abs(balanceChanges[pid]) > maxVal) {
          maxVal = Math.abs(balanceChanges[pid]);
          bestKey = pid;
        }
      });
    });
    if (!bestKey) {
      bestKey = keys[0];
    }
    balanceChanges[bestKey] = balanceChanges[bestKey] - sumChanges;
  }

  return { balanceChanges, fundAddition: 0, totalCollected };
};