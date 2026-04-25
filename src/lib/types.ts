export interface Agent {
  id: string;
  name: string;
  prompt: string;
  files: AgentFile[];
  lastUsed: number;
}

export interface AgentFile {
  name: string;
  type: string;
  dataURL: string;
}

export interface TogglePreferences {
  smartSearchEnabled: boolean;
  fastModeEnabled: boolean;
  smartSearch: boolean;
  fastMode: boolean;
}

export interface AppState {
  agents: Agent[];
  sessions: Record<string, string>; // sessionId -> agentId
  activeAgentId: string | null;
  togglePrefs?: TogglePreferences;
}