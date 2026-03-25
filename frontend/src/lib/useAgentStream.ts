/**
 * useAgentStream — SolidJS reactive hook for AG-UI event streams.
 *
 * Provides real-time agent status updates (tool calls, run lifecycle,
 * state snapshots) by consuming AG-UI events from the ConnectRPC stream.
 *
 * Usage:
 *   const { runState, processStreamResponse, reset } = useAgentStream();
 *
 *   // In your streaming loop:
 *   for await (const response of stream) {
 *     processStreamResponse(response);
 *   }
 *
 *   // In your JSX:
 *   <Show when={runState().isRunning}>
 *     <StatusIndicator status={runState().status} tool={runState().currentTool} />
 *   </Show>
 */

import { createSignal, batch } from 'solid-js';
import {
  type AGUIEvent,
  type AGUIRunState,
  type AGUIEventCallbacks,
  INITIAL_RUN_STATE,
  parseStreamResponse,
  dispatchAGUIEvent,
  reduceAGUIState,
} from './agui-adapter';

export { type AGUIEvent, type AGUIRunState, type ToolCallInfo } from './agui-adapter';
export { EventType } from '@ag-ui/core';

/**
 * Create a reactive AG-UI stream processor for SolidJS.
 *
 * @param callbacks - Optional callbacks for specific event types
 * @returns Reactive state and control functions
 */
export function useAgentStream(callbacks?: AGUIEventCallbacks) {
  const [runState, setRunState] = createSignal<AGUIRunState>({ ...INITIAL_RUN_STATE });

  /**
   * Process a single ConnectRPC StreamResponse.
   * Call this for each response in your `for await` loop.
   *
   * Returns the legacy text chunks (for backward compatibility).
   */
  function processStreamResponse(response: any): string[] {
    const { events, textChunks } = parseStreamResponse(response);

    if (events.length > 0) {
      batch(() => {
        for (const event of events) {
          // Update reactive state
          setRunState(prev => reduceAGUIState(prev, event));
          // Dispatch to callbacks
          if (callbacks) {
            dispatchAGUIEvent(event, callbacks);
          }
        }
      });
    }

    return textChunks;
  }

  /**
   * Reset the run state (call when starting a new message).
   */
  function reset() {
    setRunState({ ...INITIAL_RUN_STATE });
  }

  return {
    /** Reactive AG-UI run state signal */
    runState,
    /** Process a ConnectRPC StreamResponse and extract text chunks */
    processStreamResponse,
    /** Reset state for a new run */
    reset,
  };
}
