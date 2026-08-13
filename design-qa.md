# `/learn` 首页 Design QA

- source visual truth path: `/Users/dongpochen/Desktop/截屏2026-07-21 上午10.25.34.png`（任务开始时已打开；规范化后的参考图保存在下方对照图左侧）
- scoped Dock source state: `/Users/dongpochen/.codex/visualizations/2026/07/21/019f8265-e79f-7162-ba7c-e066465f1b26/learn-home-qa-final-1440x790.png`（本轮文字要求是在该状态上恢复 Dock，并将系统应用放入 Dock）
- scoped Haru source state: `/Users/dongpochen/.codex/visualizations/2026/07/21/019f8265-e79f-7162-ba7c-e066465f1b26/learn-home-dock-pass-1-1440x790.jpg`（本轮要求在该状态上将人物略微上移并隐藏名字）
- scoped second Haru position source state: `/Users/dongpochen/.codex/visualizations/2026/07/21/019f8265-e79f-7162-ba7c-e066465f1b26/learn-home-haru-up-no-name-1440x790.jpg`（在已上移 16px 的状态上继续向上微调）
- scoped labeled Dock source state: `/Users/dongpochen/.codex/visualizations/2026/07/21/019f8265-e79f-7162-ba7c-e066465f1b26/learn-home-haru-up-28-no-name-1440x790.jpg`（在该状态上增大 Dock、显示应用名并移除左上时间日期）
- implementation screenshot path: `/Users/dongpochen/.codex/visualizations/2026/07/21/019f8265-e79f-7162-ba7c-e066465f1b26/learn-home-dock-labels-large-no-clock-1440x790.jpg`
- viewport: `1440 × 790` CSS px；源图为 `2880 × 1580` Retina 2x
- state: 本地开发环境，`/learn?previewLearnHome=1` 用于稳定的同内容视觉对照；真实 `/learn` 另行完成当前账户空课程状态 smoke test
- full-view Dock comparison evidence: `/Users/dongpochen/.codex/visualizations/2026/07/21/019f8265-e79f-7162-ba7c-e066465f1b26/learn-home-dock-comparison-final.jpg`
- focused Dock comparison evidence: `/Users/dongpochen/.codex/visualizations/2026/07/21/019f8265-e79f-7162-ba7c-e066465f1b26/learn-home-dock-focused-comparison-final.jpg`
- full-view Haru comparison evidence: `/Users/dongpochen/.codex/visualizations/2026/07/21/019f8265-e79f-7162-ba7c-e066465f1b26/learn-home-haru-comparison-final.jpg`
- focused Haru comparison evidence: `/Users/dongpochen/.codex/visualizations/2026/07/21/019f8265-e79f-7162-ba7c-e066465f1b26/learn-home-haru-focused-comparison-final.jpg`
- full-view second Haru position comparison evidence: `/Users/dongpochen/.codex/visualizations/2026/07/21/019f8265-e79f-7162-ba7c-e066465f1b26/learn-home-haru-up-28-comparison-final.jpg`
- focused second Haru position comparison evidence: `/Users/dongpochen/.codex/visualizations/2026/07/21/019f8265-e79f-7162-ba7c-e066465f1b26/learn-home-haru-up-28-focused-comparison-final.jpg`
- full-view labeled Dock comparison evidence: `/Users/dongpochen/.codex/visualizations/2026/07/21/019f8265-e79f-7162-ba7c-e066465f1b26/learn-home-dock-labels-no-clock-comparison-final.jpg`
- focused labeled Dock and header-space comparison evidence: `/Users/dongpochen/.codex/visualizations/2026/07/21/019f8265-e79f-7162-ba7c-e066465f1b26/learn-home-dock-labels-no-clock-focused-comparison-final.jpg`
- responsive evidence: `/Users/dongpochen/.codex/visualizations/2026/07/21/019f8265-e79f-7162-ba7c-e066465f1b26/learn-home-dock-tablet-768x900.jpg`、`/Users/dongpochen/.codex/visualizations/2026/07/21/019f8265-e79f-7162-ba7c-e066465f1b26/learn-home-dock-mobile-390x844.jpg`

## Findings

