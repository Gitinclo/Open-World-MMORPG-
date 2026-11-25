import { CHARACTER_CLASSES, CLASS_SKILL_TREES, CULTIVATION_REALMS, LINEAGES } from './catalog';
import type {
  BiomeId,
  CharacterClassId,
  CharacterStats,
  EffectiveSkillStats,
  EnemyAIState,
  EnemyArchetypeId,
  LineageId,
  PlayerProfile,
  SkillTreeNodeSpec,
  TroopBranch,
} from './types';

/**
 * Deterministic Tri-Branch Tactical Counter from Voxel Realms COMBAT_FORMULAS:
 * Shieldbearer -> Shooter -> Bomber -> Shieldbearer (1.5x advantage / 0.75x disadvantage)
 */
export function computeTriBranchMultiplier(
  attacker: TroopBranch,
  defender: TroopBranch
): number {
  if (attacker === defender) return 1.0;
  if (
    (attacker === 'shieldbearer' && defender === 'shooter') ||
    (attacker === 'shooter' && defender === 'bomber') ||
    (attacker === 'bomber' && defender === 'shieldbearer')
  ) {
    return 1.5;
  }
  return 0.75;
}

/**
 * Aggregates passive stat bonuses and global cooldown reduction from invested skill tree nodes.
 */
export function computeSkillTreePassives(
  classId: CharacterClassId,
  skillRanks?: Record<string, number>
): {
  hpBonusPct: number;
  attackBonusPct: number;
  defenseBonusPct: number;
  critBonusPct: number;
  globalCooldownPct: number;
} {
  let hpBonusPct = 0;
  let attackBonusPct = 0;
  let defenseBonusPct = 0;
  let critBonusPct = 0;
  let globalCooldownPct = 0;

  if (!skillRanks) {
    return { hpBonusPct, attackBonusPct, defenseBonusPct, critBonusPct, globalCooldownPct };
  }

  const tree = CLASS_SKILL_TREES[classId] ?? [];
  for (const node of tree) {
    const rank = Math.max(0, Math.min(node.maxRank, Math.floor(skillRanks[node.id] ?? 0)));
    if (rank <= 0) continue;
    hpBonusPct += (node.bonus.hpBonusPctPerRank ?? 0) * rank;
    attackBonusPct += (node.bonus.attackBonusPctPerRank ?? 0) * rank;
    defenseBonusPct += (node.bonus.defenseBonusPctPerRank ?? 0) * rank;
    critBonusPct += (node.bonus.critBonusPctPerRank ?? 0) * rank;
    globalCooldownPct += (node.bonus.globalCooldownPctPerRank ?? 0) * rank;
  }

  return {
    hpBonusPct,
    attackBonusPct,
    defenseBonusPct,
    critBonusPct,
    globalCooldownPct: Math.min(40, globalCooldownPct),
  };
}

/**
 * Computes derived character stats from class, fantasy lineage, level, cultivation realm,
 * and optional invested skill tree passive ranks.
 */
export function computeCharacterStats(
  classId: CharacterClassId,
  lineageId: LineageId,
  level: number,
  cultivationTier: number,
  skillRanks?: Record<string, number>
): CharacterStats {
  const cls = CHARACTER_CLASSES[classId];
  const lin = LINEAGES[lineageId];
  const passives = computeSkillTreePassives(classId, skillRanks);
  const clampedLevel = Math.max(1, Math.floor(level));
  const realmIdx = Math.max(0, Math.min(CULTIVATION_REALMS.length - 1, Math.floor(cultivationTier)));
  const realm = CULTIVATION_REALMS[realmIdx];

  const levelScale = 1 + (clampedLevel - 1) * 0.14;
  const maxHp = Math.round(
    cls.baseHp *
      levelScale *
      (1 + (lin.hpBonusPct + passives.hpBonusPct) / 100) *
      Math.sqrt(realm.powerMultiplier)
  );
  const maxMana = Math.round(
    cls.baseMana * (1 + (clampedLevel - 1) * 0.1) * (1 + lin.manaBonusPct / 100)
  );
  const maxStamina = Math.round(cls.baseStamina + (clampedLevel - 1) * 4);
  const attack = Math.round(
    cls.baseAttack *
      levelScale *
      (1 + (lin.attackBonusPct + passives.attackBonusPct) / 100) *
      realm.powerMultiplier
  );
  const defense = Math.round(
    cls.baseDefense *
      (1 + (clampedLevel - 1) * 0.11) *
      (1 + (lin.defenseBonusPct + passives.defenseBonusPct) / 100) *
      Math.sqrt(realm.powerMultiplier)
  );
  const critChance = Math.min(0.75, cls.critChance + passives.critBonusPct / 100);

  const combatPower = Math.round(
    attack * 14 + defense * 10 + maxHp * 1.8 + maxMana * 1.1 + clampedLevel * 40 + passives.critBonusPct * 12
  );

  return {
    maxHp,
    maxMana,
    maxStamina,
    attack,
    defense,
    moveSpeed: cls.moveSpeed,
    critChance,
    combatPower,
  };
}

