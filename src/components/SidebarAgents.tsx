import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { loadState, subscribeToState, updateState } from '../lib/storage';
import { AgentManager } from '../lib/AgentManager';
import type { AppState, AgentFile, Agent } from '../lib/types';
import { Plus, ChevronDown, ChevronUp, Trash2, MoreHorizontal, Paperclip, Bot } from 'lucide-react';

const isZh = navigator.language.startsWith('zh');
const t = {
  agents: isZh ? '智能体' : 'AGENTS',
  createAgent: isZh ? '新建智能体' : 'Create Agent',
  editAgent: isZh ? '编辑智能体' : 'Edit Agent',
  name: isZh ? '名称 *' : 'Name *',
  prompt: isZh ? '系统提示词 (选填)' : 'Prompt (Optional)',
  attachFiles: isZh ? '附加文件 (选填)' : 'Attach Files (Optional)',
  selectFiles: isZh ? '选择文件' : 'Select Files',
  cancel: isZh ? '取消' : 'Cancel',
  saveChanges: isZh ? '保存修改' : 'Save Changes',
  backToMain: isZh ? '返回主对话' : 'Back to Main Chat',
  workspace: isZh ? '专属工作区' : 'Workspace',
  edit: isZh ? '编辑' : 'Edit',
  delete: isZh ? '删除' : 'Delete',
  confirmTitle: isZh ? '确认删除' : 'Confirm Delete',
  confirmMessage: isZh ? '确认要删除此智能体吗？' : 'Are you sure you want to delete this agent?',
  showMore: isZh ? '展开更多' : 'Show More',
  showLess: isZh ? '收起' : 'Show Less'
};