- No actionable P0/P1/P2 differences remain after applying the requested intentional deviations.
- Live2D 展示层整体上移量从 16px 增至 28px，人物脸部与上半身位置进一步靠上；卡片仍完整裁切人物，没有溢出圆角边界。
- 卡片左上角的可见 “Haru” 名字已移除；仅保留右上角 `LIVE2D` 状态标识。
- Dock 的五个系统应用现均显示 12px 应用名；图标从桌面 66px 增至 74px、窄屏 52px 增至 56px。
- 左上时间日期 header 已整体移除，桌面网格起点从 `y=68` 上移至 `y=28`，增加 40px 上方可用空间。
- 日历、个人中心、通知中心、课程商城、设置已按顺序进入底部玻璃 Dock；课程网格只保留课程入口与“新建课程”。
- 桌面 Dock 实测为 `428 × 114` px，位于 `y=664…778`；最后一排课程底部为 `y=610`，两者仍有 54px 安全间距。五个 Dock 图标使用仓库内同一组系统应用 SVG，没有用文字、Emoji 或 CSS 图形代替。
- “今日学习”已移除，“本周课程”占据左上原位置，左下为真实 Haru Live2D canvas；右上角 Wi-Fi、电量和 `100%` 已移除。
- 课程与系统应用外壳实测均为 `91 × 91` px，保持正方形；课程头像使用与系统应用图标相同的玻璃外壳、圆角、边框和阴影。
- 课程入口只显示课程名；`入门`、`科研向` 等目的/标签副标题不再渲染。

## Required fidelity surfaces

- Fonts and typography: 沿用页面既有 Inter、PingFang SC 和 Microsoft YaHei 字体栈；课程名保持 15px/20px、统一字重与文本阴影。Dock 系统应用名使用 12px/16px，与小尺寸系统启动器层级一致，并继续保留无障碍标签和悬停标题。
- Spacing and layout rhythm: 维持 6 列桌面网格、26px 小组件圆角和 18px/24px 网格间距；左侧两个 2×2 区域与参考图比例一致。移除 32px header 并把内容上边距收至 12px；分页圆点为加高后的 Dock 预留 108px。`390 × 844` 时 Dock 为 `338 × 96` px，并向右微调 8px 避开左下悬浮按钮；没有横向溢出。
- Colors and visual tokens: 沿用原蓝紫壁纸、玻璃透明度、白色边框、阴影和状态色，没有新增不属于当前系统的配色。
- Image quality and asset fidelity: 系统应用继续使用仓库内 SVG；课程继续使用真实课程头像；Haru 使用 `/live2d/Haru/Haru.model3.json` 的真实 Live2D 运行时，加载期间使用仓库内透明 Haru 预览图，不使用占位图或 CSS 绘制角色。
- Copy and content: 左上时间日期不再渲染；保留本周课程、课程名、`LIVE2D` 状态标识和 Dock 应用名。人物名字不再作为可见文本渲染；每个 Dock 按钮同时保留准确的 `aria-label` 和鼠标悬停标题。

## Interaction and runtime evidence

- Dock 的“日历”按钮已实点验证从 `/learn` 导航到 `/calendar`，返回预览后 Dock 和 Live2D 正常恢复。
- 桌面预览最终状态检测到 1 个 Haru canvas、15 个课程图标、1 个网格内“新建课程”和 5 个 Dock 系统应用；DOM 中不存在“今日学习”或伪 `100%` 状态。
- 真实 `/learn` smoke test 检测到 1 个 Haru canvas、5 个 Dock 系统应用和 1 个网格内“新建课程”；当前本地账户没有课程数据，空状态布局正常。
- 最终控制台只有 React DevTools、HMR 和 Fast Refresh 信息，无 error 或 warning。
- Haru 卡片在 `1440 × 790` 与 `390 × 844` 两档视口均检测到 1 个真实 canvas、0 个可见 “Haru” 文本，并且没有横向溢出。
- 桌面实测 5 个 Dock 图标均为 `74 × 74` px，应用名依次为“日历 / 个人中心 / 通知中心 / 课程商城 / 设置”；页面 header 数量为 0，时间日期文本检测为 false。
- `390 × 844` 实测 Dock 完整位于 `x=34…372`、`y=736…832`，五个应用名均可见且未被左下悬浮按钮遮住。

