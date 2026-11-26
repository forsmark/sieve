---
name: Sieve
description: One dark grey ground, four flat color fields with near-black text, connected tiles with notches.
colors:
  field-yellow: "#ffca31"
  field-yellow-strong: "#ffd95f"
  field-blue: "#cad5d4"
  field-pink: "#ffb9ce"
  field-beige: "#e4dcd3"
  ground: "#27282b"
  ground-raised: "#323337"
  line: "#48494e"
  line-strong: "#76777d"
  text: "#f5f3ee"
  muted: "#b9b8b2"
  faint: "#a3a29c"
  ink: "#131314"
  ink-muted: "#3f3d3a"
  danger: "#ff8672"
  danger-soft: "#40282a"
  danger-on-field: "#8c1c0c"
typography:
  display:
    fontFamily: "'Schibsted Grotesk Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "6rem"
    fontWeight: 800
    lineHeight: 0.8
    letterSpacing: "-0.025em"
    fontFeature: "tnum"
  score-card:
    fontFamily: "'Schibsted Grotesk Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "2rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontFeature: "tnum"
  headline:
    fontFamily: "'Schibsted Grotesk Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.11
    letterSpacing: "-0.025em"
  headline-detail:
    fontFamily: "'Schibsted Grotesk Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "'Schibsted Grotesk Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  title-tile:
    fontFamily: "'Schibsted Grotesk Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Schibsted Grotesk Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  reading:
    fontFamily: "'Schibsted Grotesk Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "'Schibsted Grotesk Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.45
  caption:
    fontFamily: "'Schibsted Grotesk Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.33
  badge:
    fontFamily: "'Schibsted Grotesk Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "16px"
  mono:
    fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  none: "0"
spacing:
  channel: "6px"
  notch: "11px"
  card-padding: "14px"
  tile-padding: "16px"
  tile-padding-wide: "20px"
  page-padding: "12px"
  page-padding-wide: "24px"
components:
  button-primary:
    backgroundColor: "{colors.field-yellow}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.field-yellow-strong}"
    textColor: "{colors.ink}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.ground-raised}"
    textColor: "{colors.text}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.ground-raised}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "36px"
  button-danger-hover:
    backgroundColor: "{colors.danger-soft}"
  button-small:
    typography: "{typography.label}"
    padding: "0 10px"
    height: "28px"
  button-touch:
    height: "44px"
    width: "44px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "6px 10px"
    height: "36px"
  input-touch:
    fontSize: "16px"
    height: "44px"
  slider-thumb:
    backgroundColor: "{colors.field-yellow}"
    rounded: "{rounded.none}"
    width: "20px"
    height: "20px"
  badge:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.badge}"
    rounded: "{rounded.none}"
    padding: "1px 6px"
  score-block-high:
    backgroundColor: "{colors.field-yellow}"
    textColor: "{colors.ink}"
    typography: "{typography.score-card}"
    rounded: "{rounded.none}"
    height: "44px"
  score-block-medium:
    backgroundColor: "transparent"
    textColor: "{colors.field-yellow}"
  score-block-low:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
  score-block-none:
    backgroundColor: "transparent"
    textColor: "{colors.faint}"
  job-card:
    backgroundColor: "{colors.ground-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "14px"
    height: "184px"
  job-card-open:
    backgroundColor: "{colors.field-yellow}"
    textColor: "{colors.ink}"
  tile-yellow:
    backgroundColor: "{colors.field-yellow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "16px"
  tile-blue:
    backgroundColor: "{colors.field-blue}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "16px"
  tile-pink:
    backgroundColor: "{colors.field-pink}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "16px"
  tile-beige:
    backgroundColor: "{colors.field-beige}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "16px"
  tile-ground:
    backgroundColor: "{colors.ground-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "16px"
  board-card:
    backgroundColor: "{colors.field-pink}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "12px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.body}"
    height: "56px"
  nav-link-active:
    textColor: "{colors.text}"
  toast:
    backgroundColor: "{colors.field-yellow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "4px 4px 4px 16px"
