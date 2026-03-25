/**
 * AG-UI Event Adapter for ConnectRPC Streams
 *
 * This module bridges the existing ConnectRPC streaming transport with the
 * AG-UI protocol.  The backend packs AG-UI events as JSON inside
 * `Part.data` with `media_type = "application/json+ag-ui"`, alongside
 * legacy text chunks in `Part.text`.
 *
 * The adapter:
 *  1. Detects AG-UI events from each StreamResponse
 *  2. Parses them into typed AG-UI event objects
 *  3. Provides a reactive SolidJS interface for consuming them
 *
 * Transport: ConnectRPC (unchanged)
 * State management: SolidJS createSignal / createStore
 */

import { EventType } from '@ag-ui/core';

// ── Constants ──────────────────────────────────────────────────────────────

export const AGUI_MEDIA_TYPE = 'application/json+ag-ui';

// ── AG-UI Event Types (re-export for convenience) ──────────────────────────

export { EventType };

// ── Interfaces ─────────────────────────────────────────────────────────────

/** Minimal AG-UI event as received from the backend. */
export interface AGUIEvent {
  type: string;
  timestamp?: number;
  // RUN_STARTED / RUN_FINISHED
  threadId?: string;
  runId?: string;
  // TEXT_MESSAGE_*
  messageId?: string;
  role?: string;
  delta?: string;
  // TOOL_CALL_*
  toolCallId?: string;
  toolCallName?: string;
  parentMessageId?: string;
  content?: string;
  // STATE_SNAPSHOT
  snapshot?: Record<string, any>;
  // STEP_STARTED / STEP_FINISHED
  stepName?: string;
  // RUN_ERROR
  message?: string;
  code?: string;
  // CUSTOM
  name?: string;
  value?: any;
}

/** Tool call info tracked during a streaming session. */
export interface ToolCallInfo {
  id: string;
  name: string;
  args: string;
  result?: string;
  status: 'started' | 'streaming_args' | 'ended' | 'result';
}

/** AG-UI run state for reactive UI. */
export interface AGUIRunState {
  /** Whether the agent is currently running */
  isRunning: boolean;
  /** Current status from STATE_SNAPSHOT (e.g. "working", "tool_use") */
  status: string;
  /** Current tool being used (from STATE_SNAPSHOT.currentTool) */
  currentTool: string | null;
  /** All tool calls seen during this run */
  toolCalls: ToolCallInfo[];
  /** The current step name (from STEP_STARTED) */
  currentStep: string | null;
  /** Error message if run failed */
  error: string | null;
  /** Thread ID */
  threadId: string | null;
  /** Run ID */
  runId: string | null;
}

export const INITIAL_RUN_STATE: AGUIRunState = {
  isRunning: false,
  status: '',
  currentTool: null,
  toolCalls: [],
  currentStep: null,
  error: null,
  threadId: null,
  runId: null,
};

// ── Parser ─────────────────────────────────────────────────────────────────

/**
 * Extract AG-UI events and legacy text chunks from a ConnectRPC StreamResponse.
 *
 * The backend sends `Part.data` with `media_type = "application/json+ag-ui"`
 * for AG-UI events, and `Part.text` for legacy text chunks.
 *
 * @param streamResponse - A single StreamResponse from ConnectRPC stream
 * @returns Object with `events` (AG-UI events) and `textChunks` (legacy text)
 */
export function parseStreamResponse(streamResponse: any): {
  events: AGUIEvent[];
  textChunks: string[];
} {
  const events: AGUIEvent[] = [];
  const textChunks: string[] = [];

  if (streamResponse?.payload?.case !== 'artifactUpdate') {
    return { events, textChunks };
  }

  const artifact = streamResponse.payload.value?.artifact;
  if (!artifact?.parts) {
    return { events, textChunks };
  }

  for (const part of artifact.parts) {
    // Legacy text chunk
    if (part.content?.case === 'text' && part.content.value) {
      textChunks.push(part.content.value);
    }

    // AG-UI event in Part.data
    if (part.content?.case === 'data' && part.mediaType === AGUI_MEDIA_TYPE) {
      try {
        // The backend packs the AG-UI event JSON as a string inside
        // protobuf Value.string_value.  After ConnectRPC deserialization
        // it arrives as either a string or already-parsed object.
        let eventData: any = part.content.value;
        if (typeof eventData === 'string') {
          eventData = JSON.parse(eventData);
        }
        // If it's a protobuf Value wrapper, unwrap it
        if (eventData && typeof eventData === 'object' && 'kind' in eventData) {
          // ConnectRPC deserialized protobuf Value: {kind: {case: 'stringValue', value: '...'}}
          if (eventData.kind?.case === 'stringValue') {
            eventData = JSON.parse(eventData.kind.value);
          }
        }
        if (eventData && typeof eventData === 'object' && 'type' in eventData) {
          events.push(eventData as AGUIEvent);
        }
      } catch (e) {
        console.warn('[AG-UI] Failed to parse event:', e);
      }
    }
  }

  return { events, textChunks };
}

// ── Event Handlers ─────────────────────────────────────────────────────────