## Comparison history

1. Pass 1 — P2: Haru 使用全舞台取景时在 395×282px 卡片内过小，角色辨识度不足。修复：切换到已有 `half` 取景模式。
2. Pass 2 — P2: Haru 虽可辨识，但角色仍未充分利用卡片面积。修复：向卡片下方延伸 Live2D 画布，使半身取景更突出且保持玻璃卡片裁切。
3. Pass 3 / final — 角色脸部和上半身清晰；课程与系统图标尺寸完全一致；无横向溢出；用户要求删除的文案和网页伪状态栏均不存在。无剩余 P0/P1/P2。
4. Dock pass / final — 将 5 个系统应用从网格收拢到底部 Dock，“新建课程”继续留在课程网格；上移分页圆点并预留底部空间。桌面、平板、窄屏均完整可见，桌面与课程最后一排无重叠。无剩余 P0/P1/P2。
5. Haru position pass / final — Live2D 层上移 16px，移除左上角人物名字。桌面与窄屏均保持完整圆角裁切，人物脸部未被截断，可见文案仅剩 `LIVE2D`。无剩余 P0/P1/P2。
6. Haru second position pass / final — 在上一版基础上继续上移 12px，总上移量为 28px。桌面与窄屏对照均显示人物脸部更靠上，卡片裁切、圆角与 `LIVE2D` 标识保持不变。无剩余 P0/P1/P2。
7. Labeled Dock / final — Dock 图标放大并补充应用名；移除左上时间日期 header，将网格整体上移。首次窄屏检查发现左下悬浮按钮轻微遮挡“日历”标签，随后将窄屏 Dock 向右微调 8px；最终五个标签完整可见，无横向溢出。无剩余 P0/P1/P2。

## Open Questions

- None.

## Implementation Checklist

- [x] 移除“今日学习”与网页伪 Wi-Fi/电量状态。
- [x] “本周课程”移动至左上。
- [x] 左下接入 Haru Live2D 动态展示。
- [x] 课程图标改为系统应用同款正方形外壳。
- [x] 移除课程目的/方向副标签。
- [x] 恢复底部玻璃 Dock，并放入 5 个系统应用。
- [x] 系统应用移出课程网格，只保留“新建课程”。
- [x] Live2D 人物整体上移并移除可见名字。
- [x] Dock 图标放大并显示五个系统应用名称。
- [x] 移除左上时间日期，释放页面纵向空间。
- [x] 验证桌面、平板、窄屏、Dock 日历导航、真实 `/learn` 与控制台状态。

## Follow-up Polish

- No blocking or P3 follow-up is required for this scope.

## Course App icon background removal — 2026-07-21

- source visual truth path: `/Users/dongpochen/Desktop/截屏2026-07-21 下午6.11.46.png`
- implementation screenshot path: `/Users/dongpochen/.codex/visualizations/2026/07/21/019f82c8-c4b0-7c32-ae65-00146d47e73b/openmaic-course-icons-no-frame.png`
- viewport: implementation `1280 × 720` CSS px; source image `1650 × 646` px
- state: `/learn?previewLearnHome=1`, first desktop course page with stable preview courses
- full-view comparison evidence: `/Users/dongpochen/.codex/visualizations/2026/07/21/019f82c8-c4b0-7c32-ae65-00146d47e73b/course-icons-before-after-comparison.png`
- focused comparison evidence: the full comparison is already centered on the complete course-icon grid, so a separate crop was not required.

### Findings

- The source annotation identified the translucent gray-white tile behind every course avatar as the element to remove. The implementation removes that background, border, inset padding, and outer frame shadow.
- Course avatar images now fill the complete `74–96px` responsive App-icon area with the existing 22px radius. The red notebook-count badge remains anchored at the upper-right.
- No actionable P0/P1/P2 differences remain for this scoped request.

### Required fidelity surfaces

