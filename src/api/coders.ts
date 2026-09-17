import { invoke } from "./client";
import type { CoderSummary } from "./types";

/**
 * Everyone whose work is in the open project, with how much of it is theirs.
 * The local coder is first and carries `isLocal`.
 */
export const listCoders = () => invoke<CoderSummary[]>("list_coders");

/** The coder id this install writes as, for the open project. */
export const localCoderId = () => invoke<string>("local_coder_id");
