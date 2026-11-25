import React, { useEffect, useRef, useState } from 'react';
import { BIOME_LABELS, CHARACTER_CLASSES, CULTIVATION_REALMS, REALM_SHARDS } from '../game/catalog';
import { computeEffectiveSkill } from '../game/rules';
import type {
  ChatMessage,
  FloatingDamageEvent,
  HUDRuntimeSnapshot,
  PlayerProfile,
} from '../game/types';

interface PeerLabel {
  id: string;
  name: string;
  tag: string | null;
  screenX: number;
  screenY: number;
  hpRatio: number;
}

interface GameHUDProps {
  profile: PlayerProfile;
  hud: HUDRuntimeSnapshot;
  muted: boolean;
  connected: boolean;
  onlineCount: number;
  chatMessages: ChatMessage[];
  floatingDamages: FloatingDamageEvent[];
  peerLabels: PeerLabel[];
  toastBanner: string | null;
  onCastSkill: (slot: 0 | 1 | 2 | 3) => void;
  onUseElixir: () => void;
  onUseDraught: () => void;
  onToggleMute: () => void;
  onOpenSocial: () => void;
  onOpenProgression: () => void;
  onPause: () => void;
  onQuickChat: (text: string) => void;
}

export const GameHUD: React.FC<GameHUDProps> = ({
  profile,
  hud,
  muted,
  connected,
  onlineCount,
  chatMessages,
  floatingDamages,
  peerLabels,
  toastBanner,
  onCastSkill,
  onUseElixir,
  onUseDraught,
  onToggleMute,
  onOpenSocial,
  onOpenProgression,
  onPause,
  onQuickChat,
}) => {
  const cls = CHARACTER_CLASSES[profile.classId];
  const realm = CULTIVATION_REALMS[profile.cultivationTier] ?? CULTIVATION_REALMS[0];
  const biome = BIOME_LABELS[hud.biome];
  const shard = REALM_SHARDS.find((s) => s.id === profile.shardId) ?? REALM_SHARDS[0];

  // Trailing damage ghost bar for HP
  const hpPct = Math.max(0, Math.min(100, (hud.hp / Math.max(1, hud.maxHp)) * 100));
  const manaPct = Math.max(0, Math.min(100, (hud.mana / Math.max(1, hud.maxMana)) * 100));
  const stamPct = Math.max(0, Math.min(100, (hud.stamina / Math.max(1, hud.maxStamina)) * 100));
  const xpPct = Math.max(0, Math.min(100, (profile.xp / Math.max(1, profile.xpToNext)) * 100));

  const [ghostHpPct, setGhostHpPct] = useState(hpPct);
  const ghostTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (hpPct < ghostHpPct) {
      if (ghostTimerRef.current) window.clearTimeout(ghostTimerRef.current);
      ghostTimerRef.current = window.setTimeout(() => setGhostHpPct(hpPct), 380);
    } else {
      setGhostHpPct(hpPct);
    }
    return () => {
      if (ghostTimerRef.current) window.clearTimeout(ghostTimerRef.current);
    };
  }, [hpPct, ghostHpPct]);

  const [quickInput, setQuickInput] = useState('');
  const recentChat = chatMessages.slice(-3);

  const handleQuickChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickInput.trim()) return;
    onQuickChat(quickInput);
    setQuickInput('');
    (document.activeElement as HTMLElement | null)?.blur();
  };

  // Map world coordinates (-90..90) onto 108x108 minimap
  const mapCoord = (v: number) => 54 + Math.max(-48, Math.min(48, (v / 88) * 48));

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none overflow-hidden">
      {/* Low-HP peripheral crimson vignette */}
      {hpPct < 28 && (
        <div
          className="fixed inset-0 pointer-events-none transition-opacity duration-300"
          style={{
            boxShadow: 'inset 0 0 110px rgba(185, 28, 28, 0.55)',
          }}
        />
      )}

      {/* World-to-screen Remote Multiplayer Peer Nameplates */}
      {peerLabels.map((peer) => (
        <div
          key={peer.id}
          className="fixed pointer-events-none -translate-x-1/2 -translate-y-full flex flex-col items-center"
          style={{ left: `${peer.screenX}px`, top: `${peer.screenY}px` }}
        >
          <span className="text-[11px] font-semibold text-[#f7f1e3] hud-text-shadow whitespace-nowrap">
            {peer.tag ? `[${peer.tag}] ` : ''}
            {peer.name}
          </span>
          <div className="w-12 h-1 bg-black/70 rounded overflow-hidden mt-0.5">
            <div
              className="h-full bg-emerald-400"
              style={{ width: `${Math.round(peer.hpRatio * 100)}%` }}
            />
          </div>
        </div>
      ))}

      {/* World-to-screen Floating Combat Damage Numbers */}
      {floatingDamages.map((dmg) => (
        <div
          key={dmg.id}
          className={`fixed pointer-events-none -translate-x-1/2 -translate-y-1/2 font-mono-num font-bold hud-text-shadow transition-transform duration-300 ${
            dmg.isHeal
              ? 'text-emerald-400 text-base'
              : dmg.isCrit
              ? 'text-amber-300 text-xl'
              : 'text-[#f8fafc] text-sm'
          }`}
          style={{ left: `${dmg.screenX}px`, top: `${dmg.screenY}px` }}
        >
          {dmg.isHeal ? '+' : ''}
          {dmg.amount}
          {dmg.label ? <span className="ml-1 text-[10px] tracking-wider">{dmg.label}</span> : null}
        </div>
      ))}

      {/* Top Row: Left Character Frame | Center Target Frame | Right Minimap & Controls */}
      <div className="absolute top-3.5 inset-x-4 flex items-start justify-between gap-4">
        {/* TOP-LEFT: Compact Character Vitals Frame */}
        <div className="hud-panel rounded-lg px-3.5 py-2.5 w-[276px] pointer-events-auto">
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <div className="truncate">
              <span className="font-display text-sm font-bold text-[#f7f1e3]">
                {profile.guildTag ? `[${profile.guildTag}] ` : ''}
                {profile.name}
              </span>
            </div>
            <span className="font-mono-num text-xs font-bold text-[#e0b254] shrink-0">
              LV {profile.level}
            </span>
          </div>

          {/* HP Bar with delayed trailing damage ghost */}
          <div className="mb-1.5">
            <div className="flex justify-between text-[10px] text-[#c9c3b8] font-mono-num mb-0.5">
              <span>HP</span>
              <span>
                {hud.hp} / {hud.maxHp}
              </span>
            </div>
            <div className="h-2.5 rounded-sm bg-[#1a1013] border border-white/10 overflow-hidden relative">
              <div
                className="absolute inset-y-0 left-0 bg-amber-300/75 transition-all duration-300"
                style={{ width: `${ghostHpPct}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 bg-[#c83e3b] transition-all duration-100"
                style={{ width: `${hpPct}%` }}
              />
            </div>
          </div>

          {/* Mana & Stamina Compact Bars */}
          <div className="grid grid-cols-2 gap-2 mb-1.5">
            <div>
              <div className="flex justify-between text-[10px] text-[#93c5fd] font-mono-num mb-0.5">
                <span>MP</span>
                <span>{hud.mana}</span>
              </div>
              <div className="h-1.5 rounded-sm bg-[#0f172a] overflow-hidden">
                <div className="h-full bg-[#3b82f6]" style={{ width: `${manaPct}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-[#fcd34d] font-mono-num mb-0.5">
                <span>STM</span>
                <span>{hud.stamina}</span>
              </div>
              <div className="h-1.5 rounded-sm bg-[#1f190f] overflow-hidden">
                <div className="h-full bg-[#d97706]" style={{ width: `${stamPct}%` }} />
              </div>
            </div>
          </div>

          {/* XP bar + Realm / Currencies */}
          <div className="h-1 rounded-sm bg-black/50 overflow-hidden mb-1.5">
            <div className="h-full bg-[#e0b254]" style={{ width: `${xpPct}%` }} />
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#c9c3b8] font-mono-num">
            <span className="truncate max-w-[130px]" style={{ color: realm.auraHex }}>
              {realm.name}
            </span>
            <span>
              {profile.gold}g · {profile.spiritStones} SS
            </span>
          </div>

          {hud.combo > 1 && (
            <div className="mt-1.5 pt-1 border-t border-white/10 flex items-center justify-between text-xs">
              <span className="font-display font-bold text-[#fbbf24]">
                {hud.combo}x COMBO
              </span>
              <span className="font-mono-num text-[11px] text-[#c9c3b8]">
                {hud.comboTimer.toFixed(1)}s
              </span>
            </div>
          )}
        </div>

        {/* TOP-CENTER: Active Target Enemy Plate + Toast Banner */}
        <div className="flex flex-col items-center gap-2 max-w-[380px]">
          {hud.targetEnemy && (
            <div className="hud-panel rounded-lg px-4 py-2 w-[356px]">
              <div className="flex items-center justify-between gap-2 text-xs mb-1">
                <span className="font-display font-bold text-[#f7f1e3] whitespace-nowrap truncate">
                  {hud.targetEnemy.name}
                </span>
                <span className="font-mono-num text-[11px] text-[#e0b254] shrink-0 whitespace-nowrap">
                  LV {hud.targetEnemy.level} · {hud.targetEnemy.branch.toUpperCase()}
                </span>
              </div>
              <div className="h-2.5 rounded-sm bg-[#1a1013] border border-white/10 overflow-hidden">
                <div
                  className="h-full bg-[#dc2626] transition-all duration-100"
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(100, (hud.targetEnemy.hp / Math.max(1, hud.targetEnemy.maxHp)) * 100)
                    )}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-[#c9c3b8] font-mono-num mt-1">
                <span>
                  {hud.targetEnemy.hp} / {hud.targetEnemy.maxHp}
                </span>
                <span>
                  {hud.targetEnemy.statuses.length > 0
                    ? hud.targetEnemy.statuses.join(' · ').toUpperCase()
                    : 'ENGAGED'}
                </span>
              </div>
            </div>
          )}

          {toastBanner && (
            <div className="hud-panel-subtle rounded px-3.5 py-1.5 text-xs font-semibold text-[#fef3c7] hud-text-shadow">
              {toastBanner}
            </div>
          )}
        </div>

        {/* TOP-RIGHT: Utility Buttons & Compact Circular Realm Minimap */}
        <div className="flex items-start gap-2.5 pointer-events-auto">
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenSocial();
              }}
              aria-label="Open Social and Guilds"
              title="Social, Guilds & Castle Siege [G]"
              className="hud-panel w-9 h-9 rounded flex items-center justify-center text-[#e0b254] hover:bg-[#232737] cursor-pointer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </button>
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenProgression();
              }}
              aria-label={
                profile.skillPoints > 0
                  ? `Open Skill Tree, Cultivation and Shop (${profile.skillPoints} Skill Points available)`
                  : 'Open Skill Tree, Cultivation and Shop'
              }
              title="Skill Tree, Cultivation & Shop [C]"
              className="relative hud-panel w-9 h-9 rounded flex items-center justify-center text-[#e0b254] hover:bg-[#232737] cursor-pointer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L15 8L21 9L16.5 14L17.5 21L12 17.8L6.5 21L7.5 14L3 9L9 8L12 2Z" />
              </svg>
              {profile.skillPoints > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded bg-[#e0b254] text-[#0b0d14] font-mono-num text-[10px] font-bold flex items-center justify-center">
                  {profile.skillPoints}
                </span>
              )}
            </button>
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              aria-label={muted ? 'Unmute Audio' : 'Mute Audio'}
              title="Mute / Unmute [M]"
              className="hud-panel w-9 h-9 rounded flex items-center justify-center text-[#c9c3b8] hover:text-white hover:bg-[#232737] cursor-pointer"
            >
              {muted ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              )}
            </button>
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onPause();
              }}
              aria-label="Pause Game"
              title="Pause [P / Esc]"
              className="hud-panel w-9 h-9 rounded flex items-center justify-center text-[#c9c3b8] hover:text-white hover:bg-[#232737] cursor-pointer"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            </button>
          </div>

          {/* Minimap */}
          <div className="hud-panel rounded-lg p-2 flex flex-col items-center gap-1">
            <svg
              width="108"
              height="108"
              viewBox="0 0 108 108"
              aria-label="Realm Minimap"
              className="rounded bg-[#111622] border border-[#e0b254]/30"
            >
              {/* Biome quadrant tints */}
              <rect x="0" y="0" width="54" height="54" fill="#173123" opacity="0.55" />
              <rect x="54" y="0" width="54" height="54" fill="#3a2c22" opacity="0.55" />
              <rect x="0" y="54" width="108" height="54" fill="#251c36" opacity="0.55" />
              <circle cx="54" cy="54" r="20" fill="#284226" opacity="0.65" />

              {/* Solara Avenue cross */}
              <line x1="54" y1="22" x2="54" y2="88" stroke="#8e8475" strokeWidth="2.5" opacity="0.55" />
              <line x1="22" y1="60" x2="86" y2="60" stroke="#8e8475" strokeWidth="2" opacity="0.45" />

              {/* Landmarks: Solara Keep, Verdant Shrine, Ironforge Tower, Cursed Obelisk */}
              <rect x={mapCoord(0) - 4} y={mapCoord(-24) - 3} width="8" height="6" fill="#e0b254" />
              <circle cx={mapCoord(-40)} cy={mapCoord(-26)} r="3" fill="#34d399" />
              <circle cx={mapCoord(42)} cy={mapCoord(-24)} r="3" fill="#fb923c" />
              <circle cx={mapCoord(0)} cy={mapCoord(48)} r="3.5" fill="#c084fc" />

              {/* Enemies */}
              {hud.minimapEnemies.map((e, idx) => (
                <circle
                  key={idx}
                  cx={mapCoord(e.x)}
                  cy={mapCoord(e.z)}
                  r={e.isBoss ? 3.5 : 2}
                  fill={e.isBoss ? '#ef4444' : '#f87171'}
                />
              ))}

              {/* Remote Multiplayer Peers */}
              {hud.minimapPeers.map((p, idx) => (
                <circle key={idx} cx={mapCoord(p.x)} cy={mapCoord(p.z)} r="2.5" fill="#38bdf8" />
              ))}

              {/* Player Marker */}
              <circle cx={mapCoord(hud.x)} cy={mapCoord(hud.z)} r="3.5" fill="#fef08a" stroke="#0b0d14" strokeWidth="1" />
            </svg>
            <div className="text-[10px] text-center leading-tight w-[124px]">
              <div className="font-semibold truncate" style={{ color: biome.accent }}>
                {biome.name}
              </div>
              <div className="text-[#9ca3af] font-mono-num whitespace-nowrap truncate">
                {shard.name.split(' ')[0]} · {connected ? `${Math.max(1, onlineCount)} online` : 'Syncing'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM-LEFT: Compact Live Realm Chat Ticker */}
      <div className="absolute bottom-4 left-4 w-[285px] hidden md:flex flex-col gap-1.5 pointer-events-auto">
        <div className="hud-panel-subtle rounded-lg px-3 py-2 text-[11px] flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px] text-[#a6adbe] pb-1 border-b border-white/10">
            <span className="font-semibold text-[#e0b254]">Realm Feed</span>
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenSocial();
              }}
              className="text-[#c9c3b8] hover:text-white cursor-pointer"
            >
              Guilds & Chat [G]
            </button>
          </div>
          <div className="flex flex-col gap-0.5 max-h-[68px] overflow-hidden">
            {recentChat.map((m) => (
              <div key={m.id} className="truncate leading-snug text-[#e2e8f0]">
                <span className={m.channel === 'system' ? 'text-[#fbbf24] font-semibold' : 'text-[#93c5fd] font-semibold'}>
                  {m.senderTag ? `[${m.senderTag}] ` : ''}
                  {m.senderName}:{' '}
                </span>
                <span>{m.text}</span>
              </div>
            ))}
          </div>
          <form onSubmit={handleQuickChatSubmit} className="flex gap-1 pt-1">
            <input
              type="text"
              value={quickInput}
              onChange={(e) => setQuickInput(e.target.value)}
              placeholder="Say to realm..."
              aria-label="Quick Realm Chat"
              className="flex-1 bg-[#0c0e15] border border-white/15 rounded px-2 py-1 text-[11px] text-white placeholder-[#6b7280] focus:outline-none focus:border-[#e0b254]"
            />
            <button
              type="submit"
              tabIndex={-1}
              className="px-2 py-1 rounded bg-[#2a2317] border border-[#e0b254]/50 text-[#fef3c7] text-[10px] font-semibold hover:bg-[#3a301e] cursor-pointer"
            >
              Send
            </button>
          </form>
        </div>
      </div>

      {/* BOTTOM-CENTER: 4-Slot Class Skill Hotbar + Consumables */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-end gap-2 pointer-events-auto">
        <div className="hud-panel rounded-lg p-1.5 flex items-center gap-1.5">
          {cls.skills.map((skill, idx) => {
            const eff = computeEffectiveSkill(profile.classId, idx as 0 | 1 | 2 | 3, profile.skillRanks);
            const cd = hud.skillCooldowns[idx];
            const ready = cd <= 0 && hud.mana >= eff.manaCost;
            return (
              <button
                key={skill.id}
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onCastSkill(idx as 0 | 1 | 2 | 3);
                }}
                aria-label={`${skill.name} (Key ${skill.key})`}
                className={`relative w-[92px] md:w-[118px] h-[64px] rounded border px-2.5 py-1.5 flex flex-col justify-between text-left transition-colors cursor-pointer ${
                  ready
                    ? 'bg-[#171a26] border-[#d0a85c]/55 hover:border-[#e0b254]'
                    : 'bg-[#10121a] border-white/10'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-1">
                    <span className="font-mono-num text-[10px] font-bold px-1 rounded bg-black/60 text-[#e0b254]">
                      {skill.key}
                    </span>
                    {eff.rank > 0 && (
                      <span className="font-mono-num text-[9px] font-bold text-[#fde047]">
                        +{eff.rank}
                      </span>
                    )}
                  </div>
                  {eff.manaCost > 0 && (
                    <span className="font-mono-num text-[10px] text-[#60a5fa]">{eff.manaCost} MP</span>
                  )}
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-[#f7f1e3] whitespace-nowrap truncate leading-tight">
                    {skill.name}
                  </div>
                  <div className="text-[9px] text-[#9ca3af] whitespace-nowrap truncate">{skill.role}</div>
                </div>
                {cd > 0 && (
                  <div className="absolute inset-0 bg-[#0b0d14]/88 rounded flex items-center justify-center font-mono-num text-sm font-bold text-[#fbbf24]">
                    {cd.toFixed(1)}s
                  </div>
                )}
              </button>
            );
          })}

          <div className="w-px h-11 bg-white/10 mx-0.5" />

          {/* Quick Consumable Slots */}
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onUseElixir();
            }}
            disabled={profile.healthElixirs <= 0}
            aria-label="Drink Crimson Elixir (Key Q)"
            className="w-[54px] h-[64px] rounded border border-red-400/35 bg-[#1c1317] hover:border-red-400/75 disabled:opacity-40 px-1.5 py-1 flex flex-col justify-between items-center cursor-pointer"
          >
            <span className="font-mono-num text-[10px] font-bold text-red-300">Q</span>
            <span className="text-[10px] text-[#f4efe6] font-medium">Elixir</span>
            <span className="font-mono-num text-[10px] text-red-300">x{profile.healthElixirs}</span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onUseDraught();
            }}
            disabled={profile.manaDraughts <= 0}
            aria-label="Drink Astral Draught (Key E)"
            className="w-[54px] h-[64px] rounded border border-sky-400/35 bg-[#121826] hover:border-sky-400/75 disabled:opacity-40 px-1.5 py-1 flex flex-col justify-between items-center cursor-pointer"
          >
            <span className="font-mono-num text-[10px] font-bold text-sky-300">E</span>
            <span className="text-[10px] text-[#f4efe6] font-medium">Mana</span>
            <span className="font-mono-num text-[10px] text-sky-300">x{profile.manaDraughts}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
