// ============================================
// ConnectRPC Transport (shared)
// ============================================

import { createClient, ConnectError, Code } from '@connectrpc/connect';
import type { Interceptor } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';

// ── Unauthenticated handler (populated by auth.ts to avoid circular imports) ──
export let onUnauthenticated: (() => Promise<void>) | null = null;
export function setUnauthenticatedHandler(fn: () => Promise<void>) {
  onUnauthenticated = fn;
}

// Guest mode flag — set by auth.ts when backend has no OIDC provider
let _guestMode = false;
export function setGuestMode(v: boolean) { _guestMode = v; }

// Guard: ensure onUnauthenticated is called only once (multiple concurrent
// 401 responses must not trigger parallel startAuthFlow redirects).
let _redirecting = false;

/**
 * Auth interceptor: injects Bearer token from localStorage on every request.
 * Skipped in guest mode. On CodeUnauthenticated, clears session and re-initiates auth.
 */
const authInterceptor: Interceptor = (next) => async (req) => {
  if (!_guestMode) {
    try {
      const raw = localStorage.getItem('credentials');
      if (raw) {
        const creds = JSON.parse(raw);
        const token: string | undefined = creds?.id_token || creds?.access_token;
        if (token) {
          req.header.set('Authorization', `Bearer ${token}`);
        }
      }
    } catch { /* ignore parse errors */ }
  }

  try {
    return await next(req);
  } catch (err) {
    if (
      !_guestMode &&
      !_redirecting &&
      err instanceof ConnectError &&
      err.code === Code.Unauthenticated &&
      onUnauthenticated
    ) {
      _redirecting = true;
      await onUnauthenticated();
      return new Promise<never>(() => {}); // pending — page will navigate away
    }
    throw err;
  }
};

const _transport = createConnectTransport({
  baseUrl: '/',
  useBinaryFormat: true,
  interceptors: [authInterceptor],
});

// ============================================
// Generated service descriptors
// ============================================

import {
  ProjectService,
  SearchService,
  NotificationService,
  SettingsService,
  HealthService,
  AIService,
  ShareService,
  AgentService,
  ProviderService,
} from '@/gen/agentx/v1/agentx_pb';
import { LibraryService } from '@/gen/library/v1/library_pb';
import { SkillService } from '@/gen/skill/v1/skill_pb';
import { ConnectorService, ConnectorKind } from '@/gen/connector/v1/connector_pb';
export { ConnectorKind };
import { KnowledgeService } from '@/gen/knowledge/v1beta/knowledge_pb';
import { STTService } from '@/gen/stt/v1/stt_pb';
import { BotService } from '@/gen/bots/v1/bots_pb';
import { FileService } from '@/gen/file/v1/files_pb';
import { TerminalService } from '@/gen/a2a/v1/terminal_pb';
import { AgentManagerService } from '@/gen/agent/v1/agent_mgr_pb';
import { A2AService as LfA2AService } from '@/gen/lf/a2a/v1/a2a_pb';
import { A2AService } from '@/gen/agentx/v1/a2a_pb';
import { AuthService } from '@/gen/auth/v1/auth_pb';

// ConnectRPC clients — one per service
const _projectClient      = createClient(ProjectService,      _transport);
const _libraryClient      = createClient(LibraryService,      _transport);
const _searchClient       = createClient(SearchService,       _transport);
const _notifClient        = createClient(NotificationService, _transport);
const _settingsClient     = createClient(SettingsService,     _transport);
const _healthClient       = createClient(HealthService,       _transport); // eslint-disable-line @typescript-eslint/no-unused-vars
const _aiClient           = createClient(AIService,           _transport);
const _shareClient        = createClient(ShareService,        _transport);
const _agentClient        = createClient(AgentService,        _transport);
const _skillClient        = createClient(SkillService,        _transport);
const _providerClient     = createClient(ProviderService,     _transport);
const _connectorClient    = createClient(ConnectorService,    _transport);
export const _terminalClient = createClient(TerminalService, _transport);
export const _agentMgrClient = createClient(AgentManagerService, _transport);
// agentx.v1.A2AService — session CRUD, memory, compact (Go backend)
export const _a2aClient   = createClient(A2AService,          _transport);
// auth.v1.AuthService — OIDC auth (Authorize, Token, GetUserInfo, Logout)
export const authClient   = createClient(AuthService,          _transport);
// lf.a2a.v1.A2AService — standard A2A messaging (SendStreamingMessage, GetTask, …)
export const _lfA2aClient = createClient(LfA2AService,        _transport);
const _botsClient         = createClient(BotService,          _transport);
const _fileClient         = createClient(FileService,          _transport);
const _knowledgeClient    = createClient(KnowledgeService,     _transport);
const _sttClient          = createClient(STTService,           _transport);

// ============================================
// Helpers
// ============================================

/** Convert a protobuf Timestamp to an ISO string (returns undefined if nullish). */
function tsToString(ts?: { seconds: bigint; nanos: number } | null): string | undefined {
  if (!ts) return undefined;
  return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000)).toISOString();
}

// ============================================
// Config API  — ConnectRPC (agentx.v1.SettingsService)
// ============================================

export const configApi = {
  get: async (): Promise<Config> => {
    const res = await _settingsClient.getConfig({});
    // Map proto Config fields to frontend Config shape
    return {
      theme: (res.theme as Config['theme']) || 'system',
      sidebarCollapsed: false,
      notifications: { enabled: true, sound: true },
    };
  },
};

// ============================================
// Auth API  — raw fetch (no generated proto client)
// ============================================

export const authApi = {
  authorize: async (req: { redirectUri: string; codeChallenge: string; state: string }) => {
    const resp = await fetch('/auth.v1.AuthService/Authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' },
      body: JSON.stringify(req),
    });
    return resp.json();
  },
  token: async (req: { grantType: string; code?: string; redirectUri?: string; codeVerifier?: string; refreshToken?: string }) => {
    const resp = await fetch('/auth.v1.AuthService/Token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' },
      body: JSON.stringify(req),
    });
    return resp.json();
  },
  getUserInfo: async () => {
    const creds = JSON.parse(localStorage.getItem('credentials') || 'null');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' };
    if (creds?.access_token) headers['Authorization'] = `Bearer ${creds.access_token}`;
    const resp = await fetch('/auth.v1.AuthService/GetUserInfo', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    return resp.json();
  },
};

// ============================================
// Project API  — ConnectRPC
// ============================================