- Fonts and typography: course-label font, weight, line height, truncation, and text shadow are unchanged.
- Spacing and layout rhythm: grid tracks, label spacing, drag target size, hover movement, and responsive icon footprint are unchanged; only the inset frame is removed.
- Colors and visual tokens: no new colors were introduced; the course artwork is now the sole icon background.
- Image quality and asset fidelity: real course-avatar assets remain in use with `object-cover`; image resolution hint was raised from 76px to 96px to match the enlarged rendered area.
- Copy and content: course names, badge counts, “新建课程”, and accessibility labels are unchanged.

### Interaction and runtime evidence

- The CSC148 course App remains an enabled button and the preview page exposes all course launchers through their existing accessible names.
- Browser console check returned zero errors.
- Targeted ESLint, TypeScript typecheck, and `git diff --check` all pass.

### Comparison history

1. Initial source state — P2: course artwork sat inside a 78% inset tile, leaving a visible translucent gray-white frame behind it.
2. Final — removed the outer background, border, inset padding, and frame shadow; avatar fills the App-icon footprint while badge and interactions remain intact. No remaining P0/P1/P2.

final result: passed

# 课程论坛数学编辑器 Design QA — 2026-08-13

## Evidence

- Source visual truth: `/Users/dongpochen/Desktop/截屏2026-08-13 下午5.51.57.png` (`2850 × 1550` px).
- Production-component harness screenshots: `/private/tmp/forum-editor-symbols-1600x900.png`, `/private/tmp/forum-editor-formulas-1600x900.png`, `/private/tmp/forum-editor-advanced-fixed-1600x900.png`.
- Combined comparison: `/private/tmp/forum-editor-reference-vs-implementation.png`.
- Viewport: `1600 × 900` CSS px; state: local page mounting the exact production `ForumMarkdownEditor` inside the production dialog dimensions.

## Findings

- Dialog measures `1540 × 864px` at this viewport (`96dvh`), leaving 18px above and below; the editor tool panel is `430px` wide and `618px` high.
- `\\notin` renders as the correct KaTeX `∉` glyph and inserts the LaTeX source `$\\notin$`.
- All six common-formula cards show a rendered preview alongside their source.
- Markdown table, 2×2 matrix, 3×3 matrix, piecewise function, equation system, determinant, and aligned derivation are present. An initial P1 row-break escaping issue was found in matrix cards and fixed; the final cards contain six rendered KaTeX structures and no visible raw `\\begin` source.
- The inserted piecewise template renders correctly in the editor Preview mode.
- Browser console returned zero warnings or errors.

## Interaction evidence

- Clicked the `\\notin` symbol, Common Formulas tab, Advanced Structures tab, piecewise template, and Preview tab.
- Confirmed the right panel remains independently scrollable while the main writing area retains full height.

## Comparison history

1. Initial reference — popup and editor were too short; the right panel was narrow and lacked rendered advanced structures.
2. Pass 1 — height, panel width, symbols, and formula previews were correct, but matrix row separators were normalized incorrectly.
3. Final — matrix/cases templates use protected multiline row breaks; cards and inserted-preview output render correctly. No remaining P0/P1/P2 issues.

final result: passed

# Settings Background Adaptive Height — 2026-08-10

## Evidence

- Source visual truth: `browser-comment://Comment-4` at `1470 × 837` CSS pixels.
- Implementation screenshots: `/private/tmp/settings-background-adaptive-top-final-1470x837.png` and `/private/tmp/settings-background-adaptive-height-final-1470x1186.png`.
- State: `/settings?section=background`, light theme.

## Findings

- The original three-column background cards and their original image dimensions are preserved.
- The Settings shell and content card now grow with the complete gallery instead of constraining the gallery to the viewport height.
- Scrolling belongs to the outer page shell; the background component and settings card do not create independent scroll regions.
- Coral Flow remains the configured default, and invalid or missing background IDs now resolve to that same default rather than the first gallery item.

## Interaction and runtime evidence

- All nine background selection buttons remain interactive and preserve selected-state feedback.
- The adaptive card measured `1128px` client height and `1128px` scroll height; its panel measured `1031px` for both values.
- The outer application page is the sole scroll owner for the complete settings surface.
- Browser console check returned zero errors.
- Focused ESLint, TypeScript typecheck, Prettier, and `git diff --check` pass.

