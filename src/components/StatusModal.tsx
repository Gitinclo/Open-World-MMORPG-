import React from 'react';

interface StatusModalProps {
  mode: 'paused' | 'defeat';
  kills: number;
  damageDealt: number;
  elapsedSeconds: number;
  level: number;
  bossDefeated: boolean;
  onResume: () => void;
  onRespawn: () => void;
  onReturnToTitle: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({
  mode,
  kills,
  damageDealt,
  elapsedSeconds,
  level,
  bossDefeated,
  onResume,
  onRespawn,
  onReturnToTitle,
}) => {
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  const timeFormatted = `${mins}:${secs.toString().padStart(2, '0')}`;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/72"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'paused' ? 'Game Paused' : 'Hero Fallen'}
    >
      <div className="hud-panel rounded-xl w-full max-w-[420px] p-6 flex flex-col gap-5 text-center">
        <div>
          <h2 className="font-display text-2xl font-bold text-[#f7f1e3]">
            {mode === 'paused' ? 'Realm Paused' : 'Fallen in Battle'}
          </h2>
          <p className="text-xs text-[#a6adbe] mt-1">
            {mode === 'paused'
              ? 'Your character progress is automatically saved to the persistent realm server.'
              : bossDefeated
              ? 'You felled Dreadlord Malakor before falling. Reclaim Solara Avenue!'
              : 'Your spirit returns to Solara Citadel Gate with your progression intact.'}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2.5 font-mono-num">
          <div className="rounded bg-[#10121b] border border-white/10 p-2.5">
            <div className="text-[10px] text-[#9ca3af] uppercase">Kills</div>
            <div className="text-lg font-bold text-[#e0b254]">{kills}</div>
          </div>
          <div className="rounded bg-[#10121b] border border-white/10 p-2.5">
            <div className="text-[10px] text-[#9ca3af] uppercase">Damage</div>
            <div className="text-lg font-bold text-[#f7f1e3]">{damageDealt}</div>
          </div>
          <div className="rounded bg-[#10121b] border border-white/10 p-2.5">
            <div className="text-[10px] text-[#9ca3af] uppercase">Time · Lv</div>
            <div className="text-lg font-bold text-[#93c5fd]">
              {timeFormatted} · {level}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {mode === 'paused' ? (
            <button
              type="button"
              onClick={onResume}
              className="w-full py-2.5 rounded bg-[#c9963b] hover:bg-[#dba74a] text-[#0c0e15] font-display font-bold text-sm uppercase tracking-wider cursor-pointer"
            >
              Resume Realm
            </button>
          ) : (
            <button
              type="button"
              data-start="true"
              onClick={onRespawn}
              className="w-full py-2.5 rounded bg-[#c9963b] hover:bg-[#dba74a] text-[#0c0e15] font-display font-bold text-sm uppercase tracking-wider cursor-pointer"
            >
              Respawn at Solara
            </button>
          )}
          <button
            type="button"
            onClick={onReturnToTitle}
            className="w-full py-2 rounded bg-[#181b26] hover:bg-[#232737] border border-white/15 text-xs font-semibold text-[#e2e8f0] cursor-pointer"
          >
            Return to Title & Character Select
          </button>
        </div>
      </div>
    </div>
  );
};