export const projectApi = {
  list: async (): Promise<{ data: Project[]; total: number }> => {
    const res = await _projectClient.listProjects({});
    return {
      data: res.data.map(p => ({
        id: p.id,
        name: p.name,
        path: p.path,
        icon: p.icon,
        instructions: p.instructions,
        createdAt: tsToString(p.createdAt) ?? '',
        updatedAt: tsToString(p.updatedAt),
      })),
      total: Number(res.total),
    };
  },

  get: async (id: string): Promise<Project> => {
    const p = await _projectClient.getProject({ id });
    return {
      id: p.id,
      name: p.name,
      path: p.path,
      icon: p.icon,
      instructions: p.instructions,
      createdAt: tsToString(p.createdAt) ?? '',
      updatedAt: tsToString(p.updatedAt),
    };
  },

  create: async (data: { name: string; instructions?: string; icon?: string }): Promise<Project> => {
    const p = await _projectClient.createProject({
      name: data.name,
      instructions: data.instructions ?? '',
      icon: data.icon ?? '',
    });
    return {
      id: p.id,
      name: p.name,
      path: p.path,
      icon: p.icon,
      instructions: p.instructions,
      createdAt: tsToString(p.createdAt) ?? '',
      updatedAt: tsToString(p.updatedAt),
    };
  },

  update: async (id: string, data: { name?: string; instructions?: string; icon?: string }): Promise<Project> => {
    const p = await _projectClient.updateProject({
      id,
      name: data.name ?? '',
      instructions: data.instructions ?? '',
      icon: data.icon ?? '',
    });
    return {
      id: p.id,
      name: p.name,
      path: p.path,
      icon: p.icon,
      instructions: p.instructions,
      createdAt: tsToString(p.createdAt) ?? '',
      updatedAt: tsToString(p.updatedAt),
    };
  },

  delete: async (id: string): Promise<boolean> => {
    const res = await _projectClient.deleteProject({ id });
    return res.success;
  },

  resolve: async (data: { lastProjectID?: string; name?: string; icon?: string }): Promise<{ project: Project; isNew: boolean }> => {
    const res = await _projectClient.resolveProject({
      lastProjectId: data.lastProjectID ?? '',
      name: data.name ?? '',
      icon: data.icon ?? '',
    });
    const p = res.project!;
    return {
      project: {
        id: p.id,
        name: p.name,
        path: p.path,
        icon: p.icon,
        instructions: p.instructions,
        createdAt: tsToString(p.createdAt) ?? '',
        updatedAt: tsToString(p.updatedAt),
      },
      isNew: res.isNew,
    };
  },

  getPath: async (id: string): Promise<{ path: string }> => {
    const res = await _projectClient.getProjectPath({ id });
    return { path: res.path };
  },

  getSessions: async (_id: string): Promise<{ data: Session[]; total: number }> => {
    // Project sessions are managed via A2A backend
    return { data: [], total: 0 };
  },
};

// ============================================
// Task API  — ConnectRPC
// ============================================

export interface TaskData {
  id: string;
  project_id: string;
  session_id?: string;
  title: string;
  icon: string;
  meta?: Record<string, string>;
  created_at: string;
  updated_at: string;
}

function protoToTask(t: { id: string; projectId: string; sessionId: string; title: string; icon: string; meta: Record<string, string>; createdAt?: { seconds: bigint; nanos: number } | null; updatedAt?: { seconds: bigint; nanos: number } | null }): TaskData {
  return {
    id: t.id,
    project_id: t.projectId,
    session_id: t.sessionId || undefined,
    title: t.title,
    icon: t.icon,
    meta: Object.keys(t.meta).length > 0 ? t.meta : undefined,
    created_at: tsToString(t.createdAt) ?? '',
    updated_at: tsToString(t.updatedAt) ?? '',
  };
}

export const taskApi = {
  list: async (projectId: string): Promise<{ data: TaskData[]; total: number }> => {
    const res = await _projectClient.getProjectTasks({ id: projectId });
    return {
      data: res.data.map(protoToTask),
      total: Number(res.total),
    };
  },

  get: async (projectId: string, id: string): Promise<TaskData> => {
    const t = await _projectClient.getTask({ projectId, id });
    return protoToTask(t);
  },

  create: async (projectId: string, data: { title?: string; icon?: string; meta?: Record<string, string> }): Promise<TaskData> => {
    const t = await _projectClient.createTask({
      projectId,
      title: data.title ?? '',
      icon: data.icon ?? '',
      meta: data.meta ?? {},
    });
    return protoToTask(t);
  },

  update: async (projectId: string, id: string, data: { title?: string; icon?: string; meta?: Record<string, string>; taskId?: string }): Promise<TaskData> => {
    const t = await _projectClient.updateTask({
      id,
      projectId,
      title: data.title ?? '',
      icon: data.icon ?? '',
      meta: data.meta ?? {},
      taskId: data.taskId ?? '',
    });
    return protoToTask(t);
  },

  delete: async (projectId: string, id: string): Promise<boolean> => {
    const res = await _projectClient.deleteTask({ projectId, id });
    return res.success;
  },
};

// ============================================
// Notifications API  — ConnectRPC
// ============================================

export const notificationsApi = {
  list: async (): Promise<{ data: Notification[]; total: number }> => {
    const res = await _notifClient.listNotifications({});
    return {
      data: res.data.map(n => ({
        id: n.id,
        title: n.title,
        message: n.message,
        type: n.type as Notification['type'],
        read: n.read,
        createdAt: tsToString(n.createdAt) ?? '',
      })),
      total: Number(res.total),
    };
  },

  markAsRead: async (id: string): Promise<Notification> => {
    const n = await _notifClient.markAsRead({ id });
    return {
      id: n.id,
      title: n.title,
      message: n.message,
      type: n.type as Notification['type'],
      read: n.read,
      createdAt: tsToString(n.createdAt) ?? '',
    };
  },

  markAllAsRead: async (): Promise<{ count: number }> => {
    const res = await _notifClient.markAllAsRead({});
    return { count: res.count };
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const res = await _notifClient.deleteNotification({ id });
    return { success: res.success };
  },
};

// ============================================
// User / Settings API  — ConnectRPC
// ============================================

export interface BackendSettings {
  theme: string;
  notifications: boolean;
  language: string;
  extra?: Record<string, unknown>;
}

export const userApi = {
  getCurrent: async (): Promise<User> => {
    try {
      // Try auth service userinfo first
      const creds = JSON.parse(localStorage.getItem('credentials') || 'null');
      if (creds?.access_token) {
        const resp = await fetch('/auth.v1.AuthService/GetUserInfo', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Connect-Protocol-Version': '1',
            'Authorization': `Bearer ${creds.access_token}`,
          },
          body: JSON.stringify({}),
        });
        if (resp.ok) {
          const data = await resp.json();
          return { id: data.sub || '', name: data.name || '', email: data.email || '', avatar: data.picture || '' };
        }
      }
    } catch { /* fall through to settings service */ }
    // Fallback to settings service
    const u = await _settingsClient.getUser({});
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      avatar: u.avatar,
    };
  },

  getSettings: async (): Promise<BackendSettings> => {
    const s = await _settingsClient.getSettings({});
    return { theme: s.theme, notifications: s.notifications, language: s.language, extra: {} };
  },

  updateSettings: async (data: Partial<BackendSettings>): Promise<BackendSettings> => {
    const s = await _settingsClient.updateSettings({
      theme: data.theme ?? '',
      notifications: data.notifications ?? false,
      language: data.language ?? '',
    });
    return { theme: s.theme, notifications: s.notifications, language: s.language, extra: {} };
  },
};

// ============================================
// Library API  — ConnectRPC
// ============================================