final result: passed

# 教师 AI 队列紧凑列表 Design QA — 2026-08-02

## Evidence

- Source visual truth: `browser-comment://Comment-1`（用户在当前任务中标注的 `1470 × 685` 页面截图）。
- Browser-rendered implementation: `/private/tmp/syntara-ai-queue-compact-1470x685.png`。
- Responsive implementation: `/private/tmp/syntara-ai-queue-compact-673x837.png`。
- Implementation URL: `http://localhost:3000/teacher/courses/local-csc108-2026-summer`，AI 队列页签。
- Source and desktop implementation are both evaluated at `1470 × 685` CSS px and `devicePixelRatio = 1`；无需密度归一化。
- Combined comparison input: 当前任务中的用户标注截图与浏览器渲染截图在同一视觉验收轮次中对照；重点区域即完整的四行 AI 队列列表，无需额外裁切。

## Findings

- No actionable P0/P1/P2 differences remain for the requested density change.
- 完成态队列项从源图约 `110px` 降至实测 `52–53px`，达到“约一半高度”的目标。
- 文件标题、三个类型标签、当前阶段、百分比、进度条、完成状态、持久化状态和更新时间仍完整可见；删除的只是重复阶段文案与多余层级。
- `1470px` 桌面宽度和 `673px` 窄屏均无横向溢出。窄屏采用两行布局，队列项为 `86–87px`，避免三段内容纵向堆叠回原高度。

## Required fidelity surfaces

- Fonts and typography: 沿用教师工作台现有字体、字重和状态色；主标题收为 14px，标签与时间使用 10–11px，长课程名继续截断。
- Spacing and layout rhythm: 桌面改为单行三段网格，图标缩为 32px，纵向 padding 为 10px；四行节奏一致，边框和圆角保持不变。
- Colors and visual tokens: 继续使用既有 emerald、indigo、rose、sky 语义状态色，没有引入新色板。
- Image quality and asset fidelity: 本区域没有位图资产；继续使用项目现有图标组件，没有用文本或 CSS 图形替代。
- Copy and content: 保留所有任务、处理阶段、进度、持久化和更新时间信息；移除左侧重复的“思维导图 · 思维导图已完成”等冗余描述。

## Interaction and runtime evidence

- `1470 × 685` 实测四项高度为 `53 / 53 / 53 / 52px`；页面与队列区域均无横向溢出。
- `673 × 837` 实测四项高度为 `87 / 87 / 87 / 86px`；页面无横向溢出。
- 最终浏览器日志为 0 error；focused ESLint、TypeScript typecheck、Prettier 和 `git diff --check` 均通过。

## Comparison history

1. Initial — P2: 每项约 110px，阶段和完成信息重复，右侧状态与时间分层，纵向空间浪费明显。
2. Pass 1 — 桌面项降至约 71px，但仍没有完全达到用户要求的“一半高度”。
3. Final — 标签与标题合并为同一行，状态和时间合并，桌面项稳定在 52–53px；增加窄屏两行布局，无剩余 P0/P1/P2。

## Open Questions

- None.

final result: passed

# 教师课程工作台窄屏 Design QA — 2026-08-02

## Evidence

- Source visual truth: `/var/folders/fy/p355vwwd683668y784t68b2c0000gn/T/codex-clipboard-683bddf6-549a-4c59-9d71-1d0b34ffb2af.png`
- Implementation URL: `http://localhost:3000/teacher/courses/local-csc108-2026-summer`
- Source pixels: `1345 × 1674`（Retina 2x）；implementation viewport: `673 × 837` CSS px。
- State: 笔记本库，2 本笔记本、2 条课程顺序、2 名学生、3 个已移除项目。

## Findings

- 修复了窄屏仍提前进入桌面双栏的问题：课程顺序与笔记本区现在到 `lg` 才横向并排。
- 修复了 2×4 强制等分网格把笔记本卡片压扁、裁切正文与按钮的问题：窄屏卡片采用固定 220px 高度的一列/两列自适应网格，空槽仅在 `xl` 桌面布局显示。
- 标题、操作按钮、页签间距在窄屏下已收紧；页签保留横向滚动能力，不会压缩或截断页面宽度。
- `673px` 宽度实测页面 `scrollWidth` 与 `innerWidth` 均为 `673px`，无横向溢出；两张笔记本卡片均完整为 `220 × 220px`。
- No actionable P0/P1/P2 differences remain for this scoped responsive fix.

