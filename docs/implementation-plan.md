# Roster Scratch Planner Implementation Plan

## 1. Goal

Build a dependency-free, local-first browser app for manually drafting rosters in a spreadsheet-like grid.

The first complete version should support:

- editable staff rows
- adjustable date range
- inline shorthand shift creation
- shift, marker, and pattern palette
- grouped pattern placement and movement
- immediate warnings for multiple primary shifts in one cell
- 10-hour gap warnings between primary timed shifts
- undo and redo
- bundled JSON plan save/load
- palette-only JSON import/export
- staff import by pasted text or file
- CSV export
- readable synthwave/outrun-styled roster export/print view

## 2. Technical Approach

Use a plain browser app with no npm dependency, no build step, and no framework.

Initial structure:

```text
index.html
styles.css
src/app.js
src/model.js
src/render.js
src/parser.js
src/history.js
src/validation.js
src/storage.js
src/dragdrop.js
src/export.js
src/fixtures.js
docs/roster-scratch-planner-spec.md
docs/implementation-plan.md
```

Core architecture:

- `model.js`: plan data structures and mutation helpers
- `parser.js`: shorthand parser and display formatting
- `history.js`: command-based undo/redo
- `validation.js`: rest-gap and cell-content warnings
- `render.js`: grid, palette, dialogs, and detail popovers
- `dragdrop.js`: pointer/drag interactions
- `storage.js`: plan, palette, and staff import/export
- `export.js`: CSV and printable roster output
- `app.js`: application bootstrap and event wiring

The data model should drive rendering. DOM state should not be the source of truth.

## 3. Phase 0: Project Skeleton

Create the runnable local app shell.

Tasks:

- add `index.html`, `styles.css`, and `src/` modules
- create a simple app bootstrap
- render a placeholder command bar, palette, and grid area
- add a small fixture roster for development
- make the app usable by opening `index.html` directly in a browser

Acceptance checks:

- opening `index.html` shows the roster editor shell
- no npm install is required
- no external network resources are loaded

## 4. Phase 1: Core Data Model

Implement the app state before the UI becomes complex.

Tasks:

- define `RosterPlan`
- define `StaffMember`
- define `RosterItem`
- define palette item shapes
- define pattern item shapes
- add ID generation
- add date range helpers
- add helpers for finding cells, items, staff rows, and grouped items
- add sample data matching the spec examples

Acceptance checks:

- a plan can be created in memory
- staff order is stable
- date columns can be generated from start/end dates
- items can be added, moved, edited, and removed through model helpers
- grouped items can be retrieved by `groupId`

## 5. Phase 2: Grid Rendering and Basic Editing

Render the core spreadsheet-like experience.

Tasks:

- render staff rows and date columns
- render compact cell contents
- render multiple items within a cell when present
- support selecting a cell
- support inline text entry in a selected cell
- support editing staff names in place
- support adding and deleting staff rows
- show hover/focus details for an item

Acceptance checks:

- user can create a plan-like grid with staff and dates
- user can type into a cell
- user can rename staff directly in the grid
- cell contents stay readable when a cell contains shift plus marker/call

## 6. Phase 3: Shorthand Parser

Make inline entry useful.

Tasks:

- parse default 8-hour shift entries
- parse explicit time ranges
- parse modality and optional location
- parse known markers
- parse `+call` and `(+call)`
- detect overnight shifts
- format compact display text
- format full hover details
- add parser tests via a simple browser-free test harness or local script

Required examples:

```text
630 CT ED -> 0630-1430, modality CT, location ED
630 MRI   -> 0630-1430, modality MRI
8 GEN ED  -> 0800-1600, modality GEN, location ED
4 GEN     -> 1600-0000, modality GEN
12 GEN    -> 1200-2000, modality GEN
8 MAM     -> 0800-1600, modality MAM
8-1230 EDCT -> 0800-1230, modality EDCT
```

Acceptance checks:

- all required examples parse correctly
- unknown location text is accepted
- marker-only entries are accepted
- invalid entries produce useful inline feedback without breaking the grid

## 7. Phase 4: Command History

Add undo/redo before drag and persistence increase complexity.

Tasks:

- implement a command interface with `do` and `undo`
- implement undo stack and redo stack
- convert create/edit/delete item actions to commands
- convert staff rename/add/delete actions to commands
- wire Cmd/Ctrl+Z
- wire Cmd/Ctrl+Shift+Z and Cmd/Ctrl+Y
- clear redo on new action after undo

Acceptance checks:

- cell creation can be undone and redone
- cell edits can be undone and redone
- staff edits can be undone and redone
- history remains correct after multiple sequential actions

## 8. Phase 5: Palette and Session Palette

Introduce reusable entry sources.

Tasks:

- render saved shifts
- render markers
- render saved patterns
- add session shifts automatically from new inline shift entries
- avoid duplicate session entries
- support promoting session shifts to saved shifts
- add palette item editing basics

Initial saved shifts:

