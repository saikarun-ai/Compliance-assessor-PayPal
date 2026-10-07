# Design System

## Principles

1. Single-page simplicity
2. Chat-first interaction
3. Zero learning curve
4. Local-first aesthetic
5. 4GB-friendly (no web fonts, no images)

## Colors

| Token | Hex |
|-------|-----|
| --bg-primary | #0d1117 |
| --bg-secondary | #161b22 |
| --border | #30363d |
| --text-primary | #c9d1d9 |
| --text-muted | #8b949e |
| --accent-green | #3fb950 |
| --accent-yellow | #d29922 |
| --accent-red | #f85149 |
| --accent-blue | #58a6ff |

## Typography

- Font: ui-monospace, 'SF Mono', Menlo, monospace
- No web fonts
- Body: 14px, line-height 1.5

## Layout

```
┌─────────────────────────────────────┐
│  Compliance Assessor  [Type ▼]      │
├─────────────────────────────────────┤
│  [Chat area]                        │
│  User: React dashboard $2000        │
│                                     │
│  Purpose Code: P0802                │
│     EDF: Nov 30, 2026               │
│     [Create PayPal Invoice]         │
├─────────────────────────────────────┤
│  [Type...]                  [Send]  │
└─────────────────────────────────────┘
```

## Components

- Buttons: bg-secondary, 1px border, 8px/16px padding, 6px radius
- Cards: bg-secondary, border, 8px radius, 16px padding
- Input: bg-secondary, border, 12px padding

## Badges

| Badge | Background | Text |
|-------|-----------|------|
| Success | rgba(63,185,80,.15) | green |
| Warning | rgba(210,153,34,.15) | yellow |
| Error | rgba(248,81,73,.15) | red |
| Info | rgba(88,166,255,.15) | blue |

## Accessibility

- Contrast 4.5:1
- Focus visible
- Keyboard navigable
- No color-only information (EDF state always carries a text label)
