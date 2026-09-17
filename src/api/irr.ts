import { invoke } from "./client";
import type { IrrReport, IrrRequest } from "./types";

/** Compare two coders over the documents they both coded. */
export const irrCompare = (request: IrrRequest) => invoke<IrrReport>("irr_compare", { request });

/** The same comparison written to `path` as CSV. */
export const irrExportCsv = (request: IrrRequest, path: string) =>
  invoke<void>("irr_export_csv", { request, path });