export const SidebarAgents: React.FC = () => {
  const [state, setState] = useState<AppState>({ agents: [], sessions: {}, activeAgentId: null });
  const [expanded, setExpanded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadState().then(setState);
    return subscribeToState(setState);
  }, []);

  useEffect(() => {
    const closeMenu = () => setMenuOpenFor(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    Array.from(e.target.files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setFiles(prev => [...prev, {
          name: file.name,
          type: file.type,
          dataURL: ev.target?.result as string
        }]);
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSaveAgent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const prompt = formData.get('prompt') as string;
    
    if (name) {
      await updateState(s => {
        if (editingAgent) {
          const idx = s.agents.findIndex(a => a.id === editingAgent.id);
          if (idx !== -1) {
            s.agents[idx] = { ...s.agents[idx], name, prompt, files };
          }
        } else {
          s.agents.push({
            id: Date.now().toString(),
            name,
            prompt,
            files: files,
            lastUsed: Date.now()
          });
        }
        return s;
      });
      setShowModal(false);
      setEditingAgent(null);
      setFiles([]);
    }
  };

  const openCreateModal = () => {
    setEditingAgent(null);
    setFiles([]);
    setShowModal(true);
  };

  const openEditModal = (agent: Agent) => {
    setEditingAgent(agent);
    setFiles(agent.files || []);
    setShowModal(true);
    setMenuOpenFor(null);
  };

  const confirmDelete = async () => {
    if (agentToDelete) {
      await updateState(s => {
        s.agents = s.agents.filter(a => a.id !== agentToDelete);
        if (s.activeAgentId === agentToDelete) s.activeAgentId = null;
        return s;
      });
      setAgentToDelete(null);
    }
  };

  const startAgent = (id: string) => {
    AgentManager.getInstance().startAgentChat(id);
  };

  const sortedAgents = [...state.agents].sort((a, b) => b.lastUsed - a.lastUsed);
  const visibleAgents = expanded ? sortedAgents : sortedAgents.slice(0, 3);
  
  const activeAgent = state.activeAgentId ? state.agents.find(a => a.id === state.activeAgentId) : null;

  const modal = showModal ? createPortal(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center transition-all" style={{ zIndex: 99999 }}>
      <div className="bg-white dark:bg-[#202126] p-6 rounded-2xl w-[32rem] border border-black/5 dark:border-white/5 shadow-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        <h2 className="text-[#1a1a1a] dark:text-[#ececec] text-[20px] font-semibold mb-6">{editingAgent ? t.editAgent : t.createAgent}</h2>
        <form onSubmit={handleSaveAgent} className="flex flex-col gap-5">
          <div>
            <label className="block text-[#1a1a1a]/70 dark:text-[#ececec]/70 text-[14px] mb-2 font-medium">{t.name}</label>
            <input required name="name" defaultValue={editingAgent?.name || ''} className="w-full bg-[#f4f4f4] dark:bg-[#2c2d33] border border-transparent rounded-xl px-4 py-2.5 text-[#1a1a1a] dark:text-[#ececec] outline-none focus:ring-2 focus:ring-[#4d6bfe]/50 transition-shadow text-[14px]" />
          </div>
          <div>
            <label className="block text-[#1a1a1a]/70 dark:text-[#ececec]/70 text-[14px] mb-2 font-medium">{t.prompt}</label>
            <textarea name="prompt" defaultValue={editingAgent?.prompt || ''} rows={5} className="w-full bg-[#f4f4f4] dark:bg-[#2c2d33] border border-transparent rounded-xl px-4 py-2.5 text-[#1a1a1a] dark:text-[#ececec] outline-none focus:ring-2 focus:ring-[#4d6bfe]/50 transition-shadow resize-y text-[14px]" />
          </div>
          <div>
            <label className="block text-[#1a1a1a]/70 dark:text-[#ececec]/70 text-[14px] mb-2 font-medium">{t.attachFiles}</label>
            
            <input type="file" multiple onChange={handleFileChange} className="hidden" ref={fileInputRef} />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center justify-center gap-2 px-4 py-2 bg-[#f4f4f4] dark:bg-[#2c2d33] text-[#1a1a1a]/80 dark:text-[#ececec]/80 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-[14px] w-max transition-colors font-medium">
              <Paperclip size={16} /> {t.selectFiles}
            </button>

            <div className="mt-4 flex flex-wrap gap-2">
              {files.map((f, i) => (
                <div key={i} className="text-[13px] bg-[#f4f4f4] dark:bg-[#2c2d33] pl-3 pr-1 py-1.5 rounded-lg flex items-center gap-2 text-[#1a1a1a] dark:text-[#ececec]">
                  <span className="truncate max-w-[180px] font-medium" title={f.name}>{f.name}</span>
                  <button type="button" onClick={() => setFiles(files.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/20 p-1.5 rounded-md transition-colors"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-black/5 dark:border-white/5">
            <button type="button" onClick={() => { setShowModal(false); setEditingAgent(null); }} className="px-5 py-2 text-[14px] font-medium text-[#1a1a1a]/70 dark:text-[#ececec]/70 hover:bg-[#f4f4f4] dark:hover:bg-[#2c2d33] rounded-xl transition-colors">{t.cancel}</button>
            <button type="submit" className="px-5 py-2 text-[14px] font-medium bg-[#4d6bfe] hover:bg-[#3d5bce] text-white rounded-xl transition-colors">{editingAgent ? t.saveChanges : t.createAgent}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  ) : null;

  const deleteModal = agentToDelete ? createPortal(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center transition-all" style={{ zIndex: 99999 }}>
      <div className="bg-white dark:bg-[#202126] p-7 rounded-2xl w-[24rem] border border-black/5 dark:border-white/5 shadow-2xl">
        <h2 className="text-[#1a1a1a] dark:text-[#ececec] text-[20px] font-semibold mb-3">{t.confirmTitle}</h2>
        <p className="text-[#1a1a1a]/70 dark:text-[#ececec]/70 text-[14px] mb-8">{t.confirmMessage}</p>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => setAgentToDelete(null)} className="px-5 py-2 text-[14px] font-medium text-[#1a1a1a]/70 dark:text-[#ececec]/70 hover:bg-[#f4f4f4] dark:hover:bg-[#2c2d33] rounded-xl transition-colors">{t.cancel}</button>
          <button type="button" onClick={confirmDelete} className="px-5 py-2 text-[14px] font-medium bg-red-500 hover:bg-red-600 text-white rounded-xl transition-colors">{t.delete}</button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="mt-2 mb-0 flex-shrink-0" style={{ zIndex: 100 }}>
      {state.activeAgentId ? (
        <div className="flex flex-col gap-[2px] px-2 mb-2">
           <div className="px-3 py-[6px] text-[13px] text-blue-600 dark:text-blue-400 font-medium cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors flex items-center gap-2" onClick={() => AgentManager.getInstance().deactivateAgent()}>
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
            <button onClick={openCreateModal} className="hover:text-black dark:hover:text-white transition-colors" title={t.createAgent}><Plus size={16} /></button>
          </div>
          
          <div className="flex flex-col gap-[2px] px-2 mb-2">
            {visibleAgents.map(agent => (
              <div 
                key={agent.id}
                onClick={() => startAgent(agent.id)}
                className={`group relative flex items-center justify-between px-3 py-[6px] rounded-lg cursor-pointer text-[14px] transition-colors text-black/80 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/5`}
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
                    className="absolute right-2 top-8 bg-white dark:bg-[#2c2c2c] border border-black/10 dark:border-white/10 rounded-lg shadow-xl z-50 overflow-hidden flex flex-col py-1 min-w-[120px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button onClick={(e) => { e.stopPropagation(); openEditModal(agent); }} className="px-4 py-2 text-sm text-left text-black/80 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">{t.edit}</button>
                    <button onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); setAgentToDelete(agent.id); }} className="px-4 py-2 text-sm text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">{t.delete}</button>
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

      {modal}
      {deleteModal}
    </div>
  );
};