export const libraryApi = {
  list: async (params?: { type?: string }): Promise<{ data: LibraryItem[]; total: number }> => {
    const res = await _libraryClient.listLibraryItems({ type: params?.type ?? '' });
    return {
      data: res.data.map(i => ({
        id: i.id,
        type: i.type as LibraryItem['type'],
        title: i.title,
        description: i.description,
        icon: i.icon,
        tags: i.tags,
        content: i.content,
        documentCount: i.documentCount,
        sourceType: i.sourceType as LibraryItem['sourceType'],
        sourceOrigin: i.sourceOrigin as LibraryItem['sourceOrigin'],
        metadata: i.metadata,
        fileUrl: i.fileUrl || undefined,
        fileName: i.fileName || undefined,
        fileSize: i.fileSize ? Number(i.fileSize) : undefined,
        fileType: i.fileType || undefined,
        createdAt: tsToString(i.createdAt) ?? '',
        updatedAt: tsToString(i.updatedAt) ?? '',
      })),
      total: Number(res.total),
    };
  },

  get: async (id: string): Promise<LibraryItem> => {
    const i = await _libraryClient.getLibraryItem({ id });
    return {
      id: i.id,
      type: i.type as LibraryItem['type'],
      title: i.title,
      description: i.description,
      icon: i.icon,
      tags: i.tags,
      content: i.content,
      documentCount: i.documentCount,
      sourceType: i.sourceType as LibraryItem['sourceType'],
      sourceOrigin: i.sourceOrigin as LibraryItem['sourceOrigin'],
      metadata: i.metadata,
      fileUrl: i.fileUrl || undefined,
      fileName: i.fileName || undefined,
      fileSize: i.fileSize ? Number(i.fileSize) : undefined,
      fileType: i.fileType || undefined,
      createdAt: tsToString(i.createdAt) ?? '',
      updatedAt: tsToString(i.updatedAt) ?? '',
    };
  },

  create: async (data: Omit<LibraryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<LibraryItem> => {
    const i = await _libraryClient.createLibraryItem({
      type: data.type,
      title: data.title,
      description: data.description,
      icon: data.icon,
      tags: data.tags ?? [],
      content: data.content ?? '',
      metadata: data.metadata ?? {},
    });
    return {
      id: i.id,
      type: i.type as LibraryItem['type'],
      title: i.title,
      description: i.description,
      icon: i.icon,
      tags: i.tags,
      content: i.content,
      documentCount: i.documentCount,
      sourceType: i.sourceType as LibraryItem['sourceType'],
      sourceOrigin: i.sourceOrigin as LibraryItem['sourceOrigin'],
      metadata: i.metadata,
      fileUrl: i.fileUrl || undefined,
      fileName: i.fileName || undefined,
      fileSize: i.fileSize ? Number(i.fileSize) : undefined,
      fileType: i.fileType || undefined,
      createdAt: tsToString(i.createdAt) ?? '',
      updatedAt: tsToString(i.updatedAt) ?? '',
    };
  },

  createDocument: async (data: { title: string; description?: string; tags?: string[]; fileName?: string }): Promise<LibraryItem> => {
    return libraryApi.create({
      type: 'documents',
      title: data.title,
      description: data.description ?? '',
      icon: 'description',
      tags: data.tags,
    });
  },

  createKnowledge: async (data: { title: string; description?: string; tags?: string[]; documents: string[]; knowledgeBaseId?: string }): Promise<LibraryItem> => {
    const metadata: Record<string, string> = { documents: data.documents.join(',') };
    if (data.knowledgeBaseId) {
      metadata.knowledge_base_id = data.knowledgeBaseId;
    }
    return libraryApi.create({
      type: 'knowledge',
      title: data.title,
      description: data.description ?? '',
      icon: 'auto_stories',
      tags: data.tags,
      metadata,
    });
  },

  createAgentSkill: async (data: {
    title: string;
    description?: string;
    tags?: string[];
    sourceType: 'git' | 'zip' | 'markdown';
    gitUrl?: string;
    zipFileName?: string;
    markdownContent?: string;
  }): Promise<LibraryItem> => {
    const metadata: Record<string, string> = {};
    if (data.gitUrl) metadata.source_url = data.gitUrl;
    if (data.zipFileName) metadata.zip_file = data.zipFileName;
    if (data.markdownContent) metadata.content = data.markdownContent;
    return libraryApi.create({
      type: 'agent-skills',
      title: data.title,
      description: data.description ?? '',
      icon: 'psychology',
      tags: data.tags,
      sourceType: data.sourceType,
      sourceOrigin: 'custom',
      metadata,
    });
  },

  update: async (id: string, data: Partial<LibraryItem>): Promise<LibraryItem> => {
    const i = await _libraryClient.updateLibraryItem({
      id,
      title: data.title ?? '',
      description: data.description ?? '',
      icon: data.icon ?? '',
      tags: data.tags ?? [],
      content: data.content ?? '',
      metadata: data.metadata ?? {},
    });
    return {
      id: i.id,
      type: i.type as LibraryItem['type'],
      title: i.title,
      description: i.description,
      icon: i.icon,
      tags: i.tags,
      content: i.content,
      documentCount: i.documentCount,
      sourceType: i.sourceType as LibraryItem['sourceType'],
      sourceOrigin: i.sourceOrigin as LibraryItem['sourceOrigin'],
      metadata: i.metadata,
      fileUrl: i.fileUrl || undefined,
      fileName: i.fileName || undefined,
      fileSize: i.fileSize ? Number(i.fileSize) : undefined,
      fileType: i.fileType || undefined,
      createdAt: tsToString(i.createdAt) ?? '',
      updatedAt: tsToString(i.updatedAt) ?? '',
    };
  },

  updateDocument: async (id: string, data: { title?: string; description?: string; tags?: string[]; fileName?: string }): Promise<LibraryItem> =>
    libraryApi.update(id, { title: data.title, description: data.description, tags: data.tags }),

  updateKnowledge: async (id: string, data: { title?: string; description?: string; tags?: string[] }): Promise<LibraryItem> =>
    libraryApi.update(id, { title: data.title, description: data.description, tags: data.tags }),

  updateAgentSkill: async (id: string, data: {
    title?: string;
    description?: string;
    tags?: string[];
    sourceType?: string;
    gitUrl?: string;
    zipFileName?: string;
    markdownContent?: string;
  }): Promise<LibraryItem> => {
    const metadata: Record<string, string> = {};
    if (data.gitUrl) metadata.source_url = data.gitUrl;
    if (data.zipFileName) metadata.zip_file = data.zipFileName;
    if (data.markdownContent) metadata.content = data.markdownContent;
    return libraryApi.update(id, {
      title: data.title,
      description: data.description,
      tags: data.tags,
      sourceType: data.sourceType as LibraryItem['sourceType'],
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  },

  delete: async (id: string): Promise<boolean> => {
    const res = await _libraryClient.deleteLibraryItem({ id });
    return res.success;
  },

  // Upload a file attachment to a library document item
  uploadDocument: async (itemId: string, file: File): Promise<{ id: string; file_url: string; file_name: string; file_size: number; file_type: string }> => {
    const form = new FormData();
    form.append('id', itemId);
    form.append('file', file);

    const creds = JSON.parse(localStorage.getItem('credentials') || 'null');
    const headers: Record<string, string> = {};
    if (creds?.access_token) {
      headers['Authorization'] = `Bearer ${creds.access_token}`;
    }

    const res = await fetch('/library.v1.LibraryService/DocumentUpload', {
      method: 'POST',
      headers,
      body: form,
    });

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || `Upload failed: ${res.status}`);
    }

    return res.json();
  },

  // Download a file attachment from a library document item
  downloadDocument: async (itemId: string, filename?: string): Promise<void> => {
    const creds = JSON.parse(localStorage.getItem('credentials') || 'null');
    const headers: Record<string, string> = {};
    if (creds?.access_token) {
      headers['Authorization'] = `Bearer ${creds.access_token}`;
    }

    const res = await fetch(`/library.v1.LibraryService/DocumentDownload?id=${encodeURIComponent(itemId)}`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || `Download failed: ${res.status}`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'document';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

// ============================================
// Knowledge Base API  — ConnectRPC (v1beta KnowledgeService)
// ============================================

export interface KnowledgeBaseData {
  id: string;
  bedrockKbId: string;
  s3Bucket: string;
  s3Prefix: string;
  name: string;
  description: string;
  status: string;
  projectId: string;
  tenantId: string;
  documentCount: number;
  lastSyncedAt?: string;
  createdAt?: string;
}

export interface KnowledgeDocumentData {
  id: string;
  knowledgeBaseId: string;
  s3Key: string;
  filename: string;
  contentType: string;
  size: number;
  status: string;
  createdAt?: string;
}

export interface KnowledgeChunkData {
  id: string;
  content: string;
  score: number;
  sourceDocumentId: string;
  sourceFilename: string;
  metadata: Record<string, string>;
}

function protoToKB(kb: { id: string; bedrockKbId: string; s3Bucket: string; s3Prefix: string; name: string; description: string; status: string; projectId: string; tenantId: string; documentCount: number; lastSyncedAt?: { seconds: bigint; nanos: number } | null; createdAt?: { seconds: bigint; nanos: number } | null }): KnowledgeBaseData {
  return {
    id: kb.id,
    bedrockKbId: kb.bedrockKbId,
    s3Bucket: kb.s3Bucket,
    s3Prefix: kb.s3Prefix,
    name: kb.name,
    description: kb.description,
    status: kb.status,
    projectId: kb.projectId,
    tenantId: kb.tenantId,
    documentCount: kb.documentCount,
    lastSyncedAt: tsToString(kb.lastSyncedAt),
    createdAt: tsToString(kb.createdAt),
  };
}

function protoToDoc(doc: { id: string; knowledgeBaseId: string; s3Key: string; filename: string; contentType: string; size: bigint; status: string; createdAt?: { seconds: bigint; nanos: number } | null }): KnowledgeDocumentData {
  return {
    id: doc.id,
    knowledgeBaseId: doc.knowledgeBaseId,
    s3Key: doc.s3Key,
    filename: doc.filename,
    contentType: doc.contentType,
    size: Number(doc.size),
    status: doc.status,
    createdAt: tsToString(doc.createdAt),
  };
}

export const knowledgeApi = {
  create: async (data: { name: string; description?: string; projectId?: string; embeddingModel?: string; bedrockKbId?: string; dataSourceId?: string }): Promise<KnowledgeBaseData> => {
    const kb = await _knowledgeClient.createKnowledgeBase({
      name: data.name,
      description: data.description ?? '',
      projectId: data.projectId ?? '',
      embeddingModel: data.embeddingModel ?? '',
      bedrockKbId: data.bedrockKbId ?? '',
      dataSourceId: data.dataSourceId ?? '',
    });
    return protoToKB(kb);
  },

  get: async (id: string): Promise<KnowledgeBaseData> => {
    const kb = await _knowledgeClient.getKnowledgeBase({ id });
    return protoToKB(kb);
  },

  list: async (params?: { projectId?: string; pageIndex?: number; pageSize?: number }): Promise<{ data: KnowledgeBaseData[]; total: number }> => {
    const res = await _knowledgeClient.listKnowledgeBases({
      projectId: params?.projectId ?? '',
      pageIndex: params?.pageIndex ?? 0,
      pageSize: params?.pageSize ?? 50,
    });
    return {
      data: res.data.map(protoToKB),
      total: Number(res.total),
    };
  },

  delete: async (id: string): Promise<boolean> => {
    const res = await _knowledgeClient.deleteKnowledgeBase({ id });
    return res.success;
  },

  // Document management
  addDocument: async (knowledgeBaseId: string, file: { filename: string; content: Uint8Array; contentType: string }): Promise<{ document: KnowledgeDocumentData; ingestionJobId: string }> => {
    const res = await _knowledgeClient.addDocument({
      knowledgeBaseId,
      filename: file.filename,
      content: file.content,
      contentType: file.contentType,
    });
    return {
      document: res.document ? protoToDoc(res.document) : { id: '', knowledgeBaseId, s3Key: '', filename: file.filename, contentType: file.contentType, size: 0, status: 'pending' },
      ingestionJobId: res.ingestionJobId,
    };
  },

  deleteDocument: async (knowledgeBaseId: string, documentId: string): Promise<boolean> => {
    const res = await _knowledgeClient.deleteDocument({ knowledgeBaseId, documentId });
    return res.success;
  },

  listDocuments: async (knowledgeBaseId: string, params?: { pageIndex?: number; pageSize?: number }): Promise<{ data: KnowledgeDocumentData[]; total: number }> => {
    const res = await _knowledgeClient.listDocuments({
      knowledgeBaseId,
      pageIndex: params?.pageIndex ?? 0,
      pageSize: params?.pageSize ?? 50,
    });
    return {
      data: res.data.map(protoToDoc),
      total: Number(res.total),
    };
  },

  // Presigned upload URL (for large files)
  getUploadURL: async (knowledgeBaseId: string, filename: string, contentType: string): Promise<{ uploadUrl: string; s3Key: string; expiresInSeconds: number }> => {
    const res = await _knowledgeClient.getDocumentUploadURL({
      knowledgeBaseId,
      filename,
      contentType,
    });
    return {
      uploadUrl: res.uploadUrl,
      s3Key: res.s3Key,
      expiresInSeconds: res.expiresInSeconds,
    };
  },

  // Sync (re-ingestion)
  syncKB: async (id: string): Promise<{ ingestionJobId: string; status: string }> => {
    const res = await _knowledgeClient.syncKnowledgeBase({ id });
    return { ingestionJobId: res.ingestionJobId, status: res.status };
  },

  // Ingestion job status
  getIngestionStatus: async (knowledgeBaseId: string, ingestionJobId: string): Promise<{ status: string; knowledgeBaseId: string; ingestionJobId: string }> => {
    const res = await _knowledgeClient.getIngestionJobStatus({ knowledgeBaseId, ingestionJobId });
    return {
      status: res.status,
      knowledgeBaseId: res.knowledgeBaseId,
      ingestionJobId: res.ingestionJobId,
    };
  },

  // Retrieve — semantic search returning raw knowledge chunks with scores
  retrieve: async (knowledgeBaseId: string, query: string, options?: { topK?: number; minScore?: number }): Promise<{ chunks: KnowledgeChunkData[]; totalRetrieved: number }> => {
    const res = await _knowledgeClient.retrieve({
      knowledgeBaseId,
      query,
      topK: options?.topK ?? 5,
      minScore: options?.minScore ?? 0,
    });
    return {
      chunks: res.chunks.map(c => ({
        id: c.id,
        content: c.content,
        score: c.score,
        sourceDocumentId: c.sourceDocumentId,
        sourceFilename: c.sourceFilename,
        metadata: Object.fromEntries(Object.entries(c.metadata)),
      })),
      totalRetrieved: res.totalRetrieved ?? res.chunks.length,
    };
  },

  // RetrieveAndGenerate — RAG: retrieve knowledge chunks + generate an LLM answer with citations
  retrieveAndGenerate: async (knowledgeBaseId: string, query: string, options?: { modelId?: string; topK?: number; sessionId?: string }): Promise<{ answer: string; citations: KnowledgeChunkData[]; sessionId: string }> => {
    const res = await _knowledgeClient.retrieveAndGenerate({
      knowledgeBaseId,
      query,
      modelId: options?.modelId ?? '',
      topK: options?.topK ?? 5,
    });
    return {
      answer: res.answer,
      citations: res.citations.map(c => ({
        id: c.id,
        content: c.content,
        score: c.score,
        sourceDocumentId: c.sourceDocumentId,
        sourceFilename: c.sourceFilename,
        metadata: Object.fromEntries(Object.entries(c.metadata)),
      })),
      sessionId: res.sessionId,
    };
  },
};

// ============================================
// Search API  — ConnectRPC
// ============================================

export const searchApi = {
  search: async (query: string, options?: { type?: string }): Promise<SearchResults> => {
    const res = await _searchClient.search({ q: query, type: options?.type ?? '', limit: 20 });
    const toResult = (r: { id: string; type: string; title: string; subtitle: string; icon: string }) => ({
      id: r.id, type: r.type, title: r.title, subtitle: r.subtitle, icon: r.icon,
    });
    return {
      sessions: [],
      projects: res.projects.map(toResult),
      library: res.library.map(toResult),
    };
  },
};

// ============================================
// Agent Capabilities API  — ConnectRPC
// ============================================

export const agentCapabilitiesApi = {
  list: async (params?: { includeHidden?: boolean; includeDisabled?: boolean }): Promise<{
    data: AgentCapability[];
    total: number;
    maxVisiblePrimary: number;
  }> => {
    const res = await _agentClient.listAgents({
      includeHidden: params?.includeHidden ?? false,
      includeDisabled: params?.includeDisabled ?? false,
    });

    const mapAgent = (a: typeof res.data[0]): AgentCapability => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      enable: a.enable,
      hidden: a.hidden,
      placeholder: a.placeholder,
      systemPrompt: a.systemPrompt,
      mcpServers: a.mcpServers?.map(r => ({ id: r.id })),
      skills: a.skills?.map(r => ({ id: r.id })),
      hint: a.hint ? {
        id: a.hint.id,
        title: a.hint.title,
        actions: a.hint.actions?.map(ac => ({ icon: ac.icon, label: ac.label, url: ac.url })),
      } : undefined,
      children: a.children?.map(mapAgent),
      sortOrder: a.sortOrder,
      createdAt: tsToString(a.createdAt),
      updatedAt: tsToString(a.updatedAt),
      knowledgeBases: a.knowledgeBases?.map(r => ({ id: r.id })),
      documents: a.documents?.map(r => ({ id: r.id })),
    });

    return {
      data: res.data.map(mapAgent),
      total: Number(res.total),
      maxVisiblePrimary: res.maxVisiblePrimary || 4,
    };
  },

  get: async (id: string): Promise<AgentCapability> => {
    const a = await _agentClient.getAgent({ id });
    return {
      id: a.id, name: a.name, icon: a.icon,
      enable: a.enable, hidden: a.hidden,
      placeholder: a.placeholder, systemPrompt: a.systemPrompt,
      mcpServers: a.mcpServers?.map(r => ({ id: r.id })),
      skills: a.skills?.map(r => ({ id: r.id })),
      hint: a.hint ? { id: a.hint.id, title: a.hint.title, actions: a.hint.actions } : undefined,
      children: a.children?.map(c => ({ id: c.id, name: c.name, icon: c.icon })),
      sortOrder: a.sortOrder,
      createdAt: tsToString(a.createdAt),
      updatedAt: tsToString(a.updatedAt),
      knowledgeBases: a.knowledgeBases?.map(r => ({ id: r.id })),
      documents: a.documents?.map(r => ({ id: r.id })),
    };
  },

  create: async (data: Omit<AgentCapability, 'id' | 'createdAt' | 'updatedAt' | 'children'> & { parentId?: string }): Promise<AgentCapability> => {
    const a = await _agentClient.createAgent({
      name: data.name,
      icon: data.icon,
      enable: data.enable ?? false,
      hidden: data.hidden ?? false,
      placeholder: data.placeholder ?? '',
      systemPrompt: data.systemPrompt ?? '',
      mcpServers: data.mcpServers?.map(r => ({ id: r.id })) ?? [],
      skills: data.skills?.map(r => ({ id: r.id })) ?? [],
      hint: data.hint ?? undefined,
      taskId: data.parentId ?? '',  // task_id is used as parent_id for sub-agents
      sortOrder: data.sortOrder ?? 0,
      knowledgeBases: data.knowledgeBases?.map(r => ({ id: r.id })) ?? [],
      documents: data.documents?.map(r => ({ id: r.id })) ?? [],
    });
    return {
      id: a.id, name: a.name, icon: a.icon,
      enable: a.enable, hidden: a.hidden,
      placeholder: a.placeholder, systemPrompt: a.systemPrompt,
      mcpServers: a.mcpServers?.map(r => ({ id: r.id })),
      skills: a.skills?.map(r => ({ id: r.id })),
      sortOrder: a.sortOrder,
      knowledgeBases: a.knowledgeBases?.map(r => ({ id: r.id })),
      documents: a.documents?.map(r => ({ id: r.id })),
    };
  },

  update: async (id: string, data: Partial<AgentCapability>): Promise<AgentCapability> => {
    const a = await _agentClient.updateAgent({
      id,
      name: data.name ?? '',
      icon: data.icon ?? '',
      enable: data.enable,
      hidden: data.hidden,
      placeholder: data.placeholder ?? '',
      systemPrompt: data.systemPrompt ?? '',
      mcpServers: data.mcpServers?.map(r => ({ id: r.id })) ?? [],
      skills: data.skills?.map(r => ({ id: r.id })) ?? [],
      hint: data.hint ?? undefined,
      sortOrder: data.sortOrder ?? 0,
      knowledgeBases: data.knowledgeBases?.map(r => ({ id: r.id })) ?? [],
      documents: data.documents?.map(r => ({ id: r.id })) ?? [],
    });
    return {
      id: a.id, name: a.name, icon: a.icon,
      enable: a.enable, hidden: a.hidden,
      placeholder: a.placeholder, systemPrompt: a.systemPrompt,
      mcpServers: a.mcpServers?.map(r => ({ id: r.id })),
      skills: a.skills?.map(r => ({ id: r.id })),
      sortOrder: a.sortOrder,
      knowledgeBases: a.knowledgeBases?.map(r => ({ id: r.id })),
      documents: a.documents?.map(r => ({ id: r.id })),
    };
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const res = await _agentClient.deleteAgent({ id });
    return { success: res.success };
  },

  connectAgent: async (scene: 'dispatcher' | 'task' | 'skill_creator', projectId?: string): Promise<{
    host: string; basePath: string; tenantId: string; scene: string; isNew: boolean; agentId: string;
  }> => {
    const sceneMap = { dispatcher: 0, task: 1, skill_creator: 2 };
    const res = await _agentClient.connectAgent({
      scene: sceneMap[scene],
      projectId: projectId ?? '',
    });
    return {
      host: res.host,
      basePath: res.basePath,
      tenantId: res.tenantId,
      scene: ['dispatcher', 'task', 'skill_creator'][res.scene] ?? 'dispatcher',
      isNew: res.isNew,
      agentId: res.agentId,
    };
  },
};

// ============================================
// Terminal API — ConnectRPC (a2a.v1.TerminalService)
// ============================================

export const terminalApi = {
  create: async (agentId: string, opts?: { title?: string; rows?: number; cols?: number; projectId?: string; cwd?: string }) => {
    const res = await _terminalClient.createTerminal({
      agentId,
      title: opts?.title ?? 'Terminal',
      rows: opts?.rows ?? 24,
      cols: opts?.cols ?? 80,
      projectId: opts?.projectId ?? '',
      workingDirectory: opts?.cwd ?? '',
    });
    return { id: res.id, title: res.title, rows: res.rows, cols: res.cols };
  },

  list: async (agentId?: string, projectId?: string) => {
    const res = await _terminalClient.listTerminals({ agentId: agentId ?? '', projectId: projectId ?? '' });
    return res.terminals.map(t => ({ id: t.id, title: t.title, rows: t.rows, cols: t.cols }));
  },

  resize: async (id: string, rows: number, cols: number) => {
    await _terminalClient.resizeTerminal({ id, rows, cols });
  },

  close: async (id: string) => {
    await _terminalClient.closeTerminal({ id });
  },

  streamOutput: (terminalId: string) => {
    return _terminalClient.streamTerminalOutput({ terminalId });
  },

  writeInput: async (terminalId: string, data: Uint8Array) => {
    await _terminalClient.writeTerminalInput({
      terminalId,
      payload: { case: 'data', value: data },
    });
  },

  sendResize: async (terminalId: string, rows: number, cols: number) => {
    await _terminalClient.writeTerminalInput({
      terminalId,
      payload: { case: 'resize', value: { rows, cols } },
    });
  },
};

// ============================================
// Skills Config API  — ConnectRPC + custom HTTP for upload/import
// ============================================

export const skillsConfigApi = {
  list: async (params?: { officialOnly?: boolean; enabledOnly?: boolean }): Promise<{ data: SkillConfig[]; total: number }> => {
    const res = await _skillClient.listSkills({
      officialOnly: params?.officialOnly ?? false,
      enabledOnly: params?.enabledOnly ?? false,
    });
    return {
      data: res.data.map(s => ({
        id: s.id, name: s.name, description: s.description,
        official: s.official, enabled: s.enabled,
        content: s.content, sourceUrl: s.sourceUrl,
        tags: s.tags, path: s.path, sourceType: s.sourceType,
        createdAt: tsToString(s.createdAt),
        updatedAt: tsToString(s.updatedAt),
      })),
      total: Number(res.total),
    };
  },

  get: async (id: string): Promise<SkillConfig> => {
    const s = await _skillClient.getSkill({ id });
    return {
      id: s.id, name: s.name, description: s.description,
      official: s.official, enabled: s.enabled,
      content: s.content, sourceUrl: s.sourceUrl,
      tags: s.tags, path: s.path, sourceType: s.sourceType,
      createdAt: tsToString(s.createdAt),
      updatedAt: tsToString(s.updatedAt),
    };
  },

  create: async (data: Omit<SkillConfig, 'createdAt' | 'updatedAt'>): Promise<SkillConfig> => {
    const s = await _skillClient.createSkill({
      id: data.id,
      name: data.name,
      description: data.description,
      official: data.official,
      enabled: data.enabled ?? false,
      content: data.content ?? '',
      sourceUrl: data.sourceUrl ?? '',
      tags: data.tags ?? [],
      path: data.path ?? '',
      sourceType: data.sourceType ?? '',
    });
    return {
      id: s.id, name: s.name, description: s.description,
      official: s.official, enabled: s.enabled,
      content: s.content, sourceUrl: s.sourceUrl,
      tags: s.tags, path: s.path, sourceType: s.sourceType,
    };
  },

  update: async (id: string, data: Partial<SkillConfig>): Promise<SkillConfig> => {
    const s = await _skillClient.updateSkill({
      id,
      name: data.name ?? '',
      description: data.description ?? '',
      enabled: data.enabled,
      content: data.content ?? '',
      sourceUrl: data.sourceUrl ?? '',
      tags: data.tags ?? [],
      path: data.path ?? '',
      sourceType: data.sourceType ?? '',
    });
    return {
      id: s.id, name: s.name, description: s.description,
      official: s.official, enabled: s.enabled,
      content: s.content, sourceUrl: s.sourceUrl,
      tags: s.tags, path: s.path, sourceType: s.sourceType,
    };
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const res = await _skillClient.deleteSkill({ id });
    return { success: res.success };
  },

  // Download a skill as a .zip archive
  download: async (id: string, filename?: string): Promise<void> => {
    const creds = JSON.parse(localStorage.getItem('credentials') || 'null');
    const headers: Record<string, string> = {};
    if (creds?.access_token) {
      headers['Authorization'] = `Bearer ${creds.access_token}`;
    }

    const res = await fetch(`/skill.v1.SkillService/SkillDownload?id=${encodeURIComponent(id)}`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || `Download failed: ${res.status}`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `${id}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // Upload a skill ZIP / .skill / .md file via multipart form POST
  upload: async (file: File): Promise<SkillConfig> => {
    const form = new FormData();
    form.append('file', file);

    const creds = JSON.parse(localStorage.getItem('credentials') || 'null');
    const headers: Record<string, string> = {};
    if (creds?.access_token) {
      headers['Authorization'] = `Bearer ${creds.access_token}`;
    }

    const res = await fetch('/skill.v1.SkillService/SkillUpload', {
      method: 'POST',
      headers,
      body: form,
    });

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || `Upload failed: ${res.status}`);
    }

    const data = await res.json();
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      sourceType: data.source_type,
      path: data.path,
      official: false,
      enabled: true,
      content: '',
      sourceUrl: '',
      tags: [],
    };
  },

  // Import a skill from a public GitHub repository (cloned server-side)
  importFromGitHub: async (url: string): Promise<SkillConfig> => {
    const repoName = url.replace(/\.git$/, '').split('/').pop() ?? 'imported-skill';
    const s = await _skillClient.createSkill({
      name: repoName,
      description: '',
      sourceUrl: url,
      sourceType: 'git',
      enabled: true,
      tags: [],
      content: '',
      path: '',
    });
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      official: s.official,
      enabled: s.enabled,
      content: s.content,
      sourceUrl: s.sourceUrl,
      tags: s.tags,
      path: s.path,
      sourceType: s.sourceType,
      createdAt: tsToString(s.createdAt),
      updatedAt: tsToString(s.updatedAt),
    };
  },

  // Refresh a git-sourced skill by re-pulling from the remote repository.
  // Triggers the backend to re-clone, re-parse SKILL.md, and update the skill.
  refreshFromGit: async (id: string, sourceUrl: string): Promise<SkillConfig> => {
    const s = await _skillClient.updateSkill({
      id,
      name: '',
      description: '',
      content: '',
      sourceUrl,
      sourceType: 'git',
      tags: [],
      path: '',
    });
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      official: s.official,
      enabled: s.enabled,
      content: s.content,
      sourceUrl: s.sourceUrl,
      tags: s.tags,
      path: s.path,
      sourceType: s.sourceType,
    };
  },

  getOfficial: async (): Promise<{ data: OfficialSkill[]; total: number }> => {
    return { data: [], total: 0 };
  },

  installOfficial: async (_id: string): Promise<SkillConfig> => {
    throw new Error('Official skill install not available');
  },
};

export interface OfficialSkill {
  id: string;
  name: string;
  description: string;
  source_url: string;
  tags: string[];
}

// ============================================
// Providers API  — ConnectRPC
// ============================================

export const providersApi = {
  list: async (params?: { connectedOnly?: boolean }): Promise<{ data: AIProvider[]; total: number }> => {
    const res = await _providerClient.listProviders({ connectedOnly: params?.connectedOnly ?? false });
    return {
      data: res.data.map(p => ({
        id: p.id, name: p.name, icon: p.icon,
        source: p.source, env: p.env,
        connected: p.connected,
        models: Object.fromEntries(p.models.map(m => [m.id, {
          id: m.id, name: m.name, family: m.family, status: m.status,
          capabilities: m.capabilities,
          cost: m.cost,
          limit: m.limits,
          enabled: m.enabled,
        }])),
        createdAt: tsToString(p.createdAt),
        updatedAt: tsToString(p.updatedAt),
      })),
      total: Number(res.total),
    };
  },

  get: async (id: string): Promise<AIProvider> => {
    const p = await _providerClient.getProvider({ id });
    return {
      id: p.id, name: p.name, icon: p.icon,
      source: p.source, env: p.env,
      connected: p.connected,
      models: Object.fromEntries(p.models.map(m => [m.id, {
        id: m.id, name: m.name, family: m.family, status: m.status,
        capabilities: m.capabilities,
        cost: m.cost,
        limit: m.limits,
        enabled: m.enabled,
      }])),
      createdAt: tsToString(p.createdAt),
      updatedAt: tsToString(p.updatedAt),
    };
  },

  create: async (data: Omit<AIProvider, 'createdAt' | 'updatedAt'>): Promise<AIProvider> => {
    const p = await _providerClient.createProvider({
      id: data.id,
      name: data.name,
      icon: data.icon,
      source: data.source ?? '',
      env: data.env ?? [],
      connected: data.connected,
      models: data.models ? Object.values(data.models).map(m => ({
        id: m.id, name: m.name, family: m.family ?? '', status: m.status ?? '',
        capabilities: m.capabilities,
        cost: m.cost,
        limits: m.limit,
        enabled: m.enabled,
      })) : [],
    });
    return {
      id: p.id, name: p.name, icon: p.icon,
      source: p.source, env: p.env, connected: p.connected,
      models: Object.fromEntries(p.models.map(m => [m.id, {
        id: m.id, name: m.name, family: m.family, status: m.status,
        capabilities: m.capabilities, cost: m.cost, limit: m.limits, enabled: m.enabled,
      }])),
    };
  },

  update: async (id: string, data: Partial<AIProvider>): Promise<AIProvider> => {
    const p = await _providerClient.updateProvider({
      id,
      name: data.name ?? '',
      icon: data.icon ?? '',
      source: data.source ?? '',
      env: data.env ?? [],
      connected: data.connected,
      models: data.models ? Object.values(data.models).map(m => ({
        id: m.id, name: m.name, family: m.family ?? '', status: m.status ?? '',
        capabilities: m.capabilities,
        cost: m.cost,
        limits: m.limit,
        enabled: m.enabled,
      })) : [],
    });
    return {
      id: p.id, name: p.name, icon: p.icon,
      source: p.source, env: p.env, connected: p.connected,
      models: Object.fromEntries(p.models.map(m => [m.id, {
        id: m.id, name: m.name, family: m.family, status: m.status,
        capabilities: m.capabilities, cost: m.cost, limit: m.limits, enabled: m.enabled,
      }])),
    };
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const res = await _providerClient.deleteProvider({ id });
    return { success: res.success };
  },
};

// ============================================
// Connectors API  — ConnectRPC (unified: app, mcp_remote, mcp_local)
// ============================================

function protoToConnector(s: {
  id: string; name: string; title: string; description: string; icon: string;
  kind: import('@/gen/connector/v1/connector_pb').ConnectorKind;
  enabled: boolean; hidden: boolean; status: string;
  appType: string; baseUrl: string; accessToken: string; username: string; avatarUrl: string;
  url: string; command: string; env: { [key: string]: string }; headers: { [key: string]: string };
  createdAt?: { seconds: bigint; nanos: number } | null;
  updatedAt?: { seconds: bigint; nanos: number } | null;
}): Connector {
  return {
    id: s.id, name: s.name, title: s.title, description: s.description, icon: s.icon,
    kind: s.kind as Connector['kind'],
    enabled: s.enabled, hidden: s.hidden,
    status: s.status as Connector['status'],
    appType: s.appType, baseUrl: s.baseUrl, accessToken: s.accessToken,
    username: s.username, avatarUrl: s.avatarUrl,
    url: s.url, command: s.command, env: s.env, headers: s.headers,
    createdAt: tsToString(s.createdAt),
    updatedAt: tsToString(s.updatedAt),
  };
}

export const connectorsApi = {
  list: async (params?: { kind?: Connector['kind']; enabledOnly?: boolean; includeHidden?: boolean }): Promise<{ data: Connector[]; total: number }> => {
    const res = await _connectorClient.listConnectors({
      kind: (params?.kind ?? 0) as import('@/gen/connector/v1/connector_pb').ConnectorKind,
      enabledOnly: params?.enabledOnly ?? false,
      includeHidden: params?.includeHidden ?? false,
    });
    return {
      data: res.data.map(protoToConnector),
      total: Number(res.total),
    };
  },

  get: async (id: string): Promise<Connector> => {
    const s = await _connectorClient.getConnector({ id });
    return protoToConnector(s);
  },

  create: async (data: Omit<Connector, 'id' | 'createdAt' | 'updatedAt'>): Promise<Connector> => {
    const s = await _connectorClient.createConnector({
      name: data.name, title: data.title, description: data.description, icon: data.icon ?? '',
      kind: (data.kind ?? 0) as import('@/gen/connector/v1/connector_pb').ConnectorKind,
      enabled: data.enabled ?? false, hidden: data.hidden ?? false, status: data.status ?? '',
      appType: data.appType ?? '', baseUrl: data.baseUrl ?? '', accessToken: data.accessToken ?? '',
      url: data.url ?? '', command: data.command ?? '', env: data.env ?? {},
      headers: data.headers ?? {},
    });
    return protoToConnector(s);
  },

  update: async (id: string, data: Partial<Connector>): Promise<Connector> => {
    const s = await _connectorClient.updateConnector({
      id,
      name: data.name ?? '', title: data.title ?? '', description: data.description ?? '',
      icon: data.icon ?? '',
      enabled: data.enabled, hidden: data.hidden, status: data.status ?? '',
      baseUrl: data.baseUrl ?? '', accessToken: data.accessToken ?? '',
      url: data.url ?? '', command: data.command ?? '', env: data.env ?? {},
      username: data.username ?? '', avatarUrl: data.avatarUrl ?? '',
      headers: data.headers ?? {},
    });
    return protoToConnector(s);
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const res = await _connectorClient.deleteConnector({ id });
    return { success: res.success };
  },

  // ── Per-user credential management ──

  upsertCredential: async (connectorId: string, data: { accessToken: string; baseUrl?: string }): Promise<{
    connectorId: string; username: string; avatarUrl: string; status: string; appType: string;
  }> => {
    const res = await _connectorClient.upsertCredential({
      connectorId,
      accessToken: data.accessToken,
      baseUrl: data.baseUrl ?? '',
    });
    return {
      connectorId: res.connectorId,
      username: res.username,
      avatarUrl: res.avatarUrl,
      status: res.status,
      appType: res.appType,
    };
  },

  getCredential: async (connectorId: string): Promise<{
    connectorId: string; username: string; avatarUrl: string; status: string; appType: string; hasToken: boolean;
  } | null> => {
    try {
      const res = await _connectorClient.getCredential({ connectorId });
      return {
        connectorId: res.connectorId,
        username: res.username,
        avatarUrl: res.avatarUrl,
        status: res.status,
        appType: res.appType,
        hasToken: !!res.accessToken,
      };
    } catch {
      return null; // not connected
    }
  },

  deleteCredential: async (connectorId: string): Promise<void> => {
    await _connectorClient.deleteCredential({ connectorId });
  },

  listCredentials: async (): Promise<Array<{
    connectorId: string; username: string; avatarUrl: string; status: string; appType: string;
  }>> => {
    try {
      const res = await _connectorClient.listCredentials({});
      return (res.data || []).map(c => ({
        connectorId: c.connectorId,
        username: c.username,
        avatarUrl: c.avatarUrl,
        status: c.status,
        appType: c.appType,
      }));
    } catch {
      return [];
    }
  },
};

/** @deprecated use connectorsApi */
export const mcpServersApi = {
  list: async (params?: { enabledOnly?: boolean; includeHidden?: boolean; type?: string }): Promise<{ data: MCPServer[]; total: number }> => {
    const kindFilter = params?.type === 'remote' ? 2 : params?.type === 'local' ? 3 : 0;
    const res = await connectorsApi.list({
      kind: kindFilter as Connector['kind'],
      enabledOnly: params?.enabledOnly ?? false,
      includeHidden: params?.includeHidden ?? false,
    });
    return { data: res.data.map(connectorToMCPServer), total: res.total };
  },
  get: async (id: string): Promise<MCPServer> => connectorToMCPServer(await connectorsApi.get(id)),
  create: async (data: Omit<MCPServer, 'id' | 'createdAt' | 'updatedAt'>): Promise<MCPServer> => {
    const c = await connectorsApi.create({
      name: data.name, title: data.title, description: data.description, icon: '',
      kind: data.type === 'remote' ? 2 : 3,
      enabled: data.enabled, hidden: data.hidden ?? false, status: data.status,
      appType: '', baseUrl: '', accessToken: '', username: '', avatarUrl: '',
      url: data.url ?? '', command: data.command ?? '', env: data.env ?? {},
    });
    return connectorToMCPServer(c);
  },
  update: async (id: string, data: Partial<MCPServer>): Promise<MCPServer> => {
    const updates: Partial<Connector> = { ...data, kind: data.type === 'remote' ? 2 : data.type === 'local' ? 3 : undefined };
    return connectorToMCPServer(await connectorsApi.update(id, updates));
  },
  delete: async (id: string): Promise<{ success: boolean }> => connectorsApi.delete(id),
};

function connectorToMCPServer(c: Connector): MCPServer {
  return {
    id: c.id, name: c.name, title: c.title, description: c.description,
    type: c.kind === 2 ? 'remote' : 'local',
    enabled: c.enabled,
    status: (c.status || 'disconnected') as MCPServer['status'],
    hidden: c.hidden,
    url: c.url, command: c.command, env: c.env,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// ============================================
// Bots API  — ConnectRPC
// ============================================

function protoToBot(p: { id: string; name: string; platform: string; enabled: boolean; status: string; config: Record<string, string>; createdAt?: { seconds: bigint; nanos: number } | null; updatedAt?: { seconds: bigint; nanos: number } | null }): Bot {
  return {
    id: p.id,
    name: p.name,
    platform: p.platform as Bot['platform'],
    enabled: p.enabled,
    status: p.status as Bot['status'],
    config: p.config,
    createdAt: tsToString(p.createdAt),
    updatedAt: tsToString(p.updatedAt),
  };
}

export interface BotRoom {
  id: string;
  name: string;
  icon: string;
  members: string[];
}

export interface BotSessionBinding {
  channelId: string;
  projectId: string;
  sessionId: string;
  model: string;
}

export interface BindRoomParams {
  botId: string;
  roomId: string;
  roomName: string;
  projectId: string;
  sessionId: string;
  sessionTitle: string;
  projectName: string;
}

export const botsApi = {
  list: async (params?: { enabledOnly?: boolean; platform?: string }): Promise<{ data: Bot[]; total: number }> => {
    const res = await _botsClient.listBots({
      enabledOnly: params?.enabledOnly ?? false,
      platform: params?.platform ?? '',
    });
    return { data: res.data.map(protoToBot), total: Number(res.total) };
  },

  get: async (id: string): Promise<Bot> => {
    const res = await _botsClient.getBot({ id });
    return protoToBot(res);
  },

  create: async (data: Omit<Bot, 'id' | 'createdAt' | 'updatedAt'>): Promise<Bot> => {
    const res = await _botsClient.createBot({
      name: data.name, platform: data.platform, enabled: data.enabled, config: data.config ?? {},
    });
    return protoToBot(res);
  },

  update: async (id: string, data: Partial<Bot>): Promise<Bot> => {
    const res = await _botsClient.updateBot({
      id,
      name: data.name ?? '', platform: data.platform ?? '',
      enabled: data.enabled, status: data.status ?? '',
      config: data.config ?? {},
    });
    return protoToBot(res);
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const res = await _botsClient.deleteBot({ id });
    return { success: res.success };
  },

  listRooms: async (botId: string, forceRefresh = false): Promise<BotRoom[]> => {
    const res = await _botsClient.listBotRooms({ botId, forceRefresh });
    return res.rooms.map(r => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      members: r.members,
    }));
  },

  bindRoom: async (params: BindRoomParams): Promise<{ previousRoomId: string }> => {
    const res = await _botsClient.bindSessionRoom({
      botId: params.botId,
      roomId: params.roomId,
      roomName: params.roomName,
      projectId: params.projectId,
      sessionId: params.sessionId,
      sessionTitle: params.sessionTitle,
      projectName: params.projectName,
    });
    return { previousRoomId: res.previousRoomId };
  },

  unbindRoom: async (sessionId: string, sessionTitle: string): Promise<void> => {
    await _botsClient.unbindSessionRoom({ sessionId, sessionTitle });
  },

  listSessions: async (botId: string): Promise<BotSessionBinding[]> => {
    const res = await _botsClient.listBotSessions({ botId });
    return res.sessions.map(s => ({
      channelId: s.channelId,
      projectId: s.projectId,
      sessionId: s.sessionId,
      model: s.model,
    }));
  },
};

// ============================================
// Speech-to-Text API  — ConnectRPC
// ============================================

export interface STTResponse {
  text: string;
  language?: string;
  duration?: number;
}

export const sttApi = {
  /**
   * Transcribe an audio Blob to text via ConnectRPC (agentx.v1.STTService/Transcribe).
   * The blob is read into a Uint8Array and sent as protobuf bytes — no multipart form needed.
   */
  transcribe: async (audioBlob: Blob, filename?: string, language?: string, prompt?: string): Promise<STTResponse> => {
    const audioBytes = new Uint8Array(await audioBlob.arrayBuffer());
    const res = await _sttClient.transcribe({
      audio: audioBytes,
      filename: filename || 'recording.webm',
      language: language || '',
      prompt: prompt || '',
    });
    return {
      text: res.text,
      language: res.language || undefined,
      duration: res.duration || undefined,
    };
  },

  /**
   * List available STT model IDs via ConnectRPC (agentx.v1.STTService/ListModels).
   */
  getModels: async (): Promise<string[]> => {
    const res = await _sttClient.listModels({});
    return res.models;
  },
};

// ============================================
// AI Query API  — ConnectRPC
// ============================================

export const aiApi = {
  query: async (prompt: string, systemPrompt?: string) => {
    return _aiClient.aIQuery({ prompt, systemPrompt: systemPrompt ?? '' });
  },
};

// ============================================
// Share API  — ConnectRPC
// ============================================

export const shareApi = {
  create: async (taskId: string, projectPath: string) => {
    return _shareClient.createShare({ taskId, projectPath });
  },
  get: async (id: string) => {
    return _shareClient.getShare({ id });
  },
  delete: async (id: string) => {
    return _shareClient.deleteShare({ id });
  },
};

// ============================================
// File Service API (file.v1.FileService)
// ============================================

export const fileServiceApi = {
  /** List files (source=WORKSPACE for project dir, source=UPLOAD for attachments) */
  listFiles: (req: Parameters<typeof _fileClient.listFiles>[0]) =>
    _fileClient.listFiles(req),

  /** Read file content */
  readFile: (req: Parameters<typeof _fileClient.readFile>[0]) =>
    _fileClient.readFile(req),

  /** Write file content */
  writeFile: (req: Parameters<typeof _fileClient.writeFile>[0]) =>
    _fileClient.writeFile(req),

  /** Delete a file (source=WORKSPACE or source=UPLOAD) */
  deleteFile: (req: Parameters<typeof _fileClient.deleteFile>[0]) =>
    _fileClient.deleteFile(req),

  /** Upload a user attachment file */
  uploadFile: (req: Parameters<typeof _fileClient.uploadFile>[0]) =>
    _fileClient.uploadFile(req),
};

// ============================================
// Type imports
// ============================================

import type {
  Session,
  Project,
  Config,
  User,
  Notification,
  LibraryItem,
  AgentCapability,
  SkillConfig,
  AIProvider,
  MCPServer,
  Connector,
  Bot,
} from '@/types';

interface Agent {
  id: string;
  name: string;
  description: string;
}

interface SearchResult {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  icon: string;
}

interface SearchResults {
  sessions: Session[];
  projects: SearchResult[];
  library: SearchResult[];
}
