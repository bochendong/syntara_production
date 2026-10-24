# Chat alignment — 2026-10-24

## Verified baseline

The live Railway staging service reports deployment
`8e61141f-aa3d-4210-8271-e259e144834a` (2026-10-24 07:33 UTC).
Its deployment record identifies commit `88de16913acd4f464ec523667dce71ab71fa0e02`
plus uncommitted changes from the pull-latest task. The commit is shared with this
worktree; the missing deployment changes, rather than commit age alone, caused
the version mismatch.

Compared all 3098 paths in the recorded deployment manifest. The live native JS
and CSS hashes still match its recorded assets. Imported 79 individually verified
different/new files from the preserved thin source snapshot, including navigation,
compact learning pages, onboarding, tool icons and store details. No files were
copied from the mixed shared working tree.

Checkpoint and per-file provenance:
`/Users/dongbochen/Documents/GitHub/syntara_production/.git/codex/tasks/chat-visual-online-alignment-20261024/`.
The previous chat UI patch and report are preserved there. All deployed paths now
match their manifest hashes except the documented integration changes:

- `CourseWorkspace.tsx`: omit the duplicate learning-tools list from the sidebar;
  preserve course/recent conversation copies while assigning one primary selection.
- `main.tsx`: import `chat-visual-hierarchy.css` last.
- `store-page.css`: keep featured-card dimensions and scene-image sizing stable
  while hovering or pressing; remove the `cover` to `104%` background-size switch.
- `StorePage.tsx` and `store-course-categories.ts`: group courses by subject, with
  category filters and subject-aware search, replacing organization shelves.

## Preserved visual changes

The separate chat-only stylesheet retains the requested typography, three-region
proportions and soft card shadow over the online architecture. At 1512px the global
rail is 52px, the course sidebar is 231.5px (combined navigation 18.75%), reading/input
width is 740.875px (49%), and the floating card is 302.4px. Body/navigation labels
are 14px, headings 18/16px, and desktop input 15px. Touch targets remain larger.
The 56px header spans the chat and floating-card area; the scrollport reaches the
viewport right edge. The card begins 10px below the header and its shadow can
spread naturally into the surrounding background.

Online responsive behavior is retained: below 1100px the global icon rail and
learning tabs collapse; the course-title menu opens learning tools, learning pages
return to chat, and the drawer includes store, calendar and profile. Phone widths
still omit the independent question-bank entry. From 1100px the global icon rail
and floating learning card are visible. No duplicate sidebar learning list remains.

## Validation

- Full `pnpm verify:local` passed: formatting, ESLint, root TypeScript, native app
  TypeScript and Vite-config TypeScript. The initial stale Prisma-client error was
  resolved by regenerating the client; no database migration was executed.
- Native production build and staging browser bundle build passed.
- Five offline tests across onboarding/native-store/web-store test files and the
  staging source guard passed.
- Real Google login remains active on `http://localhost:3000/test/app`. Real staging
  courses load; the new store lists 25 courses; CSC110 details show 57 chapters and
  160 problems. Detail → store → chat return navigation passed. No course was
  purchased or joined.
- Browser widths 320, 390, 600, 601, 768, 1099, 1100 and 1504px: no horizontal
  document overflow; correct compact-menu/global-rail/card switching. Mobile notes
  opens from the course menu and returns to chat. Drawer store/calendar/profile
  entries are present. Header/scrollport geometry was checked on wide screens.
- Evidence: `/tmp/syntara-aligned-store.png`,
  `/tmp/syntara-aligned-mobile-menu.png`,
  `/tmp/syntara-aligned-mobile-drawer.png`, and `/tmp/syntara-aligned-chat.png`.
- No online deployment or migration is part of this source alignment. The local
  server uses a loopback database tunnel. Its runtime wrapper revokes the task's
  temporary SSH key and removes its local files when the tunnel exits.
- AI's last live request returned `invalid_api_key`. The local process now uses the
  existing staging model/key configuration, which contains the same rejected key.
  No new provider key was created and no successful AI response is claimed.
- Native binaries/physical devices, voice/image generation and a complete onboarding
  walkthrough were not exercised.

## Store course categories

The 25 real store courses appear exactly once across computing/data science (4),
math/statistics (5), economics (7), business/finance (5), science (2), and
humanities/social sciences (2). Department codes take precedence, with name/tag
fallbacks and an other-courses group for unknown subjects. No database/API changes.

Verified each live category filter's count, a math + MAT135 search (2 results),
and a subject-name search for economics (7 results). Offline assertions covered
all 25 current codes and four fallback cases. At 390px the filter buttons are
44px tall and the document has no horizontal overflow. Scoped format/lint,
root/native TypeScript and native/browser resource builds passed.

Evidence: `/tmp/syntara-store-categories.png` and
`/tmp/syntara-store-categories-mobile.png`.

## Store header search

Search now sits in the trailing side of the title header, capped at 300px, with
a quiet background, light border and short placeholder. Category navigation follows
the header directly. The input has an explicit accessible name. Browser checks at
320px and 390px confirmed that the long computing-category title and search field
do not overlap, the search target remains 44px tall, and the page does not overflow
horizontally. Searching MAT135 still returns two courses. Scoped formatting/lint
and the browser resource build passed. Evidence: `/tmp/syntara-store-search-header.png`.

## Sidebar selection and spacing

The current course uses semibold text without a selected background. The filled
selection follows the clicked conversation entry: clicking the course copy selects
that row; clicking its Recent copy selects the Recent row. The clicked location
survives drawer remounts and page reloads within the same window. Collapsing either
the course or the entire Courses group, or searching chats, uses the visible
conversation entry when the selected course copy is hidden. Both copies remain.

Rows now use an 8px corner radius. Group margins and heading padding are tighter;
desktop rows remain 32px and phone rows retain 44px touch targets. Expanded,
individual-course collapse, whole-group collapse, search, and 390px phone states
were checked in the browser. The final whole-group collapse/expand check confirmed
one filled selection in both states and two conversation copies after expansion.
Scoped format/lint, root/native/Vite TypeScript, and native/browser builds passed.
The final selection predicate adjustment passed format/lint and a browser rebuild.
The click-location correction passed root/native/Vite TypeScript, scoped
format/lint, and a browser build. Browser checks confirmed course → Recent → course
selection, exactly one selected row, and Recent selection surviving a reload.

Evidence: `/tmp/syntara-sidebar-hierarchy.png` and
`/tmp/syntara-sidebar-hierarchy-detail.png`. Click-location evidence:
`/tmp/syntara-sidebar-click-course.png` and `/tmp/syntara-sidebar-click-recent.png`.

## Responsive memory columns

The learning-pane override previously forced the memory page into a column at all
widths, overriding its existing desktop grid. The learning body now provides a
named inline-size container: at 800px of available pane width, the page restores
the flexible left star map and 340px right memory list, with the map sticky while
the list scrolls. Smaller panes retain the stacked layout.

Browser checks at 1456px, 1200px and 1100px confirmed two columns. At 768px and
390px the layout stacks. All checked sizes had no horizontal document overflow.
Scoped CSS formatting and the staging browser resource build passed.
Evidence: `/tmp/syntara-memory-wide-restored.png`.
