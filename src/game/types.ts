export type CharacterClassId = 'knight' | 'mage' | 'rogue' | 'shaman';

export type LineageId =
  | 'human'
  | 'sylvan_elf'
  | 'ironforge_dwarf'
  | 'azure_dragonkin'
  | 'celestial_kitsune'
  | 'void_walker';

export type TroopBranch = 'shieldbearer' | 'shooter' | 'bomber';

export type StatusEffectType = 'burn' | 'freeze' | 'poison' | 'stun';

export type BiomeId = 'solara_plains' | 'verdant_forest' | 'ironforge_crags' | 'cursed_wastes';

export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type EnemyArchetypeId = 'marauder' | 'shade_archer' | 'juggernaut' | 'dreadlord_boss';

export type EnemyAIState = 'idle' | 'patrol' | 'chase' | 'kite' | 'telegraph' | 'attack' | 'flee' | 'ko';

export interface ClassSkillSpec {
  id: string;
  key: '1' | '2' | '3' | '4';
  name: string;
  role: string;
  manaCost: number;
  cooldown: number;
  damageMult: number;
  range: number;
  radius: number;
  isProjectile?: boolean;
  isDash?: boolean;
  isHeal?: boolean;
  statusEffect?: StatusEffectType;
  accentHex: string;
}

export interface CharacterClassSpec {
  id: CharacterClassId;
  name: string;
  title: string;
  branch: TroopBranch;
  primaryRole: string;
  baseHp: number;
  baseMana: number;
  baseStamina: number;
  baseAttack: number;
  baseDefense: number;
  moveSpeed: number;
  critChance: number;
  weaponStyle: 'sword_shield' | 'staff' | 'dual_daggers' | 'totem_mace';
  primaryColor: string;
  accentColor: string;
  skills: readonly [ClassSkillSpec, ClassSkillSpec, ClassSkillSpec, ClassSkillSpec];
}

export interface LineageMeshTraits {
  scale: [number, number, number];
  accentHex: string;
  skinHex: string;
  hasElfEars?: boolean;
  hasRunicBeard?: boolean;
  hasDragonHorns?: boolean;
  hasKitsuneTails?: boolean;
  hasVoidCrystals?: boolean;
  hasSovereignCrest?: boolean;
}

export interface LineageSpec {
  id: LineageId;
  name: string;
  origin: string;
  passiveSummary: string;
  hpBonusPct: number;
  attackBonusPct: number;
  defenseBonusPct: number;
  manaBonusPct: number;
  cultivationSpeedPct: number;
  meshTraits: LineageMeshTraits;
}

export interface CultivationRealmSpec {
  tier: number;
  name: string;
  minLevel: number;
  spiritStoneCost: number;
  powerMultiplier: number;
  auraHex: string;
}

export interface RealmShardSpec {
  id: string;
  name: string;
  region: string;
  biomeTheme: string;
  maxCapacity: number;
}

export interface CharacterStats {
  maxHp: number;
  maxMana: number;
  maxStamina: number;
  attack: number;
  defense: number;
  moveSpeed: number;
  critChance: number;
  combatPower: number;
}

export type SkillNodeIconType =
  | 'blade'
  | 'shield'
  | 'flame'
  | 'frost'
  | 'bolt'
  | 'dagger'
  | 'crown'
  | 'spark';

export interface SkillTreeNodeBonus {
  damagePctPerRank?: number;
  cooldownReductionPctPerRank?: number;
  manaCostReductionPctPerRank?: number;
  radiusPctPerRank?: number;
  attackBonusPctPerRank?: number;
  defenseBonusPctPerRank?: number;
  hpBonusPctPerRank?: number;
  critBonusPctPerRank?: number;
  globalCooldownPctPerRank?: number;
}

export interface SkillTreeNodeSpec {
  id: string;
  classId: CharacterClassId;
  name: string;
  subtitle: string;
  description: string;
  tier: 1 | 2 | 3;
  column: 0 | 1 | 2;
  maxRank: number;
  prerequisites: readonly string[];
  targetSkillSlot?: 0 | 1 | 2 | 3;
  icon: SkillNodeIconType;
  accentHex: string;
  bonus: SkillTreeNodeBonus;
}

export interface EffectiveSkillStats {
  skill: ClassSkillSpec;
  rank: number;
  damageMult: number;
  cooldown: number;
  manaCost: number;
  radius: number;
}

export interface PlayerProfile {
  playerId: string;
  name: string;
  classId: CharacterClassId;
  lineageId: LineageId;
  shardId: string;
  level: number;
  xp: number;
  xpToNext: number;
  cultivationTier: number;
  skillPoints: number;
  skillRanks: Record<string, number>;
  gold: number;
  spiritStones: number;
  kills: number;
  reviveTokens: number;
  healthElixirs: number;
  manaDraughts: number;
  guildId: string | null;
  guildTag: string | null;
  partyId: string | null;
  lastX: number;
  lastZ: number;
}

export interface RemotePlayerState {
  playerId: string;
  name: string;
  classId: CharacterClassId;
  lineageId: LineageId;
  shardId: string;
  level: number;
  cultivationTier: number;
  guildTag: string | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  attacking: boolean;
  lastSeen: number;
}

export interface GuildRecord {
  id: string;
  name: string;
  tag: string;
  emblemColor: string;
  motto: string;
  fortressSector: string;
  treasuryGold: number;
  rallyPower: number;
  members: string[];
  createdAt: number;
}

export interface PartyRecord {
  id: string;
  name: string;
  leaderId: string;
  leaderName: string;
  shardId: string;
  memberIds: string[];
  memberNames: string[];
}

export interface ChatMessage {
  id: string;
  channel: 'world' | 'guild' | 'party' | 'system';
  shardId: string;
  guildId?: string | null;
  partyId?: string | null;
  senderId: string;
  senderName: string;
  senderTag?: string | null;
  text: string;
  timestamp: number;
}

export interface CastleSiegeState {
  fortressName: string;
  controllingGuildTag: string;
  controllingGuildName: string;
  gateIntegrity: number;
  maxGateIntegrity: number;
  activeRallies: number;
  totalSiegeDamage: number;
  preferredBranch: TroopBranch;
  lastCapturedBy: string;
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  classId: CharacterClassId;
  lineageId: LineageId;
  guildTag: string | null;
  level: number;
  cultivationTier: number;
  kills: number;
  combatPower: number;
}

export interface HUDRuntimeSnapshot {
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  stamina: number;
  maxStamina: number;
  combo: number;
  comboTimer: number;
  biome: BiomeId;
  timeOfDay: number; // 0..1
  x: number;
  z: number;
  yaw: number;
  skillCooldowns: [number, number, number, number];
  activeStatuses: StatusEffectType[];
  targetEnemy: {
    name: string;
    archetype: EnemyArchetypeId;
    level: number;
    hp: number;
    maxHp: number;
    branch: TroopBranch;
    statuses: StatusEffectType[];
  } | null;
  minimapEnemies: Array<{ x: number; z: number; isBoss: boolean }>;
  minimapPeers: Array<{ x: number; z: number; name: string }>;
  bossDefeated: boolean;
  sessionKills: number;
  sessionDamageDealt: number;
  elapsedSeconds: number;
}

export interface FloatingDamageEvent {
  id: number;
  screenX: number;
  screenY: number;
  amount: number;
  isCrit: boolean;
  isHeal?: boolean;
  label?: string;
}