## Interaction and runtime evidence

- 在 `673 × 837` 视口实点切换“学生名单 · 2”并返回“笔记本库”，两个页签均正常工作。
- 学生页切换后仍无横向溢出。
- 最终浏览器日志检查为 0 error、0 warning。
- Prettier、focused ESLint 与 TypeScript typecheck 均通过。

## Comparison history

1. Initial — P1: 固定 2×4 网格在窄屏可用高度内压缩卡片，卡片正文和操作按钮被裁切；桌面双栏断点也过早触发。
2. Pass 1 — 改为窄屏一列/两列、220px 自适应行高，并隐藏无意义的空槽；卡片内容恢复完整。
3. Final — 收紧窄屏标题、按钮和页签尺度，实测 673px 无横向溢出、两卡完整、页签交互正常。

## Open Questions

- None.

final result: passed

# 用量统计设计验收

## Evidence

- Source visual truth: `/Users/dongpochen/Desktop/截屏2026-08-01 下午7.35.26.png`
- Browser-rendered implementation, overview: `/private/tmp/syntara-usage-top.png`
- Browser-rendered implementation, chart and recent-usage table: `/private/tmp/syntara-usage-table.png`
- Combined comparison input: `/private/tmp/syntara-usage-comparison.png`
- Implementation URL: `http://localhost:3000/teacher/usage`
- Browser viewport: 1230 x 685 CSS px in the Codex in-app browser.
- Source pixels: 2274 x 1588. Implementation pixels: 1230 x 685 per capture. The comparison normalizes both columns to 900 px wide: source 900 x 628; each implementation capture 900 x 501. This removes density and frame-width differences while preserving component proportions.
- State: authenticated teacher; two real local usage events; chart grouped by course; recent-event list populated.

## Full-view comparison evidence

The combined input shows the source and implementation together. The implementation preserves the source hierarchy and visual language: a large bordered white usage surface, title and period copy, upper-right grouping control, cumulative green area chart, horizontal grid lines, rotated dates, legend, dashed current-day marker, export action, and a bordered usage table. The existing teacher shell and four summary cards are intentional product-context additions.

## Focused-region comparison evidence

The second implementation capture focuses on the lower chart boundary, legend, export control, table header, and rows. It confirms aligned numeric columns, readable secondary metadata, restrained dividers, consistent rounded surfaces, and no clipping inside the horizontal table viewport. The first implementation capture separately verifies the app header, summary grid, chart title, selector, axis treatment, and current-day marker.

## Primary interactions tested

- Loaded `/teacher/usage` with persisted teacher authentication.
- Switched chart grouping from model to course and verified the selected state and chart redraw.
- Verified the recent-usage table renders indexed records and that the export button is enabled only when records exist.
- Verified the chart tooltip, legend, axes, and current-day marker render from the daily aggregate data.

## Console errors checked

After the chart-container fix, switching from model to course produced no new browser console errors. TypeScript, focused ESLint, Prettier, and `git diff --check` also pass.

## Findings

- No actionable P0, P1, or P2 fidelity, usability, responsiveness, accessibility, icon, asset, or content findings remain.
- Residual test gap: the local teacher currently has two usage events, so the ten-row visual density was verified structurally and through the indexed query limit rather than with ten populated rows.

## Open Questions

- None. Localization, the teacher shell, and the summary cards are intentional differences from the reference rather than fidelity defects.

## Implementation Checklist

- [x] Match the reference chart/table hierarchy within the existing teacher design system.
- [x] Keep the recent-event query limited to ten indexed rows.
- [x] Read totals and chart data from incremental aggregates instead of summing all raw events in the UI.
- [x] Verify model/course grouping and chart redraw in the in-app browser.

## Comparison history

