# Roster Scratch Planner Spec

## 1. Purpose

Roster Scratch Planner is a local-first manual planning tool for drafting and rearranging work rosters quickly.

The product is not an automatic scheduler. It is a flexible scratch workspace for trying possible rosters, moving shifts around, spotting obvious rest-gap issues, and saving or exporting the result.

The intended feel is closer to a spreadsheet than a workforce-management system: fast entry, permissive editing, drag-and-drop movement, inline changes, and minimal interruption.

## 2. Product Boundaries

The app is not intended to provide:

- automatic roster generation
- account login or cloud sync
- payroll calculations
- award or enterprise-agreement interpretation
- dependency-heavy framework architecture
- multi-user collaboration
- mobile-first editing

The app should not prevent the user from creating an invalid, incomplete, or speculative roster. It may warn about issues, but manual planning remains the priority.

## 3. Design Principles

- Local-first: plans should be usable without network access.
- Dependency-light: prefer browser-native APIs and plain HTML, CSS, and JavaScript.
- Spreadsheet-like: common actions should be inline, fast, and reversible.
- Permissive: cells should accept whatever the user needs to place there.
- Structured underneath: freeform-looking entries should be stored as structured data where possible.
- Non-blocking validation: warnings should be visible but should not stop planning.
- Portable: saved plans should be ordinary files that can be reopened later.

## 4. Core Concepts

### Plan

A roster plan contains:

- a date range
- ordered staff rows
- roster items placed into staff/date cells
- saved palette items available to that plan
- session palette items created during editing
- pattern definitions
- group relationships created by pattern placement
- metadata needed to restore the session

### Staff Member

A staff member is a row in the grid.

Staff names are editable in place and can be reordered by drag and drop. Staff can also be loaded from a saved or preloaded list.

### Date Column

A date column represents one calendar day.

Plans are created with an initial date range. The range can later be expanded or trimmed, preferably in week-sized operations.

### Roster Cell

A roster cell is the intersection of one staff member and one date.

The normal case is one primary timed shift per person per day. Cells may also contain markers, notes, and on-call entries. If a second primary timed shift is added, the app should allow it but visually flag the unusual state.

### Roster Item

A roster item is anything placed in a cell:

- timed shift
- on-call item
- RDO marker
- annual leave marker
- training marker
- note
- other user-created marker

Timed shifts have start and end times. Markers may optionally have times.

## 5. Main Interface

The first screen should be the actual roster editor, not a landing page.

Primary regions:

- top command bar for plan actions
- shift and pattern palette above the grid
- roster grid
- optional issue list or status strip for validation warnings

Core actions:

- create new plan
- open plan
- save plan
- export CSV
- export palette
- import palette
- undo
- redo
- add staff
- load staff list
- expand date range
- trim date range

## 6. Roster Grid

Rows are staff members. Columns are dates.

The first column remains staff names. The date header row remains visible while scrolling where practical.

Cells support:

- click to select
- double-click or direct typing to edit/create
- drag item into cell from palette
- drag item or group between cells
- delete selected item
- copy/paste selected item or cell contents
- hover to show full details

## 7. Staff Rows

Staff row behavior:

- inline name editing
- drag-and-drop reorder
- add row
- delete row, with confirmation if populated
- load from saved or preloaded staff list

Staff order is part of the plan file.

Saved or preloaded staff lists should be simple named lists of staff names. The first supported portable format should be plain text or CSV with one staff member per line or row. This keeps import easy from existing lists without requiring a special schema.

Staff import should support both file upload and pasted text.

## 8. Date Columns

Date behavior:

- plan starts with a chosen date range
- user can add weeks before or after the current range
- user can remove weeks from the start or end
- trimming a range that contains roster items should require confirmation

Date columns should show enough context to be scannable, such as day name and date.

## 9. Cell Display Rules

Cells should show compact text while preserving full detail on hover.

For a normal 8-hour shift:

```text
8 GEN ED
630 CT ED
```

For a non-8-hour shift:

```text
0800-1230 EDCT
0630-1200 CT ED
```

If the shift has on-call attached, show a compact call indicator:

```text
8 GEN ED +call
630 CT ED +call
```

Hover or focus details should include:

- full start and end time
- duration
- modality
- location, if present
- on-call details, if present
- marker details
- notes
- pattern/group membership
- validation warnings

Grouped pattern items should be visually identifiable with a lightly hatched cell background or item background.

## 10. Shorthand Parser

Inline creation is a core workflow.

The parser should be forgiving and should accept concise roster language. Parsed entries should remain editable after creation.

### Basic Timed Shift Forms

```text
[start] [modality] [location?]
[start]-[end] [modality] [location?]
[start] [modality] [location?] (+call)
[start]-[end] [modality] [location?] (+call)
```

The first token is the start time or time range. The second token is the modality for a normal shift. Remaining text is treated as optional location or qualifier text, except for recognized call markers.

### Time Parsing

Accepted examples:

```text
8     -> 0800
08    -> 0800
830   -> 0830
0630  -> 0630
12    -> 1200
4     -> 1600
3     -> 1500
20    -> 2000
1230  -> 1230
```

