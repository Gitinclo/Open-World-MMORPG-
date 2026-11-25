import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyExperienceGain,
  computeCharacterStats,
  computeCombatDamage,
  computeTriBranchMultiplier,
  decideEnemyAIState,
  evaluateBreakthrough,
  getBiomeAt,
  stepComboTimer,
  terrainHeightAt,
  xpRequiredForLevel,
} from './rules';

test('tri-branch tactical counter follows Shieldbearer -> Shooter -> Bomber -> Shieldbearer', () => {
  assert.equal(computeTriBranchMultiplier('shieldbearer', 'shooter'), 1.5);
  assert.equal(computeTriBranchMultiplier('shooter', 'bomber'), 1.5);
  assert.equal(computeTriBranchMultiplier('bomber', 'shieldbearer'), 1.5);

  assert.equal(computeTriBranchMultiplier('shooter', 'shieldbearer'), 0.75);
  assert.equal(computeTriBranchMultiplier('bomber', 'shooter'), 0.75);
  assert.equal(computeTriBranchMultiplier('shieldbearer', 'bomber'), 0.75);

  assert.equal(computeTriBranchMultiplier('shieldbearer', 'shieldbearer'), 1.0);
});

test('character stats scale cleanly with class, lineage, level, and cultivation tier', () => {
  const lv1HumanKnight = computeCharacterStats('knight', 'human', 1, 0);
  const lv5DwarfKnight = computeCharacterStats('knight', 'ironforge_dwarf', 5, 2);
  const lv1ElfMage = computeCharacterStats('mage', 'sylvan_elf', 1, 0);

  assert.ok(lv1HumanKnight.maxHp > lv1ElfMage.maxHp, 'Knight should have more HP than Mage');
  assert.ok(lv1ElfMage.maxMana > lv1HumanKnight.maxMana, 'Mage should have more Mana than Knight');
  assert.ok(lv5DwarfKnight.combatPower > lv1HumanKnight.combatPower, 'Higher level and cultivation increases power');
  assert.ok(lv5DwarfKnight.defense > lv1HumanKnight.defense, 'Ironforge Dwarf bonus increases defense');
});

test('combat damage applies crit, combo, branch advantage, and defense mitigation', () => {
  const baseHit = computeCombatDamage({
    attackerAttack: 40,
    skillMultiplier: 1.0,
    targetDefense: 10,
    isCrit: false,
    attackerBranch: 'shieldbearer',
    defenderBranch: 'shieldbearer',
    comboCount: 0,
  });

  const advantageCrit = computeCombatDamage({
    attackerAttack: 40,
    skillMultiplier: 1.5,
    targetDefense: 10,
    isCrit: true,
    attackerBranch: 'shieldbearer',
    defenderBranch: 'shooter',
    comboCount: 10,
  });

  assert.ok(baseHit.finalDamage > 0);
  assert.equal(advantageCrit.branchMultiplier, 1.5);
  assert.equal(advantageCrit.critMultiplier, 1.85);
  assert.ok(advantageCrit.finalDamage > baseHit.finalDamage * 2.5);
});

test('experience gain handles multi-level ups deterministically', () => {
  const req1 = xpRequiredForLevel(1);
  const res = applyExperienceGain(1, 0, req1 + 50);
  assert.equal(res.level, 2);
  assert.equal(res.xp, 50);
  assert.equal(res.leveledUp, true);
});

test('cultivation breakthrough validates level and spirit stone thresholds', () => {
  const blockedLevel = evaluateBreakthrough(0, 1, 50);
  assert.equal(blockedLevel.canBreakthrough, false);

  const blockedStones = evaluateBreakthrough(0, 3, 10);
  assert.equal(blockedStones.canBreakthrough, false);

  const eligible = evaluateBreakthrough(0, 2, 35);
  assert.equal(eligible.canBreakthrough, true);
  assert.equal(eligible.nextTier, 1);
  assert.equal(eligible.cost, 30);
});

test('combo timer decays cleanly to zero after window expires', () => {
  const mid = stepComboTimer(5, 2.0, 0.5);
  assert.equal(mid.combo, 5);
  assert.equal(mid.comboTimer, 1.5);

  const expired = stepComboTimer(5, 0.2, 0.5);
  assert.equal(expired.combo, 0);
  assert.equal(expired.comboTimer, 0);
});

test('terrain heightmap is smooth near spawn/citadel and rises along outer mountain rim', () => {
  const spawnH = terrainHeightAt(0, 12);
  const citadelH = terrainHeightAt(0, -20);
  const foothillH = terrainHeightAt(110, 0);
  const ridgeH = terrainHeightAt(120, 0);

  assert.ok(Math.abs(spawnH) < 0.25, 'Spawn plaza should be nearly flat');
  assert.ok(Math.abs(citadelH) < 0.25, 'Citadel courtyard should be nearly flat');
  assert.ok(foothillH > 5, 'Outer perimeter should rise into natural foothills');
  assert.ok(ridgeH > 10, 'Outer ridge should form natural mountain peaks');
});