- Initial P1 behavior finding: changing the chart grouping conditionally removed the ECharts host node while the library was disposing its canvas, causing a React `removeChild` exception and a full-page crash.
- Fix made: keep the chart host node mounted across loading and empty states, update its opacity, and render loading/empty overlays above the stable host.
- Post-fix evidence: `/private/tmp/syntara-usage-top.png` and `/private/tmp/syntara-usage-table.png`; the grouping control was switched to course and browser logs since the interaction timestamp contained no errors.

## Follow-up Polish

- None required for this scope.

final result: passed

# 课程聊天多附件输入框 Design QA — 2026-08-04

## Evidence

- Source visual truth: `/Users/dongpochen/Desktop/截屏2026-08-03 下午10.16.05.png`。
- Production URL: `https://www.chatai.ca/learn?courseId=cmsd1ytyh0001l504dlqghfwo&from=teacher`。
- Production DOM evidence: authenticated MAT 102 teacher-chat page exposes a multi-select transient attachment input for image, PDF, text, Markdown, CSV, JSON, and XML, plus a separate multi-select course-source input.
- Static verification: focused ESLint, TypeScript typecheck, Prettier, `git diff --check`, and a full production build passed.

## Implemented fidelity surfaces

- Composer keeps the existing Syntara visual tokens while matching the source hierarchy: horizontally scrollable attachment cards above the text row, compact file icon/name/type presentation, left-side add control, model selector, and circular send action.
- Two PDF cards fit side by side on desktop; additional files continue in the horizontal rail instead of increasing the composer height.
- File removal is available per card, and long names truncate without changing card height.
- Teacher upload actions are separated into “添加到本次聊天” and “上传为课程资料”, so ephemeral files cannot be confused with persisted course content.

## Data and interaction contract

- The browser stores transient attachment bytes in IndexedDB. Remote conversation persistence keeps attachment metadata only.
- PDF files are staged through OpenAI Files only for the active request, deleted after completion, and protected by a one-hour API-side expiration fallback.
- Text-like files are decoded in the browser and bounded before prompt injection; images continue through the existing vision path.
- Up to six attachments can be composed in one turn. Current per-file limits are PDF 4 MB, text-like 1 MB, and image 8 MB.

## Remaining visual verification

- The Chrome control extension repeatedly timed out and reset while opening the native file chooser. Because of that external blocker, the production DOM and deployment were verified, but a final production screenshot containing two selected PDF cards and an actual model reply could not be captured in this run.
- No visual-pass claim is made for that unexecuted browser state. It should be rechecked manually or after browser control recovers.

final result: implementation and deployment passed; production file-selection screenshot pending

# Web Personal Center Redesign Design QA — 2026-08-10

## Evidence

- Source visual truth: `/Users/dongpochen/Downloads/ChatGPT Image 2026年8月10日 01_09_03.png`.
- Implementation screenshot: `/private/tmp/profile-implementation-final-1600.png`.
- Full-view comparison evidence: `/private/tmp/profile-comparison-final.png`.
- Viewport: `1600 × 1000` CSS pixels, device scale factor 1.
- State: web student home preview → Personal Center → light theme.

## Findings

- The 270px sidebar, lavender canvas, 805px desktop content card, 642px identity panel, two-column form, five-plus-six avatar composition, and bottom save action align with the supplied visual hierarchy.
- Teacher and student home dashboards share the same profile component; the account label adapts to the authenticated role.
- Remaining visible content differences are local account data (name, email, usage counts, and role), not layout defects.
- No actionable P0/P1/P2 differences remain.

## Interaction and runtime evidence

- Biography edits update the character count and enable Save.
- School participates in dirty-state detection and persistence.
- Avatar selection updates the selected state; More switches to the next avatar page.
- Unsaved QA edits were cleared by reload.
- Final browser console check returned zero errors.
- Focused ESLint, TypeScript typecheck, Prettier, and `git diff --check` pass.

## Comparison history

1. Pass 1 — P2: sidebar was too narrow, the main card was too short, the identity panel stretched too far, and avatar rows did not match the source rhythm.
2. Final — aligned desktop proportions, constrained the identity panel, matched the reference form inset and avatar rows, removed redundant pager controls, and anchored Save to the card bottom.

final result: passed

# Personal Center and Settings Information Architecture — 2026-08-10

## Evidence

