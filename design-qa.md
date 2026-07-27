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