test('biome classifier separates all 4 fantasy zones accurately', () => {
  assert.equal(getBiomeAt(0, 0), 'solara_plains');
  assert.equal(getBiomeAt(-45, -30), 'verdant_forest');
  assert.equal(getBiomeAt(45, -30), 'ironforge_crags');
  assert.equal(getBiomeAt(10, 50), 'cursed_wastes');
});

test('enemy AI policies differentiate ranged kiter from melee chaser and respect attack tokens', () => {
  const archerClose = decideEnemyAIState({
    archetype: 'shade_archer',
    currentState: 'chase',
    distanceToPlayer: 4.5,
    hpRatio: 0.8,
    aggroRadius: 23,
    attackRange: 14.5,
    attackCooldownRemaining: 0,
    hasAttackToken: true,
  });
  assert.equal(archerClose, 'kite');

  const archerFlee = decideEnemyAIState({
    archetype: 'shade_archer',
    currentState: 'chase',
    distanceToPlayer: 5.5,
    hpRatio: 0.2,
    aggroRadius: 23,
    attackRange: 14.5,
    attackCooldownRemaining: 0,
    hasAttackToken: true,
  });
  assert.equal(archerFlee, 'flee');

  const marauderTelegraph = decideEnemyAIState({
    archetype: 'marauder',
    currentState: 'chase',
    distanceToPlayer: 2.5,
    hpRatio: 0.9,
    aggroRadius: 18,
    attackRange: 3.0,
    attackCooldownRemaining: 0,
    hasAttackToken: true,
  });
  assert.equal(marauderTelegraph, 'telegraph');

  const marauderNoToken = decideEnemyAIState({
    archetype: 'marauder',
    currentState: 'chase',
    distanceToPlayer: 2.5,
    hpRatio: 0.9,
    aggroRadius: 18,
    attackRange: 3.0,
    attackCooldownRemaining: 0,
    hasAttackToken: false,
  });
  assert.equal(marauderNoToken, 'chase');
});

test('skill tree enforces prerequisites, spends skill points, scales combat skills, and supports clean respec', async () => {
  const { CLASS_SKILL_TREES } = await import('./catalog');
  const {
    computeEffectiveSkill,
    evaluateSkillNodeUpgrade,
    resetClassSkillTree,
    spendSkillPointOnNode,
  } = await import('./rules');

  const knightTree = CLASS_SKILL_TREES.knight;
  const rootNode = knightTree[0];
  const tier2Aegis = knightTree[1];
  const tier2Doctrine = knightTree[2];

  const baseProfile = {
    playerId: 'test_hero',
    name: 'Test Knight',
    classId: 'knight' as const,
    lineageId: 'human' as const,
    shardId: 'solara-eu',
    level: 3,
    xp: 0,
    xpToNext: 300,
    cultivationTier: 0,
    skillPoints: 3,
    skillRanks: {} as Record<string, number>,
    gold: 100,
    spiritStones: 30,
    kills: 0,
    reviveTokens: 1,
    healthElixirs: 2,
    manaDraughts: 2,
    guildId: null,
    guildTag: null,
    partyId: null,
    lastX: 0,
    lastZ: 14,
  };

  // Tier 2 node blocked until Tier 1 root is unlocked
  const blocked = evaluateSkillNodeUpgrade(tier2Aegis, baseProfile.skillRanks, baseProfile.skillPoints);
  assert.equal(blocked.canUpgrade, false);
  assert.equal(blocked.prereqsMet, false);
  assert.equal(spendSkillPointOnNode(baseProfile, tier2Aegis.id), null);

  // Unlock Tier 1 root -> unlocks Tier 2 children and boosts Slot 0 Sovereign Cleave
  const afterRoot = spendSkillPointOnNode(baseProfile, rootNode.id);
  assert.ok(afterRoot);
  assert.equal(afterRoot.skillPoints, 2);
  assert.equal(afterRoot.skillRanks[rootNode.id], 1);

  const baseSlot0 = computeEffectiveSkill('knight', 0, {});
  const upgradedSlot0 = computeEffectiveSkill('knight', 0, afterRoot.skillRanks);
  assert.ok(upgradedSlot0.damageMult > baseSlot0.damageMult, 'Upgrading root boosts skill 1 damage');
  assert.ok(upgradedSlot0.cooldown < baseSlot0.cooldown, 'Upgrading root reduces skill 1 cooldown');

  // Now Tier 2 Doctrine can be unlocked and boosts passive Max HP & Defense
  const afterDoctrine = spendSkillPointOnNode(afterRoot, tier2Doctrine.id);
  assert.ok(afterDoctrine);
  assert.equal(afterDoctrine.skillPoints, 1);

  const statsBefore = computeCharacterStats('knight', 'human', 3, 0, {});
  const statsAfter = computeCharacterStats('knight', 'human', 3, 0, afterDoctrine.skillRanks);
  assert.ok(statsAfter.maxHp > statsBefore.maxHp, 'Citadel Plate Mastery increases Max HP');
  assert.ok(statsAfter.defense > statsBefore.defense, 'Citadel Plate Mastery increases Defense');

  // Respec refunds all 2 spent points cleanly
  const respec = resetClassSkillTree(afterDoctrine);
  assert.equal(respec.refunded, 2);
  assert.equal(respec.profile.skillPoints, 3);
  assert.equal(Object.keys(respec.profile.skillRanks).length, 0);
});

