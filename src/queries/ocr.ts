import { useQuery } from "@tanstack/react-query";
import { listTessdataLanguages } from "@/api/ocr";
import { keys } from "./keys";

/** The extra OCR languages available in the tessdata folder, refetched
 * whenever Settings is opened so a file dropped in while the app was
 * running shows up. */
export function useTessdataLanguages() {
  return useQuery({
    queryKey: keys.tessdataLanguages,
    queryFn: listTessdataLanguages,
    staleTime: 0,
  });
}
