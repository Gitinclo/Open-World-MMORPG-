import React, { useState } from 'react';
import { CHARACTER_CLASSES, CULTIVATION_REALMS, LINEAGES } from '../game/catalog';
import type {
  CastleSiegeState,
  ChatMessage,
  GuildRecord,
  LeaderboardEntry,
  PartyRecord,
  PlayerProfile,
  RemotePlayerState,
} from '../game/types';

interface SocialGuildModalProps {
  profile: PlayerProfile;
  connected: boolean;
  remotePlayers: RemotePlayerState[];
  guilds: GuildRecord[];
  parties: PartyRecord[];
  chatMessages: ChatMessage[];
  siegeState: CastleSiegeState | null;
  leaderboard: LeaderboardEntry[];
  onClose: () => void;
  onSendChat: (channel: 'world' | 'guild' | 'party', text: string) => void;
  onCreateGuild: (name: string, tag: string, motto: string, color: string) => Promise<void>;
  onJoinGuild: (guildId: string) => Promise<void>;
  onLaunchSiegeRally: () => Promise<void>;
  onCreateParty: (name: string) => void;
  onJoinParty: (partyId: string) => void;
  onLeaveParty: () => void;
}

type TabKey = 'chat' | 'guilds' | 'party' | 'leaderboard';

