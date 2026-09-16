# What users criticize about existing QDA tools

Research pass across review sites, Reddit-adjacent discussion (Reddit itself
largely blocked this session's fetcher; coverage leans on G2/Capterra/
TrustRadius/Software Advice snippets, ResearchGate Q&A, university library
guides, vendor support/community forums, and the QualCoder/Taguette issue
trackers), and QDA-specific blogs. 44 distinct URLs are cited below (Sources
section). Counts in the theme table are approximate tallies of how many
distinct sources raised each theme, not a scientific sample.

## 1. Summary

Across NVivo, ATLAS.ti, MAXQDA, Dedoose, Quirkos, Delve, QualCoder and
Taguette, the loudest and most consistent complaints are about **money**
(per-seat subscriptions, one-time licenses in the $600–$2,000 range, and
transcription add-ons priced in inconvenient blocks), **reliability**
(crashes, project-file corruption — especially when a project lives in a
cloud-synced folder like OneDrive/iCloud/Google Drive — and lost codes after
updates), and **cloud/collaboration friction** (NVivo's Collaboration Cloud
is described by reviewers as "a catastrophic experience" with sync failures
and cryptic errors, while MAXQDA's collaboration is "functional but not
real-time"). Secondary but frequent themes are a steep learning curve and
cluttered, dated interfaces (especially ATLAS.ti and MAXQDA), weak
interoperability even with the shared REFI-QDA/.qdpx standard (data loss on
transfer; Taguette doesn't support it at all), thin support for audio/video
and scanned PDFs in the lighter tools (Quirkos can't code PDFs directly,
Delve has no native audio/video), long-standing Mac-vs-Windows feature gaps
in NVivo, and a clear appetite — visible in both commercial marketing copy
and researcher blog posts — for local-first, offline, privacy-preserving
tools that don't put sensitive interview data in the cloud. QualCoder and
Taguette users, by contrast, mostly ask for incremental workflow features
(team/server mode, global undo/redo, a memo manager, duplicate-named
sub-codes) rather than complaining about cost or lock-in, since those tools
are already free and local.

## 2. Complaint themes by frequency

| Theme                                                | Approx. sources | Representative tools                                                                      |
| ---------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| Price / subscription / per-seat or per-block cost    | 12              | NVivo, ATLAS.ti, MAXQDA, Dedoose                                                          |
| Slow performance or crashing                         | 9               | NVivo, MAXQDA, ATLAS.ti, Dedoose, Quirkos                                                 |
| Cloud lock-in, sync fragility & data-privacy worries | 7               | NVivo (Collaboration Cloud), Dedoose, Delve, Quirkos (marketed against this)              |
| Learning curve                                       | 6               | ATLAS.ti, NVivo, MAXQDA                                                                   |
| Clunky / dated / cluttered UI                        | 6               | MAXQDA, ATLAS.ti, NVivo                                                                   |
| Poor or fragile collaboration                        | 6               | NVivo, MAXQDA, ATLAS.ti, QualCoder (feature request)                                      |
| Data loss / project-file corruption                  | 5               | NVivo, MAXQDA, Delve                                                                      |
| Weak export / interoperability (REFI-QDA)            | 5               | Taguette, QualCoder, NVivo/ATLAS.ti/MAXQDA (lossy transfer)                               |
| Missing or half-baked AI/analysis features           | 4               | Dedoose, Delve, (contrast: ATLAS.ti/MAXQDA add AI)                                        |
| Poor customer support                                | 4               | NVivo, MAXQDA (mixed), Delve                                                              |
| Weak media support (audio/video/scanned PDF)         | 4               | Quirkos (no direct PDF coding), Delve (no audio/video), NVivo (no built-in transcription) |
| Struggles at scale (large datasets/teams)            | 4               | Quirkos, MAXQDA, NVivo, ATLAS.ti                                                          |
| Mac/Windows feature parity gaps                      | 3               | NVivo                                                                                     |

## 3. Per-tool complaints

### NVivo (Lumivero)

- Collaboration Cloud: "a catastrophic experience" that "repeatedly failed to
  sync, produced cryptic errors" and cost a team "hours we can't get back."
  — G2 reviews via community.lumivero.com support docs, 2024–2025.
- "The program runs painfully slowly, frequently crashes, and makes even
  basic tasks frustrating." — G2 review synthesis, g2.com/products/nvivo/reviews.
- Project-file corruption is common enough that Lumivero, Alfasoft and
  university IT desks all publish recovery guides; causes include working
  from a USB drive or a OneDrive/iCloud/Google-Drive-synced folder, or a
  computer sleeping mid-save. — support.alfasoft.com; northwestern.edu
  NUworkspace KB.
- "Quite expensive for something that is powerful when it works, but more
  often than not is a pain to use." — usercall.co, NVivo guide, 2026.
- Mac and Windows builds have "slightly different file formats" and the Mac
  version has historically shipped with fewer features than Windows. —
  Duke University software site; multiple library guides note this gap
  persists across versions.
- Support is email-only with slow response times, per reviewer accounts
  aggregated by delvetool.com's Collaboration Cloud writeup.

### ATLAS.ti

- "Difficulty with learning curve initially due to multiple buttons and
  complex interface." / "Learning curve steeper than marketing suggests." —
  Capterra reviews, capterra.com/p/171500/ATLAS-ti/reviews.
- "At the end of the day, maybe 1 or 2 hours are basically lost due to this
  program's hiccups, constant saving and what not." — Capterra review.
- Desktop pricing (~$395–$666/year commercial) is repeatedly cited as a
  barrier next to free tools. — skimle.com, usercall.co pricing guides.

### MAXQDA

- "MAXQDA reacts very slowly or crashes," most often traced to opening a
  project from a USB stick, network share, or cloud-synced folder rather
  than a local disk — MAXQDA's own support article, help.maxqda.com, 2024.
- "Almost any change to codes causes a crash as soon as they try to add the
  code to the document." — MAXQDA community discussion,
  help.maxqda.com/en/support/discussions/topics/80000663635.
- Collaboration is "functional but not real-time — teams typically work
  through synchronized exports rather than a shared live environment." —
  skimle.com comparison, 2026.
- Transcription pricing is block-based (€80 per 10 hours) which "forces
  users to purchase full blocks for just a couple extra hours," making it
  pricier than subscription competitors for occasional use. — Capterra
  review synthesis, capterra.com/p/174104/MAXQDA/reviews.
- "If you aren't a student scholar, the cost can be expensive." — Capterra
  review, capterra.co.za/reviews/174104/maxqda.

### Dedoose

- Per-seat pricing "adds another seat at the applicable per-user rate,"
  which "becomes more expensive as teams expand," especially on long-running
  projects. — usercall.co Dedoose pricing guide, 2026; libguides.library.
  arizona.edu/QAnalysis/Dedoose.
- "Clunky and slow systems, even leading to potential data loss"; the site
  "logs you off after a few minutes of inactivity." — aggregated Capterra/
  G2 review synthesis via WebSearch, 2026.
- "Has no equivalent capability to the AI-assisted coding that competitors
  like NVivo, MAXQDA, and ATLAS.ti have introduced." — delvetool.com,
  Dedoose vs NVivo vs Delve, 2026.
- Being browser-based is praised for collaboration but blamed for slowness
  and crashes under load. — Capterra/G2 synthesis.
- Marketing itself concedes the pricing complaint is common enough to
  address directly: "...the only thing that should feel complex is your
  data — not your subscription plan." — Dedoose's own Threads post,
  threads.com/@dedoose, 2026.

### Quirkos

- "The backend design of Quirkos is not robust enough for qualitative data
  analysis... became very slow and unresponsive and eventually crashed" on
  a large Word document. — cited via WebSearch synthesis of a published
  case study (runjmss.com article on using Quirkos), 2026.
- Cannot code PDFs directly — they must be converted to .txt or .doc first.
  — Software Advice/Capterra review synthesis, softwareadvice.com/
  qualitative-data-analysis/quirkos-profile.
- Positioned by its own vendor as the offline/private alternative precisely
  because rivals push cloud sync: "No data is shared with Quirkos or anyone
  else... Quirkos is likely the most secure and confidential option." —
  quirkos.com blog, 2026.

### Delve

- "I always get user errors and sometimes that software does not work well
  in general. I find it more frustrating to use as compared to other
  qualitative software." — Software Advice review.
- "I've lost all of my codes." — Software Advice review,
  softwareadvice.com/qualitative-data-analysis/delve-profile/reviews.
- "I am not quite sure whether my data are secured with Delve." — same
  source.
- AI coding "only used 'some' of the coding and made choices I did not
  agree with." — Capterra review synthesis.
- No native audio/video coding support. — GetApp/Software Advice profile.

### QualCoder (open source)

Open feature requests on the GitHub tracker (github.com/ccbogel/QualCoder/
issues) skew toward workflow gaps rather than cost/lock-in complaints,
consistent with it being free and local already:

- #1531 "Allow multiple (sub)codes with the same name" (Aug 2026).
- #1575 "working with team - server" — i.e., users want lightweight
  multi-coder/server support (Sep 2026).
- #1317 "Clickable Context-Links from Text Segments to References, Files, or
  External Sources" (May 2026).
- #1293 "Implementation of Global Undo/Redo (Ctrl+Z / Ctrl+Y) for Coding
  Actions" (May 2026).
- #1263 "Memo Manager" (Apr 2026).
- Vendor-neutral guides note QualCoder's REFI-QDA export/import "may not be
  error-free" when moving projects to/from NVivo, ATLAS.ti or MAXQDA. —
  skimle.com, free QDA software comparison, 2026.

### Taguette (open source)

- Does not implement REFI-QDA at all, so migrating a Taguette project into
  NVivo or MAXQDA means rebuilding the codebook by hand. — skimle.com, free
  QDA software comparison, 2026.
- Issue tracker lives on GitLab (gitlab.com/remram44/taguette/-/issues); the
  GitHub mirror shows no independent recent issue activity, and the JOSS
  software review (github.com/openjournals/joss-reviews/issues/3522)
  documents early reviewer requests around packaging and documentation.

## 4. What users say they want (with rough counts)

1. **No subscription / one-time or free cost** (≈10 mentions) — the single
   most repeated wish, phrased as "per-seat pricing gets expensive" or
   outright "expensive... a pain to use."
2. **A project that survives crashes and cloud-sync without corrupting**
   (≈6) — explicit vendor and forum advice to avoid OneDrive/iCloud/USB for
   NVivo and MAXQDA implies users want this handled automatically.
3. **Real, working collaboration without a fragile cloud service** (≈6) —
   NVivo Collaboration Cloud and MAXQDA's export-only workflow both draw
   complaints; QualCoder users are asking for basic server/team support.
4. **Lossless import/export between tools (REFI-QDA that actually works)**
   (≈5) — repeated caveat that .qdpx transfers lose data, and that Taguette
   has none at all.
5. **A simpler, less cluttered interface** (≈5) — specifically named against
   MAXQDA's "colors, emojis, and on-the-fly filtering" and ATLAS.ti's
   "multiple buttons and complex interface."
6. **Native audio/video and scanned-PDF coding without extra conversion
   steps** (≈4) — Quirkos and Delve both criticized for gaps here.
7. **AI assistance that is optional and doesn't silently make wrong calls**
   (≈3) — Delve's AI coding "made choices I did not agree with" is cited as
   a caution, not just a feature request.
8. **Excerpt weighting/intensity ratings** (≈2, but a named Dedoose
   strength repeatedly contrasted against competitors).
9. **Responsive, non-email-only support** (≈3).
10. **Consistent features across macOS and Windows** (≈3, specific to
    NVivo's long-standing gap).

## 5. What this implies for Misket

Ranked by how often the underlying need was raised across sources. "Already
addressed" notes check against the README feature list before claiming a
gap.

1. **No subscription, local-first, single-file project.** (≈10 mentions —
   the top complaint everywhere.) **Already addressed**: README states
   Misket is local-first with no upload and positions itself explicitly
   against Dedoose's subscription model. Recommendation: keep this as the
   lead marketing message; no roadmap item needed.
2. **Protect the project file from crash/corruption, especially when it
   sits in a synced folder (OneDrive/iCloud/Dropbox).** (≈6.) Roadmap
   **#13 Backups is done** and already covers destructive-operation backups.
   **NEW**: add a lightweight check/warning when the `.misket` file is
   opened from inside a detected cloud-sync folder, mirroring the exact
   failure mode NVivo and MAXQDA support docs warn about.
3. **Lightweight, non-fragile team collaboration.** (≈6.) Maps to roadmap
   **#20 Multiple coders**, **#22 Inter-rater reliability**, and **#23
   Project merge** (all "later"). Recommendation: raise these in priority
   relative to media features — reviewers' anger is more about _reliability_
   of collaboration than its absence, so a simple file-merge model (already
   planned via #23, content-hash matching) is a credible answer to "NVivo's
   cloud sync is catastrophic."
4. **REFI-QDA (.qdpx) import/export that doesn't lose data.** (≈5.) Maps to
   roadmap **#24** ("later"). Recommendation: prioritize _import_ first
   (capturing users leaving NVivo/ATLAS.ti/MAXQDA) since that's the
   higher-value migration direction; document known lossy fields up front
   rather than silently dropping them, which is exactly what competitors
   are criticized for.
5. **Keep the interface simple and keyboard-first rather than cluttered.**
   (≈5.) **Already addressed**: the README's keyboard-cheatsheet-driven,
   single-palette coding UX is a direct contrast to MAXQDA's "colors,
   emojis" and ATLAS.ti's "multiple buttons" complaints. Recommendation: no
   new roadmap item, but keep UI review as a standing bar for new features
   (avoid Misket accreting toolbars).
6. **Audio/video coding.** (≈4.) Maps to roadmap **#18** ("later", milestone
   2 is next). Recommendation: given how often "no native audio/video" is
   cited against Delve and Quirkos, keep this as the top milestone-2 item as
   already planned; no change to ranking needed.
7. **Scanned/OCR PDF and other media a lighter tool can't handle.** (≈4.)
   **Partially addressed**: README says PDF import is "text only." **NEW**:
   consider OCR fallback or at least a clear in-app message when a PDF has
   no extractable text, since Quirkos's "can't code PDFs directly" complaint
   shows users don't discover format limits until mid-import.
8. **Excerpt weights/ratings.** (≈2, but specifically a named Dedoose
   differentiator competitors lack.) Already tracked as roadmap **#8**
   ("later"); recommendation: no change, but note it explicitly answers a
   documented Dedoose-user expectation when it ships.
9. **Optional, non-silent AI assistance.** (≈3.) Maps to roadmap **#25**
   ("later", v0.5, explicitly "never auto-apply"). **Already addressed** in
   design intent: Misket's opt-in/suggest-only stance directly answers the
   Delve complaint about AI "making choices I did not agree with."
10. **Consistent features across macOS/Windows/Linux.** (≈3, specific to
    NVivo's long documented Mac gap.) **Already addressed** by construction
    (single Tauri/Rust+TS codebase, one feature set per release); worth a
    one-line callout in docs/marketing since it's a differentiator users
    explicitly ask for.
11. **Basic team/server mode without a hosted cloud service.** (≈2, echoed
    directly by a QualCoder feature request, #1575.) Overlaps with item 3
    above (#20/#23); recommendation: when multi-coder support ships, ensure
    it works file-based/LAN rather than requiring a hosted service, which is
    the actual point of failure competitors are criticized for.
12. **Large-project performance under load.** (≈4.) Maps to roadmap **#34**
    ("later", explicitly conditional on "if a real transcript proves slow").
    Recommendation: given how often crashes on large documents/datasets are
    cited for MAXQDA, ATLAS.ti and Quirkos, test with genuinely large
    transcripts (50k+ words) and multi-hundred-excerpt projects before
    video lands, since video will raise file sizes sharply.
13. **Responsive support / community channel.** (NEW, ≈4 mentions of
    email-only or slow vendor support.) Misket is open source so "support"
    means issue triage and docs; **partially addressed** (roadmap #33
    website/docs is done). Recommendation (NEW): keep GitHub issues
    responsive and consider a lightweight community channel (Discussions or
    Discord) as a visible contrast to "support is email-only."
14. **Speaker-aware transcript handling** (not a top-line complaint above,
    but implied by repeated interview-transcript pain points around
    coding turns and transcription-format quirks like NVivo/ATLAS.ti
    disagreeing on timestamp brackets). Maps to roadmap **#15** ("later").
    No change to priority; flag as still relevant.
15. **Transparent, predictable pricing model if Misket ever adds paid
    tiers** (NEW). Not urgent since Misket is currently free, but if any
    future monetization (e.g., hosted sync) is considered, avoid per-seat or
    block-based pricing, both of which draw the sharpest cost complaints
    (Dedoose per-seat, MAXQDA transcription blocks).

## 6. Sources

- https://www.g2.com/products/nvivo/reviews
- https://www.g2.com/products/nvivo/reviews?qs=pros-and-cons
- https://www.g2.com/products/dedoose/reviews
- https://www.g2.com/sellers/lumivero
- https://capterra.com/p/171501/NVivo/reviews/
- https://capterra.com/p/171500/ATLAS-ti/reviews/
- https://capterra.com/p/174104/MAXQDA/reviews/
- https://www.capterra.com/p/210414/Dedoose/
- https://www.capterra.com/p/141206/Quirkos/reviews/
- https://www.capterra.co.za/reviews/174104/maxqda
- https://www.softwareadvice.com/collaboration/dedoose-profile/
- https://www.softwareadvice.com/qualitative-data-analysis/quirkos-profile/reviews/
- https://www.softwareadvice.com/qualitative-data-analysis/delve-profile/reviews/
- https://www.trustradius.com/products/nvivo/reviews?qs=pros-and-cons
- https://lonm.vivaldi.net/2022/07/13/the-pains-of-qualitative-analysis-with-nvivo/
- https://www.researchgate.net/post/What-are-the-pros-and-cons-of-using-Dedoose-versus-nVivo-for-qualitative-data-analysis
- https://www.researchgate.net/post/why_didn_t_you_use_NVIVO_in_qualitative_studies
- https://www.researchgate.net/post/Has-anyone-used-nVivo-in-their-qualitative-research-and-if-you-have-what-did-you-like-or-not-like-about-this-software
- https://blog.soton.ac.uk/wsi/nvivo
- https://help.maxqda.com/en/support/solutions/articles/80001135580-maxqda-reacts-very-slowly-or-crashes
- https://help.maxqda.com/en/support/discussions/topics/80000663635
- https://support.alfasoft.com/hc/en-us/articles/4406402613649-How-to-avoid-NVivo-project-file-corruption
- https://services.northwestern.edu/TDClient/30/Portal/KB/Article/2833/NUworkspace-Recovering-a-Corrupted-NVivo-Project-File
- https://qdatraining.com/forums/topic/recovering-a-corrupt-project-file-2
- https://community.lumivero.com/s/article/How-can-I-import-export-a-project-from-to-other-QDA-programs-such-as-Atlas-ti-maxQDA-Dedoose-etc
- https://delvetool.com/blog/nvivo-cloud-collaboration
- https://delvetool.com/blog/dedoose-vs-nvivo-vs-delve
- https://delvetool.com/blog/dedoose-alternatives-delve
- https://delvetool.com/blog/ultimate-guide-comparing-qualitative-coding-software
- https://skimle.com/blog/nvivo-and-maxqda-alternatives-2026
- https://skimle.com/blog/dedoose-review-2026-features-pricing-alternatives-nvivo-maxqda-skimle
- https://skimle.com/blog/maxqda-vs-atlas-ti-qualitative-analysis-software-2026
- https://skimle.com/blog/qualitative-data-analysis-tools-complete-comparison
- https://skimle.com/blog/free-qualitative-data-analysis-software-2026
- https://www.usercall.co/post/nvivo-software-for-qualitative-research-the-brutally-honest-guide-what-works-what-doesn-t-and-what-s-replacing-it
- https://www.usercall.co/post/atlas-ti-pricing-guide-2025-plans-costs-and-key-differences
- https://www.usercall.co/post/dedoose-pricing-guide-2025-plans-costs-intelligent-comparison
- https://checkthat.ai/brands/atlas-ti/reviews
- https://www.quirkos.com/blog/post/quirkos-3-is-released-best-qualitative-software/
- https://www.quirkos.com/learn-qualitative/refi-qda-exchange-atlasti-nvivo-maxqda.html
- https://www.qdasoftware.org/
- https://openqda.github.io/user-docs/refi.html
- https://libguides.library.arizona.edu/QAnalysis/Dedoose
- https://www.threads.com/@dedoose/post/DVMdkaoDmWp
- https://github.com/ccbogel/QualCoder/issues
- https://gitlab.com/remram44/taguette/-/issues
- https://github.com/openjournals/joss-reviews/issues/3522
- https://runjmss.com/index.php/runojs/article/view/87

Note on method: several standard sources named in the brief (raw Reddit
threads on r/qualitativeresearch, r/AskAcademia, r/PhD, r/GradSchool,
r/UXResearch, r/sociology, r/publichealth; Hacker News; live Twitter/X and
Bluesky threads) could not be fetched directly in this environment (Reddit
and X/Twitter blocked the fetcher; Bluesky/HN searches surfaced no on-topic
threads with retrievable content). Complaint content attributed above to
G2/Capterra/TrustRadius/Software Advice reflects those sites' aggregated
review text as returned by search, not a direct page fetch, since those
domains were also blocked for direct fetching in this session; quotes are
reproduced as returned and should be spot-checked against the live pages
before being republished verbatim.