- Source visual truth: `/Users/dongpochen/Downloads/ChatGPT Image 2026年8月10日 01_09_03.png`.
- Personal Center screenshot: `/private/tmp/profile-unified-final-1600.png`.
- Settings screenshot: `/private/tmp/settings-unified-final-1600.png`.
- Full-view comparison evidence: `/private/tmp/profile-settings-unified-comparison.png`.
- Viewport: `1600 × 1000` CSS pixels, device scale factor 1.
- State: student web home preview → Settings and Personal Center → light theme.
- Focused comparison was not required because sidebar labels, headers, cards, and primary controls remain legible in the native-size full-view evidence.

## Findings

- Personal Center now contains only identity and profile data: avatar, display name, biography, school, role, and learning totals.
- Model, image, background, Live2D, and speech controls now live under Settings.
- Settings and Personal Center share the same 270px navigation shell, lavender canvas, white content card, spacing, radius, icon treatment, and selected-state styling.
- The Settings App is present in both student and teacher home system-app collections; the icon-order storage version was advanced so existing users receive the new App in the visible default order.
- No actionable P0/P1/P2 differences remain.

## Interaction and runtime evidence

- Student home exposes an enabled `设置；可拖动排序` App.
- Opening Settings renders the real language-model controls rather than the previous summary placeholder.
- Learning Background and Live2D sections were opened successfully, then Return Home restored the home screen.
- Personal Center exposes a single profile navigation item plus explicit Open Settings, Return Home, and Sign Out actions.
- Browser console check returned zero errors.
- Focused ESLint, TypeScript typecheck, Prettier, and `git diff --check` pass.

## Comparison history

1. Initial — P1: preference destinations were mixed into Personal Center, while the student home omitted the Settings App and the Settings surface used a separate visual language.
2. Final — separated profile identity from application preferences, added Settings to both home variants, rendered the real settings panels, and reused the Personal Center shell and tokens.

final result: passed

# Settings Navigation and Static Companion Posters — 2026-08-10

## Evidence

- Source visual truth: `browser-comment://Comment-1`, `browser-comment://Comment-2`, and `browser-comment://Comment-3` at `1470 × 837` CSS pixels.
- Implementation screenshot: `/private/tmp/settings-companion-posters-compact-final-1470x837.png`.
- Viewport: `1470 × 837` CSS pixels, device scale factor 1.
- State: `/settings?section=live2d`, light theme, Haru selected.
- Full-view comparison evidence: the two labeled browser-comment screenshots in the current task and the final native-size implementation screenshot.
- Focused comparison was not required because the complete header region, navigation, role cards, and poster assets are legible in the full-view evidence.

## Findings

- The top Settings header selected in both browser comments is removed; the active settings card now begins directly below the page inset.
- System Settings, File Parsing, and Web Search are absent from the settings navigation and cannot be selected through the section query allowlist.
- The section is named Companion Role in Chinese, matching its learning-companion purpose rather than a classroom-presenter label.
- Five local `1254 × 1254` poster assets are arranged in one compact desktop row with smaller card spacing and two-line descriptions.
- The settings content no longer creates an internal scrolling region; the page owns vertical overflow when it is needed.
- The character selector creates zero Live2D canvases; Live2D is only instantiated later in the actual companion or classroom surface.
- No actionable P0/P1/P2 differences remain.

## Interaction and runtime evidence

- Navigation counts for System Settings, File Parsing, and Web Search are all zero.
- Header selector `header.learn-dock-profile-toolbar` count is zero.
- Five poster images loaded successfully in a five-column desktop grid and the selected-state card remains functional.
- The panel computed without its former `ipados-settings-content` overflow behavior.
- Browser console check returned zero errors.
- Focused ESLint, TypeScript typecheck, Prettier, and `git diff --check` pass.

## Comparison history

1. Initial — P1: three unwanted settings remained visible; the top header duplicated the active-card heading; several poster URLs were broken; hover/selection instantiated Live2D previews.
2. Final — removed the three sections and top header, renamed the section to Companion Role in Chinese, switched all five models to existing local poster assets, removed the preview runtime path and internal scroll container, and compacted the desktop selector into one row.

final result: passed
