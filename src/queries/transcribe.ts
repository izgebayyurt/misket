import { useQuery } from "@tanstack/react-query";
import { listWhisperModels, transcriptionSupport } from "@/api/transcribe";
import { keys } from "./keys";

/** What this build can do. Fixed for the life of the process, so cached hard. */
export function useTranscriptionSupport() {
  return useQuery({
    queryKey: keys.transcriptionSupport,
    queryFn: transcriptionSupport,
    staleTime: Infinity,
  });
}

/**
 * The installed models. Refetched whenever something that shows them mounts,
 * since a file can be dropped into the folder while the app is running.
 */
export function useWhisperModels() {
  return useQuery({
    queryKey: keys.whisperModels,
    queryFn: listWhisperModels,
    staleTime: 0,
  });
}