/**
 * Computes effective combat stats for a class hotbar skill [0..3] after applying skill tree upgrades.
 */
export function computeEffectiveSkill(
  classId: CharacterClassId,
  slotIndex: 0 | 1 | 2 | 3,
  skillRanks?: Record<string, number>
): EffectiveSkillStats {
  const baseSkill = CHARACTER_CLASSES[classId].skills[slotIndex];
  const tree = CLASS_SKILL_TREES[classId] ?? [];
  const passives = computeSkillTreePassives(classId, skillRanks);

  let nodeRank = 0;
  let damagePct = 0;
  let cdReductionPct = passives.globalCooldownPct;
  let manaReductionPct = 0;
  let radiusPct = 0;

  if (skillRanks) {
    for (const node of tree) {
      if (node.targetSkillSlot !== slotIndex) continue;
      const r = Math.max(0, Math.min(node.maxRank, Math.floor(skillRanks[node.id] ?? 0)));
      if (r <= 0) continue;
      nodeRank += r;
      damagePct += (node.bonus.damagePctPerRank ?? 0) * r;
      cdReductionPct += (node.bonus.cooldownReductionPctPerRank ?? 0) * r;
      manaReductionPct += (node.bonus.manaCostReductionPctPerRank ?? 0) * r;
      radiusPct += (node.bonus.radiusPctPerRank ?? 0) * r;
    }
  }

  const damageMult = Number((baseSkill.damageMult * (1 + damagePct / 100)).toFixed(2));
  const cooldown = Number(Math.max(0.22, baseSkill.cooldown * (1 - Math.min(55, cdReductionPct) / 100)).toFixed(2));
  const manaCost = Math.max(0, Math.round(baseSkill.manaCost * (1 - Math.min(60, manaReductionPct) / 100)));
  const radius = Number((baseSkill.radius * (1 + radiusPct / 100)).toFixed(2));

  return {
    skill: baseSkill,
    rank: nodeRank,
    damageMult,
    cooldown,
    manaCost,
    radius,
  };
}

/**
 * Validates whether a player can unlock or upgrade a specific skill tree node.
 */
export function evaluateSkillNodeUpgrade(
  node: SkillTreeNodeSpec,
  skillRanks: Record<string, number>,
  skillPoints: number
): { canUpgrade: boolean; currentRank: number; prereqsMet: boolean; reason?: string } {
  const currentRank = Math.max(0, Math.floor(skillRanks[node.id] ?? 0));
  const prereqsMet = node.prerequisites.every((pid) => (skillRanks[pid] ?? 0) >= 1);

  if (currentRank >= node.maxRank) {
    return { canUpgrade: false, currentRank, prereqsMet, reason: 'Maximum rank mastered' };
  }
  if (!prereqsMet) {
    return { canUpgrade: false, currentRank, prereqsMet, reason: 'Requires parent ability unlocked' };
  }
  if (skillPoints < 1) {
    return { canUpgrade: false, currentRank, prereqsMet, reason: 'No Skill Points available' };
  }
  return { canUpgrade: true, currentRank, prereqsMet };
}

/**
 * Pure immutable update spending 1 Skill Point to unlock/upgrade a node in the player's class tree.
 */
export function spendSkillPointOnNode(profile: PlayerProfile, nodeId: string): PlayerProfile | null {
  const tree = CLASS_SKILL_TREES[profile.classId] ?? [];
  const node = tree.find((n) => n.id === nodeId);
  if (!node) return null;

  const check = evaluateSkillNodeUpgrade(node, profile.skillRanks, profile.skillPoints);
  if (!check.canUpgrade) return null;

  return {
    ...profile,
    skillPoints: profile.skillPoints - 1,
    skillRanks: {
      ...profile.skillRanks,
      [node.id]: check.currentRank + 1,
    },
  };
}

/**
 * Refunds all spent Skill Points for the player's active class tree.
 */