Single-number starts default to an 8-hour shift.

Examples:

```text
630 CT ED -> 0630-1430, modality CT, location ED
630 MRI   -> 0630-1430, modality MRI
8 GEN ED  -> 0800-1600, modality GEN, location ED
4 GEN     -> 1600-0000, modality GEN
12 GEN    -> 1200-2000, modality GEN
8 MAM     -> 0800-1600, modality MAM
```

Explicit ranges override the default duration.

```text
8-1230 EDCT -> 0800-1230, duration 4.5 hours, modality EDCT
```

If an end time is earlier than or equal to the start time, the shift crosses midnight.

### Modality and Location

Modality is required for normal timed shifts.

Location is optional. Known locations may be configured later, but the parser should accept unknown freeform location text rather than rejecting it.

Representative modality/location examples:

```text
CT ED  -> modality CT, location ED
GEN ED -> modality GEN, location ED
MRI    -> modality MRI
MAM    -> modality MAM
```

### Markers

Known markers should be accepted without requiring times:

```text
RDO
AL
Annual Leave
Training
On Call
```

Markers may optionally carry times if entered that way.

## 11. Palette

The palette contains draggable items that can be placed into roster cells.

Palette sections:

- saved shifts
- saved patterns
- session shifts
- markers

Saved shifts and patterns are reusable definitions.

Session shifts are created automatically from inline entries that do not already exist in the saved palette. They remain available during the current editing session and should be included in the plan file so the plan restores as it was. They are not automatically promoted to the user's saved library.

The user can promote a session shift into the saved palette.

Saved palette libraries should also support palette-only export and import. This allows the user to carry reusable shifts, patterns, and markers between plans without moving a whole roster plan.

## 12. Patterns and Grouping

A pattern is a reusable sequence of roster items placed across consecutive days.

Example pattern:

```text
8 GEN ED (+call), 4 GEN, 3 GEN, 12 GEN
```

When dropped onto a starting cell, this creates:

```text
Day 1: 0800-1600 GEN ED +call
Day 2: 1600-0000 GEN
Day 3: 1500-2300 GEN
Day 4: 1200-2000 GEN
```

Pattern placement behavior:

- while dragging, preview affected cells
- on drop, create all items with a shared group ID
- grouped items show a lightly hatched background
- selecting one grouped item highlights the rest of the group
- grouped items move as a group by default
- the user can ungroup a placed pattern
- after ungrouping, items become ordinary independent roster items

If a pattern would overwrite or conflict with existing cell contents, the app should preview that clearly and ask for confirmation before replacing or adding to existing contents.

## 13. Drag and Drop

Drag sources:

- saved shift
- session shift
- marker
- pattern
- existing roster item
- grouped pattern

Drop targets:

- roster cell
- possibly palette, for future save/promote workflows

Expected behavior:

- dragging a single palette shift into a cell creates a roster item
- dragging a marker into a cell creates a marker item
- dragging a pattern previews and creates grouped items
- dragging an existing ungrouped item moves it
- dragging a grouped item moves the whole group by default
- modifier-key behavior may later allow moving a single item out of a group

All drag/drop operations must be undoable.

## 14. Undo and Redo

Undo and redo are core requirements.

The app should maintain a substantial history of reversible user actions. A command-history model is preferred.

Undoable actions include:

- create item
- edit item
- delete item
- move item
- move group
- place pattern
- ungroup pattern
- edit staff name
- reorder staff row
- add staff row
- delete staff row
- change date range
- add palette item
- promote session palette item
- load plan

Redo should be cleared when a new action occurs after undo.

Plan files do not need to persist the undo stack unless a later design explicitly requires that.

## 15. Validation

The only planned roster logic is a 10-hour gap check between successive primary timed shifts for the same staff member.

Validation behavior:

- calculate ordered timed shifts per staff member
- compare the end of one shift to the start of the next
- if the gap is less than 10 hours, flag both relevant cells or the later shift
- do not block the user from saving or continuing

Warnings should be visible in cells and optionally summarized in an issue list.

Example warning:

```text
Only 9h 0m between Tue 0000 finish and Tue 0900 start.
```

Markers without times do not participate in the 10-hour gap check.

On-call items do not participate in the 10-hour gap check by default, even when they have concrete start/end times. Call interactions with rest-gap rules are handled ad hoc outside the app's validation logic.

A second primary timed shift in the same cell should warn immediately, because staff generally work only one shift per day. The warning should remain non-blocking.

## 16. Save, Load, and Export

### Save Plan

Save downloads or writes a portable JSON file.

The JSON file should preserve:

- schema version
- date range
- staff list and order
- roster items
- group IDs
- saved palette items bundled with the plan
- session palette items
- pattern definitions
- marker definitions
- display preferences needed to restore the plan

Validation warnings can be recalculated on load rather than stored as authoritative state.

Plan files should be self-contained bundles. Opening a saved plan should restore the grid, metadata, palette definitions, session palette items, patterns, markers, and staff lists needed for that plan without depending on separate files.

### Open Plan