---

# Design System: Sieve

## Overview

**Creative North Star: "Connected Tiles"**

The interface has one theme. The ground is dark grey (not black), and text on it is off-white. Four flat color fields sit on the ground: yellow, pale blue-grey, pink, and beige. Every field carries near-black text. Color is not decoration here: each field names one kind of content, so the user can tell what a block holds before reading it.

The posting detail and the application board are built from tiles that touch, with a thin channel of ground between them. A triangular notch in the color of a tile crosses the channel into the next tile and says "the next tile follows from this one". The score tile points to the parts it is computed from; a board stage points to the stage that follows it. The jobs list uses the same channel as a grid of cards of equal height, each with a large score numeral.

All corners are square, rules are 1px hairlines, and no surface casts a shadow. One grotesk family does all the text work, with tabular numerals and heavy weights for scores. Controls are standard web controls drawn with a 1px border.

**Key Characteristics:**
- One theme on a dark grey ground; there is no light theme.
- Four flat color fields with near-black text; the color names the kind of content.
- Zero corner radius, 1px hairline rules, no shadows.
- Tiles that touch across a 6px channel, linked by triangular notches.
- Large tabular score numerals in weight 800.
- Color fills an opened card and the detail tiles from the top in 420ms.
- A card moves to its new place in 420ms when a score changes its rank. A column change and a scroll do not animate. The keyboard cursor stays on its posting.

## Colors

A dark grey ground with off-white text, and four flat fields that each carry one meaning.

### Primary
- **Yellow field** (`field-yellow`): the score and the primary action. It fills the score tile, the strong-match score block, the score bars, the opened job card, the primary button, and the space that a swipe to "Save" uncovers at the threshold. It also marks the selected state of a control (checked switch, selected segment, status filter chip that is on) and the outline of a selected card or a drop target. On the ground it is otherwise used only for the active navigation underline, the focus ring, text selection, and the 2px underline of text links. No status dot, badge, count, or notice is yellow. Information messages (toast, undo bar, first-run guide) are yellow fields.
- **Yellow field, hover** (`field-yellow-strong`): the hover fill of the primary button only.

### Secondary
- **Pale blue-grey field** (`field-blue`): facts and skills. It fills the "Matched skills" and "Facts" tiles, and it draws the 1px border of the "Missing skills" tile.

### Tertiary
- **Pink field** (`field-pink`): the cover letter and applications. It fills the cover letter tile, the application cards on the board, the application count in the navigation, and the space that a swipe to "Mark applied" uncovers at the threshold.
- **Ground with a hairline border**: the expanded analysis. It is a judgment like the assessment, so it has no color field. The verdict is one word in the weight of the score numeral.
- **Beige field** (`field-beige`): the posting text. It fills the "Description" tile and the stored posting copy in the application panel.