export function resetClassSkillTree(profile: PlayerProfile): { profile: PlayerProfile; refunded: number } {
  const tree = CLASS_SKILL_TREES[profile.classId] ?? [];
  const nextRanks = { ...profile.skillRanks };
  let refunded = 0;
  for (const node of tree) {
    const r = Math.max(0, Math.floor(nextRanks[node.id] ?? 0));
    if (r > 0) {
      refunded += r;
      delete nextRanks[node.id];
    }
  }
  return {
    refunded,
    profile: {
      ...profile,
      skillPoints: profile.skillPoints + refunded,
      skillRanks: nextRanks,
    },
  };
}

export interface DamageInput {
  attackerAttack: number;
  skillMultiplier: number;
  targetDefense: number;
  isCrit: boolean;
  attackerBranch: TroopBranch;
  defenderBranch: TroopBranch;
  comboCount: number;
  realmDiff?: number;
}

export interface DamageResult {
  finalDamage: number;
  branchMultiplier: number;
  comboMultiplier: number;
  critMultiplier: number;
}

/**
 * Deterministic combat damage calculation incorporating tri-branch counters,
 * defense mitigation, combo bonus, critical strike multiplier, and realm suppression.
 */
export function computeCombatDamage(input: DamageInput): DamageResult {
  const branchMultiplier = computeTriBranchMultiplier(input.attackerBranch, input.defenderBranch);
  const comboMultiplier = 1 + Math.min(Math.max(0, input.comboCount), 20) * 0.03;
  const critMultiplier = input.isCrit ? 1.85 : 1.0;
  const realmBonus = input.realmDiff && input.realmDiff > 0 ? 1 + Math.min(input.realmDiff, 4) * 0.15 : 1.0;

  const raw =
    input.attackerAttack *
    Math.max(0.2, input.skillMultiplier) *
    branchMultiplier *
    comboMultiplier *
    critMultiplier *
    realmBonus;

  const mitigation = 100 / (100 + Math.max(0, input.targetDefense) * 2.2);
  const finalDamage = Math.max(1, Math.round(raw * mitigation));

  return {
    finalDamage,
    branchMultiplier,
    comboMultiplier,
    critMultiplier,
  };
}

/**
 * XP required to reach the next level.
 */
export function xpRequiredForLevel(level: number): number {
  const lv = Math.max(1, Math.floor(level));
  return Math.round(100 * Math.pow(lv, 1.38));
}

/**
 * Applies XP gain and returns updated level, levelsGained (for Skill Points), and remainder XP.
 */
export function applyExperienceGain(
  level: number,
  xp: number,
  gain: number
): { level: number; xp: number; xpToNext: number; leveledUp: boolean; levelsGained: number } {
  const startLevel = Math.max(1, Math.floor(level));
  let currentLevel = startLevel;
  let currentXp = Math.max(0, Math.floor(xp)) + Math.max(0, Math.floor(gain));

  while (currentXp >= xpRequiredForLevel(currentLevel) && currentLevel < 99) {
    currentXp -= xpRequiredForLevel(currentLevel);
    currentLevel += 1;
  }

  const levelsGained = currentLevel - startLevel;
  return {
    level: currentLevel,
    xp: currentXp,
    xpToNext: xpRequiredForLevel(currentLevel),
    leveledUp: levelsGained > 0,
    levelsGained,
  };
}

/**
 * Evaluates whether a character qualifies for the next Cultivation Realm breakthrough.
 */
export function evaluateBreakthrough(
  currentTier: number,
  level: number,
  spiritStones: number
): { canBreakthrough: boolean; nextTier: number; cost: number; reason?: string } {
  const nextTier = currentTier + 1;
  if (nextTier >= CULTIVATION_REALMS.length) {
    return { canBreakthrough: false, nextTier: currentTier, cost: 0, reason: 'Maximum realm reached' };
  }
  const spec = CULTIVATION_REALMS[nextTier];
  if (level < spec.minLevel) {
    return {
      canBreakthrough: false,
      nextTier,
      cost: spec.spiritStoneCost,
      reason: `Requires Level ${spec.minLevel}`,
    };
  }
  if (spiritStones < spec.spiritStoneCost) {
    return {
      canBreakthrough: false,
      nextTier,
      cost: spec.spiritStoneCost,
      reason: `Requires ${spec.spiritStoneCost} Spirit Stones`,
    };
  }
  return {
    canBreakthrough: true,
    nextTier,
    cost: spec.spiritStoneCost,
  };
}

/**
 * Advances combo counter with a 3.2-second decay window.
 */
export function stepComboTimer(
  combo: number,
  comboTimer: number,
  dt: number
): { combo: number; comboTimer: number } {
  if (combo <= 0) return { combo: 0, comboTimer: 0 };
  const nextTimer = comboTimer - Math.max(0, dt);
  if (nextTimer <= 0) {
    return { combo: 0, comboTimer: 0 };
  }
  return { combo, comboTimer: nextTimer };
}

