import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip, Trash2 } from 'lucide-react';
import type { Agent, AgentFile } from '../lib/types';
import { t } from '../lib/i18n';

interface AgentModalProps {
  agent: Agent | null;
  onClose: () => void;
  onSave: (data: { name: string; prompt: string; files: AgentFile[] }) => void;
}

export const AgentModal: React.FC<AgentModalProps> = ({ agent, onClose, onSave }) => {
  const [files, setFiles] = useState<AgentFile[]>(agent?.files || []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    Array.from(e.target.files).forEach(file => {
      if (file.size > MAX_FILE_SIZE) {
        console.warn(`File "${file.name}" exceeds 10 MB limit, skipping`);
        return;
      }
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

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const prompt = formData.get('prompt') as string;
    if (name) onSave({ name, prompt, files });
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center" style={{ zIndex: 99999 }}>
      <div className="bg-white dark:bg-[#202126] p-6 rounded-2xl w-[32rem] border border-black/5 dark:border-white/5 shadow-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        <h2 className="text-[#1a1a1a] dark:text-[#ececec] text-[20px] font-semibold mb-6">
          {agent ? t.editAgent : t.createAgent}
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <label className="block text-[#1a1a1a]/70 dark:text-[#ececec]/70 text-[14px] mb-2 font-medium">{t.name}</label>
            <input required name="name" defaultValue={agent?.name || ''} className="w-full bg-[#f4f4f4] dark:bg-[#2c2d33] border border-transparent rounded-xl px-4 py-2.5 text-[#1a1a1a] dark:text-[#ececec] outline-none focus:ring-2 focus:ring-[#4d6bfe]/50 transition-shadow text-[14px]" />
          </div>
          <div>
            <label className="block text-[#1a1a1a]/70 dark:text-[#ececec]/70 text-[14px] mb-2 font-medium">{t.prompt}</label>
            <textarea name="prompt" defaultValue={agent?.prompt || ''} rows={5} className="w-full bg-[#f4f4f4] dark:bg-[#2c2d33] border border-transparent rounded-xl px-4 py-2.5 text-[#1a1a1a] dark:text-[#ececec] outline-none focus:ring-2 focus:ring-[#4d6bfe]/50 transition-shadow resize-y text-[14px]" />
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
                  <button type="button" onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/20 p-1.5 rounded-md transition-colors"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-black/5 dark:border-white/5">
            <button type="button" onClick={onClose} className="px-5 py-2 text-[14px] font-medium text-[#1a1a1a]/70 dark:text-[#ececec]/70 hover:bg-[#f4f4f4] dark:hover:bg-[#2c2d33] rounded-xl transition-colors">{t.cancel}</button>
            <button type="submit" className="px-5 py-2 text-[14px] font-medium bg-[#4d6bfe] hover:bg-[#3d5bce] text-white rounded-xl transition-colors">{agent ? t.saveChanges : t.createAgent}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
