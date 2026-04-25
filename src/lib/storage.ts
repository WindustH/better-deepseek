import type { AppState } from './types';

const STORAGE_KEY = 'better_deepseek_state';

const DEFAULT_STATE: AppState = {
  agents: [],
  sessions: {},
  activeAgentId: null,
};

export async function loadState(): Promise<AppState> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as AppState) || DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

export async function saveState(state: AppState): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  } catch {
    // Extension context invalidated — ignore.
  }
}

let updateQueue: Promise<unknown> = Promise.resolve();

export async function updateState(updater: (state: AppState) => AppState): Promise<AppState> {
  const task = updateQueue.then(async () => {
    const state = await loadState();
    const newState = updater(state);
    await saveState(newState);
    return newState;
  });
  updateQueue = task.catch(() => {});
  try {
    return await task;
  } catch {
    return DEFAULT_STATE;
  }
}

export function subscribeToState(callback: (state: AppState) => void) {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
    try {
      if (changes[STORAGE_KEY]) {
        callback((changes[STORAGE_KEY].newValue as AppState) || DEFAULT_STATE);
      }
    } catch {
      // Extension context invalidated — listener from old content script.
      chrome.storage.onChanged.removeListener(listener);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    try {
      chrome.storage.onChanged.removeListener(listener);
    } catch {
      // Already removed or context invalidated.
    }
  };
}