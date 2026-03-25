// User Types
export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  createdAt?: string;
  updatedAt?: string;
}

// Session Types
export interface Session {
  id: string;
  title: string;
  parentID?: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
  share?: {
    url: string;
  };
}

export interface SessionStatus {
  status: 'idle' | 'running' | 'error';
  error?: string;
}

// Message Types
export interface Message {
  id: string;
  sessionID: string;
  role: 'user' | 'assistant';
  createdAt: string;
}

export interface MessagePart {
  type: 'text' | 'tool-invocation' | 'tool-result' | 'step-start';
  text?: string;
  toolInvocation?: {
    toolName: string;
    args: Record<string, unknown>;
    state: 'pending' | 'running' | 'completed' | 'error';
    result?: unknown;
  };
}

export interface MessageWithParts {
  info: Message;
  parts: MessagePart[];
}

// Project Types
export interface Project {
  id: string;
  name: string;
  path: string;
  icon?: string;
  instructions?: string;
  sandbox?: string;  // URL for sandbox/preview iframe
  createdAt: string;
  updatedAt?: string;
}

// Notification Types
export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  createdAt: string;
}

// Capability Types
export interface Capability {
  id: string;
  name: string;
  icon: string;
  description: string;
}

// Thought Process Types
export interface ThoughtStep {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  timestamp?: string;
}

// Browser Preview Types
export interface BrowserState {
  url: string;
  title: string;
  screenshot?: string;
  loading: boolean;
}

// Todo Types
export interface Todo {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

// Config Types
export interface Config {
  theme: 'light' | 'dark' | 'system';
  sidebarCollapsed: boolean;
  notifications: {
    enabled: boolean;
    sound: boolean;
  };
}

// Settings Types
export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  language: string;
  notifications: {
    enabled: boolean;
    sound: boolean;
    email: boolean;
  };
  privacy: {
    shareAnalytics: boolean;
  };
}

// Library Types
export interface LibraryItem {
  id: string;
  type: 'documents' | 'knowledge' | 'agent-skills';
  title: string;
  description: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  content?: string;
  // Knowledge specific
  documentCount?: number;
  // Agent Skill specific
  sourceType?: 'git' | 'zip' | 'markdown';
  sourceOrigin?: 'custom' | 'official';
  metadata?: Record<string, string>;
  // File attachment (for documents)
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
}

// Backend API Response Types (snake_case from proto)
export interface ApiLibraryItem {
  id: string;
  type: string;
  title: string;
  description: string;
  icon: string;
  created_at: string;
  updated_at: string;
  tags?: string[];
  content?: string;
  document_count?: number;
  source_type?: string;
  source_origin?: string;
  metadata?: Record<string, string>;
}

export interface ApiProject {
  id: string;
  name: string;
  path: string;
  icon?: string;
  instructions?: string;
  sandbox?: string;
  created_at: string;
  updated_at?: string;
}

export interface ApiNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
}

export interface ApiSession {
  id: string;
  title: string;
  parent_id?: string;
  project_id?: string;
  icon?: string;
  created_at: string;
  updated_at: string;
}

