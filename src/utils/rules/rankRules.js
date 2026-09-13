/**
 * Green Future Tech (GFT) — Pure Rank & Designation Rules
 * Phase 0: Deterministic rank qualification and milestone evaluation.
 * 
 * Rules:
 * - Zero database writes.
 * - Zero wallet crediting.
 * - Deterministic output based purely on turnover and team structure inputs.
 */

import { RANKS } from "./businessPlanConfig.js";

/**
 * Ordered list of official GFT ranks from lowest to highest.
 */
export const RANK_LADDER = Object.freeze([
  "rank_silver",
  "rank_gold",
  "rank_emerald",
  "rank_platinum",
  "rank_diamond",
  "rank_ruby",
  "rank_chairman",
]);

/**
 * Pure function: Evaluate user qualification for a specific designation rank.
 * 
 * @param {string} rankKey - e.g. "rank_silver"
 * @param {number} leftTurnover - Total turnover in left binary leg
 * @param {number} rightTurnover - Total turnover in right binary leg
 * @param {object} teamMeta - e.g. { silverLeftCount, silverRightCount, goldLeftCount, etc. }
 * @returns {object} { qualified: boolean, reason: string, rankInfo: object }
 */
export function evaluateRankQualification(rankKey, leftTurnover = 0, rightTurnover = 0, teamMeta = {}) {
  const rank = RANKS[rankKey];
  if (!rank) {
    throw new Error(`Unknown rankKey: '${rankKey}'`);
  }

  const left = Number(leftTurnover) || 0;
  const right = Number(rightTurnover) || 0;
  const totalTurnover = left + right;

  // 1. Silver qualification: ₹2.50 Lakh total, ₹1.25 Lakh left, ₹1.25 Lakh right
  if (rankKey === "rank_silver") {
    const hasTotal = totalTurnover >= 250000;
    const hasLeft = left >= 125000;
    const hasRight = right >= 125000;
    const qualified = hasTotal && hasLeft && hasRight;

    return {
      rankKey,
      rankName: rank.name,
      qualified,
      requiredTurnover: rank.requiredTurnover,
      currentTotalTurnover: totalTurnover,
      leftTurnover: left,
      rightTurnover: right,
      leftRequired: 125000,
      rightRequired: 125000,
      missingLeft: Math.max(0, 125000 - left),
      missingRight: Math.max(0, 125000 - right),
      fundPercentage: rank.fundPercentage,
      fundAmount: rank.fundAmount,
      rewards: rank.rewards,
    };
  }

  // 2. Turnover threshold check for Gold through Chairman
  const meetsTurnover = totalTurnover >= rank.requiredTurnover;

  // Specific prerequisite checks based on team designations
  let meetsTeamPrerequisite = true;
  let prerequisiteNotes = [];

  if (rankKey === "rank_gold") {
    const hasLeftSilver = (teamMeta.silverLeftCount || 0) >= 1;
    const hasRightSilver = (teamMeta.silverRightCount || 0) >= 1;
    if (!hasLeftSilver) prerequisiteNotes.push("Requires at least 1 Silver on the left leg.");
    if (!hasRightSilver) prerequisiteNotes.push("Requires at least 1 Silver on the right leg.");
    meetsTeamPrerequisite = hasLeftSilver && hasRightSilver;
  } else if (rankKey === "rank_emerald") {
    const hasLeftGold = (teamMeta.goldLeftCount || 0) >= 1;
    const hasRightGold = (teamMeta.goldRightCount || 0) >= 1;
    if (!hasLeftGold) prerequisiteNotes.push("Requires at least 1 Gold on the left leg.");
    if (!hasRightGold) prerequisiteNotes.push("Requires at least 1 Gold on the right leg.");
    meetsTeamPrerequisite = hasLeftGold && hasRightGold;
  } else if (rankKey === "rank_platinum") {
    const hasLeftEmerald = (teamMeta.emeraldLeftCount || 0) >= 1;
    const hasRightEmerald = (teamMeta.emeraldRightCount || 0) >= 1;
    if (!hasLeftEmerald) prerequisiteNotes.push("Requires at least 1 Emerald on the left leg.");
    if (!hasRightEmerald) prerequisiteNotes.push("Requires at least 1 Emerald on the right leg.");
    meetsTeamPrerequisite = hasLeftEmerald && hasRightEmerald;
  } else if (rankKey === "rank_diamond") {
    const hasLeftPlatinum = (teamMeta.platinumLeftCount || 0) >= 1;
    const hasRightPlatinum = (teamMeta.platinumRightCount || 0) >= 1;
    if (!hasLeftPlatinum) prerequisiteNotes.push("Requires at least 1 Platinum on the left leg.");
    if (!hasRightPlatinum) prerequisiteNotes.push("Requires at least 1 Platinum on the right leg.");
    meetsTeamPrerequisite = hasLeftPlatinum && hasRightPlatinum;
  } else if (rankKey === "rank_ruby") {
    const hasLeftDiamond = (teamMeta.diamondLeftCount || 0) >= 1;
    const hasRightDiamond = (teamMeta.diamondRightCount || 0) >= 1;
    if (!hasLeftDiamond) prerequisiteNotes.push("Requires at least 1 Diamond on the left leg.");
    if (!hasRightDiamond) prerequisiteNotes.push("Requires at least 1 Diamond on the right leg.");
    meetsTeamPrerequisite = hasLeftDiamond && hasRightDiamond;
  } else if (rankKey === "rank_chairman") {
    const hasLeftRuby = (teamMeta.rubyLeftCount || 0) >= 1;
    const hasRightRuby = (teamMeta.rubyRightCount || 0) >= 1;
    const totalRubies = (teamMeta.totalRubiesInTeam || 0);
    if (!hasLeftRuby) prerequisiteNotes.push("Requires at least 1 Ruby on the left leg.");
    if (!hasRightRuby) prerequisiteNotes.push("Requires at least 1 Ruby on the right leg.");
    if (totalRubies < 3) prerequisiteNotes.push("Requires at least 3 Rubies in team for Dubai tour qualification.");
    meetsTeamPrerequisite = hasLeftRuby && hasRightRuby;
  }

  const qualified = meetsTurnover && meetsTeamPrerequisite;

  return {
    rankKey,
    rankName: rank.name,
    qualified,
    requiredTurnover: rank.requiredTurnover,
    currentTotalTurnover: totalTurnover,
    leftTurnover: left,
    rightTurnover: right,
    meetsTurnover,
    meetsTeamPrerequisite,
    prerequisiteNotes,
    fundPercentage: rank.fundPercentage,
    fundAmount: rank.fundAmount,
    rewards: rank.rewards,
  };
}

