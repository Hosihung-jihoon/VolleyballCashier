// lib/bettingEngine.js
export const calculateSettlement = (firstArg, ...args) => {
  let teamsMap = {};
  let matchup, winner, betAmount, playerBets;

  // Dynamically determine signature based on arguments
  if (firstArg && typeof firstArg === 'object' && !firstArg.slots) {
    // New signature: calculateSettlement(teamsMap, matchup, winner, betAmount, playerBets)
    teamsMap = firstArg;
    [matchup, winner, betAmount, playerBets = {}] = args;
  } else {
    // Old signature: calculateSettlement(teamA, teamB, teamC, matchup, winner, betAmount, playerBets)
    const [teamB, teamC, matchupVal, winnerVal, betAmountVal, playerBetsVal = {}] = args;
    teamsMap = {
      teamA: firstArg,
      teamB: teamB,
      teamC: teamC,
    };
    matchup = matchupVal;
    winner = winnerVal;
    betAmount = betAmountVal;
    playerBets = playerBetsVal;
  }

  // Parse matchup dynamically
  let playingKeys;
  if (matchup === 'A_B') playingKeys = ['teamA', 'teamB'];
  else if (matchup === 'B_C') playingKeys = ['teamB', 'teamC'];
  else if (matchup === 'A_C') playingKeys = ['teamA', 'teamC'];
  else if (typeof matchup === 'string') playingKeys = matchup.split('_');
  else playingKeys = [];

  const winnerKey = winner; 
  const loserKey = playingKeys.find(k => k !== winnerKey) || playingKeys[1];
  
  const winningTeam = teamsMap[winnerKey];
  const losingTeam = teamsMap[loserKey];

  const winningSlots = Object.values(winningTeam?.slots || {});
  const losingSlots = Object.values(losingTeam?.slots || {});

  let totalCollected = 0;
  const balanceChanges = {};

  const getBetInfo = (val) => {
    if (val && typeof val === 'object') {
      return {
        amount: Number(val.amount) || 0,
        targetPlayerId: val.targetPlayerId || null
      };
    }
    if (typeof val === 'number') {
      return { amount: val, targetPlayerId: null };
    }
    if (typeof val === 'string') {
      return { amount: Number(val) || 0, targetPlayerId: null };
    }
    return null;
  };

  const settledDirectPairs = new Set();
  const directBets = {}; // pid -> { amount, targetPlayerId }
  const hasDirectBet = {}; // pid -> boolean
  
  const allPlayingPids = [];
  winningSlots.forEach(slot => slot.forEach(pid => allPlayingPids.push(pid)));
  losingSlots.forEach(slot => slot.forEach(pid => allPlayingPids.push(pid)));

  allPlayingPids.forEach(pid => {
    const rawBet = playerBets && playerBets[pid];
    const betInfo = getBetInfo(rawBet);
    if (betInfo && betInfo.targetPlayerId && allPlayingPids.includes(betInfo.targetPlayerId)) {
      directBets[pid] = betInfo;
      hasDirectBet[pid] = true;
      hasDirectBet[betInfo.targetPlayerId] = true;
    }
  });

  // Settle direct bets first
  allPlayingPids.forEach(pid => {
    if (directBets[pid]) {
      const { amount, targetPlayerId } = directBets[pid];
      const pairKey = [pid, targetPlayerId].sort().join('_');
      if (!settledDirectPairs.has(pairKey)) {
        settledDirectPairs.add(pairKey);
        
        const isPidWinner = winningSlots.some(slot => slot.includes(pid));
        const isTargetWinner = winningSlots.some(slot => slot.includes(targetPlayerId));
        
        if (isPidWinner && !isTargetWinner) {
          balanceChanges[pid] = (balanceChanges[pid] || 0) + amount;
          balanceChanges[targetPlayerId] = (balanceChanges[targetPlayerId] || 0) - amount;
        } else if (!isPidWinner && isTargetWinner) {
          balanceChanges[pid] = (balanceChanges[pid] || 0) - amount;
          balanceChanges[targetPlayerId] = (balanceChanges[targetPlayerId] || 0) + amount;
        }
      }
    }
  });

  // 1. Tính tiền bên thua trả (cho người chơi không có cược 1-on-1, làm tròn lên 1000đ)
  losingSlots.forEach(slot => {
    const activeSlotPids = slot.filter(pid => !hasDirectBet[pid]);
    if (activeSlotPids.length === 0) return;

    activeSlotPids.forEach(pid => {
      const rawBet = playerBets && playerBets[pid];
      const betInfo = getBetInfo(rawBet);
      const pBet = betInfo ? betInfo.amount : betAmount;
      const rawLoss = pBet / activeSlotPids.length;
      const roundedLoss = Math.ceil(rawLoss / 1000) * 1000;
      balanceChanges[pid] = (balanceChanges[pid] || 0) - roundedLoss;
      totalCollected += roundedLoss;
    });
  });

  // 2. Tính tiền bên thắng dự kiến nhận
  let totalExpected = 0;
  winningSlots.forEach(slot => {
    const activeSlotPids = slot.filter(pid => !hasDirectBet[pid]);
    if (activeSlotPids.length === 0) return;

    activeSlotPids.forEach(pid => {
      const rawBet = playerBets && playerBets[pid];
      const betInfo = getBetInfo(rawBet);
      const pBet = betInfo ? betInfo.amount : betAmount;
      const rawWin = pBet / activeSlotPids.length;
      totalExpected += rawWin;
    });
  });

  // 3. Phân phối tiền thu được cho bên thắng (tỷ lệ theo tiền cược)
  winningSlots.forEach(slot => {
    const activeSlotPids = slot.filter(pid => !hasDirectBet[pid]);
    if (activeSlotPids.length === 0) return;

    activeSlotPids.forEach(pid => {
      const rawBet = playerBets && playerBets[pid];
      const betInfo = getBetInfo(rawBet);
      const pBet = betInfo ? betInfo.amount : betAmount;
      const rawWin = pBet / activeSlotPids.length;
      const winRaw = totalExpected > 0 ? rawWin * (totalCollected / totalExpected) : 0;
      const roundedWin = Math.round(winRaw / 1000) * 1000;
      balanceChanges[pid] = (balanceChanges[pid] || 0) + roundedWin;
    });
  });

  // 4. Đảm bảo tổng số tiền thay đổi bằng 0 (Zero-sum) bằng cách bù trừ sai số làm tròn vào người thắng nhiều nhất
  let sumChanges = 0;
  const poolKeys = Object.keys(balanceChanges).filter(pid => !hasDirectBet[pid]);
  poolKeys.forEach(k => { sumChanges += balanceChanges[k]; });

  if (sumChanges !== 0 && poolKeys.length > 0) {
    let bestKey = null;
    let maxVal = -1;
    winningSlots.forEach(slot => {
      const activeSlotPids = slot.filter(pid => !hasDirectBet[pid]);
      activeSlotPids.forEach(pid => {
        if (balanceChanges[pid] !== undefined && Math.abs(balanceChanges[pid]) > maxVal) {
          maxVal = Math.abs(balanceChanges[pid]);
          bestKey = pid;
        }
      });
    });
    if (!bestKey) {
      bestKey = poolKeys[0];
    }
    balanceChanges[bestKey] = balanceChanges[bestKey] - sumChanges;
  }

  return { balanceChanges, fundAddition: 0, totalCollected };
};