export const SocialGuildModal: React.FC<SocialGuildModalProps> = ({
  profile,
  connected,
  remotePlayers,
  guilds,
  parties,
  chatMessages,
  siegeState,
  leaderboard,
  onClose,
  onSendChat,
  onCreateGuild,
  onJoinGuild,
  onLaunchSiegeRally,
  onCreateParty,
  onJoinParty,
  onLeaveParty,
}) => {
  const [tab, setTab] = useState<TabKey>('chat');
  const [chatChannel, setChatChannel] = useState<'world' | 'guild' | 'party'>('world');
  const [chatInput, setChatInput] = useState('');

  const [newGuildName, setNewGuildName] = useState('');
  const [newGuildTag, setNewGuildTag] = useState('');
  const [newGuildMotto, setNewGuildMotto] = useState('');
  const [guildError, setGuildError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [partyName, setPartyName] = useState('');

  const myParty = parties.find((p) => p.memberIds.includes(profile.playerId)) ?? null;
  const filteredChat = chatMessages.filter((m) => {
    if (m.channel === 'system') return true;
    return m.channel === chatChannel;
  });

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendChat(chatChannel, chatInput);
    setChatInput('');
  };

  const handleFoundGuild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newGuildName.trim().length < 3) {
      setGuildError('Guild name must be at least 3 characters.');
      return;
    }
    if (newGuildTag.trim().length < 2) {
      setGuildError('Guild tag must be 2–5 letters.');
      return;
    }
    setGuildError(null);
    setBusy(true);
    try {
      await onCreateGuild(newGuildName.trim(), newGuildTag.trim(), newGuildMotto.trim(), '#d97706');
      setNewGuildName('');
      setNewGuildTag('');
      setNewGuildMotto('');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateParty = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateParty(partyName.trim() || `${profile.name}'s Party`);
    setPartyName('');
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-black/65"
      role="dialog"
      aria-modal="true"
      aria-label="Social, Guilds, and Castle Warfare"
    >
      <div className="hud-panel rounded-xl w-full max-w-[780px] max-h-[84vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e0b254]/25">
          <div>
            <h2 className="font-display text-lg font-bold text-[#f7f1e3]">
              Realm Social & Castle Warfare
            </h2>
            <p className="text-xs text-[#a6adbe]">
              {connected ? 'Persistent Server Connected' : 'Reconnecting'} · {Math.max(1, remotePlayers.length)} online in shard
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Social Window"
            className="px-3 py-1.5 rounded bg-[#1d202c] hover:bg-[#2a2e3f] text-xs font-semibold text-[#e2e8f0] cursor-pointer"
          >
            Close
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-white/10 bg-[#10121b]" role="tablist">
          {(
            [
              ['chat', 'Realm Chat'],
              ['guilds', 'Guilds & Siege'],
              ['party', 'Party & Players'],
              ['leaderboard', 'Leaderboard'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`px-3.5 py-1.5 rounded text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                tab === key
                  ? 'bg-[#2c2417] text-[#fef3c7] border border-[#e0b254]/70'
                  : 'text-[#a6adbe] hover:text-white border border-transparent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto realm-scroll flex-1 min-h-[380px]">
          {tab === 'chat' && (
            <div className="flex flex-col h-[390px] gap-3">
              <div className="flex items-center gap-1.5">
                {(['world', 'guild', 'party'] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setChatChannel(ch)}
                    className={`px-3 py-1 rounded text-xs font-semibold capitalize cursor-pointer ${
                      chatChannel === ch
                        ? 'bg-[#c9963b] text-[#0b0d14]'
                        : 'bg-[#171a26] text-[#a6adbe] hover:text-white'
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>

              <div className="flex-1 bg-[#0b0d14] border border-white/10 rounded-lg p-3 overflow-y-auto realm-scroll flex flex-col gap-2">
                {filteredChat.length === 0 ? (
                  <p className="text-xs text-[#6b7280] m-auto">
                    No messages in {chatChannel} channel yet. Start the conversation below.
                  </p>
                ) : (
                  filteredChat.map((m) => (
                    <div key={m.id} className="text-xs leading-relaxed">
                      <span className="font-mono-num text-[10px] text-[#64748b] mr-2">
                        {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span
                        className={
                          m.channel === 'system'
                            ? 'text-[#fbbf24] font-semibold'
                            : m.senderId === profile.playerId
                            ? 'text-[#34d399] font-semibold'
                            : 'text-[#93c5fd] font-semibold'
                        }
                      >
                        {m.senderTag ? `[${m.senderTag}] ` : ''}
                        {m.senderName}:
                      </span>{' '}
                      <span className="text-[#f1f5f9]">{m.text}</span>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handleChatSubmit} className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={`Message ${chatChannel} channel...`}
                  aria-label="Realm Chat Message"
                  className="flex-1 px-3 py-2 rounded bg-[#0c0e15] border border-[#d0a85c]/40 text-xs text-white focus:outline-none focus:border-[#e0b254]"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-[#c9963b] hover:bg-[#dba74a] text-[#0c0e15] text-xs font-bold cursor-pointer"
                >
                  Send Message
                </button>
              </form>
            </div>
          )}

          {tab === 'guilds' && (
            <div className="flex flex-col gap-5">
              {/* Live Castle Warfare Siege Banner */}
              {siegeState && (
                <div className="rounded-lg bg-[#16121b] border border-[#e0b254]/45 p-4 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-display text-sm font-bold text-[#fef3c7]">
                        Castle Warfare · {siegeState.fortressName}
                      </h3>
                      <p className="text-xs text-[#c9c3b8]">
                        Controlled by [{siegeState.controllingGuildTag}] {siegeState.controllingGuildName} · Active Rallies: {siegeState.activeRallies}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await onLaunchSiegeRally();
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="px-3.5 py-2 rounded bg-[#c83e3b] hover:bg-[#dc2626] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      Launch Siege Rally
                    </button>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] font-mono-num text-[#c9c3b8] mb-1">
                      <span>Gate Integrity</span>
                      <span>
                        {siegeState.gateIntegrity} / {siegeState.maxGateIntegrity}
                      </span>
                    </div>
                    <div className="h-2.5 rounded bg-black/60 overflow-hidden">
                      <div
                        className="h-full bg-[#e0b254] transition-all duration-300"
                        style={{
                          width: `${Math.round((siegeState.gateIntegrity / Math.max(1, siegeState.maxGateIntegrity)) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Active Guilds Directory */}
              <div>
                <h3 className="text-xs font-semibold text-[#c9c3b8] uppercase tracking-wider mb-2.5">
                  Realm Guilds ({guilds.length})
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {guilds.map((g) => {
                    const isMember = profile.guildId === g.id;
                    return (
                      <div
                        key={g.id}
                        className="rounded-lg bg-[#121520] border border-white/10 p-3 flex flex-col justify-between gap-2"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-display text-sm font-bold text-[#f7f1e3]">
                              [{g.tag}] {g.name}
                            </span>
                            <span className="font-mono-num text-[11px] text-[#e0b254]">
                              {g.rallyPower} PWR
                            </span>
                          </div>
                          <p className="text-xs text-[#9ca3af] mt-1">{g.motto}</p>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-white/10 text-[11px] text-[#a6adbe]">
                          <span>{g.members.length} members · {g.fortressSector}</span>
                          {isMember ? (
                            <span className="text-emerald-400 font-semibold">Joined</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onJoinGuild(g.id)}
                              className="px-2.5 py-1 rounded bg-[#272116] border border-[#e0b254]/50 text-[#fef3c7] hover:bg-[#382f1d] font-semibold cursor-pointer"
                            >
                              Join Guild
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Found New Guild Form */}
              <form
                onSubmit={handleFoundGuild}
                className="rounded-lg bg-[#10121b] border border-white/10 p-3.5 flex flex-col gap-2.5"
              >
                <h3 className="text-xs font-semibold text-[#e0b254] uppercase tracking-wider">
                  Found a New Guild
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={newGuildName}
                    onChange={(e) => setNewGuildName(e.target.value)}
                    placeholder="Guild Name"
                    aria-label="New Guild Name"
                    className="px-2.5 py-1.5 rounded bg-[#0c0e15] border border-white/15 text-xs text-white"
                  />
                  <input
                    type="text"
                    maxLength={5}
                    value={newGuildTag}
                    onChange={(e) => setNewGuildTag(e.target.value.toUpperCase())}
                    placeholder="Tag (e.g. DAWN)"
                    aria-label="New Guild Tag"
                    className="px-2.5 py-1.5 rounded bg-[#0c0e15] border border-white/15 text-xs text-white uppercase"
                  />
                  <input
                    type="text"
                    value={newGuildMotto}
                    onChange={(e) => setNewGuildMotto(e.target.value)}
                    placeholder="Banner Motto"
                    aria-label="New Guild Motto"
                    className="px-2.5 py-1.5 rounded bg-[#0c0e15] border border-white/15 text-xs text-white"
                  />
                </div>
                {guildError && <p className="text-xs text-red-400">{guildError}</p>}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-1.5 rounded bg-[#c9963b] hover:bg-[#dba74a] text-[#0c0e15] text-xs font-bold cursor-pointer"
                  >
                    Create Guild
                  </button>
                </div>
              </form>
            </div>
          )}

          {tab === 'party' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Party Management */}
              <div className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold text-[#e0b254] uppercase tracking-wider">
                  Adventuring Parties ({parties.length})
                </h3>
                {myParty ? (
                  <div className="rounded-lg bg-[#141a24] border border-emerald-500/40 p-3.5 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="font-display text-sm font-bold text-[#f7f1e3]">
                        {myParty.name}
                      </span>
                      <button
                        type="button"
                        onClick={onLeaveParty}
                        className="px-2.5 py-1 rounded bg-red-950/80 border border-red-400/40 text-red-200 text-xs font-semibold cursor-pointer"
                      >
                        Leave Party
                      </button>
                    </div>
                    <p className="text-xs text-[#a6adbe]">Leader: {myParty.leaderName}</p>
                    <ul className="text-xs text-[#e2e8f0] space-y-1 pt-1">
                      {myParty.memberNames.map((m, idx) => (
                        <li key={idx}>· {m}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <form onSubmit={handleCreateParty} className="flex gap-2">
                    <input
                      type="text"
                      value={partyName}
                      onChange={(e) => setPartyName(e.target.value)}
                      placeholder="Party name (optional)"
                      aria-label="Party Name"
                      className="flex-1 px-2.5 py-1.5 rounded bg-[#0c0e15] border border-white/15 text-xs text-white"
                    />
                    <button
                      type="submit"
                      className="px-3.5 py-1.5 rounded bg-[#c9963b] hover:bg-[#dba74a] text-[#0c0e15] text-xs font-bold cursor-pointer whitespace-nowrap"
                    >
                      Form Party
                    </button>
                  </form>
                )}

                <div className="flex flex-col gap-2">
                  {parties
                    .filter((p) => p.id !== myParty?.id)
                    .map((p) => (
                      <div
                        key={p.id}
                        className="rounded bg-[#121520] border border-white/10 p-3 flex items-center justify-between"
                      >
                        <div>
                          <div className="text-xs font-semibold text-white">{p.name}</div>
                          <div className="text-[11px] text-[#9ca3af]">
                            {p.memberNames.length}/5 · Led by {p.leaderName}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onJoinParty(p.id)}
                          className="px-2.5 py-1 rounded bg-[#272116] border border-[#e0b254]/50 text-[#fef3c7] text-xs font-semibold cursor-pointer"
                        >
                          Join
                        </button>
                      </div>
                    ))}
                </div>
              </div>

              {/* Online Shard Roster */}
              <div className="flex flex-col gap-2.5">
                <h3 className="text-xs font-semibold text-[#e0b254] uppercase tracking-wider">
                  Online Players in Shard ({Math.max(1, remotePlayers.length)})
                </h3>
                <div className="flex flex-col gap-2">
                  {remotePlayers.map((peer) => (
                    <div
                      key={peer.playerId}
                      className="rounded bg-[#121520] border border-white/10 px-3 py-2 flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-semibold text-[#f7f1e3]">
                          {peer.guildTag ? `[${peer.guildTag}] ` : ''}
                          {peer.name}
                          {peer.playerId === profile.playerId ? ' (You)' : ''}
                        </span>
                        <div className="text-[11px] text-[#9ca3af]">
                          {CHARACTER_CLASSES[peer.classId]?.name} · {LINEAGES[peer.lineageId]?.name}
                        </div>
                      </div>
                      <span className="font-mono-num text-[#e0b254]">LV {peer.level}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'leaderboard' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-[#a6adbe]">
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">Hero</th>
                    <th className="py-2 pr-3">Class & Lineage</th>
                    <th className="py-2 pr-3">Realm</th>
                    <th className="py-2 pr-3 text-right">Kills</th>
                    <th className="py-2 text-right">Combat Power</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono-num">
                  {leaderboard.map((row, idx) => (
                    <tr
                      key={row.playerId}
                      className={row.playerId === profile.playerId ? 'bg-[#2a2317]/60' : ''}
                    >
                      <td className="py-2 pr-3 text-[#e0b254]">{idx + 1}</td>
                      <td className="py-2 pr-3 font-sans font-semibold text-[#f7f1e3]">
                        {row.guildTag ? `[${row.guildTag}] ` : ''}
                        {row.name}
                      </td>
                      <td className="py-2 pr-3 font-sans text-[#cbd5e1]">
                        LV {row.level} {CHARACTER_CLASSES[row.classId]?.name} ·{' '}
                        {LINEAGES[row.lineageId]?.name.split(' ')[0]}
                      </td>
                      <td className="py-2 pr-3 font-sans text-[#93c5fd]">
                        {CULTIVATION_REALMS[row.cultivationTier]?.name ?? 'Mortal'}
                      </td>
                      <td className="py-2 pr-3 text-right text-[#cbd5e1]">{row.kills}</td>
                      <td className="py-2 text-right font-bold text-[#e0b254]">
                        {row.combatPower}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