/**
 * Deterministic 4-biome open-world classifier (110m playable radius).
 * Center (r < 34m): Solara Citadel Plains
 * North-West (x < 0, z < 0): Verdant High-Elf Woods
 * North-East (x >= 0, z < 0): Ironforge Runic Crags
 * South (z >= 0): Shadowvale Cursed Wastes
 */
export function getBiomeAt(x: number, z: number): BiomeId {
  const dist = Math.hypot(x, z);
  if (dist < 34) return 'solara_plains';
  if (z >= 10) return 'cursed_wastes';
  if (x < 0) return 'verdant_forest';
  return 'ironforge_crags';
}

/**
 * Deterministic open-world terrain heightmap.
 * Keeps Solara Citadel courtyard (around x=0, z=-18) and main spawn road (x=0, z=0..24) smooth and flat,
 * rises naturally toward perimeter highland ridges beyond r = 82m so there are no boxed void walls.
 */
export function terrainHeightAt(x: number, z: number): number {
  const distCenter = Math.hypot(x, z);
  const distKeep = Math.hypot(x, z + 20);
  const distSpawn = Math.hypot(x, z - 12);

  // Smooth rolling hills
  const hills =
    Math.sin(x * 0.045) * Math.cos(z * 0.045) * 1.9 +
    Math.sin(x * 0.095 + 1.2) * Math.sin(z * 0.085 - 0.6) * 0.85;

  // Flatten the citadel plaza & main road corridor for crisp grounding
  const keepFlatten = Math.min(1, Math.max(0, (distKeep - 16) / 14));
  const spawnFlatten = Math.min(1, Math.max(0, (distSpawn - 10) / 12));
  const roadDist = Math.min(Math.abs(x), Math.abs(z - 12));
  const roadFlatten = distCenter < 56 ? Math.min(1, Math.max(0, (roadDist - 4.5) / 6)) : 1;

  const flatMask = keepFlatten * spawnFlatten * (0.35 + 0.65 * roadFlatten);
  let h = hills * flatMask;

  // Slight elevation for Ironforge Crags in NE
  if (x > 26 && z < 8) {
    const cragFactor = Math.min(1, (Math.hypot(x - 48, z + 30) < 34 ? 1 : 0.4));
    h += cragFactor * Math.max(0, Math.sin(x * 0.12) * Math.cos(z * 0.12)) * 2.2;
  }

  // Natural perimeter mountain ring outside playable 90m radius
  if (distCenter > 90) {
    const rim = (distCenter - 90) / 28;
    const angle = Math.atan2(z, x);
    const crags = Math.sin(angle * 7) * 1.4 + Math.cos(angle * 13 + 0.8) * 0.9;
    h += rim * rim * 10.5 + Math.max(0, crags) * rim * 1.6;
  }

  return h;
}

/**
 * Pure enemy behavior state selector enforcing distinct archetype policies:
 * - marauder: direct aggressive chaser
 * - shade_archer: ranged kiter that backs away if player closes within 6m
 * - juggernaut: charges in bursts and triggers heavy telegraphed slams
 * - dreadlord_boss: multi-range warlord boss with relentless pursuit & sweeping slams
 */
export function decideEnemyAIState(params: {
  archetype: EnemyArchetypeId;
  currentState: EnemyAIState;
  distanceToPlayer: number;
  hpRatio: number;
  aggroRadius: number;
  attackRange: number;
  attackCooldownRemaining: number;
  hasAttackToken: boolean;
}): EnemyAIState {
  if (params.currentState === 'ko') return 'ko';
  if (params.currentState === 'telegraph' || params.currentState === 'attack') {
    return params.currentState;
  }

  // Low-HP non-boss archers flee briefly if cornered
  if (params.archetype === 'shade_archer' && params.hpRatio < 0.25 && params.distanceToPlayer < 7.5) {
    return 'flee';
  }

  if (params.distanceToPlayer > params.aggroRadius * 1.45) {
    return 'patrol';
  }

  if (params.distanceToPlayer <= params.aggroRadius) {
    // Ranged kiter keeps optimal distance
    if (params.archetype === 'shade_archer' && params.distanceToPlayer < 6.0) {
      return 'kite';
    }
    if (
      params.distanceToPlayer <= params.attackRange &&
      params.attackCooldownRemaining <= 0 &&
      params.hasAttackToken
    ) {
      return 'telegraph';
    }
    return 'chase';
  }

  return 'patrol';
}
