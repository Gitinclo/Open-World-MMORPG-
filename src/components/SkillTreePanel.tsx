import React, { useMemo, useState } from 'react';
import { CHARACTER_CLASSES, CLASS_SKILL_TREES } from '../game/catalog';
import { computeEffectiveSkill, evaluateSkillNodeUpgrade } from '../game/rules';
import type { PlayerProfile, SkillNodeIconType, SkillTreeNodeSpec } from '../game/types';

interface SkillTreePanelProps {
  profile: PlayerProfile;
  onUpgradeSkillNode: (nodeId: string) => void;
  onResetSkillTree: () => void;
}

const SVG_W = 324;
const SVG_H = 300;
const COL_X = [78, 174, 270] as const;
const TIER_Y = [52, 152, 252] as const;

function nodeCoord(node: SkillTreeNodeSpec): { x: number; y: number } {
  return {
    x: COL_X[node.column] ?? 174,
    y: TIER_Y[node.tier - 1] ?? 152,
  };
}

function SkillNodeGlyph({ icon, color }: { icon: SkillNodeIconType; color: string }) {
  const strokeProps = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (icon) {
    case 'blade':
      return (
        <svg {...strokeProps}>
          <path d="M14.5 17.5L3 6V3h3l11.5 11.5" />
          <path d="M13 19l6-6" />
          <path d="M16 16l4 4" />
          <path d="M19 21l2-2" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...strokeProps}>
          <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
          <path d="M12 8v8" />
          <path d="M9 11h6" />
        </svg>
      );
    case 'flame':
      return (
        <svg {...strokeProps}>
          <path d="M12 3c1.5 3 5 5 5 9.5a5 5 0 1 1-10 0c0-2.5 1.3-4.6 2.8-6.2.2 1.7 1.2 2.7 2.2 2.7C11.7 6.8 11.5 4.8 12 3z" />
        </svg>
      );
    case 'frost':
      return (
        <svg {...strokeProps}>
          <path d="M12 2v20" />
          <path d="M2 12h20" />
          <path d="M5 5l14 14" />
          <path d="M19 5L5 19" />
          <circle cx="12" cy="12" r="2.2" />
        </svg>
      );
    case 'bolt':
      return (
        <svg {...strokeProps}>
          <path d="M13 2L4.5 13h6.5L10 22l9.5-11H13l0-9z" />
        </svg>
      );
    case 'dagger':
      return (
        <svg {...strokeProps}>
          <path d="M19 5l-9.5 9.5" />
          <path d="M19 5l-5 1.5L6.5 14l3.5 3.5L17.5 10 19 5z" />
          <path d="M5 19l3.5-3.5" />
          <path d="M8 12l4 4" />
        </svg>
      );
    case 'crown':
      return (
        <svg {...strokeProps}>
          <path d="M3 18h18l-1.5-9-4.5 3.5L12 6l-3 6.5L4.5 9 3 18z" />
          <path d="M5 21h14" />
        </svg>
      );
    case 'spark':
    default:
      return (
        <svg {...strokeProps}>
          <path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3z" />
        </svg>
      );
  }
}

interface BonusRow {
  label: string;
  currentText: string;
  nextText: string | null;
}

function describeNodeBonuses(node: SkillTreeNodeSpec, currentRank: number): BonusRow[] {
  const rows: BonusRow[] = [];
  const nextRank = currentRank < node.maxRank ? currentRank + 1 : null;
  const b = node.bonus;

  const pushPct = (label: string, perRank: number | undefined, sign: '+' | '-') => {
    if (!perRank) return;
    rows.push({
      label,
      currentText: `${sign}${perRank * currentRank}%`,
      nextText: nextRank !== null ? `${sign}${perRank * nextRank}%` : null,
    });
  };

  pushPct('Skill Damage', b.damagePctPerRank, '+');
  pushPct('Skill Cooldown', b.cooldownReductionPctPerRank, '-');
  pushPct('Mana Cost', b.manaCostReductionPctPerRank, '-');
  pushPct('AoE Radius', b.radiusPctPerRank, '+');
  pushPct('Max HP', b.hpBonusPctPerRank, '+');
  pushPct('Attack Power', b.attackBonusPctPerRank, '+');
  pushPct('Defense', b.defenseBonusPctPerRank, '+');
  pushPct('Crit Chance', b.critBonusPctPerRank, '+');
  pushPct('All Cooldowns', b.globalCooldownPctPerRank, '-');

  return rows;
}

