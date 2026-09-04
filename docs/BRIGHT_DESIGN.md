# FeelY Bright Design

The FeelY bright theme is a warm, calm alternative to the default dark theme.
It uses the pink from the FeelY logo as its main accent while keeping reading
surfaces soft and comfortable for longer conversations and journal entries.

## Design principles

- **Warm, not clinical:** use warm whites and pale pinks instead of cold grey.
- **Calm hierarchy:** content should remain more prominent than decoration.
- **Pink as an accent:** reserve strong pink for actions, selection, and focus.
- **Readable reflection:** use dark ink for text and generous spacing for longer copy.
- **Consistent workspaces:** Chat, Map, and Journal share the same header geometry.

## Colour palette

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| App background | `--midnight` | `#fff4f7` | Sidebar and outer canvas |
| Content background | `--night` | `#fffbfc` | Chat and primary workspace |
| Raised surface | `--night-raised` | `#ffffff` | Cards and raised controls |
| Soft accent surface | `--night-soft` | `#ffe8ef` | Switches and subtle highlights |
| Paper | `--paper` | `#fff9f6` | Journal and dialog surfaces |
| Primary text | `--ink` | `#252129` | Headings and body text |
| Muted text | `--paper-muted` | `#71636a` | Supporting information |
| Primary accent | `--lavender` | `#f2789c` | Main actions and selection |
| Strong accent | `--orchid` | `#d9557d` | Focus and emphasis |
| Secondary pink | `--coral` | `#e47794` | Avatars and supporting accents |
| Mint accent | `--mint` | `#82b7a8` | Journal and reflective signals |
| Divider | `--line-dark` | `rgba(76, 46, 58, 0.16)` | Borders and separators |

Use `#79666f` for secondary text on bright surfaces. Do not use the primary pink
for long text: it is an accent colour, not a body-text colour.

## CSS theme tokens

The implemented theme is activated with `data-theme="light"` on the `<html>`
element. These are the source tokens used by the website:

```css
html[data-theme="light"] {
  color-scheme: light;
  --midnight: #fff4f7;
  --night: #fffbfc;
  --night-raised: #ffffff;
  --night-soft: #ffe8ef;
  --paper: #fff9f6;
  --paper-muted: #71636a;
  --lavender: #f2789c;
  --orchid: #d9557d;
  --coral: #e47794;
  --line-dark: rgba(76, 46, 58, 0.16);
  --scrollbar-thumb: rgba(217, 85, 125, 0.44);
  --scrollbar-thumb-hover: rgba(217, 85, 125, 0.72);
  --shadow: 0 22px 60px rgba(93, 52, 67, 0.16);
}
```

## Typography

- **Headings:** Manrope, with DM Sans as fallback.
- **Interface and body:** DM Sans, with system sans-serif fallbacks.
- **Workspace title:** `19px` desktop, `16px` mobile.
- **Eyebrow label:** `11px` desktop, `9px` mobile; bold and uppercase.
- **Body copy:** normally `13px` to `15px`, depending on context.
- **Long text:** use comfortable line heights between `1.5` and `1.7`.

Avoid oversized headings inside the application. The writing and conversation
should be the visual focus.

## Layout

### Workspace headers

Chat, Map, and Journal use the same header dimensions:

| Viewport | Height | Title size | Horizontal padding |
| --- | ---: | ---: | ---: |
| Desktop | `76px` | `19px` | `22px` |
| Mobile | `68px` plus safe area | `16px` | `14px` plus safe area |
| Short landscape | `56px` plus safe area | `17px` | `10px` plus safe area |

Titles stay on one line and use an ellipsis when space is limited.

### Sidebar

- Use `#fff3f6` as the bright sidebar background.
- Keep navigation, creation buttons, and the account row fixed.
- Scroll only the conversation, topic, or journal-entry list.
- Use pale pink for active and hover states; avoid solid blocks of saturated pink.

### Main surfaces

- **Chat:** near-white background (`#fffbfc`) with a pale pink user-message bubble
  (`#ffd6e1`). Assistant responses remain visually quiet with a pink marker.
- **Map:** use a very light pink-to-warm-white background with restrained radial
  accents. Topic nodes should remain mostly white until selected.
- **Journal:** use warm paper (`#fffaf6`) so it feels distinct from navigation.
- **Dialogs:** use warm paper or white, soft borders, and a subtle rose-tinted shadow.

## Components and states

- **Primary buttons:** strong pink background with dark text where contrast permits.
- **Secondary buttons:** transparent or white with a muted rose border.
- **Selected items:** pale pink fill and a stronger pink border.
- **Focus:** a visible pink outline or a soft three-pixel pink focus ring.
- **Premium badges:** pale pink pill, dark rose text, and a thin rose border.
- **Theme switch:** pale pink track with a circular pink selection indicator.
- **Scrollbar:** slim, rounded, semi-transparent pink; stronger pink on hover.

All interactive states must remain understandable without relying on colour alone.
Use borders, labels, icons, or shape changes alongside colour.

## Motion

- Keep transitions short, normally `120ms` to `180ms`.
- Use motion only to clarify selection, opening, or movement.
- Honour `prefers-reduced-motion` and remove nonessential animation.

## Content tone

Interface language should be calm, direct, and non-judgmental. Prefer short labels
such as "Write and reflect", "Find map insights", and "New conversation". Avoid
clinical claims or language that tells a person what they must be feeling.

## Implementation source

The live implementation is in [`website/styles.css`](../website/styles.css), with
theme selection and persistence in [`website/app.js`](../website/app.js). This
document is a design reference; update it whenever the light-theme tokens or core
workspace dimensions change.