export interface AGUIEventCallbacks {
  /** Called on RUN_STARTED */
  onRunStarted?: (event: AGUIEvent) => void;
  /** Called on RUN_FINISHED */
  onRunFinished?: (event: AGUIEvent) => void;
  /** Called on RUN_ERROR */
  onRunError?: (event: AGUIEvent) => void;
  /** Called on TEXT_MESSAGE_START */
  onTextMessageStart?: (event: AGUIEvent) => void;
  /** Called on TEXT_MESSAGE_CONTENT with text delta */
  onTextMessageContent?: (event: AGUIEvent) => void;
  /** Called on TEXT_MESSAGE_END */
  onTextMessageEnd?: (event: AGUIEvent) => void;
  /** Called on TOOL_CALL_START */
  onToolCallStart?: (event: AGUIEvent) => void;
  /** Called on TOOL_CALL_ARGS */
  onToolCallArgs?: (event: AGUIEvent) => void;
  /** Called on TOOL_CALL_END */
  onToolCallEnd?: (event: AGUIEvent) => void;
  /** Called on TOOL_CALL_RESULT */
  onToolCallResult?: (event: AGUIEvent) => void;
  /** Called on STATE_SNAPSHOT */
  onStateSnapshot?: (event: AGUIEvent) => void;
  /** Called on STEP_STARTED */
  onStepStarted?: (event: AGUIEvent) => void;
  /** Called on STEP_FINISHED */
  onStepFinished?: (event: AGUIEvent) => void;
  /** Called on any event (catch-all) */
  onEvent?: (event: AGUIEvent) => void;
}

/**
 * Dispatch an AG-UI event to the appropriate callback.
 */
export function dispatchAGUIEvent(event: AGUIEvent, callbacks: AGUIEventCallbacks): void {
  // Call catch-all first
  callbacks.onEvent?.(event);

  switch (event.type) {
    case EventType.RUN_STARTED:
      callbacks.onRunStarted?.(event);
      break;
    case EventType.RUN_FINISHED:
      callbacks.onRunFinished?.(event);
      break;
    case EventType.RUN_ERROR:
      callbacks.onRunError?.(event);
      break;
    case EventType.TEXT_MESSAGE_START:
      callbacks.onTextMessageStart?.(event);
      break;
    case EventType.TEXT_MESSAGE_CONTENT:
      callbacks.onTextMessageContent?.(event);
      break;
    case EventType.TEXT_MESSAGE_END:
      callbacks.onTextMessageEnd?.(event);
      break;
    case EventType.TOOL_CALL_START:
      callbacks.onToolCallStart?.(event);
      break;
    case EventType.TOOL_CALL_ARGS:
      callbacks.onToolCallArgs?.(event);
      break;
    case EventType.TOOL_CALL_END:
      callbacks.onToolCallEnd?.(event);
      break;
    case EventType.TOOL_CALL_RESULT:
      callbacks.onToolCallResult?.(event);
      break;
    case EventType.STATE_SNAPSHOT:
      callbacks.onStateSnapshot?.(event);
      break;
    case EventType.STEP_STARTED:
      callbacks.onStepStarted?.(event);
      break;
    case EventType.STEP_FINISHED:
      callbacks.onStepFinished?.(event);
      break;
  }
}

/**
 * Create a state reducer for AG-UI events.
 * Call this with each event to maintain a running state.
 */
export function reduceAGUIState(state: AGUIRunState, event: AGUIEvent): AGUIRunState {
  switch (event.type) {
    case EventType.RUN_STARTED:
      return {
        ...INITIAL_RUN_STATE,
        isRunning: true,
        threadId: event.threadId ?? null,
        runId: event.runId ?? null,
        status: 'running',
      };

    case EventType.RUN_FINISHED:
      return { ...state, isRunning: false, status: 'completed', currentTool: null, currentStep: null };

    case EventType.RUN_ERROR:
      return { ...state, isRunning: false, status: 'error', error: event.message ?? null };

    case EventType.STATE_SNAPSHOT:
      return {
        ...state,
        status: event.snapshot?.status ?? state.status,
        currentTool: event.snapshot?.currentTool ?? state.currentTool,
      };

    case EventType.TOOL_CALL_START: {
      const newToolCall: ToolCallInfo = {
        id: event.toolCallId!,
        name: event.toolCallName!,
        args: '',
        status: 'started',
      };
      return {
        ...state,
        toolCalls: [...state.toolCalls, newToolCall],
        currentTool: event.toolCallName ?? null,
      };
    }

    case EventType.TOOL_CALL_ARGS: {
      const toolCalls = state.toolCalls.map(tc =>
        tc.id === event.toolCallId
          ? { ...tc, args: tc.args + (event.delta ?? ''), status: 'streaming_args' as const }
          : tc
      );
      return { ...state, toolCalls };
    }

    case EventType.TOOL_CALL_END: {
      const toolCalls = state.toolCalls.map(tc =>
        tc.id === event.toolCallId ? { ...tc, status: 'ended' as const } : tc
      );
      return { ...state, toolCalls };
    }

    case EventType.TOOL_CALL_RESULT: {
      const toolCalls = state.toolCalls.map(tc =>
        tc.id === event.toolCallId
          ? { ...tc, result: event.content, status: 'result' as const }
          : tc
      );
      return { ...state, toolCalls, currentTool: null };
    }

    case EventType.STEP_STARTED:
      return { ...state, currentStep: event.stepName ?? null };

    case EventType.STEP_FINISHED:
      return { ...state, currentStep: null };

    default:
      return state;
  }
}
