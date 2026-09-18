import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as api from "@/api/assist";
import type { AssistFeature, AssistReply, AssistSettings, AssistedRef } from "@/api/types";
import { useSettings } from "@/state/settings";
import type { BuiltPrompt } from "@/core/assist/prompts";

/** The assistance settings as they stand. */
export function useAssistSettings(): AssistSettings {
  return useSettings((s) => s.settings.assist);
}

/**
 * Is this feature switched on?
 *
 * Every button that can spend somebody's money or send their data is behind
 * this, and the backend checks the same toggle again — the UI hiding a button
 * is a courtesy, not the guarantee.
 */
export function useAssistEnabled(feature: Exclude<AssistFeature, "testConnection">): boolean {
  const assist = useAssistSettings();
  return feature === "suggestCodes"
    ? assist.suggestCodes
    : feature === "summariseCode"
      ? assist.summariseCode
      : assist.suggestDefinition;
}

/** Whether there is a key, whether the keychain works, what is missing. */
export function useAssistStatus() {
  return useQuery({
    queryKey: ["assist", "status"],
    queryFn: api.assistStatus,
    staleTime: 5_000,
  });
}

/** The session list of what was sent. */
export function useAssistRequests(enabled: boolean) {
  return useQuery({
    queryKey: ["assist", "requests"],
    queryFn: api.assistRequests,
    enabled,
    refetchInterval: enabled ? 3_000 : false,
  });
}

let nextRequestId = 1;

/**
 * One assisted draft: run it, watch it arrive, cancel it, read it back.
 *
 * `stream` is for the features whose answer is prose a person reads as it
 * lands (a memo, a definition). A reply that has to be parsed as JSON is
 * asked for whole, because half a JSON document is worth nothing.
 */
export function useAssistDraft(feature: AssistFeature, options?: { stream?: boolean }) {
  const stream = options?.stream ?? false;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<AssistReply | null>(null);
  const requestId = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // A draft whose panel closed mid-flight is not worth paying for.
      if (requestId.current) void api.cancelAssist(requestId.current);
    };
  }, []);

  const run = useCallback(
    async (prompt: BuiltPrompt): Promise<AssistReply | null> => {
      if (requestId.current) return null;
      const id = stream ? `assist-${nextRequestId++}` : undefined;
      requestId.current = id ?? "pending";
      setBusy(true);
      setError(null);
      setText("");
      const stopListening = id ? api.onAssistDelta(id, (piece) => setText((t) => t + piece)) : null;
      try {
        const result = await api.assistComplete({
          feature,
          system: prompt.system,
          prompt: prompt.user,
          requestId: id,
        });
        if (alive.current) {
          setText(result.text);
          setReply(result);
        }
        return result;
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        stopListening?.();
        requestId.current = null;
        if (alive.current) setBusy(false);
      }
    },
    [feature, stream],
  );

  const cancel = useCallback(() => {
    const id = requestId.current;
    if (id && id !== "pending") void api.cancelAssist(id);
  }, []);

  /** What to record on anything accepted out of this draft. */
  const assisted: AssistedRef | undefined = reply
    ? { provider: reply.provider, model: reply.model }
    : undefined;

  return { text, setText, busy, error, reply, assisted, run, cancel };
}
