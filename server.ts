import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { REALM_SHARDS } from './src/game/catalog';
import { computeCharacterStats, xpRequiredForLevel } from './src/game/rules';
import type {
  CastleSiegeState,
  CharacterClassId,
  ChatMessage,
  GuildRecord,
  LeaderboardEntry,
  LineageId,
  PartyRecord,
  PlayerProfile,
  RemotePlayerState,
} from './src/game/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, 'data');
const STATE_FILE = path.resolve(DATA_DIR, 'realm-state.json');

interface PersistedRealmStore {
  profiles: Record<string, PlayerProfile>;
  guilds: Record<string, GuildRecord>;
  chatHistory: ChatMessage[];
  siege: Record<string, CastleSiegeState>;
}

function createInitialStore(): PersistedRealmStore {
  const now = Date.now();
  const guilds: Record<string, GuildRecord> = {
    guild_valor: {
      id: 'guild_valor',
      name: 'Sovereign Vanguard',
      tag: 'VALOR',
      emblemColor: '#d97706',
      motto: 'Hold the Solara Gate against the Shadowvale tide.',
      fortressSector: 'Solara Citadel Keep',
      treasuryGold: 48500,
      rallyPower: 14200,
      members: ['Arthur Pendragon', 'Lyra Shadowshot', 'Garrick Ironbrow'],
      createdAt: now - 86400000 * 12,
    },
    guild_verdant: {
      id: 'guild_verdant',
      name: 'Verdant Wardens',
      tag: 'LEAF',
      emblemColor: '#10b981',
      motto: 'Swift volleys from the emerald canopy.',
      fortressSector: 'Verdant Spires Shrine',
      treasuryGold: 36200,
      rallyPower: 11850,
      members: ['Sylvara Windrunner', 'Theron Mossblade'],
      createdAt: now - 86400000 * 9,
    },
    guild_iron: {
      id: 'guild_iron',
      name: 'Ironforge Runesmiths',
      tag: 'ANVIL',
      emblemColor: '#3b82f6',
      motto: 'Tempered in mountain fire and eternal stone.',
      fortressSector: 'Ironforge Watchtower',
      treasuryGold: 41900,
      rallyPower: 12900,
      members: ['Borin Runehammer', 'Kaelen Stormforge'],
      createdAt: now - 86400000 * 7,
    },
  };

  const siege: Record<string, CastleSiegeState> = {};
  for (const shard of REALM_SHARDS) {
    siege[shard.id] = {
      fortressName: `${shard.name} Keep`,
      controllingGuildTag: 'VALOR',
      controllingGuildName: 'Sovereign Vanguard',
      gateIntegrity: 8400,
      maxGateIntegrity: 10000,
      activeRallies: 1,
      totalSiegeDamage: 1600,
      preferredBranch: 'bomber',
      lastCapturedBy: 'Sovereign Vanguard',
    };
  }

  const seedProfiles: Record<string, PlayerProfile> = {
    seed_arthur: {
      playerId: 'seed_arthur',
      name: 'Arthur Pendragon',
      classId: 'knight',
      lineageId: 'human',
      shardId: 'solara-eu',
      level: 14,
      xp: 310,
      xpToNext: xpRequiredForLevel(14),
      cultivationTier: 4,
      skillPoints: 5,
      skillRanks: { knight_root_cleave: 3, knight_t2_doctrine: 3, knight_t3_fortress: 2 },
      gold: 4250,
      spiritStones: 290,
      kills: 86,
      reviveTokens: 2,
      healthElixirs: 4,
      manaDraughts: 3,
      guildId: 'guild_valor',
      guildTag: 'VALOR',
      partyId: null,
      lastX: -6,
      lastZ: 10,
    },
    seed_lyra: {
      playerId: 'seed_lyra',
      name: 'Lyra Shadowshot',
      classId: 'rogue',
      lineageId: 'sylvan_elf',
      shardId: 'solara-eu',
      level: 11,
      xp: 120,
      xpToNext: xpRequiredForLevel(11),
      cultivationTier: 3,
      skillPoints: 4,
      skillRanks: { rogue_root_fang: 3, rogue_t2_precision: 3 },
      gold: 3180,
      spiritStones: 185,
      kills: 64,
      reviveTokens: 1,
      healthElixirs: 3,
      manaDraughts: 2,
      guildId: 'guild_verdant',
      guildTag: 'LEAF',
      partyId: null,
      lastX: 8,
      lastZ: 12,
    },
    seed_kaelen: {
      playerId: 'seed_kaelen',
      name: 'Kaelen Stormforge',
      classId: 'shaman',
      lineageId: 'azure_dragonkin',
      shardId: 'ironforge-ap',
      level: 9,
      xp: 95,
      xpToNext: xpRequiredForLevel(9),
      cultivationTier: 2,
      skillPoints: 3,
      skillRanks: { shaman_root_storm: 2, shaman_t2_ward: 2 },
      gold: 2100,
      spiritStones: 140,
      kills: 41,
      reviveTokens: 1,
      healthElixirs: 2,
      manaDraughts: 4,
      guildId: 'guild_iron',
      guildTag: 'ANVIL',
      partyId: null,
      lastX: 2,
      lastZ: 16,
    },
  };

  const chatHistory: ChatMessage[] = [
    {
      id: 'sys_welcome_1',
      channel: 'system',
      shardId: 'solara-eu',
      senderId: 'system',
      senderName: 'Realm Herald',
      text: 'Welcome to Solara Citadel. Siege Dreadlord Malakor has been sighted south of the avenue.',
      timestamp: now - 180000,
    },
    {
      id: 'msg_seed_1',
      channel: 'world',
      shardId: 'solara-eu',
      senderId: 'seed_arthur',
      senderName: 'Arthur Pendragon',
      senderTag: 'VALOR',
      text: 'Sovereign Vanguard is forming a siege rally for the Citadel Keep. All classes welcome.',
      timestamp: now - 90000,
    },
  ];

  return { profiles: seedProfiles, guilds, chatHistory, siege };
}

