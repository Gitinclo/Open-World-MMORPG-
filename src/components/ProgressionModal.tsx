import React, { useState } from 'react';
import { CULTIVATION_REALMS, SHOP_ITEMS } from '../game/catalog';
import { computeCharacterStats, evaluateBreakthrough } from '../game/rules';
import type { PlayerProfile } from '../game/types';
import { SkillTreePanel } from './SkillTreePanel';

interface ProgressionModalProps {
  profile: PlayerProfile;
  onClose: () => void;
  onAttemptBreakthrough: () => void;
  onPurchaseItem: (itemId: 'health_elixir' | 'mana_draught' | 'revive_token' | 'spirit_pill') => void;
  onUpgradeSkillNode: (nodeId: string) => void;
  onResetSkillTree: () => void;
}

export const ProgressionModal: React.FC<ProgressionModalProps> = ({
  profile,
  onClose,
  onAttemptBreakthrough,
  onPurchaseItem,
  onUpgradeSkillNode,
  onResetSkillTree,
}) => {
  const [tab, setTab] = useState<'skills' | 'cultivation' | 'shop'>('skills');
  const currentRealm = CULTIVATION_REALMS[profile.cultivationTier] ?? CULTIVATION_REALMS[0];
  const nextRealm = CULTIVATION_REALMS[profile.cultivationTier + 1] ?? null;
  const check = evaluateBreakthrough(profile.cultivationTier, profile.level, profile.spiritStones);
  const stats = computeCharacterStats(
    profile.classId,
    profile.lineageId,
    profile.level,
    profile.cultivationTier,
    profile.skillRanks
  );

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-black/65"
      role="dialog"
      aria-modal="true"
      aria-label="Character Progression, Skill Tree, and Quartermaster"
    >
      <div className="hud-panel rounded-xl w-full max-w-[920px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e0b254]/25">
          <div>
            <h2 className="font-display text-lg font-bold text-[#f7f1e3]">
              Mastery, Cultivation & Quartermaster
            </h2>
            <p className="text-xs text-[#a6adbe] font-mono-num">
              {profile.skillPoints} Skill Points · {profile.gold} Gold · {profile.spiritStones} Spirit Stones · Power {stats.combatPower}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Progression Window"
            className="px-3 py-1.5 rounded bg-[#1d202c] hover:bg-[#2a2e3f] text-xs font-semibold text-[#e2e8f0] whitespace-nowrap cursor-pointer"
          >
            Close
          </button>
        </div>

        <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-white/10 bg-[#10121b]" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'skills'}
            onClick={() => setTab('skills')}
            className={`px-3.5 py-1.5 rounded text-xs font-semibold whitespace-nowrap cursor-pointer ${
              tab === 'skills'
                ? 'bg-[#2c2417] text-[#fef3c7] border border-[#e0b254]/70'
                : 'text-[#a6adbe] hover:text-white'
            }`}
          >
            Skill Tree{profile.skillPoints > 0 ? ` (${profile.skillPoints} SP)` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'cultivation'}
            onClick={() => setTab('cultivation')}
            className={`px-3.5 py-1.5 rounded text-xs font-semibold whitespace-nowrap cursor-pointer ${
              tab === 'cultivation'
                ? 'bg-[#2c2417] text-[#fef3c7] border border-[#e0b254]/70'
                : 'text-[#a6adbe] hover:text-white'
            }`}
          >
            Cultivation Ascension
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'shop'}
            onClick={() => setTab('shop')}
            className={`px-3.5 py-1.5 rounded text-xs font-semibold whitespace-nowrap cursor-pointer ${
              tab === 'shop'
                ? 'bg-[#2c2417] text-[#fef3c7] border border-[#e0b254]/70'
                : 'text-[#a6adbe] hover:text-white'
            }`}
          >
            Quartermaster Shop
          </button>
        </div>

        <div className="p-5 overflow-y-auto realm-scroll">
          {tab === 'skills' ? (
            <SkillTreePanel
              profile={profile}
              onUpgradeSkillNode={onUpgradeSkillNode}
              onResetSkillTree={onResetSkillTree}
            />
          ) : tab === 'cultivation' ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg bg-[#121520] border border-[#e0b254]/35 p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-[#a6adbe]">Current Cultivation Realm</div>
                    <div className="font-display text-xl font-bold" style={{ color: currentRealm.auraHex }}>
                      {currentRealm.name}
                    </div>
                  </div>
                  <div className="text-right font-mono-num">
                    <div className="text-xs text-[#a6adbe]">Power Multiplier</div>
                    <div className="text-lg font-bold text-[#e0b254]">
                      {currentRealm.powerMultiplier.toFixed(2)}x
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 pt-2 border-t border-white/10 text-xs font-mono-num text-[#cbd5e1]">
                  <div>HP: {stats.maxHp}</div>
                  <div>MP: {stats.maxMana}</div>
                  <div>ATK: {stats.attack}</div>
                  <div>DEF: {stats.defense}</div>
                </div>
              </div>

              {nextRealm ? (
                <div className="rounded-lg bg-[#161926] border border-white/10 p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-[#a6adbe]">Next Ascension Tier</div>
                      <div className="font-display text-base font-bold" style={{ color: nextRealm.auraHex }}>
                        {nextRealm.name} ({nextRealm.powerMultiplier.toFixed(2)}x Power)
                      </div>
                    </div>
                    <div className="text-right text-xs font-mono-num text-[#cbd5e1]">
                      <div>Min Level: {nextRealm.minLevel} (You: {profile.level})</div>
                      <div>Cost: {nextRealm.spiritStoneCost} Spirit Stones</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!check.canBreakthrough}
                    onClick={onAttemptBreakthrough}
                    className="w-full py-2.5 rounded bg-[#c9963b] hover:bg-[#dba74a] disabled:bg-[#232634] disabled:text-[#6b7280] text-[#0c0e15] font-display font-bold text-sm uppercase tracking-wider cursor-pointer disabled:cursor-not-allowed"
                  >
                    {check.canBreakthrough
                      ? `Breakthrough to ${nextRealm.name}`
                      : check.reason || 'Requirements Not Met'}
                  </button>
                </div>
              ) : (
                <div className="rounded-lg bg-[#161926] border border-[#e0b254]/40 p-4 text-center text-sm text-[#fde047] font-display font-bold">
                  You have attained the Sovereign Ascendant pinnacle.
                </div>
              )}

              {/* Realm Ladder */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {CULTIVATION_REALMS.map((r) => {
                  const unlocked = profile.cultivationTier >= r.tier;
                  return (
                    <div
                      key={r.tier}
                      className={`rounded p-2.5 border text-xs ${
                        unlocked
                          ? 'bg-[#191d2b] border-[#e0b254]/45'
                          : 'bg-[#0e1018] border-white/10 opacity-60'
                      }`}
                    >
                      <div className="font-semibold" style={{ color: r.auraHex }}>
                        {r.name}
                      </div>
                      <div className="text-[11px] text-[#9ca3af] font-mono-num mt-0.5">
                        Lv.{r.minLevel}+ · {r.powerMultiplier.toFixed(2)}x
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SHOP_ITEMS.map((item) => {
                const canAfford = profile.gold >= item.goldCost;
                const stockLabel =
                  item.id === 'health_elixir'
                    ? `Owned: ${profile.healthElixirs}`
                    : item.id === 'mana_draught'
                    ? `Owned: ${profile.manaDraughts}`
                    : item.id === 'revive_token'
                    ? `Owned: ${profile.reviveTokens}`
                    : `Stones: ${profile.spiritStones}`;
                return (
                  <div
                    key={item.id}
                    className="rounded-lg bg-[#121520] border border-white/10 p-3.5 flex flex-col justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-sm font-bold text-[#f7f1e3]">
                          {item.name}
                        </span>
                        <span className="font-mono-num text-xs font-bold text-[#e0b254]">
                          {item.goldCost}g
                        </span>
                      </div>
                      <p className="text-xs text-[#9ca3af] mt-1">{item.description}</p>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs">
                      <span className="font-mono-num text-[#cbd5e1]">{stockLabel}</span>
                      <button
                        type="button"
                        disabled={!canAfford}
                        onClick={() => onPurchaseItem(item.id)}
                        className="px-3 py-1.5 rounded bg-[#c9963b] hover:bg-[#dba74a] disabled:bg-[#232634] disabled:text-[#6b7280] text-[#0c0e15] font-bold cursor-pointer disabled:cursor-not-allowed"
                      >
                        Buy
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