/**
 * Pure function: Determine user's current highest achieved rank and next target rank.
 */
export function determineUserRankProgress(leftTurnover = 0, rightTurnover = 0, teamMeta = {}) {
  let highestAchieved = null;
  let nextRank = null;

  for (let i = 0; i < RANK_LADDER.length; i++) {
    const rankKey = RANK_LADDER[i];
    const evaluation = evaluateRankQualification(rankKey, leftTurnover, rightTurnover, teamMeta);
    if (evaluation.qualified) {
      highestAchieved = evaluation;
    } else {
      nextRank = evaluation;
      break;
    }
  }

  const total = (Number(leftTurnover) || 0) + (Number(rightTurnover) || 0);
  const nextTargetTurnover = nextRank ? nextRank.requiredTurnover : (highestAchieved ? highestAchieved.requiredTurnover : 250000);
  const progressPct = Math.min(100, Math.round((total / nextTargetTurnover) * 100));

  return {
    currentRankKey: highestAchieved ? highestAchieved.rankKey : "none",
    currentRankName: highestAchieved ? highestAchieved.rankName : "Affiliate Member",
    nextRankKey: nextRank ? nextRank.rankKey : null,
    nextRankName: nextRank ? nextRank.rankName : "Max Rank Achieved",
    totalTurnover: total,
    targetTurnover: nextTargetTurnover,
    remainingTurnover: Math.max(0, nextTargetTurnover - total),
    progressPercentage: progressPct,
  };
}