```text
630 CT ED
630 MRI
8 GEN ED
4 GEN
12 GEN
8 MAM
```

Initial markers:

```text
RDO
AL
Training
On Call
```

Initial pattern:

```text
8 GEN ED (+call), 4 GEN, 3 GEN, 12 GEN
```

Acceptance checks:

- inline-created shifts appear in session palette
- user can reuse session palette items
- user can promote a session shift to saved palette
- marker palette items can be placed in cells

## 9. Phase 6: Drag, Drop, and Grouped Patterns

Implement the main planning interaction.

Tasks:

- drag palette shifts into cells
- drag palette markers into cells
- drag existing ungrouped items between cells
- drag patterns onto a starting cell
- preview affected cells while dragging a pattern
- create grouped pattern items with a shared `groupId`
- display grouped items with a lightly hatched background
- selecting one grouped item highlights the group
- dragging one grouped item moves the whole group by default
- support ungrouping a placed pattern
- make all drag/drop operations undoable

Acceptance checks:

- pattern placement creates expected consecutive-day items
- grouped pattern movement preserves item spacing
- grouped items are visually recognizable
- ungrouped items move individually
- undo/redo works for pattern placement, group movement, and ungrouping

## 10. Phase 7: Validation

Add non-blocking warnings.

Tasks:

- detect multiple primary timed shifts in one cell
- warn immediately in the affected cell
- calculate successive primary timed shifts per staff member
- flag gaps under 10 hours
- exclude markers from rest-gap validation
- exclude on-call from rest-gap validation by default
- render warnings in cells
- add a compact issue list or status strip

Acceptance checks:

- second primary shift in one cell warns immediately
- shift-to-shift gaps under 10 hours are flagged
- on-call entries do not create 10-hour warnings
- warnings do not block save, edit, or drag/drop

## 11. Phase 8: Date Range and Staff Import

Finish roster-shape controls.

Tasks:

- add date range creation UI
- add weeks before current range
- add weeks after current range
- trim weeks from start or end with confirmation if populated
- make trim operations undoable with removed data restored on undo
- import staff from pasted text
- import staff from plain text file
- import staff from CSV file
- preserve staff order

Acceptance checks:

- date ranges can expand without losing roster data
- trimming populated dates warns before applying
- undo restores trimmed dates and contents
- pasted staff names create rows
- staff file import creates rows

## 12. Phase 9: Save, Load, and Palette Import/Export

Make work portable.

Tasks:

- save full plan as self-contained JSON
- load full plan JSON
- include schema version
- include staff, date range, items, groups, palette, session palette, patterns, and markers
- warn on unknown future schema versions
- export palette-only JSON
- import palette-only JSON
- support adding imported palette items to current palette
- support replacing current saved palette with imported palette

Acceptance checks:

- saved plan restores the same visible roster
- grouped patterns survive save/load
- session palette survives save/load
- palette export/import works without a roster plan
- invalid or incompatible files show useful errors

## 13. Phase 10: CSV and Print/Export View

Add sharing outputs.

Tasks:

- export flattened CSV
- include staff, date, display text, start, end, modality, location, marker/call text
- create printable roster view
- apply readable outrun/synthwave visual direction
- preserve grid readability over theme intensity
- add print stylesheet if needed

Acceptance checks:

- CSV opens as a useful table in spreadsheet software
- printable view resembles the current roster grid
- print/export colors are playful but legible
- warnings remain visible or are summarized in print/export output

## 14. Phase 11: Interaction Polish

Tighten the app into something pleasant to use.

Tasks:

- improve keyboard selection behavior
- support copy/paste of selected cell contents where practical
- add confirmation flows for destructive actions
- improve hover/focus detail presentation
- add empty-state handling
- add lightweight accessibility labels
- check layout at common desktop widths
- tune synthwave styling without sacrificing dense roster scanning

Acceptance checks:

- common editing flows feel quick
- keyboard undo/redo is reliable
- no major text overlap in the grid, palette, or command bar
- app remains usable without network access

## 15. Verification Strategy

Because this is dependency-free, verification should start simple and stay close to the code.

Use:

- parser test cases in a small standalone script
- model/history tests in a small standalone script
- manual browser checks for drag/drop and rendering
- saved JSON round-trip checks
- CSV output spot checks

Minimum checks before calling the first version complete:

- parser examples pass
- create/edit/delete item undo/redo passes
- pattern placement and group movement undo/redo passes
- 10-hour gap validation catches known examples
- saved plan reloads to the same state
- palette-only export/import works
- CSV export includes expected columns

## 16. Build Order Summary

1. Skeleton
2. Model
3. Grid rendering
4. Parser
5. Undo/redo
6. Palette
7. Drag/drop and grouped patterns
8. Validation
9. Date range and staff import
10. Save/load and palette import/export
11. CSV and print/export view
12. Interaction polish

This order keeps data, parsing, and history solid before the highest-risk interactions are added.
