export interface Agent {
  id: string;
  name: string;
  prompt: string;
  files: AgentFile[];
  lastUsed: number;
  icon?: string;
}

export interface AgentFile {
  name: string;
  type: string;
  dataURL: string;
}

export interface AppState {
  agents: Agent[];
  sessions: Record<string, string>; // sessionId -> agentId
  activeAgentId: string | null;
}