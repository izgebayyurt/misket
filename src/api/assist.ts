import { listen } from "@tauri-apps/api/event";
import { invoke } from "./client";
import type { AssistFeature, AssistLogEntry, AssistReply, AssistStatus } from "./types";

/** Deltas of a streamed reply arrive here, one piece of text at a time. */
export const ASSIST_DELTA_EVENT = "misket://assist-delta";

export const assistStatus = () => invoke<AssistStatus>("assist_status");
export const setAssistApiKey = (key: string) => invoke<void>("assist_set_api_key", { key });
export const clearAssistApiKey = () => invoke<void>("assist_clear_api_key");
export const assistRequests = () => invoke<AssistLogEntry[]>("assist_requests");
export const clearAssistRequests = () => invoke<void>("assist_clear_requests");
export const cancelAssist = (requestId: string) => invoke<void>("assist_cancel", { requestId });
export const testAssistConnection = () => invoke<AssistReply>("assist_test_connection");

/**
 * Ask the configured provider one question.
 *
 * With a `requestId` the reply streams: each piece arrives as an
 * `ASSIST_DELTA_EVENT`, `cancelAssist(requestId)` stops it, and the promise
 * still resolves with the whole text at the end.
 */
export const assistComplete = (args: {
  feature: AssistFeature;
  system: string;
  prompt: string;
  requestId?: string;
}) =>
  invoke<AssistReply>("assist_complete", {
    feature: args.feature,
    system: args.system,
    prompt: args.prompt,
    requestId: args.requestId ?? null,
  });

/** Call `onDelta` for every piece of the reply with this id. */
export function onAssistDelta(requestId: string, onDelta: (text: string) => void) {
  let stop: (() => void) | undefined;
  let cancelled = false;
  void listen<{ requestId: string; text: string }>(ASSIST_DELTA_EVENT, (event) => {
    if (event.payload.requestId === requestId) onDelta(event.payload.text);
  }).then((fn) => {
    if (cancelled) fn();
    else stop = fn;
  });
  return () => {
    cancelled = true;
    stop?.();
  };
}
