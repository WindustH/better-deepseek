import type { AppState } from './types';

const STORAGE_KEY = 'better_deepseek_state';

const DEFAULT_STATE: AppState = {
  agents: [],
  sessions: {},
  activeAgentId: null,
};

export async function loadState(): Promise<AppState> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as AppState) || DEFAULT_STATE;
}

export async function saveState(state: AppState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

export async function updateState(updater: (state: AppState) => AppState): Promise<AppState> {
  const state = await loadState();
  const newState = updater(state);
  await saveState(newState);
  return newState;
}

export function subscribeToState(callback: (state: AppState) => void) {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
    if (changes[STORAGE_KEY]) {
      callback((changes[STORAGE_KEY].newValue as AppState) || DEFAULT_STATE);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}