function loadStore(): PersistedRealmStore {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as PersistedRealmStore;
      if (parsed && parsed.profiles && parsed.guilds && parsed.siege) {
        return parsed;
      }
    }
  } catch {
    // Fallback to clean seed store
  }
  const initial = createInitialStore();
  saveStore(initial);
  return initial;
}

let saveTimer: NodeJS.Timeout | null = null;
function saveStore(store: PersistedRealmStore): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch {
    // Non-fatal persistence warning
  }
}

function scheduleSave(store: PersistedRealmStore): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveStore(store);
  }, 400);
}

const VALID_CLASSES = new Set<CharacterClassId>(['knight', 'mage', 'rogue', 'shaman']);
const VALID_LINEAGES = new Set<LineageId>([
  'human',
  'sylvan_elf',
  'ironforge_dwarf',
  'azure_dragonkin',
  'celestial_kitsune',
  'void_walker',
]);

function sanitizeName(raw: unknown, fallback = 'Wanderer'): string {
  const cleaned = String(raw ?? '')
    .replace(/[^a-zA-Z0-9 _'-]/g, '')
    .trim()
    .slice(0, 24);
  return cleaned || fallback;
}

function sanitizeTag(raw: unknown): string {
  const cleaned = String(raw ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 5);
  return cleaned || 'REALM';
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '128kb' }));

  const store = loadStore();
  const livePlayers = new Map<string, RemotePlayerState>();
  const socketToPlayerId = new Map<WebSocket, string>();
  const parties = new Map<string, PartyRecord>();

  const buildLeaderboard = (): LeaderboardEntry[] => {
    return Object.values(store.profiles)
      .map((p) => {
        const stats = computeCharacterStats(p.classId, p.lineageId, p.level, p.cultivationTier, p.skillRanks);
        return {
          playerId: p.playerId,
          name: p.name,
          classId: p.classId,
          lineageId: p.lineageId,
          guildTag: p.guildTag,
          level: p.level,
          cultivationTier: p.cultivationTier,
          kills: p.kills,
          combatPower: stats.combatPower,
        };
      })
      .sort((a, b) => b.combatPower - a.combatPower)
      .slice(0, 20);
  };

  const broadcastToShard = (shardId: string, payload: unknown) => {
    const serialized = JSON.stringify(payload);
    for (const [sock, pid] of socketToPlayerId.entries()) {
      if (sock.readyState !== WebSocket.OPEN) continue;
      const peer = livePlayers.get(pid);
      if (!peer || peer.shardId === shardId) {
        sock.send(serialized);
      }
    }
  };

  const broadcastAll = (payload: unknown) => {
    const serialized = JSON.stringify(payload);
    for (const sock of socketToPlayerId.keys()) {
      if (sock.readyState === WebSocket.OPEN) {
        sock.send(serialized);
      }
    }
  };

  // --- REST API ROUTES ---

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      onlinePlayers: livePlayers.size,
      totalProfiles: Object.keys(store.profiles).length,
      guilds: Object.keys(store.guilds).length,
    });
  });

  app.get('/api/realms', (_req, res) => {
    const counts: Record<string, number> = {};
    for (const peer of livePlayers.values()) {
      counts[peer.shardId] = (counts[peer.shardId] || 0) + 1;
    }
    res.json({
      shards: REALM_SHARDS.map((s) => ({
        ...s,
        onlineCount: counts[s.id] || 0,
        siege: store.siege[s.id],
      })),
    });
  });

  app.get('/api/profile/:playerId', (req, res) => {
    const id = String(req.params.playerId).slice(0, 64);
    const existing = store.profiles[id] ?? null;
    if (existing) {
      res.json({
        profile: {
          ...existing,
          skillPoints: existing.skillPoints ?? 2,
          skillRanks: existing.skillRanks ?? {},
        },
      });
      return;
    }
    res.json({ profile: null });
  });

  app.post('/api/profile', (req, res) => {
    const body = req.body as Partial<PlayerProfile>;
    const playerId = String(body.playerId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    if (!playerId) {
      res.status(400).json({ error: 'playerId is required' });
      return;
    }

    const existing = store.profiles[playerId];
    const classId: CharacterClassId =
      body.classId && VALID_CLASSES.has(body.classId) ? body.classId : existing?.classId ?? 'knight';
    const lineageId: LineageId =
      body.lineageId && VALID_LINEAGES.has(body.lineageId) ? body.lineageId : existing?.lineageId ?? 'human';
    const shardId =
      REALM_SHARDS.some((s) => s.id === body.shardId)
        ? (body.shardId as string)
        : existing?.shardId ?? REALM_SHARDS[0].id;

    const sanitizedSkillRanks: Record<string, number> = {};
    const rawRanks =
      body.skillRanks && typeof body.skillRanks === 'object'
        ? body.skillRanks
        : existing?.skillRanks ?? {};
    for (const [k, v] of Object.entries(rawRanks)) {
      if (/^[a-z0-9_]{3,40}$/.test(k)) {
        const rankNum = Math.max(0, Math.min(5, Math.floor(Number(v))));
        if (rankNum > 0) sanitizedSkillRanks[k] = rankNum;
      }
    }

    const level = Math.max(1, Math.min(99, Math.floor(Number(body.level ?? existing?.level ?? 1))));
    const profile: PlayerProfile = {
      playerId,
      name: sanitizeName(body.name ?? existing?.name, 'Aiden Skyrender'),
      classId,
      lineageId,
      shardId,
      level,
      xp: Math.max(0, Math.floor(Number(body.xp ?? existing?.xp ?? 0))),
      xpToNext: xpRequiredForLevel(level),
      cultivationTier: Math.max(0, Math.min(5, Math.floor(Number(body.cultivationTier ?? existing?.cultivationTier ?? 0)))),
      skillPoints: Math.max(0, Math.min(99, Math.floor(Number(body.skillPoints ?? existing?.skillPoints ?? 2)))),
      skillRanks: sanitizedSkillRanks,
      gold: Math.max(0, Math.floor(Number(body.gold ?? existing?.gold ?? 120))),
      spiritStones: Math.max(0, Math.floor(Number(body.spiritStones ?? existing?.spiritStones ?? 35))),
      kills: Math.max(0, Math.floor(Number(body.kills ?? existing?.kills ?? 0))),
      reviveTokens: Math.max(0, Math.floor(Number(body.reviveTokens ?? existing?.reviveTokens ?? 1))),
      healthElixirs: Math.max(0, Math.floor(Number(body.healthElixirs ?? existing?.healthElixirs ?? 2))),
      manaDraughts: Math.max(0, Math.floor(Number(body.manaDraughts ?? existing?.manaDraughts ?? 2))),
      guildId: body.guildId !== undefined ? body.guildId : existing?.guildId ?? null,
      guildTag: body.guildTag !== undefined ? body.guildTag : existing?.guildTag ?? null,
      partyId: body.partyId !== undefined ? body.partyId : existing?.partyId ?? null,
      lastX: Number.isFinite(body.lastX) ? Number(body.lastX) : existing?.lastX ?? 0,
      lastZ: Number.isFinite(body.lastZ) ? Number(body.lastZ) : existing?.lastZ ?? 14,
    };

    store.profiles[playerId] = profile;
    scheduleSave(store);
    res.json({ profile });
  });

  app.get('/api/guilds', (_req, res) => {
    res.json({ guilds: Object.values(store.guilds) });
  });

  app.post('/api/guilds', (req, res) => {
    const { name, tag, motto, emblemColor, playerId, playerName } = req.body as {
      name?: string;
      tag?: string;
      motto?: string;
      emblemColor?: string;
      playerId?: string;
      playerName?: string;
    };
    const cleanName = sanitizeName(name, '');
    const cleanTag = sanitizeTag(tag);
    if (cleanName.length < 3) {
      res.status(400).json({ error: 'Guild name must be at least 3 characters.' });
      return;
    }
    const id = `guild_${Date.now().toString(36)}`;
    const memberLabel = sanitizeName(playerName, 'Founder');
    const guild: GuildRecord = {
      id,
      name: cleanName,
      tag: cleanTag,
      emblemColor: typeof emblemColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(emblemColor) ? emblemColor : '#d97706',
      motto: String(motto || 'United under the banner of the realm.').trim().slice(0, 96),
      fortressSector: 'Solara Frontier',
      treasuryGold: 1500,
      rallyPower: 2400,
      members: [memberLabel],
      createdAt: Date.now(),
    };
    store.guilds[id] = guild;
    if (playerId && store.profiles[playerId]) {
      store.profiles[playerId].guildId = guild.id;
      store.profiles[playerId].guildTag = guild.tag;
    }
    scheduleSave(store);
    broadcastAll({ type: 'guilds:sync', guilds: Object.values(store.guilds) });
    res.status(201).json({ guild });
  });

  app.post('/api/guilds/:guildId/join', (req, res) => {
    const guild = store.guilds[req.params.guildId];
    if (!guild) {
      res.status(404).json({ error: 'Guild not found' });
      return;
    }
    const { playerId, playerName } = req.body as { playerId?: string; playerName?: string };
    const cleanMember = sanitizeName(playerName, 'Adventurer');
    if (!guild.members.includes(cleanMember)) {
      guild.members.push(cleanMember);
      guild.rallyPower += 450;
    }
    if (playerId && store.profiles[playerId]) {
      store.profiles[playerId].guildId = guild.id;
      store.profiles[playerId].guildTag = guild.tag;
      const live = livePlayers.get(playerId);
      if (live) live.guildTag = guild.tag;
    }
    scheduleSave(store);
    broadcastAll({ type: 'guilds:sync', guilds: Object.values(store.guilds) });
    res.json({ guild });
  });

  app.post('/api/siege/rally', (req, res) => {
    const { shardId, playerId, playerName, guildTag, guildName, powerContribution } = req.body as {
      shardId?: string;
      playerId?: string;
      playerName?: string;
      guildTag?: string;
      guildName?: string;
      powerContribution?: number;
    };
    const shard = REALM_SHARDS.some((s) => s.id === shardId) ? (shardId as string) : REALM_SHARDS[0].id;
    const state = store.siege[shard];
    const dmg = Math.max(250, Math.min(2500, Math.round(Number(powerContribution || 650))));
    state.activeRallies += 1;
    state.totalSiegeDamage += dmg;
    state.gateIntegrity = Math.max(0, state.gateIntegrity - dmg);

    let captured = false;
    if (state.gateIntegrity <= 0) {
      captured = true;
      state.controllingGuildTag = sanitizeTag(guildTag || 'REALM');
      state.controllingGuildName = sanitizeName(guildName || `${playerName || 'Sovereign'} Host`, 'Realm Host');
      state.lastCapturedBy = sanitizeName(playerName, 'Commander');
      state.gateIntegrity = state.maxGateIntegrity;
      state.activeRallies = 1;
    }

    const announcement: ChatMessage = {
      id: `sys_${Date.now().toString(36)}`,
      channel: 'system',
      shardId: shard,
      senderId: playerId || 'system',
      senderName: 'Castle Warfare',
      text: captured
        ? `[${state.controllingGuildTag}] ${state.controllingGuildName} breached the gate and claimed ${state.fortressName}!`
        : `${sanitizeName(playerName, 'Commander')} launched a Siege Rally on ${state.fortressName} (-${dmg} Gate HP).`,
      timestamp: Date.now(),
    };
    store.chatHistory.push(announcement);
    if (store.chatHistory.length > 80) store.chatHistory.shift();
    scheduleSave(store);

    broadcastToShard(shard, { type: 'siege:update', shardId: shard, siege: state });
    broadcastToShard(shard, { type: 'chat:message', message: announcement });
    res.json({ siege: state, captured });
  });

  app.get('/api/leaderboard', (_req, res) => {
    res.json({ leaderboard: buildLeaderboard() });
  });

  // --- HTTP + WEBSOCKET SERVER ---
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;
        const type = String(msg.type || '');

        if (type === 'player:join') {
          const playerId = String(msg.playerId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
          if (!playerId) return;
          const shardId = REALM_SHARDS.some((s) => s.id === msg.shardId)
            ? String(msg.shardId)
            : REALM_SHARDS[0].id;
          const classId = VALID_CLASSES.has(msg.classId as CharacterClassId)
            ? (msg.classId as CharacterClassId)
            : 'knight';
          const lineageId = VALID_LINEAGES.has(msg.lineageId as LineageId)
            ? (msg.lineageId as LineageId)
            : 'human';

          const peer: RemotePlayerState = {
            playerId,
            name: sanitizeName(msg.name, 'Aiden Skyrender'),
            classId,
            lineageId,
            shardId,
            level: Math.max(1, Number(msg.level || 1)),
            cultivationTier: Math.max(0, Number(msg.cultivationTier || 0)),
            guildTag: msg.guildTag ? sanitizeTag(msg.guildTag) : null,
            x: Number(msg.x || 0),
            y: Number(msg.y || 0),
            z: Number(msg.z || 14),
            yaw: Number(msg.yaw || Math.PI),
            hp: Number(msg.hp || 200),
            maxHp: Number(msg.maxHp || 200),
            attacking: false,
            lastSeen: Date.now(),
          };

          socketToPlayerId.set(ws, playerId);
          livePlayers.set(playerId, peer);

          const shardPeers = Array.from(livePlayers.values()).filter((p) => p.shardId === shardId);
          const shardParties = Array.from(parties.values()).filter((p) => p.shardId === shardId);
          const shardChat = store.chatHistory.filter((m) => m.shardId === shardId || m.channel === 'guild').slice(-40);

          ws.send(
            JSON.stringify({
              type: 'realm:init',
              shardId,
              players: shardPeers,
              guilds: Object.values(store.guilds),
              parties: shardParties,
              chat: shardChat,
              siege: store.siege[shardId],
              leaderboard: buildLeaderboard(),
            })
          );

          broadcastToShard(shardId, { type: 'player:upsert', player: peer });
          return;
        }

        const senderId = socketToPlayerId.get(ws);
        if (!senderId) return;
        const sender = livePlayers.get(senderId);
        if (!sender) return;

        if (type === 'player:state') {
          sender.x = Number(msg.x ?? sender.x);
          sender.y = Number(msg.y ?? sender.y);
          sender.z = Number(msg.z ?? sender.z);
          sender.yaw = Number(msg.yaw ?? sender.yaw);
          sender.hp = Number(msg.hp ?? sender.hp);
          sender.maxHp = Number(msg.maxHp ?? sender.maxHp);
          sender.attacking = Boolean(msg.attacking);
          sender.level = Number(msg.level ?? sender.level);
          sender.cultivationTier = Number(msg.cultivationTier ?? sender.cultivationTier);
          sender.guildTag = msg.guildTag ? sanitizeTag(msg.guildTag) : sender.guildTag;
          sender.lastSeen = Date.now();
          broadcastToShard(sender.shardId, { type: 'player:upsert', player: sender });
          return;
        }

        if (type === 'chat:send') {
          const text = String(msg.text || '').trim().slice(0, 220);
          if (!text) return;
          const channel =
            msg.channel === 'guild' || msg.channel === 'party' ? msg.channel : 'world';
          const chatMsg: ChatMessage = {
            id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            channel,
            shardId: sender.shardId,
            guildId: typeof msg.guildId === 'string' ? msg.guildId : null,
            partyId: typeof msg.partyId === 'string' ? msg.partyId : null,
            senderId: sender.playerId,
            senderName: sender.name,
            senderTag: sender.guildTag,
            text,
            timestamp: Date.now(),
          };
          store.chatHistory.push(chatMsg);
          if (store.chatHistory.length > 80) store.chatHistory.shift();
          scheduleSave(store);
          broadcastToShard(sender.shardId, { type: 'chat:message', message: chatMsg });
          return;
        }

        if (type === 'party:create') {
          const partyId = `party_${Date.now().toString(36)}`;
          const party: PartyRecord = {
            id: partyId,
            name: sanitizeName(msg.name, `${sender.name}'s Vanguard`),
            leaderId: sender.playerId,
            leaderName: sender.name,
            shardId: sender.shardId,
            memberIds: [sender.playerId],
            memberNames: [sender.name],
          };
          parties.set(partyId, party);
          const shardParties = Array.from(parties.values()).filter((p) => p.shardId === sender.shardId);
          broadcastToShard(sender.shardId, { type: 'parties:sync', parties: shardParties });
          return;
        }

        if (type === 'party:join') {
          const party = parties.get(String(msg.partyId || ''));
          if (!party || party.shardId !== sender.shardId) return;
          if (!party.memberIds.includes(sender.playerId) && party.memberIds.length < 5) {
            party.memberIds.push(sender.playerId);
            party.memberNames.push(sender.name);
          }
          const shardParties = Array.from(parties.values()).filter((p) => p.shardId === sender.shardId);
          broadcastToShard(sender.shardId, { type: 'parties:sync', parties: shardParties });
          return;
        }

        if (type === 'party:leave') {
          for (const [pid, party] of parties.entries()) {
            const idx = party.memberIds.indexOf(sender.playerId);
            if (idx !== -1) {
              party.memberIds.splice(idx, 1);
              party.memberNames.splice(idx, 1);
              if (party.memberIds.length === 0) {
                parties.delete(pid);
              }
            }
          }
          const shardParties = Array.from(parties.values()).filter((p) => p.shardId === sender.shardId);
          broadcastToShard(sender.shardId, { type: 'parties:sync', parties: shardParties });
        }
      } catch {
        // Ignore malformed client messages
      }
    });

    ws.on('close', () => {
      const playerId = socketToPlayerId.get(ws);
      socketToPlayerId.delete(ws);
      if (playerId) {
        const peer = livePlayers.get(playerId);
        livePlayers.delete(playerId);
        if (peer) {
          broadcastToShard(peer.shardId, { type: 'player:leave', playerId });
        }
      }
    });
  });

  // Frontend middleware (Vite in dev, static dist in production)
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`ShadowRealms MMORPG server listening on http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ShadowRealms server:', err);
  process.exit(1);
});
