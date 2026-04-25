import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { loadState, subscribeToState, updateState } from '../lib/storage';
import { AgentManager } from '../lib/AgentManager';
import { AgentModal } from './AgentModal';
import type { AppState, Agent, AgentFile } from '../lib/types';
import { Plus, ChevronDown, ChevronUp, MoreHorizontal, Bot } from 'lucide-react';
import { t } from '../lib/i18n';

export const SidebarAgents: React.FC = () => {
  const [state, setState] = useState<AppState>({ agents: [], sessions: {}, activeAgentId: null });
  const [expanded, setExpanded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<string | null>(null);

  useEffect(() => {
    loadState().then(setState);
    return subscribeToState(setState);
  }, []);

  useEffect(() => {
    const closeMenu = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.agent-context-menu')) return;
      setMenuOpenFor(null);
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const sortedAgents = useMemo(
    () => [...state.agents].sort((a, b) => b.lastUsed - a.lastUsed),
    [state.agents]
  );

  const visibleAgents = useMemo(
    () => expanded ? sortedAgents : sortedAgents.slice(0, 3),
    [sortedAgents, expanded]
  );

  const activeAgent = useMemo(
    () => state.activeAgentId ? state.agents.find(a => a.id === state.activeAgentId) ?? null : null,
    [state.agents, state.activeAgentId]
  );

  const handleSaveAgent = async ({ name, prompt, files }: { name: string; prompt: string; files: AgentFile[] }) => {
    await updateState(s => {
      if (editingAgent) {
        const idx = s.agents.findIndex(a => a.id === editingAgent.id);
        if (idx !== -1) s.agents[idx] = { ...s.agents[idx], name, prompt, files };
      } else {
        s.agents.push({ id: Date.now().toString(), name, prompt, files, lastUsed: Date.now() });
      }
      return s;
    });
    setShowModal(false);
    setEditingAgent(null);
  };

  const confirmDelete = async () => {
    if (!agentToDelete) return;
    const id = agentToDelete;
    await updateState(s => {
      s.agents = s.agents.filter(a => a.id !== id);
      if (s.activeAgentId === id) s.activeAgentId = null;
      for (const [sid, aid] of Object.entries(s.sessions)) {
        if (aid === id) delete s.sessions[sid];
      }
      return s;
    });
    setAgentToDelete(null);
  };

  return (
    <div className="mt-2 mb-0 flex-shrink-0" style={{ zIndex: 100 }}>
      {state.activeAgentId ? (
        <div className="flex flex-col gap-[2px] px-2 mb-2">
          <div
            className="px-3 py-[6px] text-[13px] text-blue-600 dark:text-blue-400 font-medium cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors flex items-center gap-2"
            onClick={() => AgentManager.getInstance().deactivateAgent()}
          >
            <span className="text-lg leading-none">←</span> {t.backToMain}
          </div>
          <div className="flex items-center gap-3 px-3 py-[6px] mt-1 rounded-lg text-[14px] bg-[#e5e5e5] dark:bg-[#2c2c2c] text-black dark:text-white font-medium">
            <Bot size={16} className="opacity-70" />
            <span className="truncate flex-1">{activeAgent?.name} {t.workspace}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-4 py-1.5 text-xs text-black/50 dark:text-white/50 font-medium group">
            <span>{t.agents}</span>
            <button
              onClick={() => { setEditingAgent(null); setShowModal(true); }}
              className="hover:text-black dark:hover:text-white transition-colors"
              title={t.createAgent}
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="flex flex-col gap-[2px] px-2 mb-2">
            {visibleAgents.map(agent => (
              <div
                key={agent.id}
                onClick={() => AgentManager.getInstance().startAgentChat(agent.id)}
                className="group relative flex items-center justify-between px-3 py-[6px] rounded-lg cursor-pointer text-[14px] transition-colors text-black/80 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="truncate flex-1">{agent.name}</span>
                <div
                  className="opacity-0 group-hover:opacity-100 flex items-center p-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10"
                  onClick={(e) => { e.stopPropagation(); setMenuOpenFor(menuOpenFor === agent.id ? null : agent.id); }}
                >
                  <MoreHorizontal size={16} className="text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white" />
                </div>
                {menuOpenFor === agent.id && (
                  <div
                    className="agent-context-menu absolute right-2 top-8 bg-white dark:bg-[#2c2c2c] border border-black/10 dark:border-white/10 rounded-lg shadow-xl z-50 overflow-hidden flex flex-col py-1 min-w-[120px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); setEditingAgent(agent); setShowModal(true); }}
                      className="px-4 py-2 text-sm text-left text-black/80 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    >
                      {t.edit}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); setAgentToDelete(agent.id); }}
                      className="px-4 py-2 text-sm text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                    >
                      {t.delete}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {sortedAgents.length > 3 && (
              <div
                onClick={() => setExpanded(!expanded)}
                className="flex items-center justify-center gap-1 py-1.5 mt-1 text-[13px] font-medium text-black/50 dark:text-white/50 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors"
              >
                {expanded ? <><ChevronUp size={14} /> {t.showLess}</> : <><ChevronDown size={14} /> {t.showMore}</>}
              </div>
            )}
          </div>
        </>
      )}

      {showModal && (
        <AgentModal
          key={editingAgent?.id ?? 'create'}
          agent={editingAgent}
          onClose={() => { setShowModal(false); setEditingAgent(null); }}
          onSave={handleSaveAgent}
        />
      )}

      {agentToDelete && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center" style={{ zIndex: 99999 }}>
          <div className="bg-white dark:bg-[#202126] p-7 rounded-2xl w-[24rem] border border-black/5 dark:border-white/5 shadow-2xl">
            <h2 className="text-[#1a1a1a] dark:text-[#ececec] text-[20px] font-semibold mb-3">{t.confirmTitle}</h2>
            <p className="text-[#1a1a1a]/70 dark:text-[#ececec]/70 text-[14px] mb-8">{t.confirmMessage}</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setAgentToDelete(null)} className="px-5 py-2 text-[14px] font-medium text-[#1a1a1a]/70 dark:text-[#ececec]/70 hover:bg-[#f4f4f4] dark:hover:bg-[#2c2d33] rounded-xl transition-colors">{t.cancel}</button>
              <button onClick={confirmDelete} className="px-5 py-2 text-[14px] font-medium bg-red-500 hover:bg-red-600 text-white rounded-xl transition-colors">{t.delete}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
