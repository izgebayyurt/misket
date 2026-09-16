# Research: what to build next

Three surveys, run in September 2026, feed the roadmap:

- [`literature.md`](literature.md): 53 papers and methods texts (via Consensus) on CAQDAS usability, coding practice and analysis displays.
- [`user-criticisms.md`](user-criticisms.md): 44 forum, review-site and issue-tracker sources on what users dislike about Dedoose, NVivo, ATLAS.ti, MAXQDA, QualCoder, Taguette, Quirkos and Delve.
- [`tool-comparison.md`](tool-comparison.md): feature-by-feature comparison of the coding loop and the analysis toolset, with a gap analysis for Misket.

## What the three sources agree on

1. **Price, crashes and lost projects** are the loudest complaints. Misket's local-first, single-file, no-subscription model already answers the first; backups answer part of the second. Still open: warn when the project file sits in a cloud-synced folder (a documented corruption path for NVivo and MAXQDA), and never lose data on interchange.
2. **Coding is iterative.** Coders start with many fine codes and lump later; they code to a parent when unsure and push down later; they need definitions with inclusion and exclusion rules and an example. Merge, move and undo exist; in vivo coding, quick re-coding, upcode/downcode and structured definitions do not.
3. **Analysis lags coding** in every tool. The techniques researchers actually use are frequencies, co-occurrence, code-by-attribute cross-tabs, framework (case-by-theme) matrices, Boolean and proximity retrieval, word frequency, and coding over time. Misket has the first two and a heatmap.
4. **Rigour and audit.** Reviewers ask for a coding history and a versioned codebook; teams need coder identity, agreement statistics and a resolution workflow. None exists yet.
5. **Interoperability.** REFI-QDA (.qdpx) import matters more than export, because it captures people leaving the incumbents; document lossy fields instead of dropping them silently.

## Coding practice Misket should support directly

| Practice                                    | Support today                                                 | Gap                                                           |
| ------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| First-cycle: many fine codes, in vivo names | `>name` creates codes from the palette                        | In vivo (name from selection), quick-code the last code       |
| Second-cycle: lump, split, reparent         | Merge with impact preview, move excerpts, drag reparent, undo | Roll several siblings into a parent in one step               |
| Code to parent, push down later             | Filters and counts aggregate descendants                      | "Review this code" recode loop, push-down and pull-up actions |
| Definitions with rules and examples         | Free-text description shown in the palette                    | Inclusion / exclusion fields, "use excerpt as example"        |
| Memoing and constant comparison             | Project, document, code and excerpt memos                     | Memo linked to several excerpts                               |
| Audit trail                                 | Undo stack, backups                                           | Activity log, codebook history                                |
| Team coding                                 | Single coder                                                  | Coder identity, agreement, resolution                         |

## Ranked additions

Wave 5 (delegated now):

| Item                                                                                                                               | Effort | Roadmap         |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------- |
| In vivo coding, quick-code last code, roll-up into parent, push-down review mode, structured code definitions with example excerpt | M      | 35              |
| Code-by-descriptor cross-tab and a Boolean/proximity query builder with saved queries                                              | L      | 36, 37          |
| Word frequency view, stemmed search, coding-over-time per code                                                                     | S      | 38              |
| Framework matrix: documents by codes with editable summary cells                                                                   | L      | 39              |
| Coding activity log and codebook history                                                                                           | M      | 40 (extends 25) |
| Cloud-synced folder warning; auto-code by regex and by speaker turn                                                                | M      | 41, 16          |

Wave 6 (next): REFI-QDA import first (24), coder identity and inter-rater reliability with a disagreement list (21, 22), excerpt weights (8), hierarchy treemap and code clustering (42), OCR fallback for scanned PDFs (43).
