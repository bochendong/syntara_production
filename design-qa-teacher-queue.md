**Comparison target**

- Source visual truth: `/Users/dongpochen/Desktop/截屏2026-08-14 上午12.16.19.png`
- Implementation desktop: `/Users/dongpochen/Github/syntara_production/artifacts/teacher-queue-ui/queue-failure-unified-desktop.png`
- Implementation narrow: `/Users/dongpochen/Github/syntara_production/artifacts/teacher-queue-ui/queue-failure-unified-900px.png`
- State: teacher course studio, AI queue, light theme, local demo fixtures, failed jobs visible
- Source pixels: 2048 x 717
- Desktop implementation pixels and CSS viewport: 2048 x 717, device scale factor 1
- Narrow implementation pixels and CSS viewport: 900 x 900, device scale factor 1
- Density normalization: none; source and desktop implementation use matching pixel and CSS dimensions

**Full-view comparison evidence**

- The source failed rows were taller than successful, running, and queued rows because the diagnostic rendered on a dedicated second line.
- The revised desktop implementation measures seven rows at 53 px and one at 52 px, including both failed rows. The long diagnostic no longer changes row height.
- At 900 px all rows measure 86-87 px, including failed rows, with document `scrollWidth` equal to `clientWidth` (900 px).

**Focused region comparison evidence**

- Focused review covered the failed-row metadata, progress header, status badges, attempt timestamp, and retry control.
- Failure state is now expressed once in the progress/status regions; the left metadata stays consistent as file type, task kind, and automatic-processing mode.
- The diagnostic is a muted, single-line, truncated suffix beside the failed stage label. Its complete value remains available in the native title affordance.
- The retry button remains visible and enabled in both desktop and narrow layouts.

**Required fidelity surfaces**

- Fonts and typography: existing project typography, weights, sizes, line heights, and truncation patterns are preserved. The diagnostic uses existing small secondary text styling.
- Spacing and layout rhythm: desktop rows are consistently 52-53 px; narrow rows are consistently 86-87 px. Three-column alignment and progress-bar rhythm are uniform across statuses.
- Colors and visual tokens: existing emerald, sky, rose, indigo, amber, slate, border, and dark-mode tokens are reused without introducing new colors.
- Image quality and assets: no raster assets are required for this UI; existing Lucide status and action icons are preserved.
- Copy and content: stage, progress, persistence, attempt count, time, and retry copy are preserved. Full error content remains accessible without dominating the row.

**Findings**

- No actionable P0, P1, or P2 differences remain for the requested failure-state consistency fix.
- P3: native `title` presentation varies by browser. A custom tooltip could offer more controlled styling later, but it is not needed for hierarchy, readability, or task completion.

**Comparison history**

- Initial P2: failed rows expanded vertically and duplicated rose failure labels across metadata and status areas.
- Fix: moved the diagnostic into a truncated inline progress summary, normalized metadata tags, and reserved a stable desktop action column.
- Post-fix evidence: matching desktop row heights, matching narrow row heights, no horizontal overflow, retry control present, and no browser console warnings or errors.

**Primary interactions tested**

- Opened the teacher course studio mock route.
- Switched from source files to the AI queue.
- Confirmed failed-task retry controls are visible and enabled.
- Confirmed responsive layout at 900 px.
- Checked browser console warnings and errors: none.

**Implementation checklist**

- [x] Normalize failure-row height with other task states.
- [x] Keep diagnostic details accessible without expanding the row.
- [x] Remove redundant failure metadata styling.
- [x] Preserve progress, persistence, attempts, timestamp, and retry affordance.
- [x] Verify desktop and narrow layouts.

final result: passed