// API Response Types
export interface ApiResponse<T> {
  data: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ============================================
// Agent Capability Types (Config Data)
// ============================================

export interface HintAction {
  icon: string;
  label: string;
  url: string;
}

export interface AgentHint {
  id: string;
  title: string;
  actions?: HintAction[];
}

export interface AgentRef {
  id: string;
}

export interface AgentCapability {
  id: string;
  name: string;
  icon: string;
  enable?: boolean;
  hidden?: boolean;
  placeholder?: string;
  systemPrompt?: string;
  mcpServers?: AgentRef[];
  skills?: AgentRef[];
  hint?: AgentHint;
  children?: AgentCapability[];
  parentId?: string;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
  knowledgeBases?: AgentRef[];
  documents?: AgentRef[];
}

// API response type (snake_case)
export interface ApiAgentCapability {
  id: string;
  name: string;
  icon: string;
  enable?: boolean;
  hidden?: boolean;
  placeholder?: string;
  system_prompt?: string;
  mcp_servers?: { id: string }[];
  skills?: { id: string }[];
  hint?: {
    id: string;
    title: string;
    actions?: { icon: string; label: string; url: string }[];
  };
  children?: ApiAgentCapability[];
  parent_id?: string;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
  knowledge_bases?: { id: string }[];
  documents?: { id: string }[];
}

// ============================================
// Skill Config Types (Config Data)
// ============================================

export interface SkillConfig {
  id: string;
  name: string;
  description: string;
  official: boolean;
  enabled?: boolean;
  content?: string;
  sourceUrl?: string;
  tags?: string[];
  path?: string;           // Local file system path to skill files
  sourceType?: string;     // Source type: 'markdown', 'zip', 'git', 'official'
  createdAt?: string;
  updatedAt?: string;
}

// API response type (snake_case)
export interface ApiSkillConfig {
  id: string;
  name: string;
  description: string;
  official: boolean;
  enabled?: boolean;
  content?: string;
  source_url?: string;
  tags?: string[];
  path?: string;
  source_type?: string;
  created_at?: string;
  updated_at?: string;
}

// ============================================
// AI Provider Types (Config Data)
// ============================================

export interface ModelCapabilities {
  temperature: boolean;
  reasoning: boolean;
  attachment: boolean;
  toolcall: boolean;
}

export interface ModelCost {
  input: number;
  output: number;
}

export interface ModelLimit {
  context: number;
  output: number;
}

export interface AIModel {
  id: string;
  name: string;
  family?: string;
  status?: string;
  capabilities?: ModelCapabilities;
  cost?: ModelCost;
  limit?: ModelLimit;
  enabled?: boolean;
}

export interface AIProvider {
  id: string;
  name: string;
  icon: string;
  source?: string;
  env?: string[];
  connected: boolean;
  models: Record<string, AIModel>;
  createdAt?: string;
  updatedAt?: string;
}

// API response types (snake_case)
export interface ApiModel {
  id: string;
  name: string;
  family?: string;
  status?: string;
  capabilities?: {
    temperature: boolean;
    reasoning: boolean;
    attachment: boolean;
    toolcall: boolean;
  };
  cost?: {
    input: number;
    output: number;
  };
  limits?: {
    context: number;
    output: number;
  };
  enabled?: boolean;
}

export interface ApiProvider {
  id: string;
  name: string;
  icon: string;
  source?: string;
  env?: string[];
  connected: boolean;
  models?: ApiModel[];
  created_at?: string;
  updated_at?: string;
}

// ============================================
// Connector Types (unified: app, mcp_remote, mcp_local)
// ============================================

/** 0=unspecified, 1=app, 2=mcp_remote, 3=mcp_local */
export type ConnectorKind = 0 | 1 | 2 | 3;

export interface Connector {
  id: string;
  name: string;
  title: string;
  description: string;
  icon: string;
  kind: ConnectorKind;
  enabled: boolean;
  hidden: boolean;
  status: 'connected' | 'disconnected' | 'error' | '';
  // App-specific (kind=1)
  appType?: string;
  baseUrl?: string;
  accessToken?: string;
  username?: string;
  avatarUrl?: string;
  // MCP-specific (kind=2 remote, kind=3 local)
  url?: string;
  command?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>; // Custom HTTP headers (kind=2 remote only)
  createdAt?: string;
  updatedAt?: string;
}

// ============================================
// MCP Server Types (Config Data)
// ============================================

export interface MCPServer {
  id: string;
  name: string;
  title: string;
  description: string;
  type: 'remote' | 'local';
  enabled: boolean;
  status: 'connected' | 'disconnected' | 'error';
  hidden?: boolean;
  url?: string;
  command?: string;
  env?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

// API response type (snake_case)
export interface ApiMCPServer {
  id: string;
  name: string;
  title: string;
  description: string;
  type: string;
  enabled: boolean;
  status: string;
  hidden?: boolean;
  url?: string;
  command?: string;
  env?: Record<string, string>;
  created_at?: string;
  updated_at?: string;
}

// ============================================
// Bot Types
// ============================================

export interface Bot {
  id: string;
  name: string;
  platform: 'feishu' | 'matrix' | 'dingtalk';
  enabled: boolean;
  status: 'connected' | 'disconnected' | 'error';
  config?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}


