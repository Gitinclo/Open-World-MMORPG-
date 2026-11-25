import React from 'react';
import { CHARACTER_CLASSES, CLASS_LIST, LINEAGE_LIST, LINEAGES } from '../game/catalog';
import { computeCharacterStats } from '../game/rules';
import type { RealmShardInfo } from '../hooks/useRealmSocket';
import type { CharacterClassId, LineageId, PlayerProfile } from '../game/types';

interface TitleOverlayProps {
  profile: PlayerProfile;
  shards: RealmShardInfo[];
  onChangeName: (name: string) => void;
  onSelectClass: (classId: CharacterClassId) => void;
  onSelectLineage: (lineageId: LineageId) => void;
  onSelectShard: (shardId: string) => void;
  onEnterRealm: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  profile,
  shards,
  onChangeName,
  onSelectClass,
  onSelectLineage,
  onSelectShard,
  onEnterRealm,
}) => {
  const selectedClass = CHARACTER_CLASSES[profile.classId];
  const selectedLineage = LINEAGES[profile.lineageId];
  const stats = computeCharacterStats(
    profile.classId,
    profile.lineageId,
    profile.level,
    profile.cultivationTier
  );

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-5 md:p-8">
      {/* Subtle left contrast vignette leaving the right 60% of the live 3D Solara Citadel unobstructed */}
      <div
        className="fixed inset-y-0 left-0 w-full max-w-[560px] pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, rgba(10,12,19,0.92) 0%, rgba(10,12,19,0.78) 68%, rgba(10,12,19,0) 100%)',
        }}
      />

      {/* Main Left-Third Character & Realm Entry Panel */}
      <div className="relative z-10 pointer-events-auto w-full max-w-[430px] flex flex-col gap-4 my-auto">
        {/* Bespoke Inline SVG Solara Crest & Title Lockup */}
        <div className="flex items-center gap-3.5">
          <svg
            width="52"
            height="52"
            viewBox="0 0 64 64"
            fill="none"
            aria-hidden="true"
            className="shrink-0 drop-shadow-[0_2px_10px_rgba(224,178,84,0.45)]"
          >
            <path
              d="M32 4L56 14V32C56 46.5 45.2 56.2 32 60C18.8 56.2 8 46.5 8 32V14L32 4Z"
              fill="#141824"
              stroke="#E0B254"
              strokeWidth="2.5"
            />
            <path
              d="M32 11L49 18.5V31.5C49 42.2 41.4 49.8 32 53C22.6 49.8 15 42.2 15 31.5V18.5L32 11Z"
              fill="#1E2538"
              stroke="#B48332"
              strokeWidth="1.2"
            />
            <path d="M32 16L36 28L46 32L36 36L32 48L28 36L18 32L28 28L32 16Z" fill="#E0B254" />
            <circle cx="32" cy="32" r="3.5" fill="#0B0D14" />
          </svg>
          <div>
            <h1 className="font-display text-3xl md:text-4xl font-bold tracking-wide text-[#f7f1e3] leading-none hud-text-shadow">
              ShadowRealms
            </h1>
            <p className="text-xs tracking-[0.22em] text-[#e0b254] font-semibold mt-1 uppercase">
              Voxel Ascendant · Open-World MMORPG
            </p>
          </div>
        </div>

        {/* Character Forging & Persistent Shard Selection */}
        <div className="hud-panel rounded-lg p-4 flex flex-col gap-3.5">
          {/* Hero Name Input */}
          <div>
            <label
              htmlFor="hero-name-input"
              className="block text-xs font-semibold text-[#c9c3b8] mb-1.5"
            >
              Hero Name
            </label>
            <input
              id="hero-name-input"
              type="text"
              maxLength={24}
              value={profile.name}
              onChange={(e) => onChangeName(e.target.value)}
              placeholder="Enter hero name..."
              className="w-full px-3 py-2 rounded bg-[#0c0e15] border border-[#d0a85c]/40 text-sm text-[#f4efe6] placeholder-[#6b7280] focus:outline-none focus:border-[#e0b254]"
            />
          </div>

          {/* 4 Character Classes */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-semibold text-[#c9c3b8]">Class</span>
              <span className="text-[#e0b254]">
                {selectedClass.title} · {selectedClass.primaryRole}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Character Class">
              {CLASS_LIST.map((cls) => {
                const active = cls.id === profile.classId;
                return (
                  <button
                    key={cls.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onSelectClass(cls.id)}
                    className={`px-2 py-2 rounded text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer border ${
                      active
                        ? 'bg-[#2a2317] border-[#e0b254] text-[#fef3c7]'
                        : 'bg-[#12141e] border-white/10 text-[#a6adbe] hover:border-[#e0b254]/50 hover:text-white'
                    }`}
                  >
                    {cls.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 6 Fantasy Lineages */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-semibold text-[#c9c3b8]">Lineage</span>
              <span className="text-[#a6adbe] truncate max-w-[230px]">
                {selectedLineage.origin}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Fantasy Lineage">
              {LINEAGE_LIST.map((lin) => {
                const active = lin.id === profile.lineageId;
                return (
                  <button
                    key={lin.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onSelectLineage(lin.id)}
                    className={`px-2 py-1.5 rounded text-xs font-medium transition-colors truncate cursor-pointer border ${
                      active
                        ? 'bg-[#25211b] border-[#e0b254] text-[#fef3c7]'
                        : 'bg-[#12141e] border-white/10 text-[#a6adbe] hover:border-[#e0b254]/45 hover:text-white'
                    }`}
                  >
                    {lin.name.split(' ')[0]}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[#9ca3af] mt-1.5">{selectedLineage.passiveSummary}</p>
          </div>

          {/* Persistent Realm Shard Picker */}
          <div>
            <label htmlFor="shard-select" className="block text-xs font-semibold text-[#c9c3b8] mb-1.5">
              Persistent Realm Shard
            </label>
            <select
              id="shard-select"
              value={profile.shardId}
              onChange={(e) => onSelectShard(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[#0c0e15] border border-[#d0a85c]/35 text-xs text-[#f4efe6] focus:outline-none focus:border-[#e0b254]"
            >
              {shards.map((shard) => (
                <option key={shard.id} value={shard.id}>
                  {shard.name} ({shard.region}) — {shard.onlineCount} online
                </option>
              ))}
            </select>
          </div>

          {/* Compact Combat Attribute Preview */}
          <div className="flex items-center justify-between text-xs pt-2 border-t border-white/10 text-[#c9c3b8] font-mono-num">
            <span>HP {stats.maxHp}</span>
            <span>ATK {stats.attack}</span>
            <span>DEF {stats.defense}</span>
            <span className="text-[#e0b254]">PWR {stats.combatPower}</span>
          </div>

          {/* Primary Start CTA */}
          <button
            type="button"
            data-start="true"
            onClick={onEnterRealm}
            className="w-full py-3 px-5 rounded bg-[#c9963b] hover:bg-[#dba74a] active:bg-[#b5842e] text-[#0c0e15] font-display font-bold text-base tracking-wider uppercase transition-colors cursor-pointer shadow-[0_4px_16px_rgba(201,150,59,0.35)]"
          >
            Enter Realm
          </button>
        </div>
      </div>

      {/* Bottom Safe-Margin Single Flat Control Hint Line */}
      <div className="relative z-10 text-xs text-[#d6d0c4]/85 hud-text-shadow tracking-wide">
        WASD Move · Shift Sprint · Space Jump · Left Click / 1–4 Skills · Drag Orbit · G Social · C Cultivation · Esc Pause
      </div>
    </div>
  );
};