export const SkillTreePanel: React.FC<SkillTreePanelProps> = ({
  profile,
  onUpgradeSkillNode,
  onResetSkillTree,
}) => {
  const cls = CHARACTER_CLASSES[profile.classId];
  const tree = CLASS_SKILL_TREES[profile.classId];
  const [selectedId, setSelectedId] = useState<string>(tree[0]?.id ?? '');

  const nodeMap = useMemo(() => {
    const map = new Map<string, SkillTreeNodeSpec>();
    for (const node of tree) map.set(node.id, node);
    return map;
  }, [tree]);

  const selectedNode = nodeMap.get(selectedId) ?? tree[0];

  const { spentPoints, maxTotalRanks } = useMemo(() => {
    let spent = 0;
    let total = 0;
    for (const node of tree) {
      spent += Math.max(0, Math.min(node.maxRank, Math.floor(profile.skillRanks[node.id] ?? 0)));
      total += node.maxRank;
    }
    return { spentPoints: spent, maxTotalRanks: total };
  }, [tree, profile.skillRanks]);

  const edges = useMemo(() => {
    const list: Array<{
      id: string;
      from: { x: number; y: number };
      to: { x: number; y: number };
      parentUnlocked: boolean;
      childUnlocked: boolean;
    }> = [];
    for (const node of tree) {
      const to = nodeCoord(node);
      const childRank = profile.skillRanks[node.id] ?? 0;
      for (const preId of node.prerequisites) {
        const parent = nodeMap.get(preId);
        if (!parent) continue;
        const from = nodeCoord(parent);
        const parentRank = profile.skillRanks[parent.id] ?? 0;
        list.push({
          id: `${parent.id}->${node.id}`,
          from,
          to,
          parentUnlocked: parentRank >= 1,
          childUnlocked: childRank >= 1,
        });
      }
    }
    return list;
  }, [tree, nodeMap, profile.skillRanks]);

  if (!selectedNode) return null;

  const selectedEval = evaluateSkillNodeUpgrade(selectedNode, profile.skillRanks, profile.skillPoints);
  const bonusRows = describeNodeBonuses(selectedNode, selectedEval.currentRank);

  const effectiveCurrent =
    selectedNode.targetSkillSlot !== undefined
      ? computeEffectiveSkill(profile.classId, selectedNode.targetSkillSlot, profile.skillRanks)
      : null;

  const effectiveNext =
    selectedNode.targetSkillSlot !== undefined && selectedEval.currentRank < selectedNode.maxRank
      ? computeEffectiveSkill(profile.classId, selectedNode.targetSkillSlot, {
          ...profile.skillRanks,
          [selectedNode.id]: selectedEval.currentRank + 1,
        })
      : null;

  const actionLabel =
    selectedEval.currentRank >= selectedNode.maxRank
      ? `Mastered (Rank ${selectedNode.maxRank}/${selectedNode.maxRank})`
      : !selectedEval.canUpgrade
      ? selectedEval.reason || 'Unavailable'
      : selectedEval.currentRank === 0
      ? 'Unlock Ability (1 SP)'
      : `Upgrade to Rank ${selectedEval.currentRank + 1} (1 SP)`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.28fr_1fr] gap-4">
      {/* Left: Visual 3-Tier Branching Skill Tree */}
      <div className="rounded-lg bg-[#0d1019] border border-[#e0b254]/25 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 pb-2 border-b border-white/10">
          <div className="min-w-0">
            <div className="font-display text-sm font-bold text-[#f7f1e3]">
              {cls.name} Mastery Tree
            </div>
            <div className="text-[11px] text-[#94a3b8]">
              {cls.title} · Select a node to inspect & invest Skill Points
            </div>
          </div>
          <div className="text-right font-mono-num shrink-0 whitespace-nowrap">
            <div className="text-xs font-bold text-[#e0b254]">
              {spentPoints}/{maxTotalRanks} Ranks
            </div>
            <div className="text-[11px] text-[#94a3b8]">3 Mastery Tiers</div>
          </div>
        </div>

        {/* Interactive Tree Stage */}
        <div
          className="relative w-full h-[368px] rounded-md bg-[#090c13] border border-white/10 overflow-hidden"
          role="region"
          aria-label={`${cls.name} Skill Tree Graph`}
        >
          {/* Tier labels in dedicated left gutter */}
          <span className="absolute left-2.5 top-[17.3%] -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wider text-[#64748b] pointer-events-none select-none">
            Tier I
          </span>
          <span className="absolute left-2.5 top-[50.7%] -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wider text-[#64748b] pointer-events-none select-none">
            Tier II
          </span>
          <span className="absolute left-2.5 top-[84%] -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wider text-[#64748b] pointer-events-none select-none">
            Tier III
          </span>

          {/* SVG Prerequisite Connector Paths */}
          <svg
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none"
            aria-hidden="true"
          >
            {edges.map((edge) => {
              const midY = (edge.from.y + edge.to.y) / 2;
              const d = `M ${edge.from.x} ${edge.from.y} C ${edge.from.x} ${midY}, ${edge.to.x} ${midY}, ${edge.to.x} ${edge.to.y}`;
              const stroke = edge.childUnlocked
                ? '#e0b254'
                : edge.parentUnlocked
                ? '#c9963b'
                : '#2a3245';
              const strokeOpacity = edge.childUnlocked ? 0.95 : edge.parentUnlocked ? 0.65 : 0.7;
              const strokeWidth = edge.childUnlocked ? 2.6 : 1.9;
              return (
                <g key={edge.id}>
                  <path
                    d={d}
                    fill="none"
                    stroke="#06080d"
                    strokeWidth={strokeWidth + 2}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeDasharray={edge.parentUnlocked && !edge.childUnlocked ? '5 4' : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
          </svg>

          {/* Interactive Skill Nodes */}
          {tree.map((node) => {
            const coord = nodeCoord(node);
            const ev = evaluateSkillNodeUpgrade(node, profile.skillRanks, profile.skillPoints);
            const isSelected = node.id === selectedNode.id;
            const isMaxed = ev.currentRank >= node.maxRank;
            const isInvested = ev.currentRank > 0;
            const isLocked = !ev.prereqsMet;

            const borderStyle = isSelected
              ? 'border-[#f6d379] ring-2 ring-[#e0b254]/75 bg-[#1b1811]'
              : isMaxed
              ? 'border-[#e0b254]/85 bg-[#19160f]'
              : isInvested
              ? 'border-[#e0b254]/55 bg-[#131826]'
              : !isLocked
              ? 'border-white/25 hover:border-[#e0b254]/70 bg-[#111521]'
              : 'border-white/10 bg-[#0d1018] opacity-60 hover:opacity-85';

            return (
              <button
                key={node.id}
                type="button"
                onClick={() => setSelectedId(node.id)}
                aria-pressed={isSelected}
                aria-label={`${node.name}, Rank ${ev.currentRank} of ${node.maxRank}`}
                style={{
                  left: `${(coord.x / SVG_W) * 100}%`,
                  top: `${(coord.y / SVG_H) * 100}%`,
                }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 w-[114px] rounded-lg border px-2 py-2 flex flex-col items-center gap-1 transition-colors cursor-pointer ${borderStyle}`}
              >
                {node.targetSkillSlot !== undefined && (
                  <span className="absolute top-1 right-1.5 text-[10px] font-mono-num font-bold text-[#e0b254]">
                    [{node.targetSkillSlot + 1}]
                  </span>
                )}
                <div
                  className="w-8 h-8 rounded-md flex items-center justify-center border"
                  style={{
                    borderColor: isLocked ? 'rgba(148,163,184,0.22)' : `${node.accentHex}88`,
                    backgroundColor: isLocked ? 'rgba(15,23,42,0.7)' : `${node.accentHex}1c`,
                  }}
                >
                  <SkillNodeGlyph
                    icon={node.icon}
                    color={isLocked ? '#64748b' : node.accentHex}
                  />
                </div>
                <span className="text-[11px] font-semibold text-[#f1f5f9] leading-tight text-center line-clamp-2 min-h-[26px] flex items-center">
                  {node.name}
                </span>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: node.maxRank }).map((_, idx) => (
                      <span
                        key={idx}
                        className="w-2 h-1 rounded-xs"
                        style={{
                          backgroundColor:
                            idx < ev.currentRank
                              ? node.accentHex
                              : 'rgba(148,163,184,0.28)',
                        }}
                      />
                    ))}
                  </div>
                  <span
                    className={`font-mono-num text-[10px] font-bold ${
                      isMaxed
                        ? 'text-[#fde047]'
                        : isInvested
                        ? 'text-[#e0b254]'
                        : 'text-[#94a3b8]'
                    }`}
                  >
                    {ev.currentRank}/{node.maxRank}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Skill Points Pool & Selected Node Inspector */}
      <div className="flex flex-col gap-3">
        {/* Skill Points Header Bar */}
        <div className="rounded-lg bg-[#121520] border border-[#e0b254]/30 px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-semibold">
              Available Skill Points
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span
                data-testid="skill-points-count"
                className="font-mono-num text-2xl font-bold text-[#e0b254] leading-none"
              >
                {profile.skillPoints}
              </span>
              <span className="text-xs text-[#94a3b8]">+1 SP per Level Up</span>
            </div>
          </div>
          <button
            type="button"
            disabled={spentPoints <= 0}
            onClick={onResetSkillTree}
            aria-label="Reset Class Skill Tree"
            className="px-3 py-1.5 rounded bg-[#1d2232] hover:bg-[#2a3147] disabled:opacity-45 disabled:hover:bg-[#1d2232] border border-white/15 text-xs font-semibold text-[#e2e8f0] whitespace-nowrap cursor-pointer disabled:cursor-not-allowed"
          >
            Reset Tree
          </button>
        </div>

        {/* Selected Ability Detail Card */}
        <div className="rounded-lg bg-[#121622] border border-white/15 p-4 flex flex-col justify-between gap-3.5 flex-1">
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-10 h-10 rounded-md flex items-center justify-center border shrink-0"
                  style={{
                    borderColor: `${selectedNode.accentHex}88`,
                    backgroundColor: `${selectedNode.accentHex}1c`,
                  }}
                >
                  <SkillNodeGlyph icon={selectedNode.icon} color={selectedNode.accentHex} />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold text-[#f7f1e3] leading-tight">
                    {selectedNode.name}
                  </h3>
                  <div className="text-xs text-[#e0b254] font-medium mt-0.5">
                    {selectedNode.subtitle}
                  </div>
                </div>
              </div>
              <span
                data-testid="selected-node-rank"
                className="font-mono-num text-xs font-bold text-[#cbd5e1] whitespace-nowrap"
              >
                Rank {selectedEval.currentRank}/{selectedNode.maxRank}
              </span>
            </div>

            <p className="text-xs text-[#cbd5e1] leading-relaxed">
              {selectedNode.description}
            </p>

            {/* Prerequisite Status */}
            {selectedNode.prerequisites.length > 0 && (
              <div className="text-xs flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#0c0f17] border border-white/10">
                <span className="text-[#94a3b8]">Prerequisite</span>
                <span
                  className={`font-semibold ${
                    selectedEval.prereqsMet ? 'text-[#34d399]' : 'text-[#f87171]'
                  }`}
                >
                  {selectedNode.prerequisites
                    .map((pid) => nodeMap.get(pid)?.name ?? pid)
                    .join(', ')}{' '}
                  {selectedEval.prereqsMet ? '(Unlocked)' : '(Required)'}
                </span>
              </div>
            )}

            {/* Live Skill Scaling Comparison (for Hotbar Ability Nodes) */}
            {effectiveCurrent && (
              <div className="rounded bg-[#0b0e16] border border-white/10 p-3 flex flex-col gap-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">
                  Live Combat Scaling · [{effectiveCurrent.skill.key}] {effectiveCurrent.skill.name}
                </div>
                <div className="flex flex-col gap-1 text-xs font-mono-num">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#94a3b8]">Power Multiplier</span>
                    <span className="whitespace-nowrap">
                      <span className="text-[#e2e8f0]">{effectiveCurrent.damageMult.toFixed(2)}x</span>
                      {effectiveNext && effectiveNext.damageMult !== effectiveCurrent.damageMult && (
                        <span className="text-[#34d399]"> → {effectiveNext.damageMult.toFixed(2)}x</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#94a3b8]">Cooldown</span>
                    <span className="whitespace-nowrap">
                      <span className="text-[#e2e8f0]">{effectiveCurrent.cooldown.toFixed(2)}s</span>
                      {effectiveNext && effectiveNext.cooldown !== effectiveCurrent.cooldown && (
                        <span className="text-[#34d399]"> → {effectiveNext.cooldown.toFixed(2)}s</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#94a3b8]">Mana Cost</span>
                    <span className="whitespace-nowrap">
                      <span className="text-[#e2e8f0]">{effectiveCurrent.manaCost} MP</span>
                      {effectiveNext && effectiveNext.manaCost !== effectiveCurrent.manaCost && (
                        <span className="text-[#34d399]"> → {effectiveNext.manaCost} MP</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#94a3b8]">Impact Radius</span>
                    <span className="whitespace-nowrap">
                      <span className="text-[#e2e8f0]">{effectiveCurrent.radius.toFixed(1)}m</span>
                      {effectiveNext && effectiveNext.radius !== effectiveCurrent.radius && (
                        <span className="text-[#34d399]"> → {effectiveNext.radius.toFixed(1)}m</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Rank Bonus Breakdown */}
            <div className="rounded bg-[#0b0e16] border border-white/10 p-3 flex flex-col gap-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">
                Rank Mastery Effects
              </div>
              {bonusRows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between text-xs font-mono-num"
                >
                  <span className="text-[#cbd5e1]">{row.label}</span>
                  <span>
                    <span className="text-[#e2e8f0]">{row.currentText}</span>
                    {row.nextText && (
                      <span className="text-[#e0b254]"> → {row.nextText}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={!selectedEval.canUpgrade}
            onClick={() => onUpgradeSkillNode(selectedNode.id)}
            data-testid="upgrade-skill-node-btn"
            className="w-full py-2.5 rounded bg-[#c9963b] hover:bg-[#dba74a] disabled:bg-[#232634] disabled:text-[#6b7280] text-[#0c0e15] font-display font-bold text-sm uppercase tracking-wider cursor-pointer disabled:cursor-not-allowed"
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
