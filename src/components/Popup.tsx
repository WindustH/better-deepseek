import React, { useEffect, useState, useRef } from 'react';
import { loadState, subscribeToState, updateState, exportData, importData } from '../lib/storage';
import { t } from '../lib/i18n';
import type { AppState, TogglePreferences } from '../lib/types';

const DEFAULT_PREFS: TogglePreferences = {
  smartSearchEnabled: true,
  fastModeEnabled: true,
  smartSearch: true,
  fastMode: true,
};

export const Popup: React.FC = () => {
  const [state, setState] = useState<AppState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadState().then(setState);
    return subscribeToState(setState);
  }, []);

  const prefs = state?.togglePrefs;

  const updateTogglePref = (key: keyof TogglePreferences, value: boolean) => {
    updateState(s => {
      if (!s.togglePrefs) s.togglePrefs = { ...DEFAULT_PREFS };
      s.togglePrefs[key] = value;
      return s;
    });
  };

  const handleExport = async () => {
    const json = await exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `better-deepseek-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (!confirm(t.importConfirm)) return;

    const text = await file.text();
    const ok = await importData(text);
    showToast(ok ? t.importSuccess : t.importFailed);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  if (!state) return null;

  return (
    <div className="w-[360px] min-h-[200px] bg-white dark:bg-[#1a1a1a] text-[#1a1a1a] dark:text-[#ececec]">
      <div className="px-5 py-4 border-b border-black/5 dark:border-white/5">
        <div className="text-[16px] font-semibold">Better DeepSeek</div>
      </div>

      {/* Settings */}
      <div className="px-5 py-4 border-b border-black/5 dark:border-white/5">
        <div className="text-[13px] font-medium text-black/50 dark:text-white/50 mb-3">{t.settings}</div>
        <div className="flex flex-col gap-3">
          <ToggleRow
            label={t.rememberSmartSearch}
            checked={prefs?.smartSearchEnabled ?? false}
            onChange={v => updateTogglePref('smartSearchEnabled', v)}
          />
          <ToggleRow
            label={t.rememberFastMode}
            checked={prefs?.fastModeEnabled ?? false}
            onChange={v => updateTogglePref('fastModeEnabled', v)}
          />
        </div>
      </div>

      {/* Data Management */}
      <div className="px-5 py-4">
        <div className="text-[13px] font-medium text-black/50 dark:text-white/50 mb-3">{t.dataManagement}</div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="flex-1 px-3 py-2 text-[13px] font-medium bg-[#f4f4f4] dark:bg-[#2c2d33] hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors"
          >
            {t.exportData}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 px-3 py-2 text-[13px] font-medium bg-[#f4f4f4] dark:bg-[#2c2d33] hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors"
          >
            {t.importData}
          </button>
          <input type="file" accept=".json" ref={fileInputRef} onChange={handleImport} className="hidden" />
        </div>
        <div className="mt-3 text-[12px] text-black/40 dark:text-white/40">
          {state.agents.length} {state.agents.length === 1 ? 'agent' : 'agents'}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-[#1a1a1a] dark:bg-white text-white dark:text-[#1a1a1a] text-[13px] rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
};

const ToggleRow: React.FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <div className="flex items-center justify-between">
    <span className="text-[14px]">{label}</span>
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-[22px] rounded-full transition-colors ${checked ? 'bg-[#4d6bfe]' : 'bg-[#d1d1d1] dark:bg-[#444]'}`}
    >
      <div
        className={`absolute top-[2px] w-[18px] h-[18px] bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-[21px]' : 'translate-x-[2px]'}`}
      />
    </button>
  </div>
);
