import { useCallback, useEffect, useRef, useState } from 'react';
import { GameHUD } from './components/GameHUD';
import { ProgressionModal } from './components/ProgressionModal';
import { SocialGuildModal } from './components/SocialGuildModal';
import { StatusModal } from './components/StatusModal';
import { TitleOverlay } from './components/TitleOverlay';
import { CLASS_SKILL_TREES, CULTIVATION_REALMS, SHOP_ITEMS } from './game/catalog';
import { ShadowRealmsEngine } from './game/engine';
import {
  applyExperienceGain,
  computeCharacterStats,
  evaluateBreakthrough,
  resetClassSkillTree,
  spendSkillPointOnNode,
} from './game/rules';
import type {
  CharacterClassId,
  FloatingDamageEvent,
  GamePhase,
  HUDRuntimeSnapshot,
  LineageId,
  PlayerProfile,
} from './game/types';
import { createDefaultProfile, getOrCreatePlayerId, useRealmSocket } from './hooks/useRealmSocket';

const INITIAL_HUD: HUDRuntimeSnapshot = {
  hp: 260,
  maxHp: 260,
  mana: 110,
  maxMana: 110,
  stamina: 120,
  maxStamina: 120,
  combo: 0,
  comboTimer: 0,
  biome: 'solara_plains',
  timeOfDay: 0.28,
  x: 0,
  z: 14,
  yaw: Math.PI,
  skillCooldowns: [0, 0, 0, 0],
  activeStatuses: [],
  targetEnemy: null,
  minimapEnemies: [],
  minimapPeers: [],
  bossDefeated: false,
  sessionKills: 0,
  sessionDamageDealt: 0,
  elapsedSeconds: 0,
};