Open reads a saved JSON plan and restores the editor state.

The app should reject or warn about unknown future schema versions.

### Export CSV

CSV export is for sharing, printing, or downstream manual use. It does not need to preserve the full interactive session.

CSV should include at least:

- staff name
- date
- displayed cell contents
- structured start time, if present
- structured end time, if present
- modality, if present
- location, if present
- marker/call text, if present

The first printable/exported roster layout does not need to be finalized before implementation. The initial requirement is a readable grid export matching the on-screen roster closely enough for review or sharing.

The visual direction for printable/exported roster views should be outrun/synthwave-inspired: bright accent colors, dark or high-contrast surfaces, playful energy, and enough whimsy to make the tool feel enjoyable. Readability remains more important than theme intensity.

### Palette Import and Export

Palette-only import and export should use JSON.

Palette export should include:

- saved shifts
- saved patterns
- markers
- palette metadata such as schema version and exported date

Palette import should allow adding to or replacing the current saved palette.

## 17. Data Model Draft

### RosterPlan

```json
{
  "schemaVersion": 1,
  "name": "Example roster",
  "dateStart": "2026-07-06",
  "dateEnd": "2026-08-02",
  "staff": [],
  "items": [],
  "palette": {
    "savedShifts": [],
    "sessionShifts": [],
    "patterns": [],
    "markers": []
  }
}
```

### StaffMember

```json
{
  "id": "staff_1",
  "name": "Staff Name"
}
```

### RosterItem

```json
{
  "id": "item_1",
  "staffId": "staff_1",
  "date": "2026-07-06",
  "kind": "shift",
  "label": "630 CT ED",
  "start": "2026-07-06T06:30:00",
  "end": "2026-07-06T14:30:00",
  "durationHours": 8,
  "modality": "CT",
  "location": "ED",
  "call": {
    "enabled": false
  },
  "groupId": null,
  "sourcePatternId": null,
  "notes": ""
}
```

### PatternDefinition

```json
{
  "id": "pattern_1",
  "name": "GEN call run",
  "items": [
    { "dayOffset": 0, "text": "8 GEN ED (+call)" },
    { "dayOffset": 1, "text": "4 GEN" },
    { "dayOffset": 2, "text": "3 GEN" },
    { "dayOffset": 3, "text": "12 GEN" }
  ]
}
```

## 18. Keyboard and Mouse Interactions

Expected keyboard support:

- typing in selected cell starts inline entry
- Enter commits
- Escape cancels
- Delete removes selected item or cell contents
- Cmd/Ctrl+Z undo
- Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y redo
- copy/paste selected cell contents where practical

Expected mouse support:

- click select
- double-click edit
- drag from palette into cell
- drag roster item to move
- drag grouped item to move group
- hover/focus for details

## 19. Technical Direction

Preferred implementation:

- plain HTML
- plain CSS
- plain JavaScript using ES modules
- no npm dependency required
- no build step required
- browser-native drag/drop or pointer events
- local file save/load using browser APIs

Possible initial file layout:

```text
index.html
styles.css
src/app.js
src/model.js
src/parser.js
src/history.js
src/validation.js
src/storage.js
src/dragdrop.js
docs/roster-scratch-planner-spec.md
```

The implementation should keep the data model separate from rendering so undo/redo, validation, and save/load can remain reliable.

## 20. Open Questions

Resolved decisions:

- Staff-list import should start simple: plain text or CSV with one staff member per line or row.
- Saved plans should be self-contained bundles including the grid, metadata, staff lists, palette items, session palette items, patterns, and markers needed to restore the plan.
- Saved palette libraries should also support palette-only JSON import and export.
- A second primary timed shift in the same cell should warn immediately.
- On-call should not count toward the 10-hour gap check by default, even when timed.
- Initial printable/exported output should be a readable synthwave/outrun-styled roster grid matching the on-screen layout closely enough for review or sharing.
- Trimming date ranges should be handled through the undo history, with enough command data to restore removed dates and contents robustly.
- Staff-list import should support pasted text as well as file upload.

Remaining open questions:

- None currently.

## 21. Implementation Milestones

### Milestone 1: Static Editor Shell

- create dependency-free browser app skeleton
- render command bar, palette area, and editable roster grid
- create new plan with date range and sample staff

### Milestone 2: Inline Entry and Parsing

- implement shorthand parser
- create/edit cell entries from typed text
- display compact cell text and hover details
- add session palette entries from new inline shifts

### Milestone 3: Drag, Drop, and Patterns

- drag palette shifts into cells
- drag existing items between cells
- define and place patterns
- implement grouped pattern state and hatched display
- move grouped items as a group by default

### Milestone 4: Undo, Redo, and Validation

- implement command-based history
- wire undo/redo keyboard shortcuts
- implement 10-hour gap validation
- show non-blocking warnings

### Milestone 5: Persistence and Export

- save/load JSON plans
- export CSV
- preserve session palette and groups in saved files

### Milestone 6: Usability Pass

- staff list loading
- date range expansion/trimming
- row reorder
- polish keyboard interactions
- improve warning and hover presentation
