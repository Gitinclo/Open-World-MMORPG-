import { useCallback, useEffect, useRef, useState } from 'react';
import { REALM_SHARDS } from '../game/catalog';
import { xpRequiredForLevel } from '../game/rules';
import type {
  CastleSiegeState,
  ChatMessage,
  GuildRecord,
  LeaderboardEntry,
  PartyRecord,
  PlayerProfile,
  RemotePlayerState,
} from '../game/types';

export interface RealmShardInfo {
  id: string;
  name: string;
  region: string;
  biomeTheme: string;
  maxCapacity: number;
  onlineCount: number;
  siege?: CastleSiegeState;
}

const STORAGE_PLAYER_ID_KEY = 'shadowrealms_player_id_v1';

export function getOrCreatePlayerId(): string {
  try {
    const saved = localStorage.getItem(STORAGE_PLAYER_ID_KEY);
    if (saved && /^[a-zA-Z0-9_-]{6,48}$/.test(saved)) return saved;
    const generated = `hero_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    localStorage.setItem(STORAGE_PLAYER_ID_KEY, generated);
    return generated;
  } catch {
    return `hero_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function createDefaultProfile(playerId: string): PlayerProfile {
  return {
    playerId,
    name: 'Aiden Skyrender',
    classId: 'knight',
    lineageId: 'human',
    shardId: REALM_SHARDS[0].id,
    level: 1,
    xp: 0,
    xpToNext: xpRequiredForLevel(1),
    cultivationTier: 0,
    skillPoints: 2,
    skillRanks: {},
    gold: 140,
    spiritStones: 35,
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
}

export function useRealmSocket(profile: PlayerProfile, active: boolean) {
  const [connected, setConnected] = useState(false);
  const [shards, setShards] = useState<RealmShardInfo[]>(
    REALM_SHARDS.map((s) => ({ ...s, onlineCount: 0 }))
  );
  const [remotePlayers, setRemotePlayers] = useState<RemotePlayerState[]>([]);
  const [guilds, setGuilds] = useState<GuildRecord[]>([]);
  const [parties, setParties] = useState<PartyRecord[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [siegeState, setSiegeState] = useState<CastleSiegeState | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  // Fetch initial realms + guilds + leaderboard over HTTP right away
  const refreshServerLists = useCallback(async () => {
    try {
      const [realmsRes, guildsRes, lbRes] = await Promise.all([
        fetch('/api/realms'),
        fetch('/api/guilds'),
        fetch('/api/leaderboard'),
      ]);
      if (realmsRes.ok) {
        const data = (await realmsRes.json()) as { shards: RealmShardInfo[] };
        setShards(data.shards);
        const match = data.shards.find((s) => s.id === profileRef.current.shardId);
        if (match?.siege) setSiegeState(match.siege);
      }
      if (guildsRes.ok) {
        const data = (await guildsRes.json()) as { guilds: GuildRecord[] };
        setGuilds(data.guilds);
      }
      if (lbRes.ok) {
        const data = (await lbRes.json()) as { leaderboard: LeaderboardEntry[] };
        setLeaderboard(data.leaderboard);
      }
    } catch {
      // Server may be starting up; WebSocket reconnect handles sync
    }
  }, []);

  useEffect(() => {
    refreshServerLists();
  }, [refreshServerLists]);

  // Persist profile updates to backend
  const persistProfile = useCallback(async (next: PlayerProfile) => {
    try {
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
    } catch {
      // Retry on next mutation
    }
  }, []);

  // WebSocket lifecycle with auto-reconnect
  useEffect(() => {
    if (!active) return;
    let closedByUnmount = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (closedByUnmount) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        const p = profileRef.current;
        ws.send(
          JSON.stringify({
            type: 'player:join',
            playerId: p.playerId,
            name: p.name,
            classId: p.classId,
            lineageId: p.lineageId,
            shardId: p.shardId,
            level: p.level,
            cultivationTier: p.cultivationTier,
            guildTag: p.guildTag,
            x: p.lastX,
            y: 0,
            z: p.lastZ,
            yaw: Math.PI,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
          const type = String(msg.type || '');
          if (type === 'realm:init') {
            setRemotePlayers((msg.players as RemotePlayerState[]) || []);
            setGuilds((msg.guilds as GuildRecord[]) || []);
            setParties((msg.parties as PartyRecord[]) || []);
            setChatMessages((msg.chat as ChatMessage[]) || []);
            if (msg.siege) setSiegeState(msg.siege as CastleSiegeState);
            if (msg.leaderboard) setLeaderboard(msg.leaderboard as LeaderboardEntry[]);
          } else if (type === 'player:upsert') {
            const incoming = msg.player as RemotePlayerState;
            setRemotePlayers((prev) => {
              const idx = prev.findIndex((p) => p.playerId === incoming.playerId);
              if (idx === -1) return [...prev, incoming];
              const copy = [...prev];
              copy[idx] = incoming;
              return copy;
            });
          } else if (type === 'player:leave') {
            const leftId = String(msg.playerId || '');
            setRemotePlayers((prev) => prev.filter((p) => p.playerId !== leftId));
          } else if (type === 'chat:message') {
            const incoming = msg.message as ChatMessage;
            setChatMessages((prev) => {
              if (prev.some((m) => m.id === incoming.id)) return prev;
              return [...prev.slice(-60), incoming];
            });
          } else if (type === 'guilds:sync') {
            setGuilds((msg.guilds as GuildRecord[]) || []);
          } else if (type === 'parties:sync') {
            setParties((msg.parties as PartyRecord[]) || []);
          } else if (type === 'siege:update') {
            if (msg.siege) setSiegeState(msg.siege as CastleSiegeState);
          }
        } catch {
          // Ignore malformed frames
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!closedByUnmount) {
          reconnectTimer = window.setTimeout(connect, 2200);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      closedByUnmount = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [active, profile.shardId]);

  const sendPosition = useCallback(
    (pos: { x: number; y: number; z: number; yaw: number; hp: number; maxHp: number; attacking: boolean }) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const p = profileRef.current;
      ws.send(
        JSON.stringify({
          type: 'player:state',
          ...pos,
          level: p.level,
          cultivationTier: p.cultivationTier,
          guildTag: p.guildTag,
        })
      );
    },
    []
  );

  const sendChat = useCallback((channel: 'world' | 'guild' | 'party', text: string) => {
    const ws = wsRef.current;
    const trimmed = text.trim();
    if (!ws || ws.readyState !== WebSocket.OPEN || !trimmed) return false;
    const p = profileRef.current;
    ws.send(
      JSON.stringify({
        type: 'chat:send',
        channel,
        guildId: p.guildId,
        partyId: p.partyId,
        text: trimmed,
      })
    );
    return true;
  }, []);

  const createParty = useCallback((partyName: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'party:create', name: partyName }));
  }, []);

  const joinParty = useCallback((partyId: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'party:join', partyId }));
  }, []);

  const leaveParty = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'party:leave' }));
  }, []);

  const createGuild = useCallback(
    async (name: string, tag: string, motto: string, emblemColor: string): Promise<GuildRecord | null> => {
      const p = profileRef.current;
      const res = await fetch('/api/guilds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          tag,
          motto,
          emblemColor,
          playerId: p.playerId,
          playerName: p.name,
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { guild: GuildRecord };
      await refreshServerLists();
      return data.guild;
    },
    [refreshServerLists]
  );

  const joinGuild = useCallback(
    async (guildId: string): Promise<GuildRecord | null> => {
      const p = profileRef.current;
      const res = await fetch(`/api/guilds/${guildId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: p.playerId, playerName: p.name }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { guild: GuildRecord };
      await refreshServerLists();
      return data.guild;
    },
    [refreshServerLists]
  );

  const launchSiegeRally = useCallback(
    async (powerContribution: number, guildName?: string): Promise<{ siege: CastleSiegeState; captured: boolean } | null> => {
      const p = profileRef.current;
      const res = await fetch('/api/siege/rally', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shardId: p.shardId,
          playerId: p.playerId,
          playerName: p.name,
          guildTag: p.guildTag || 'REALM',
          guildName: guildName || `${p.name}'s Host`,
          powerContribution,
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { siege: CastleSiegeState; captured: boolean };
      setSiegeState(data.siege);
      return data;
    },
    []
  );

  return {
    connected,
    shards,
    remotePlayers,
    guilds,
    parties,
    chatMessages,
    siegeState,
    leaderboard,
    persistProfile,
    refreshServerLists,
    sendPosition,
    sendChat,
    createParty,
    joinParty,
    leaveParty,
    createGuild,
    joinGuild,
    launchSiegeRally,
  };
}