export default function App() {
  const [phase, setPhase] = useState<GamePhase>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('autostart') === '1' ? 'playing' : 'title';
  });

  const [profile, setProfile] = useState<PlayerProfile>(() =>
    createDefaultProfile(getOrCreatePlayerId())
  );
  const [hud, setHud] = useState<HUDRuntimeSnapshot>(INITIAL_HUD);
  const [muted, setMuted] = useState(false);
  const [openDrawer, setOpenDrawer] = useState<'none' | 'social' | 'progression'>('none');
  const [toastBanner, setToastBanner] = useState<string | null>(null);
  const [floatingDamages, setFloatingDamages] = useState<FloatingDamageEvent[]>([]);
  const [peerLabels, setPeerLabels] = useState<
    Array<{ id: string; name: string; tag: string | null; screenX: number; screenY: number; hpRatio: number }>
  >([]);
  const [defeatSnapshot, setDefeatSnapshot] = useState<{
    kills: number;
    damageDealt: number;
    elapsedSeconds: number;
    bossDefeated: boolean;
  } | null>(null);

  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ShadowRealmsEngine | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((text: string) => {
    setToastBanner(text);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastBanner(null), 3200);
  }, []);

  // Load persisted profile from backend on mount
  useEffect(() => {
    const pid = profileRef.current.playerId;
    fetch(`/api/profile/${encodeURIComponent(pid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { profile?: PlayerProfile } | null) => {
        if (data?.profile) {
          const normalized: PlayerProfile = {
            ...data.profile,
            skillPoints: data.profile.skillPoints ?? 2,
            skillRanks: data.profile.skillRanks ?? {},
          };
          setProfile(normalized);
          engineRef.current?.updateProfile(normalized, true);
        }
      })
      .catch(() => {});
  }, []);

  // Mirror game phase to document.body.dataset.state
  useEffect(() => {
    document.body.dataset.state = phase;
    engineRef.current?.setPhase(phase);
  }, [phase]);

  const realm = useRealmSocket(profile, phase !== 'title');
  const sendPositionRef = useRef(realm.sendPosition);
  sendPositionRef.current = realm.sendPosition;
  const persistProfileRef = useRef(realm.persistProfile);
  persistProfileRef.current = realm.persistProfile;

  // Sync remote multiplayer avatars into 3D engine
  useEffect(() => {
    engineRef.current?.syncRemotePlayers(realm.remotePlayers, profile.playerId);
  }, [realm.remotePlayers, profile.playerId]);

  // Mount Three.js engine ONCE inside dedicated isolated ref container
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const engine = new ShadowRealmsEngine(mount, profileRef.current, {
      onHudUpdate: (snapshot) => {
        setHud(snapshot);
      },
      onFloatingDamage: (evt) => {
        setFloatingDamages((prev) => [...prev.slice(-14), evt]);
        window.setTimeout(() => {
          setFloatingDamages((prev) => prev.filter((item) => item.id !== evt.id));
        }, 620);
      },
      onRewardEarned: ({ xp, gold, spiritStones, killedBoss, enemyName }) => {
        setProfile((prev) => {
          const xpRes = applyExperienceGain(prev.level, prev.xp, xp);
          const next: PlayerProfile = {
            ...prev,
            level: xpRes.level,
            xp: xpRes.xp,
            xpToNext: xpRes.xpToNext,
            skillPoints: prev.skillPoints + xpRes.levelsGained,
            gold: prev.gold + gold,
            spiritStones: prev.spiritStones + spiritStones,
            kills: prev.kills + 1,
          };
          engine.updateProfile(next, false);
          persistProfileRef.current(next);
          if (xpRes.leveledUp) {
            engine.audio.playLevelUp();
            showToast(
              `Level Up! Reached Level ${xpRes.level} (+${xpRes.levelsGained} Skill ${
                xpRes.levelsGained === 1 ? 'Point' : 'Points'
              })`
            );
          } else if (killedBoss) {
            engine.audio.playLevelUp();
            showToast(`World Boss Slain: ${enemyName} (+${gold}g, +${spiritStones} SS)`);
          }
          return next;
        });
      },
      onPlayerDefeated: (summary) => {
        setDefeatSnapshot(summary);
        setOpenDrawer('none');
        setPhase('gameover');
      },
      onReviveTokenUsed: () => {
        setProfile((prev) => {
          const next = { ...prev, reviveTokens: Math.max(0, prev.reviveTokens - 1) };
          persistProfileRef.current(next);
          return next;
        });
        showToast('Sovereign Revive Sigil activated!');
      },
      onPositionBroadcast: (pos) => {
        sendPositionRef.current(pos);
      },
      onPeerLabelsUpdate: (labels) => {
        setPeerLabels(labels);
      },
    });

    engineRef.current = engine;
    engine.setPhase(phaseRef.current);

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [showToast]);

  const handleEnterRealm = useCallback(() => {
    const cleanName = profileRef.current.name.trim() || 'Aiden Skyrender';
    const next = { ...profileRef.current, name: cleanName };
    setProfile(next);
    engineRef.current?.updateProfile(next, true);
    persistProfileRef.current(next);
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.dataset.state = 'playing';
    setOpenDrawer('none');
    setPhase('playing');
  }, []);

  const handleUseElixir = useCallback(() => {
    if (profileRef.current.healthElixirs <= 0) return;
    setProfile((prev) => {
      if (prev.healthElixirs <= 0) return prev;
      const next = { ...prev, healthElixirs: prev.healthElixirs - 1 };
      persistProfileRef.current(next);
      return next;
    });
    engineRef.current?.healVitals(0.45, 0);
  }, []);

  const handleUseDraught = useCallback(() => {
    if (profileRef.current.manaDraughts <= 0) return;
    setProfile((prev) => {
      if (prev.manaDraughts <= 0) return prev;
      const next = { ...prev, manaDraughts: prev.manaDraughts - 1 };
      persistProfileRef.current(next);
      return next;
    });
    engineRef.current?.healVitals(0, 0.55);
  }, []);

  // Global keyboard shortcuts (Title Enter/Space, Pause Esc/P, Social G, Cultivation C, Mute M, Potions Q/E)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (phaseRef.current === 'title') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          handleEnterRealm();
        }
        return;
      }

      if (e.code === 'Escape') {
        e.preventDefault();
        if (openDrawer !== 'none') {
          setOpenDrawer('none');
        } else if (phaseRef.current === 'playing') {
          setPhase('paused');
        } else if (phaseRef.current === 'paused') {
          setPhase('playing');
        }
        return;
      }

      if (phaseRef.current === 'playing') {
        if (e.code === 'KeyP') {
          setOpenDrawer('none');
          setPhase('paused');
        } else if (e.code === 'KeyG') {
          setOpenDrawer((d) => (d === 'social' ? 'none' : 'social'));
        } else if (e.code === 'KeyC') {
          setOpenDrawer((d) => (d === 'progression' ? 'none' : 'progression'));
        } else if (e.code === 'KeyM') {
          const nextMute = engineRef.current?.audio.toggleMute() ?? false;
          setMuted(nextMute);
        } else if (e.code === 'KeyQ') {
          handleUseElixir();
        } else if (e.code === 'KeyE') {
          handleUseDraught();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleEnterRealm, handleUseElixir, handleUseDraught, openDrawer]);

  const handleSelectClass = (classId: CharacterClassId) => {
    setProfile((prev) => {
      const next = { ...prev, classId };
      engineRef.current?.updateProfile(next, true);
      return next;
    });
  };

  const handleSelectLineage = (lineageId: LineageId) => {
    setProfile((prev) => {
      const next = { ...prev, lineageId };
      engineRef.current?.updateProfile(next, true);
      return next;
    });
  };

  const handleAttemptBreakthrough = () => {
    const p = profileRef.current;
    const check = evaluateBreakthrough(p.cultivationTier, p.level, p.spiritStones);
    if (!check.canBreakthrough) return;
    const next: PlayerProfile = {
      ...p,
      cultivationTier: check.nextTier,
      spiritStones: p.spiritStones - check.cost,
    };
    setProfile(next);
    engineRef.current?.updateProfile(next, false);
    engineRef.current?.audio.playLevelUp();
    persistProfileRef.current(next);
    const newRealm = CULTIVATION_REALMS[check.nextTier];
    showToast(`Ascended to ${newRealm.name}!`);
  };

  const handlePurchaseItem = (itemId: 'health_elixir' | 'mana_draught' | 'revive_token' | 'spirit_pill') => {
    const spec = SHOP_ITEMS.find((i) => i.id === itemId);
    if (!spec) return;
    setProfile((prev) => {
      if (prev.gold < spec.goldCost) return prev;
      const next: PlayerProfile = {
        ...prev,
        gold: prev.gold - spec.goldCost,
        healthElixirs: prev.healthElixirs + (itemId === 'health_elixir' ? 1 : 0),
        manaDraughts: prev.manaDraughts + (itemId === 'mana_draught' ? 1 : 0),
        reviveTokens: prev.reviveTokens + (itemId === 'revive_token' ? 1 : 0),
        spiritStones: prev.spiritStones + (itemId === 'spirit_pill' ? 40 : 0),
      };
      engineRef.current?.updateProfile(next, false);
      persistProfileRef.current(next);
      return next;
    });
    showToast(`Purchased ${spec.name}`);
  };

  const handleUpgradeSkillNode = (nodeId: string) => {
    const current = profileRef.current;
    const next = spendSkillPointOnNode(current, nodeId);
    if (!next) return;
    setProfile(next);
    engineRef.current?.updateProfile(next, false);
    engineRef.current?.audio.playLevelUp();
    persistProfileRef.current(next);
    const node = CLASS_SKILL_TREES[next.classId].find((n) => n.id === nodeId);
    if (node) {
      const rank = next.skillRanks[nodeId] ?? 1;
      showToast(`${node.name} upgraded to Rank ${rank}/${node.maxRank}`);
    }
  };

  const handleResetSkillTree = () => {
    const current = profileRef.current;
    const { profile: next, refunded } = resetClassSkillTree(current);
    if (refunded <= 0) return;
    setProfile(next);
    engineRef.current?.updateProfile(next, false);
    persistProfileRef.current(next);
    showToast(`Skill Tree reset (+${refunded} Skill ${refunded === 1 ? 'Point' : 'Points'} refunded)`);
  };

  const handleRespawn = () => {
    engineRef.current?.respawnPlayer();
    setDefeatSnapshot(null);
    setPhase('playing');
  };

  const currentShardOnline = Math.max(
    realm.remotePlayers.length,
    realm.shards.find((s) => s.id === profile.shardId)?.onlineCount ?? 1
  );

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0b0d14]">
      {/* Isolated WebGL Canvas Mount — never re-created by React HUD state updates */}
      <div
        ref={canvasMountRef}
        data-testid="world-canvas-mount"
        className="fixed inset-0 w-full h-full"
      />

      {/* Title Screen Overlay over Live 3D World Tour */}
      {phase === 'title' && (
        <TitleOverlay
          profile={profile}
          shards={realm.shards}
          onChangeName={(name) => setProfile((p) => ({ ...p, name }))}
          onSelectClass={handleSelectClass}
          onSelectLineage={handleSelectLineage}
          onSelectShard={(shardId) => setProfile((p) => ({ ...p, shardId }))}
          onEnterRealm={handleEnterRealm}
        />
      )}

      {/* Active Gameplay HUD */}
      {phase !== 'title' && (
        <GameHUD
          profile={profile}
          hud={hud}
          muted={muted}
          connected={realm.connected}
          onlineCount={currentShardOnline}
          chatMessages={realm.chatMessages}
          floatingDamages={floatingDamages}
          peerLabels={peerLabels}
          toastBanner={toastBanner}
          onCastSkill={(slot) => engineRef.current?.castSkill(slot)}
          onUseElixir={handleUseElixir}
          onUseDraught={handleUseDraught}
          onToggleMute={() => {
            const nextMute = engineRef.current?.audio.toggleMute() ?? false;
            setMuted(nextMute);
          }}
          onOpenSocial={() => setOpenDrawer((d) => (d === 'social' ? 'none' : 'social'))}
          onOpenProgression={() => setOpenDrawer((d) => (d === 'progression' ? 'none' : 'progression'))}
          onPause={() => {
            setOpenDrawer('none');
            setPhase('paused');
          }}
          onQuickChat={(text) => realm.sendChat('world', text)}
        />
      )}

      {/* Social, Guilds, Castle Siege, Party & Leaderboard Modal */}
      {phase === 'playing' && openDrawer === 'social' && (
        <SocialGuildModal
          profile={profile}
          connected={realm.connected}
          remotePlayers={realm.remotePlayers}
          guilds={realm.guilds}
          parties={realm.parties}
          chatMessages={realm.chatMessages}
          siegeState={realm.siegeState}
          leaderboard={realm.leaderboard}
          onClose={() => setOpenDrawer('none')}
          onSendChat={(channel, text) => realm.sendChat(channel, text)}
          onCreateGuild={async (name, tag, motto, color) => {
            const created = await realm.createGuild(name, tag, motto, color);
            if (created) {
              const next = { ...profileRef.current, guildId: created.id, guildTag: created.tag };
              setProfile(next);
              persistProfileRef.current(next);
              showToast(`Founded Guild [${created.tag}] ${created.name}`);
            }
          }}
          onJoinGuild={async (guildId) => {
            const joined = await realm.joinGuild(guildId);
            if (joined) {
              const next = { ...profileRef.current, guildId: joined.id, guildTag: joined.tag };
              setProfile(next);
              persistProfileRef.current(next);
              showToast(`Joined [${joined.tag}] ${joined.name}`);
            }
          }}
          onLaunchSiegeRally={async () => {
            const stats = computeCharacterStats(
              profileRef.current.classId,
              profileRef.current.lineageId,
              profileRef.current.level,
              profileRef.current.cultivationTier,
              profileRef.current.skillRanks
            );
            const myGuild = realm.guilds.find((g) => g.id === profileRef.current.guildId);
            const res = await realm.launchSiegeRally(stats.combatPower, myGuild?.name);
            if (res) {
              showToast(
                res.captured
                  ? `Fortress Captured for [${res.siege.controllingGuildTag}]!`
                  : `Siege Rally hit ${res.siege.fortressName}!`
              );
            }
          }}
          onCreateParty={(name) => realm.createParty(name)}
          onJoinParty={(partyId) => realm.joinParty(partyId)}
          onLeaveParty={() => realm.leaveParty()}
        />
      )}

      {/* Mastery, Cultivation & Quartermaster Modal */}
      {phase === 'playing' && openDrawer === 'progression' && (
        <ProgressionModal
          profile={profile}
          onClose={() => setOpenDrawer('none')}
          onAttemptBreakthrough={handleAttemptBreakthrough}
          onPurchaseItem={handlePurchaseItem}
          onUpgradeSkillNode={handleUpgradeSkillNode}
          onResetSkillTree={handleResetSkillTree}
        />
      )}

      {/* Pause / Defeat Modal */}
      {(phase === 'paused' || phase === 'gameover') && (
        <StatusModal
          mode={phase === 'paused' ? 'paused' : 'defeat'}
          kills={defeatSnapshot?.kills ?? hud.sessionKills}
          damageDealt={defeatSnapshot?.damageDealt ?? hud.sessionDamageDealt}
          elapsedSeconds={defeatSnapshot?.elapsedSeconds ?? hud.elapsedSeconds}
          level={profile.level}
          bossDefeated={defeatSnapshot?.bossDefeated ?? hud.bossDefeated}
          onResume={() => setPhase('playing')}
          onRespawn={handleRespawn}
          onReturnToTitle={() => {
            setOpenDrawer('none');
            setDefeatSnapshot(null);
            setPhase('title');
          }}
        />
      )}
    </main>
  );
}
