# Syntara Brand Color System

Syntara's interface palette is derived from the product mark rather than from a generic purple AI theme.

## Core roles

| Role | Source color | Interface use |
| --- | --- | --- |
| Brand ink | `#011E46` | Brand identity, strong navigation surfaces, high-emphasis headings |
| Brand teal | `#03A0AF` | Focus rings, links, selected navigation, interactive highlights |
| Accessible teal | `#087F8C` | Primary buttons and text on light surfaces |
| Brand gold | `#FAB206` | Sparse emphasis, milestones, warnings and featured moments |
| Brand orange | `#E97817` | Secondary chart series and warm emphasis |

The light theme uses cool white and blue-gray surfaces. The dark theme uses navy surfaces with bright teal interaction states.

## Usage rules

- Use semantic utilities such as `primary`, `accent`, `muted`, `destructive`, and chart tokens for application UI.
- Use `brand-*`, `ink-*`, and `gold-*` only when a specific brand role is needed.
- Purple is not a general Syntara interaction color. Legacy `violet-*` and `purple-*` utilities temporarily resolve to the brand teal scale while components migrate to semantic tokens.
- Keep green for success, red or rose for errors and unresolved work, and amber or gold for warnings and constraints.
- Do not use gold as body text or as a large background. It is an accent and should remain visually scarce.
- Authored course content, generated slides, user avatars, and imported images may keep their own palettes; the application chrome should not recolor them.

## Accessibility

- `#087F8C` on white has a contrast ratio of approximately `4.75:1` and is suitable for normal text.
- `#011E46` on white has a contrast ratio of approximately `16.46:1`.
- `#22C7D3` on the dark canvas `#061422` has a contrast ratio of approximately `9:1`.
- Focus states must remain visible independently of color through rings, borders, or shape changes.