### Neutral
- **Dark grey ground** (`ground`): the page background, and the color of the channel between tiles.
- **Raised ground** (`ground-raised`): job cards at rest, ground tiles (score parts, assessment, sources, board columns), and the hover fill of secondary and ghost buttons.
- **Hairline** (`line`): quiet dividers such as the filter bar, the status bar, and the panel header.
- **Strong hairline** (`line-strong`, #76777d): borders of controls, badges, and skill labels; the track of a slider; the scrollbar thumb. It has a contrast of 3.3:1 on the ground, so a control's border reaches 3:1.
- **Off-white text** (`text`): body text on the ground. It also draws the 1px rule that closes the top bar and opens each form section, and it carries the small signals that are not a score: the unread marker, the unread count, the "ok" status dot, the checked checkbox, and the border of an emphasized badge.
- **Muted text** (`muted`): secondary text on the ground.
- **Faint text** (`faint`): the least important text on the ground, such as placeholders and the source line of a card.
- **Ink** (`ink`): all text on a color field. Also the fill of an inverted score block on a field.
- **Muted ink** (`ink-muted`): secondary text on a color field.
- **Danger** (`danger`), **danger ground** (`danger-soft`): errors, failed and excluded states on the ground. On a color field, danger text uses **danger on field** (`danger-on-field`).

### Named Rules
**The Color Names Content Rule.** Yellow is the score and the primary action. Blue-grey is facts and skills. Pink is the cover letter and applications. Beige is the posting text. A field is never chosen for variety.

**The Ink On Fields Rule.** Text on a color field is ink. Secondary text on a field is muted ink, never grey. Borders on a field are ink at 28% or 55% opacity, and the focus ring turns from yellow to ink.

**The Reserved Yellow Rule.** Yellow on the ground belongs to the score, the primary action, and the selected state of a control, plus four fixed signals: the active navigation underline, the focus ring, text selection, and the underline of text links. The selected state means a checked switch, a selected segment, an active filter chip, the outline of a selected card, and the outline of a drop target. Badges, counts, status dots, notices, and the unread marker are off-white or outlined, never yellow.

**The Inverted Score Rule.** A score shown on a color field is an ink block with the numeral in the color of that field (yellow on the opened card, pink on a board card).

## Typography

**Display Font:** Schibsted Grotesk Variable (with ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif), self-hosted through @fontsource-variable
**Body Font:** the same family
**Label/Mono Font:** ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace; used for keyboard keys, commands, identifiers, file names, and the log

**Character:** One grotesk family in weights 400 to 800. Size and weight carry the hierarchy; there is no second typeface for headings.

### Hierarchy
- **Display** (800, 6rem, line-height 0.8, tabular numerals): the total score in the yellow score tile. It is the largest numeral on the screen.
- **Score on a card** (800, 2rem, line-height 1, tabular numerals): the score block on each job card. The count in a board column head uses the same weight at 1.5rem.
- **Headline** (700, 2.25rem, tight tracking): the page title of Board, Profile, Settings, and Activity.
- **Detail headline** (700, 1.875rem, line-height 1.1, tight tracking): the title of the open posting.
- **Title** (700, 1.25rem): the heading of a form section.
- **Tile title** (700, 1rem): the heading of a tile and of a board column.
- **Body** (400, 14px, line-height 1.45): the default text.
- **Reading text** (400, 15px, line-height 1.625, at most 70ch): the assessment, the facts summary, the description, and the cover letter. The title of a job card is also 15px, in 700 when unread or open and 500 when read.
- **Label** (500 or 600, 13px): field labels, small buttons, skill labels, card meta lines, notices.
- **Caption** (400, 12px): hints and the status bar. The foot of a job card uses 13px, and its badges keep 11px.
- **Badge** (600, 11px, line-height 16px): state badges.

The wordmark "sieve" is lowercase in weight 800 at 1.5rem in the top bar (1.25rem below 640px width) and at 3rem on the login screen.

### Named Rules
**The Tabular Numeral Rule.** Scores, counts, dates in lists, and ages use tabular numerals, so numbers align between cards and rows.

**The Weight Shows Read State Rule.** On a job card, an unread title is weight 700 in off-white text, and a read title is weight 500 in muted text.

## Layout

The shell fills the viewport height and has three bands. The top bar is 56px high and holds the wordmark, five text links, and, from 640px width, the log-out button; a 1px rule in the text color closes it. The main area scrolls inside itself. The status bar at the bottom is at least 36px high (44px below 640px width, where it is one line), in 12px text, with a 1px hairline above it. Its bottom padding grows to the device's safe area, so the home indicator of a phone never covers it. Horizontal page padding is 12px, and 24px from 640px width.

**Safe areas.** Opened from the home screen, the page runs under the device's status bar (`black-translucent`). The top bar keeps its 56px and adds the top safe-area inset above its content. The shell pads its left and right edges by the side insets, and the page padding comes inside that. The full-screen panels below 1024px, the job detail and the application panel, pad by the top, left, and right insets in the same way.

**Jobs.** The list is a grid of cards. Each card is 184px high and at least 270px wide, with a 6px channel between cards. The number of columns follows from the page width and is never more than 6. When a posting is open and the window is at least 1024px wide, the detail panel covers some columns and the cards keep their width: 3 card columns stay on a page of 5 or 6 columns, 2 columns stay on a page of 4, and 1 column stays on a narrower page. Below 1024px the detail covers the whole screen and has a "Back to list" button.

**Detail mosaic.** The tiles sit on a grid of 6 columns with a 6px channel. When the mosaic itself is at least 448px wide, the score tile takes 2 columns and the score parts take 4, and the two skill tiles take 3 columns each. When it is narrower, every tile takes the full width and the side notch of the score tile becomes a down notch. When the mosaic is at least 768px wide (48rem), the assessment and the cover letter sit side by side at 3 columns each, and "Facts" (2 columns) sits beside "Description" (4 columns). "Facts" then keeps its own height and stays at the top of the scrolling panel while the description scrolls. Below 768px of mosaic width, CSS `order` puts the cover letter, the expanded analysis, and the sources after the description: score, breakdown, skills, assessment, facts, description, cover letter, analysis, sources. The DOM order stays, so the tab order on wide screens does not change. Tile padding is 16px, and 20px from 640px width.

**Detail view on a phone.** Below 1024px, where the detail covers the screen, its triage buttons leave the header for a bar under the detail's scroller. The bar is a flex sibling of the scroller, so it never covers text. It has a ground fill, a 1px rule in the text color on top, 12px side padding, 8px top padding, and a bottom padding of the safe area but at least 8px. It holds the buttons of the posting's status, 44px high, sharing the width 8px apart: Save, Dismiss or Restore, and "Mark as applied" as the primary button or "Open on board". Rescore stays in the header. The detail header row is 40px, 48px on a touch screen.

**Job list on a phone.** Below 640px:
- The Filters button opens the filters as a full-screen sheet on the ground: a header with "Filters" in 20px weight 700 and a Close button, the fields in a scrolling body, and a footer with a full-width primary button "Show N postings" of 44px that closes the sheet. Filters write to the address at once, so the count is live. The sheet never opens by itself; "Filters (N)" says that filters are on. From 640px the panel opens in the page, and on load when filters are set.
- With a selection, the bulk actions sit in a bar at the bottom of the list column, above the status bar: Save, Dismiss, and Applied as 44px secondary buttons, sharing the width with a 44px "More" select for Restore, Rescore, Analyze, "Mark read", and "Mark unread". The select runs the chosen action and shows "More" again. Clear stands beside "N selected" in the top row. From 640px every action stays in the top row.

**Undo control.** While the latest undoable action is a triage and its message has closed, the job list's top row shows an undo control at its right end: a small ghost button (28px, 44px on a touch screen) in 13px, "Undo" in weight 700 with a 2px yellow underline, then " · <message>". It shortens with an ellipsis, and its accessible name holds the whole message. It runs the same undo as the `u` key.

**Keyboard hints on a touch screen.** The Shortcuts button and the board's drag hint are hidden, and the search placeholder reads "Search jobs" without "/". The `?` key still opens the shortcut list.

**Board.** Five stage columns stand side by side from 768px width, and each column scrolls inside itself. Below 768px the columns stack in one column and scroll with the page. The application panel is 480px wide from 1024px width, and covers the whole screen below it. On a touch screen the drag hint above the columns is hidden, because drag and the arrow keys need a mouse and a keyboard.

**Form pages.** All screens share one left edge. The content column of Profile, Settings, and Activity starts at the page padding and is not centered; it is at most 56rem wide on Profile and Settings and 64rem on Activity. A section opens with a 1px rule in the text color, then its title, then its content with 40px of space below.

**Form pages on a phone.** Below 640px:
- Each profile weight takes two lines: the label and the share in percent, then the slider and the number field. From 640px a weight is one row: a 104px label, the slider, a 72px number, and a 56px share.
- Each skill row puts the name on its own line, then level, years, and Remove, and each field shows its label above it. From 640px the skill rows share one grid under a header row "Skill, Level, Years" in 12px muted weight 500.
- Each source of a fetch run on Activity takes two lines under a hairline: the source name and its state in 13px, then the counts in 12px muted tabular text, such as "41 found · 7 new · 2 invalid". From 640px the sources form a table.

## Elevation & Depth

The system is flat. No surface casts a shadow, and all shadow tokens of the framework are set to nothing. Depth is shown in two ways only: the raised ground is one step lighter than the ground, and a color field stands out from both. A panel that opens beside the list is divided from it by a 1px rule in the text color. Below 1024px a panel covers the screen completely, and its scrolling content ends with bottom padding of at least the device's safe area, so its last line stays above the home indicator of a phone. The shortcut dialog darkens the page behind it with ink at 70% opacity.

### Named Rules
**The Flat Surface Rule.** Surfaces are flat at rest and in every state. Hover, selection, and focus change fill, border, or outline, never elevation.

## Shapes

Every corner is square (radius 0). Borders and rules are 1px. Outlines for focus, the active card, a selected card, and a drop target are 2px.

The notch is the one recurring figure. It is a triangle, 22px wide and 11px deep, in the color of its tile. It crosses the 6px channel into the next tile, and a triangle in the ground color around it keeps the channel visible. A down notch starts 28px from the left edge of its tile. A side notch starts 20px from the top edge and exists only when two tiles sit side by side; when the tiles stack, it becomes a down notch.

Small markers are squares of 8px: the unread marker on a card and the status dots in the status bar. Icons are line drawings in a 16px box with a 1.75px stroke and square ends, shown at 14px. The loading spinner is a rotating square outline with one open side. No round shape exists in the system.

### Named Rules
**The Notch Means Follows Rule.** A notch points from a tile to the tile that follows from it: the score to its parts, the parts to the skills, the skills to the assessment, the assessment to the cover letter, a board stage to the next stage. A tile with no such relation has no notch.

## Components

Controls are plain and exact: a 1px border, a transparent fill, and a change of fill or border on hover.

### Touch screens
A touch screen is a question of the pointer, not of the width: the rules below apply when the primary pointer is coarse (`@media (pointer: coarse)`, the `touch:` variant), at any width. A narrow desktop window keeps the mouse sizes, and a tablet gets the touch sizes. The layouts that need room on the screen follow the width breakpoints instead.

**The Touch Target Rule.** On a touch screen every button, input, select, filter chip, segment, summary row, switch, and text link in a panel header has a hit area of at least 44 by 44px. A control whose text or look must stay small gets its area from padding or from an invisible `::after` that reaches 44px around it: the switch, the summary rows, and the text links in panel headers. With a mouse every control keeps the size given below.

**The 16px Form Text Rule.** On a touch screen inputs, selects, and text areas use 16px text, so Safari on iOS does not zoom the page when one gets focus. The rule holds for every field, also one whose class sets a smaller text size. The page keeps pinch zoom: the viewport does not set `maximum-scale`.

### Buttons
- **Shape:** square corners (0), 1px border, weight 600. The default height is 36px with 16px side padding in 14px text. The small size is 28px with 10px side padding in 13px text. On a touch screen both sizes are 44px high and at least 44px wide, in the same text.
- **Primary:** yellow fill and yellow border with ink text. Hover changes the fill to the lighter yellow. On a color field the primary button becomes an ink fill with off-white text.
- **Secondary:** transparent with a strong hairline border and off-white text. Hover changes the border to the text color and the fill to the raised ground.
- **Ghost:** no visible border. Hover fills with the raised ground.
- **Danger:** transparent with a danger border and danger text. Hover fills with the danger ground. A destructive action first shows a secondary button; the danger button appears with "Cancel" after the first click.
- **States:** color transitions only. A disabled button has 45% opacity. A busy button shows the spinner before its label.

### Badges and labels
- **Badge:** 1px border, no fill, 11px text in weight 600. Neutral is a strong hairline with muted text; accent and ok are a border and text in the text color; danger is danger border and text; warn is a dashed strong hairline with off-white text.
- **Key cap:** a keyboard key in the monospace stack at 12px with a 1px strong hairline border; it does not wrap. In the shortcut dialog the key caps have a raised ground fill and stand in a column of 6.5rem.
- **Skill label and tag:** 1px border in 13px or 12px text, no fill. Inside a field the border and text are ink. A tag is a button; hover fills it with ink.

### Score block
The score numeral in a block of 44px height on a job card. The band shows as fill and outline as well as in words: a strong match is a yellow block with an ink numeral; a good match is a yellow numeral in a 1px yellow outline; lower bands are off-white or faint numerals in a 1px hairline outline. On an open card the block is ink with a yellow numeral. The band label stands beside the block in 12px muted text, with a bar of 4px height below it (at most 112px wide) that shows the total score as a yellow length on a ground-colored track. On an open card the bar is ink on a track of ink at 20% opacity.

### Job card
- **Shape and size:** square, 184px high, 14px padding, raised ground fill.
- **Content:** score block, band label, and score bar on top, title in at most 2 lines, a meta line, and a foot with badges, sources, and age. An unread posting has an 8px off-white square before its title (ink on the open card). A checkbox for selection sits in the top right corner.
- **States:** hover lightens the fill. The card under the keyboard cursor has a 2px inset outline in the text color; a selected card has a 2px inset yellow outline. The arrow keys move the keyboard cursor in the grid: left and right by one card, up and down by one row. The opened card turns yellow with ink text, and the yellow fills the card from the top in 420ms.
- **Swipe:** on a touch screen the card follows a finger sideways and uncovers the ground of its slot, and the slot clips the card. The uncovered space names the action of a release on the side the card leaves, in 15px: "Dismiss", "Save", "Mark applied", "Back to new", or "Remove application". Before the threshold the words are muted in weight 500 on the ground. At the threshold (30% of the card width, 72 to 140px) they turn weight 700, and the space takes the look of the action: "Save" a yellow field and "Mark applied" a pink field, both with ink text; "Dismiss" and "Back to new" off-white text in a 1px strong hairline frame; "Remove application" danger text in a 1px danger frame. After a release the card slides out of its slot, or back into place, in 180ms with the curve cubic-bezier(0.16, 1, 0.3, 1). With reduced motion set in the system, it moves at once.

### Mosaic tiles
- **Shape:** square, 16px padding (20px from 640px width), a tile title in weight 700 at 1rem.
- **Colors:** yellow, blue-grey, pink, and beige tiles are color fields with ink text. A ground tile uses the raised ground with off-white text. The "Missing skills" tile is a ground tile with a 1px blue-grey border.
- **Score tile:** yellow, with the total in the display size, the band label below it, and under the label an ink bar of 6px height on a track of ink at 20% opacity. It has a notch to the "How the score is built" tile (a side notch, or a down notch when the tiles stack).
- **Breakdown tile:** four parts as yellow bars of 10px height on a ground-colored track, each with its number in weight 700. Under each part name stands its weight in percent in 12px faint text. One sentence in 12px muted text below the bars says how the parts give the total.
- **Notches:** score to breakdown, breakdown down, skills down to the assessment, the assessment to the cover letter. When the two skill tiles sit side by side (mosaic at least 448px wide), "Matched skills" carries the notch to the assessment. When they stack, "Matched skills" has none and "Missing skills", which then sits directly above the assessment, carries it. The notch from the assessment to the cover letter is a side notch when the two sit side by side (mosaic at least 768px wide). Below that "Facts" follows the assessment, so the assessment has no notch. An empty "Missing skills" tile is one line, "Missing skills: none", in 16px weight 700 with 12px vertical padding; it spans the full width under "Matched skills" and carries the down notch to the assessment. The other tiles have no notch.
- **Motion:** each tile fills from the top in 420ms with the curve cubic-bezier(0.16, 1, 0.3, 1). Each following tile starts 45ms later. With reduced motion set in the system, the tiles appear at once.

### Board columns and application cards
- **Column:** a ground tile with the stage name in weight 700 and the count in weight 800 at 1.5rem in muted text. The "Applied" and "Interview" columns have a side notch from 768px width. A column that is a drop target has a 2px inset yellow outline. Below 768px a column is at least 96px high and grows with its cards.
- **Application card:** a pink field with 12px padding: title in 15px weight 700, company, an inverted score block, the applied date, and a stage menu of 28px height (44px with 16px text on a touch screen) that fills the card width and has no visible text label. The open card has a 2px inset ink outline. A dragged card has 50% opacity. Cards fade in and out in 150ms.
- **Application panel:** it has no save buttons. It stores the notes when the field loses focus, when the panel closes, and when the page is hidden. It stores the interview date as soon as a whole date is chosen. A 12px muted caption under each field says "Saving…" while a store runs and "Saved" while the field matches the stored value. A failed store shows the error toast, and the panel shows the typed notes again the next time it opens.

### Inputs / Fields
- **Style:** transparent fill, 1px strong hairline border, square corners, 36px height, 14px text, faint placeholder. On a touch screen the height is 44px and the text 16px; a text area keeps its height and gets the 16px text. A label in 13px weight 500 stands above the control and a hint in 12px muted text below it.
- **Hover / Focus:** hover changes the border to the text color. Focus changes the border to yellow and adds the 2px yellow focus ring at 2px offset. On a color field both are ink. The caret is yellow on the ground and ink on a field.
- **Select:** the same border and height as a text input, also on a touch screen, with the ground as fill. Inside a color field the fill is transparent, so the field shows through and the text is ink. The option list, which the browser draws, has a fixed pair of ground fill and off-white text.
- **Checkbox:** a square of 16px with a 1px strong hairline border and no fill. Hover changes the border to the text color. Checked: a fill in the text color with a drawn check of 2px stroke and square ends. Mixed, when part of a group is checked: a border in the text color and a dash of 8 by 2px in the text color, with no fill.
- **Switch:** a square track of 36 by 20px with a 1px border and a square thumb of 14px. On: yellow track with an ink thumb. Off: transparent track with a muted thumb. On a touch screen an invisible area of 44 by 44px around the track takes the tap; the track keeps its size.
- **Slider:** a square thumb of 20px in the accent color (yellow on the ground, ink on a field) on a track of a 1px strong hairline, in a row of 20px. On a touch screen the row is 44px high.
- **Segmented control:** segments inside one strong hairline border, divided by hairlines. The selected segment is yellow with ink text in weight 600. On a touch screen each segment is at least 44px high.
- **Status filter chip:** a 28px label with a checkbox, 44px on a touch screen. On: yellow fill with ink text. Off: strong hairline border with muted text.
- **Summary row:** the row that opens a folded part keeps its text size. On a touch screen padding makes it at least 44px high.
- **Error:** a box with a 1px danger border on the danger ground, with a title in danger text.

### Navigation
- **Top bar:** the lowercase wordmark, then text links in 14px weight 500. A link is muted at rest and off-white on hover. The current link is off-white with a 2px yellow line on the bottom edge of the bar. The unread count is an off-white block with ground-colored numerals; the application count is a pink block with ink numerals and counts the open applications: applied, interview, and offer. From 640px "Log out" is a ghost button at the right end of the bar. Below 640px the bar has none, and Settings ends with an "Account" section holding "Log out" whenever a password is set. Below 640px width the links are 13px and scroll sideways without a visible scrollbar.
- **Status bar:** 12px muted text with square status dots (off-white for ok, danger for a fault, faint for unknown, a hollow square with a 1px off-white border for busy; no dot is yellow), ghost buttons of 24px height, and "Matching paused" as off-white text in weight 600 inside a 1px off-white border. Below 640px width the status bar is one line, at least 44px high, and the whole bar is a link to Activity. It holds no buttons: the fetch state, "Matching paused" when matching is paused, the model dot and text, the queue count ("Queue 7"), and the connection at the right end. Only the first item shortens with an ellipsis; faults and the connection stay whole. "Fetch now" and "Pause matching" ("Resume matching" while paused) stand beside the Activity title at every width, as secondary buttons that wrap below the title when there is no room. The connection item at the right end says "Live", "Connecting", or "Reconnecting" with its dot. While the device has no network it says "Offline" in off-white text with a danger dot instead, and an action that changes data fails at once with the error toast "The device is offline." instead of waiting.
- **Text links:** every text link on the ground is off-white in weight 600 or 500 with a 2px yellow underline, in running text and for standalone links such as "Open posting". On hover the underline of a standalone link changes to the text color. On a color field the link is ink with a 2px ink underline. The section links in Settings are muted text in weight 500 with a strong hairline underline; hover changes both to the text color.

### Messages
- **Toast and undo bar:** a yellow field with ink text in weight 500, with 16px padding before the text and 4px around the buttons. An error toast is a danger border on the danger ground. The Undo button is 44px high and at least 64px wide, in weight 700 with a 2px underline. The close button is a 44 by 44px area around a 14px close icon, 16px after the Undo button. After a stage move on the board, a toast says "Moved to <Stage>." with Undo; the undo is an ordinary stage change, so the history shows both moves. A toast rises 8px and fades in over 160ms. Toasts stack just above the status bar: 12px above it below 640px width, 20px above it and at the right edge from 640px. When a bar stands at the bottom edge, such as the detail action bar or the bulk bar, it sets `--bottom-bar` on the root element to how far its top edge rises above the status bar's top edge, and the toasts stand that much higher. A bar above the status bar gives its whole height; a bar in a full-screen panel that covers the status bar gives its height less the status bar's.
- **Notice:** a 1px bordered box in 13px text with no tinted fill. The border says the kind: a hairline for a neutral notice, the text color for a positive or emphasized notice, a dashed border in the text color for a caution, and a danger border on the danger ground for an error.

## Do's and Don'ts

### Do:
- **Do** choose a field by the kind of content: yellow for the score and the primary action, blue-grey for facts and skills, pink for the cover letter and applications, beige for the posting text.
- **Do** put ink text on every color field, and muted ink for secondary text on a field.
- **Do** keep every corner square and every rule at 1px.
- **Do** separate tiles and cards with the 6px channel of ground, and link tiles with a notch only when one follows from the other.
- **Do** show a score as a tabular numeral in weight 800, and show its band as fill or outline as well as in words.
- **Do** keep the jobs grid at 6 columns or fewer, and keep 3 card columns beside the open detail panel on a page of 5 or 6 columns.
- **Do** fill an opened card and the detail tiles with color from the top in 420ms, and show them at once when the system asks for reduced motion.

### Don't:
- **Don't** add a light theme or a second theme; the system has one theme on a dark grey ground.
- **Don't** round corners.
- **Don't** add shadows to show depth. Use the raised ground, a color field, or a 1px rule.
- **Don't** put grey or off-white text on a color field.
- **Don't** use yellow on the ground for a badge, a count, a status dot, or an unread marker; these are off-white or outlined.
- **Don't** use a field color for decoration or to tell two items of the same kind apart.
- **Don't** add a notch between tiles that have no "follows from" relation.
