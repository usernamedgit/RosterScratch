(function (root, factory) {
  var api = factory(
    root.RosterModel,
    root.RosterParser,
    root.RosterValidation,
    root.RosterDragDrop
  );
  root.RosterRender = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Model, Parser, Validation, DragDrop) {
  "use strict";

  var STAFF_COLUMN_WIDTH = 252;
  var MIN_CELL_FALLBACK = 72;
  var CELL_LABEL_CHROME_WIDTH = 84;
  var resizeFrame = 0;
  var latestRoot = null;
  var latestPlan = null;
  var resizeWatcherBound = false;
  var suppressSummaryClick = false;
  // Cell under the cursor; kept across re-renders so a drop doesn't blank the highlight.
  var crosshair = null;
  var scaleReadoutTimer = 0;

  function render(root, state, actions) {
    var plan = state.plan;
    var validation = state.validation;
    var previousGridWrap = root.querySelector ? root.querySelector(".grid-wrap") : null;
    var previousScrollTop = previousGridWrap ? previousGridWrap.scrollTop : 0;
    var previousScrollLeft = previousGridWrap ? previousGridWrap.scrollLeft : 0;
    var previousViewKey = previousGridWrap ? previousGridWrap.dataset.viewKey : "";
    var previousFocus = captureFocus(root);
    latestRoot = root;
    latestPlan = plan;
    root.innerHTML = [
      renderCommandBar(plan, state),
      renderPaletteOverlay(plan, state),
      renderDaySummaryOverlay(plan, state),
      renderWorkspace(plan, state, validation),
      state.modal ? renderModal(plan, state.modal) : "",
      state.toast ? "<div class=\"toast\" role=\"status\">" + escapeHtml(state.toast) + "</div>" : ""
    ].join("");
    syncCommandBarSizing(root);
    syncGridSizing(root, plan);
    restoreGridScroll(root, previousScrollTop, previousScrollLeft, previousViewKey);
    bindResizeWatcher();
    wire(root, state, actions);
    restoreFocus(root, previousFocus, state);
  }

  function captureFocus(root) {
    var doc = root.ownerDocument;
    var active = doc && doc.activeElement;
    if (!active || !active.dataset || !active.dataset.focusKey || !root.contains(active)) {
      return null;
    }
    return {
      key: active.dataset.focusKey,
      start: typeof active.selectionStart === "number" ? active.selectionStart : null,
      end: typeof active.selectionEnd === "number" ? active.selectionEnd : null
    };
  }

  function findFocusTarget(root, key) {
    var matches = root.querySelectorAll("[data-focus-key]");
    for (var index = 0; index < matches.length; index += 1) {
      if (matches[index].dataset.focusKey === key) {
        return matches[index];
      }
    }
    return null;
  }

  function restoreFocus(root, previous, state) {
    if (state.pendingFocus) {
      var pending = findFocusTarget(root, state.pendingFocus);
      state.pendingFocus = null;
      if (pending) {
        pending.focus();
        if (typeof pending.select === "function" && pending.type !== "date") {
          pending.select();
        }
        return;
      }
    }
    if (!previous) {
      return;
    }
    var target = findFocusTarget(root, previous.key);
    if (!target) {
      return;
    }
    target.focus();
    if (previous.start != null && typeof target.setSelectionRange === "function" && target.type !== "date") {
      try {
        target.setSelectionRange(previous.start, previous.end);
      } catch (ignore) {}
    }
  }

  function describeForSection(text, section) {
    var described = Parser.describeEntry(text);
    if (section === "markers" && described.tone === "warn" && Parser.parseRosterText(text).kind === "note") {
      return { tone: "muted", text: "Custom marker; placed in cells as a note" };
    }
    return described;
  }

  function renderEntryPreview(text, section) {
    var preview = describeForSection(text, section);
    return "<span class=\"entry-preview tone-" + attr(preview.tone) + "\" data-preview data-section=\"" + attr(section || "") +
      "\" aria-live=\"polite\">" + escapeHtml(preview.text) + "</span>";
  }

  function renderCommandBar(plan, state) {
    return "<header class=\"command-bar\">" +
      "<div class=\"command-bar-content\">" +
      "<input class=\"plan-name\" data-action=\"rename-plan\" value=\"" + attr(plan.name) + "\" aria-label=\"Plan name\">" +
      "<div class=\"date-controls\">" +
      "<input type=\"date\" data-action=\"date-start\" value=\"" + attr(plan.dateStart) + "\" aria-label=\"Start date\">" +
      "<input type=\"date\" data-action=\"date-end\" value=\"" + attr(plan.dateEnd) + "\" aria-label=\"End date\">" +
      "<button class=\"text-button\" data-action=\"apply-dates\">Apply</button>" +
      "<button class=\"icon-button\" data-action=\"expand-before\" title=\"Add week before\">-7</button>" +
      "<button class=\"icon-button\" data-action=\"expand-after\" title=\"Add week after\">+7</button>" +
      "<button class=\"icon-button\" data-action=\"trim-start\" title=\"Trim week from start\">S-</button>" +
      "<button class=\"icon-button\" data-action=\"trim-end\" title=\"Trim week from end\">E-</button>" +
      "</div>" +
      "<div class=\"command-group\">" +
      "<button class=\"icon-button\" data-action=\"undo\" title=\"Undo\" " + disabled(!state.canUndo) + ">U</button>" +
      "<button class=\"icon-button\" data-action=\"redo\" title=\"Redo\" " + disabled(!state.canRedo) + ">R</button>" +
      "<button class=\"text-button\" data-action=\"add-staff\">Add Staff</button>" +
      "<button class=\"text-button\" data-action=\"import-staff\">Import Staff</button>" +
      "<button class=\"text-button\" data-action=\"import-shifts\">Import Shifts</button>" +
      "<button class=\"text-button\" data-action=\"ungroup\" " + disabled(!state.selectedGroupId) + ">Ungroup</button>" +
      "</div>" +
      "<div class=\"command-group\">" +
      "<button class=\"text-button palette-toggle\" data-action=\"toggle-palette\" aria-expanded=\"" + (state.paletteOpen ? "true" : "false") + "\" aria-keyshortcuts=\"`\" title=\"Toggle palette (`)\">Palette <kbd>`</kbd></button>" +
      "<button class=\"text-button\" data-action=\"new-plan\">New</button>" +
      "<button class=\"text-button\" data-action=\"open-plan\">Open</button>" +
      "<button class=\"text-button\" data-action=\"save-plan\">Save</button>" +
      "<button class=\"text-button\" data-action=\"csv\">CSV</button>" +
      "<button class=\"text-button\" data-action=\"print\">Print View</button>" +
      "<button class=\"text-button\" data-action=\"export-palette\">Export Palette</button>" +
      "<button class=\"text-button\" data-action=\"import-palette\">Import Palette</button>" +
      "<button class=\"icon-button help-button\" data-action=\"open-help\" title=\"How to use Roster Scratch Planner\" aria-label=\"Open how-to guide\" aria-haspopup=\"dialog\">?</button>" +
      "</div>" +
      "</div>" +
      "</header>";
  }

  function renderPaletteOverlay(plan, state) {
    return "<div class=\"palette-overlay " + (state.paletteOpen ? "open" : "") + "\" " + (state.paletteOpen ? "" : "hidden") + ">" +
      "<button class=\"palette-scrim\" data-action=\"close-palette\" aria-label=\"Close palette\"></button>" +
      renderPalette(plan, state) +
      "</div>";
  }

  function renderPalette(plan, state) {
    return "<section class=\"palette\" aria-label=\"Palette\">" +
      "<div class=\"palette-toolbar\">" +
      "<span>Group shifts</span>" +
      renderPaletteGroupButton("modality", "Modality", state) +
      renderPaletteGroupButton("start", "Start time", state) +
      "<button class=\"icon-button palette-close\" data-action=\"close-palette\" title=\"Close palette\">X</button>" +
      "</div>" +
      renderPaletteSection("Saved shifts", "savedShifts", plan.palette.savedShifts, "shift", true, getPaletteGroupBy(state), state) +
      renderPaletteSection("Session shifts", "sessionShifts", plan.palette.sessionShifts, "session", false, getPaletteGroupBy(state), state) +
      renderPatternSection(plan.palette.patterns) +
      renderPaletteSection("Markers", "markers", plan.palette.markers, "marker", true, null, state) +
      "</section>";
  }

  function renderPaletteGroupButton(value, label, state) {
    var selected = getPaletteGroupBy(state) === value;
    return "<button class=\"segmented-button\" data-action=\"palette-group\" data-group-by=\"" + attr(value) + "\" aria-pressed=\"" + (selected ? "true" : "false") + "\">" +
      escapeHtml(label) + "</button>";
  }

  function renderPaletteSection(title, section, items, kind, addButton, groupBy, state) {
    var edit = state && state.paletteEdit && state.paletteEdit.section === section ? state.paletteEdit : null;
    var adding = edit && edit.id == null ? renderPaletteEditor(section, kind, edit.text) : "";
    var chips = items.length ? renderPaletteItems(section, items, kind, groupBy, edit) : (adding ? "" : "<span class=\"empty-note\">Empty</span>");
    chips += adding;
    var add = addButton ? "<button class=\"chip-action\" data-action=\"add-palette\" data-section=\"" + attr(section) + "\" title=\"Add\">+</button>" : "";
    return "<div class=\"palette-section\"><div class=\"palette-heading\"><span>" + escapeHtml(title) + "</span>" + add + "</div>" +
      "<div class=\"palette-list\">" + chips + "</div></div>";
  }

  function renderPaletteItems(section, items, kind, groupBy, edit) {
    if (section !== "savedShifts" && section !== "sessionShifts") {
      return items.map(function (entry) {
        return renderPaletteChip(section, entry, kind, edit);
      }).join("");
    }
    return groupPaletteShifts(items, groupBy).map(function (group) {
      return "<div class=\"palette-subgroup\">" +
        "<div class=\"palette-subheading\">" + escapeHtml(group.label) + "</div>" +
        "<div class=\"palette-sublist\">" + group.items.map(function (entry) {
          return renderPaletteChip(section, entry, kind, edit);
        }).join("") + "</div>" +
        "</div>";
    }).join("");
  }

  function renderPaletteEditor(section, kind, text) {
    var label = section === "markers" ? "Marker text" : "Shift text";
    return "<span class=\"palette-chip palette-chip-editing " + kind + "\">" +
      "<input class=\"palette-editor\" data-editor=\"palette\" data-focus-key=\"palette-editor\" value=\"" + attr(text) +
      "\" aria-label=\"" + label + "\" placeholder=\"" + (section === "markers" ? "Training" : "8 GEN ED") +
      "\" title=\"Enter to save, Escape to cancel\">" +
      renderEntryPreview(text, section) + "</span>";
  }

  function renderPaletteChip(section, entry, kind, edit) {
      if (edit && edit.id === entry.id) {
        return renderPaletteEditor(section, kind, edit.text);
      }
      var promote = section === "sessionShifts" ? "<button class=\"chip-action\" data-action=\"promote-session\" data-id=\"" + attr(entry.id) + "\" title=\"Promote\">+</button>" : "";
      return "<span class=\"palette-chip " + kind + "\" draggable=\"true\" data-drag-type=\"" + dragTypeFor(section) +
        "\" data-id=\"" + attr(entry.id) + "\" data-text=\"" + attr(entry.text || entry.label) + "\">" +
        "<span class=\"chip-label\">" + escapeHtml(entry.label || entry.text) + "</span>" +
        promote +
        "<button class=\"chip-action\" data-action=\"edit-palette\" data-section=\"" + attr(section) + "\" data-id=\"" + attr(entry.id) + "\" title=\"Edit\">E</button>" +
        "<button class=\"chip-action\" data-action=\"delete-palette\" data-section=\"" + attr(section) + "\" data-id=\"" + attr(entry.id) + "\" title=\"Delete\">X</button>" +
        "</span>";
  }

  function renderPatternSection(patterns) {
    var chips = patterns.length ? patterns.map(function (pattern) {
      var summary = pattern.items.map(function (entry) { return entry.text; }).join(", ");
      return "<span class=\"palette-chip pattern\" draggable=\"true\" data-drag-type=\"pattern\" data-id=\"" + attr(pattern.id) + "\" title=\"" + attr(summary) + "\">" +
        "<span class=\"chip-label\">" + escapeHtml(pattern.name) + "</span>" +
        "<button class=\"chip-action\" data-action=\"edit-pattern\" data-id=\"" + attr(pattern.id) + "\" title=\"Edit\">E</button>" +
        "<button class=\"chip-action\" data-action=\"delete-palette\" data-section=\"patterns\" data-id=\"" + attr(pattern.id) + "\" title=\"Delete\">X</button>" +
        "</span>";
    }).join("") : "<span class=\"empty-note\">Empty</span>";
    return "<div class=\"palette-section\"><div class=\"palette-heading\"><span>Patterns</span><button class=\"text-button palette-add-button\" data-action=\"add-pattern\" title=\"Add pattern\">Add Pattern</button></div>" +
      "<div class=\"palette-list\">" + chips + "</div></div>";
  }

  function renderDaySummaryOverlay(plan, state) {
    var dateKey = state.summaryDate;
    if (!dateKey || dateKey < plan.dateStart || dateKey > plan.dateEnd) {
      return "";
    }
    var shifts = plan.items.filter(function (item) {
      return item.kind === "shift" && item.date === dateKey;
    }).sort(function (a, b) {
      var startDifference = shiftStartSort(a) - shiftStartSort(b);
      if (startDifference) {
        return startDifference;
      }
      var staffDifference = staffSort(plan, a.staffId) - staffSort(plan, b.staffId);
      return staffDifference || Model.compareIds(a.id, b.id);
    });
    var date = new Date(dateKey + "T00:00:00Z");
    var title = date.toLocaleDateString("en-AU", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    });
    var list = shifts.length ? "<ol class=\"day-summary-list\">" + shifts.map(function (item) {
      var staff = Model.getStaff(plan, item.staffId);
      return "<li class=\"day-summary-row\">" +
        "<span class=\"day-summary-shift " + modalityClass(item) + "\">" + escapeHtml(formatSummaryShift(item)) + "</span>" +
        "<span class=\"day-summary-staff\">" + escapeHtml(staff ? staff.name : "Unknown staff") + "</span>" +
        "</li>";
    }).join("") + "</ol>" : "<p class=\"day-summary-empty\">No shifts assigned.</p>";
    return "<div class=\"day-summary-overlay\">" +
      "<section class=\"day-summary\" role=\"region\" aria-label=\"Shift summary for " + attr(title) + "\">" +
      "<header class=\"day-summary-header\"><div><h2>" + escapeHtml(title) + "</h2><span>" + shifts.length + (shifts.length === 1 ? " shift" : " shifts") + "</span></div>" +
      "<button class=\"icon-button\" data-action=\"close-day-summary\" title=\"Close daily summary\" aria-label=\"Close daily summary\">X</button></header>" +
      renderDayFteField(plan, state, dateKey) + list + "</section></div>";
  }

  function renderAvailableCounter(plan, dateKey) {
    var available = Model.availableFte(plan, dateKey);
    if (available === null) {
      return "";
    }
    var title = "Available staff: " + formatFte(Model.getDayFte(plan, dateKey)) + " FTE less " + formatAllocated(Model.countStaffAllocated(plan, dateKey));
    return "<span class=\"date-fte" + (available < 0 ? " short" : "") + "\" title=\"" + attr(title) + "\" aria-label=\"" + attr(title + " = " + formatFte(available)) + "\">" +
      escapeHtml(formatFte(available)) + "</span>";
  }

  function formatAllocated(counts) {
    return counts.rostered + " rostered, " + counts.away + " on leave or away";
  }

  function formatFte(value) {
    return String(Math.round(value * 100) / 100);
  }

  function renderDayFteField(plan, state, dateKey) {
    var fte = Model.getDayFte(plan, dateKey);
    var draft = state.dayFteDraft && state.dayFteDraft.date === dateKey ? state.dayFteDraft.value : null;
    var allocated = formatAllocated(Model.countStaffAllocated(plan, dateKey));
    var available = Model.availableFte(plan, dateKey);
    var result = available === null ?
      "<span class=\"day-fte-result muted\">" + allocated + "</span>" :
      "<span class=\"day-fte-result" + (available < 0 ? " short" : "") + "\">" + allocated + " · Available: <strong>" + escapeHtml(formatFte(available)) + "</strong></span>";
    return "<div class=\"day-fte\"><label class=\"day-fte-label\" for=\"day-fte-input\">FTE available</label>" +
      "<input id=\"day-fte-input\" class=\"day-fte-input\" type=\"number\" min=\"0\" step=\"any\" inputmode=\"decimal\" data-action=\"set-day-fte\" data-date=\"" + attr(dateKey) +
      "\" value=\"" + attr(draft !== null ? draft : fte === null ? "" : formatFte(fte)) + "\" placeholder=\"Optional\">" + result + "</div>";
  }

  function shiftStartSort(item) {
    var parsed = item.start ? Date.parse(item.start) : NaN;
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
  }

  function staffSort(plan, staffId) {
    var index = plan.staff.findIndex(function (staff) { return staff.id === staffId; });
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  }

  function formatSummaryShift(item) {
    var parts = [];
    if (item.start) {
      var time = Parser.formatTimeForDisplay(item.start);
      if (item.end) {
        time += "–" + Parser.formatTimeForDisplay(item.end);
      }
      parts.push(time);
    }
    if (item.modality) {
      parts.push(item.modality);
    }
    if (item.location) {
      parts.push(item.location);
    }
    if (item.call && item.call.enabled) {
      parts.push("+call");
    }
    return parts.join(" ") || Parser.formatCompact(item);
  }

  function renderWorkspace(plan, state, validation) {
    var dates = visibleRosterDates(plan);
    var viewMode = getDateViewMode(plan);
    var viewKey = viewMode === "week" ? "week|" + (dates[0] || "") :
      viewMode === "range" ? "range|" + plan.display.rangeStart + "|" + plan.display.rangeEnd :
      "full|" + plan.dateStart + "|" + plan.dateEnd;
    return "<main class=\"workspace\">" +
      renderDateViewToolbar(plan, dates, viewMode) +
      "<div class=\"grid-wrap\" data-view-key=\"" + attr(viewKey) + "\">" + renderGrid(plan, state, validation, dates, viewMode) + "</div>" +
      renderIssueStrip(validation) +
      "</main>";
  }

  function renderDateViewToolbar(plan, dates, viewMode) {
    var allDates = Model.enumerateDates(plan.dateStart, plan.dateEnd);
    var modeButtons = "<div class=\"date-view-modes\" role=\"group\" aria-label=\"Roster date display\">" +
      "<button class=\"segmented-button\" data-action=\"date-view-mode\" data-view-mode=\"full\" aria-pressed=\"" + (viewMode === "full") + "\">Full period</button>" +
      "<button class=\"segmented-button\" data-action=\"date-view-mode\" data-view-mode=\"week\" aria-pressed=\"" + (viewMode === "week") + "\">Week</button>" +
      "<button class=\"segmented-button\" data-action=\"date-view-mode\" data-view-mode=\"range\" aria-pressed=\"" + (viewMode === "range") + "\" " +
      (hasDateRange(plan) ? "title=\"Show the days last picked by dragging across date headings\"" : "title=\"Drag across date headings to pick days\" disabled") + ">Selected days</button>" +
      "</div>";
    if (viewMode !== "week") {
      var context = viewMode === "range" ?
        escapeHtml(formatDateRange(dates[0], dates[dates.length - 1])) + " · " + dates.length + " days" :
        allDates.length + (allDates.length === 1 ? " day" : " days");
      return "<section class=\"date-view-toolbar\" aria-label=\"Date view controls\">" +
        modeButtons +
        "<span class=\"date-view-context\">" + context + " · Scaled to fit the window</span>" +
        renderDistributionButton() +
        "</section>";
    }
    var weekStart = dates[0] || plan.dateStart;
    var weekEnd = dates[dates.length - 1] || plan.dateEnd;
    var weekNumber = Math.floor(Model.daysBetween(plan.dateStart, weekStart) / 7) + 1;
    var weekCount = Math.max(1, Math.ceil(allDates.length / 7));
    return "<section class=\"date-view-toolbar\" aria-label=\"Date view controls\">" +
      modeButtons +
      "<div class=\"week-navigation\" role=\"group\" aria-label=\"Week navigation\">" +
      "<button class=\"week-nav-button\" data-action=\"previous-week\" aria-label=\"Previous week\" title=\"Previous week\" " + disabled(weekStart <= plan.dateStart) + ">‹</button>" +
      "<span class=\"week-range\" aria-live=\"polite\"><strong>" + escapeHtml(formatDateRange(weekStart, weekEnd)) + "</strong><small>Week " + weekNumber + " of " + weekCount + "</small></span>" +
      "<button class=\"week-nav-button\" data-action=\"next-week\" aria-label=\"Next week\" title=\"Next week\" " + disabled(Model.addDays(weekStart, 7) > plan.dateEnd) + ">›</button>" +
      "</div>" + renderDistributionButton() + "</section>";
  }

  function renderDistributionButton() {
    return "<button class=\"text-button distribution-button\" data-action=\"open-distribution\" aria-haspopup=\"dialog\">Distribution</button>";
  }

  function renderGrid(plan, state, validation, dates, viewMode) {
    var headTitle = viewMode === "week" ? "Toggle daily shift summary" :
      "Click for the daily shift summary · drag across dates to show just those days";
    var focusedStaffId = state.focusedStaffId || null;
    var gridClasses = ["roster-grid", focusedStaffId ? "staff-focus-active" : ""].filter(Boolean).join(" ");
    var head = "<thead><tr><th>Staff</th>" + dates.map(function (dateKey) {
      var date = new Date(dateKey + "T00:00:00Z");
      var expanded = state.summaryDate === dateKey;
      return "<th data-date=\"" + attr(dateKey) + "\"><button class=\"date-head\" data-action=\"toggle-day-summary\" data-date=\"" + attr(dateKey) + "\" aria-expanded=\"" + expanded + "\" title=\"" + headTitle + "\"><span class=\"date-day\">" +
        escapeHtml(date.toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" })) +
        "</span><span class=\"date-num\">" +
        escapeHtml(date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", timeZone: "UTC" })) +
        "</span>" + renderAvailableCounter(plan, dateKey) + "</button></th>";
    }).join("") + "</tr></thead>";
    var body = "<tbody>" + plan.staff.map(function (staff) {
      var rowFocused = focusedStaffId === staff.id;
      return "<tr" + (rowFocused ? " class=\"staff-focused\"" : "") + " data-staff-row=\"" + attr(staff.id) + "\">" +
        renderStaffCell(staff, rowFocused) +
        dates.map(function (dateKey) {
          return renderRosterCell(plan, state, validation, staff, dateKey);
        }).join("") + "</tr>";
    }).join("") + "</tbody>";
    return "<table class=\"" + gridClasses + "\" data-date-count=\"" + dates.length +
      "\" data-view-mode=\"" + attr(viewMode) + "\">" + head + body + "</table>";
  }

  function visibleRosterDates(plan) {
    var mode = getDateViewMode(plan);
    if (mode === "range") {
      return Model.enumerateDates(plan.display.rangeStart, plan.display.rangeEnd);
    }
    if (mode !== "week") {
      return Model.enumerateDates(plan.dateStart, plan.dateEnd);
    }
    var display = plan.display || {};
    var weekStart = Model.weekStartForPlan(plan, display.weekStart);
    var weekEnd = Model.addDays(weekStart, 6);
    if (weekEnd > plan.dateEnd) {
      weekEnd = plan.dateEnd;
    }
    return Model.enumerateDates(weekStart, weekEnd);
  }

  function getDateViewMode(plan) {
    var mode = plan.display && plan.display.dateViewMode;
    if (mode === "range" && hasDateRange(plan)) {
      return "range";
    }
    return mode === "week" ? "week" : "full";
  }

  function hasDateRange(plan) {
    var display = plan.display || {};
    return Boolean(display.rangeStart && display.rangeEnd);
  }

  function formatDateRange(startKey, endKey) {
    var start = new Date(startKey + "T00:00:00Z");
    var end = new Date(endKey + "T00:00:00Z");
    var sameMonth = start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth();
    if (sameMonth) {
      return start.toLocaleDateString("en-AU", { day: "numeric", timeZone: "UTC" }) + "–" +
        end.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    }
    return start.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" }) + "–" +
      end.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }

  function renderStaffCell(staff, focused) {
    return "<th class=\"staff-cell\" data-staff-focus-target=\"true\" data-staff-id=\"" + attr(staff.id) +
      "\" aria-label=\"" + attr((focused ? "Disable focus for " : "Focus row for ") + staff.name) +
      "\" title=\"Click the surrounding cell to " + (focused ? "disable row focus" : "focus this row") + "\"><div class=\"staff-row\">" +
      "<span class=\"staff-drag-handle\" draggable=\"true\" data-staff-drag=\"" + attr(staff.id) + "\" title=\"Drag to reorder\" aria-hidden=\"true\">⋮⋮</span>" +
      "<input class=\"staff-name\" data-action=\"rename-staff\" data-focus-key=\"staff-name-" + attr(staff.id) + "\" data-staff-id=\"" + attr(staff.id) + "\" value=\"" + attr(staff.name) + "\" aria-label=\"Staff name\">" +
      "<button class=\"icon-button\" data-action=\"delete-staff\" data-staff-id=\"" + attr(staff.id) + "\" title=\"Delete staff\">X</button>" +
      "</div></th>";
  }

  function renderRosterCell(plan, state, validation, staff, dateKey) {
    var items = Model.getCellItems(plan, staff.id, dateKey);
    var locked = Model.isCellLocked(plan, staff.id, dateKey);
    var selected = state.selectedCell && state.selectedCell.staffId === staff.id && state.selectedCell.date === dateKey;
    var editing = state.editCell && state.editCell.staffId === staff.id && state.editCell.date === dateKey;
    var warnings = validation.byCell[Validation.cellKey(staff.id, dateKey)] || [];
    var preview = isPatternPreview(state, staff.id, dateKey);
    var date = new Date(dateKey + "T00:00:00Z");
    var classes = [
      "cell",
      locked ? "locked" : "",
      selected ? "selected" : "",
      warnings.length ? "has-warning" : "",
      preview ? "pattern-preview" : "",
      date.getUTCDay() === 0 || date.getUTCDay() === 6 ? "weekend" : ""
    ].filter(Boolean).join(" ");
    var itemHtml = items.map(function (item) {
      var itemWarnings = warnings.filter(function (issue) {
        return issue.itemIds.indexOf(item.id) !== -1;
      });
      return renderItem(item, state, itemWarnings, locked);
    }).join("");
    var editor = editing ? "<textarea class=\"cell-editor\" data-editor=\"cell\">" + escapeHtml(state.editCell.text) + "</textarea>" : "";
    var lockControl = editing ? "" : renderCellLockControl(staff.id, dateKey, locked);
    var warning = warnings.length ? "<span class=\"cell-warning-dot\" title=\"" + attr(warnings.map(function (issue) { return issue.message; }).join("\n")) + "\">!</span>" : "";
    return "<td class=\"" + classes + "\" data-cell=\"true\" data-locked=\"" + (locked ? "true" : "false") +
      "\" data-staff-id=\"" + attr(staff.id) + "\" data-date=\"" + attr(dateKey) + "\" aria-readonly=\"" + (locked ? "true" : "false") + "\">" +
      "<div class=\"cell-items\">" + itemHtml + "</div>" + editor + warning + lockControl + "</td>";
  }

  function renderCellLockControl(staffId, dateKey, locked) {
    var label = locked ? "Unlock cell" : "Lock cell";
    var icon = locked ?
      "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M7 10V7a5 5 0 0 1 9.4-2.4\"/><path d=\"M6 10h12v10H6z\"/></svg>" :
      "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M8 10V7a4 4 0 0 1 8 0v3\"/><path d=\"M6 10h12v10H6z\"/></svg>";
    return "<button class=\"cell-lock-toggle\" data-action=\"toggle-cell-lock\" data-staff-id=\"" + attr(staffId) +
      "\" data-date=\"" + attr(dateKey) + "\" title=\"" + label + "\" aria-label=\"" + label +
      "\" aria-pressed=\"" + (locked ? "true" : "false") + "\">" + icon + "</button>";
  }

  function renderItem(item, state, warnings, locked) {
    if (state.editItem && state.editItem.id === item.id && !locked) {
      return "<span class=\"item-pill item-pill-editing " + attr(item.kind || "note") + "\">" +
        "<input class=\"item-editor\" data-editor=\"item\" data-focus-key=\"item-editor\" value=\"" + attr(state.editItem.text) +
        "\" aria-label=\"Edit item\" title=\"" + attr(Parser.describeEntry(state.editItem.text).text + "\nEnter to save, Escape to cancel, clear to delete") + "\"></span>";
    }
    var selectedGroup = state.selectedGroupId && item.groupId === state.selectedGroupId;
    var removeCall = item.call && item.call.enabled && !item.onCallOnly && item.kind !== "call";
    var actionDisabled = locked ? " disabled aria-disabled=\"true\"" : "";
    var actions = (removeCall ? "<button class=\"item-action call-action\" data-action=\"remove-call\" data-item-id=\"" + attr(item.id) +
      "\" title=\"" + (locked ? "Cell is locked" : "Remove on call") + "\"" + actionDisabled + ">Call</button>" : "") +
      "<button class=\"item-action\" data-action=\"delete-item\" data-item-id=\"" + attr(item.id) + "\" title=\"" +
      (locked ? "Cell is locked" : "Delete item") + "\"" + actionDisabled + ">X</button>";
    var classes = [
      "item-pill",
      item.kind || "note",
      modalityClass(item),
      item.groupId ? "grouped" : "",
      state.selectedItemId === item.id ? "selected" : "",
      selectedGroup ? "group-highlight" : ""
    ].filter(Boolean).join(" ");
    var title = Parser.formatFull(item);
    if (warnings.length) {
      title += "\nWarnings:\n" + warnings.map(function (issue) { return issue.message; }).join("\n");
    }
    if (locked) {
      title += "\nCell locked";
    }
    return "<span class=\"" + classes + "\" draggable=\"true\" data-item-id=\"" + attr(item.id) + "\" title=\"" + attr(title) + "\">" +
      "<span class=\"item-label\">" + escapeHtml(Parser.formatCompact(item)) + "</span>" + actions + "</span>";
  }

  function renderIssueStrip(validation) {
    var issues = validation.issues;
    var list = issues.length ? issues.slice(0, 12).map(function (issue) {
      return "<span class=\"issue-pill\" title=\"" + attr(issue.message) + "\">" + escapeHtml(issue.message) + "</span>";
    }).join("") : "<span class=\"empty-note\">No warnings</span>";
    return "<aside class=\"issue-strip\"><div class=\"issue-count\">" + issues.length + (issues.length === 1 ? " warning" : " warnings") + "</div><div class=\"issue-list\">" + list + "</div></aside>";
  }

  function renderModal(plan, modal) {
    if (modal.type === "help") {
      return renderHelpModal();
    }
    if (modal.type === "distribution") {
      return renderDistributionModal(plan);
    }
    if (modal.type === "pattern") {
      return renderPatternModal(modal);
    }
    if (modal.type === "new-plan") {
      return renderNewPlanModal(plan, modal);
    }
    if (modal.type === "staff-import") {
      return "<div class=\"modal-backdrop\"><section class=\"modal\" role=\"dialog\" aria-modal=\"true\">" +
        "<header><h2>Import Staff</h2><button class=\"icon-button\" data-action=\"close-modal\">X</button></header>" +
        "<div class=\"modal-body\"><textarea data-field=\"staff-text\" placeholder=\"One staff member per line, or CSV rows\">" + escapeHtml(modal.text || "") + "</textarea>" +
        "<button class=\"text-button\" data-action=\"choose-staff-file\">Choose File</button></div>" +
        "<footer><button class=\"text-button\" data-action=\"close-modal\">Cancel</button><button class=\"text-button\" data-action=\"apply-staff-import\">Import</button></footer>" +
        "</section></div>";
    }
    if (modal.type === "shift-import") {
      return "<div class=\"modal-backdrop\"><section class=\"modal\" role=\"dialog\" aria-modal=\"true\">" +
        "<header><h2>Import Shifts</h2><button class=\"icon-button\" data-action=\"close-modal\">X</button></header>" +
        "<div class=\"modal-body\"><textarea data-field=\"shift-text\" placeholder=\"One shift per line\">" + escapeHtml(modal.text || "") + "</textarea>" +
        "<button class=\"text-button\" data-action=\"choose-shift-file\">Choose File</button></div>" +
        "<footer><button class=\"text-button\" data-action=\"close-modal\">Cancel</button><button class=\"text-button\" data-action=\"apply-shift-import\">Import</button></footer>" +
        "</section></div>";
    }
    return "";
  }

  function renderPatternModal(modal) {
    var days = modal.items.map(function (text, index) {
      var day = "Day " + (index + 1);
      return "<li class=\"pattern-day\"><span class=\"pattern-day-label\">" + day + "</span>" +
        "<input data-field=\"pattern-day\" data-index=\"" + index + "\" data-focus-key=\"pattern-day-" + index + "\" value=\"" + attr(text) +
        "\" aria-label=\"" + day + "\" placeholder=\"Leave blank for a day off\">" +
        renderEntryPreview(text) +
        "<button class=\"icon-button\" data-action=\"remove-pattern-day\" data-index=\"" + index + "\" title=\"Remove " + day +
        "\" aria-label=\"Remove " + day + "\"" + (modal.items.length === 1 ? " disabled" : "") + ">X</button></li>";
    }).join("");
    var title = modal.id ? "Edit pattern" : "New pattern";
    return "<div class=\"modal-backdrop\"><section class=\"modal pattern-modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"pattern-title\">" +
      "<header><h2 id=\"pattern-title\">" + title + "</h2><button class=\"icon-button\" data-action=\"close-modal\" title=\"Close\" aria-label=\"Close\">X</button></header>" +
      "<div class=\"modal-body\">" +
      "<label class=\"modal-field\"><span>Name</span><input data-field=\"pattern-name\" data-focus-key=\"pattern-name\" value=\"" + attr(modal.name) + "\" placeholder=\"GEN call run\"></label>" +
      "<ol class=\"pattern-days\">" + days + "</ol>" +
      "<div class=\"pattern-actions\"><button class=\"text-button\" data-action=\"add-pattern-day\">Add day</button>" +
      "<span class=\"field-hint\">Enter moves to the next day. Leave a day blank for a gap; use ; for two entries on one day.</span></div>" +
      (modal.error ? "<p class=\"field-error\" role=\"alert\">" + escapeHtml(modal.error) + "</p>" : "") +
      "</div>" +
      "<footer><button class=\"text-button\" data-action=\"close-modal\">Cancel</button><button class=\"text-button primary-button\" data-action=\"save-pattern\">Save pattern</button></footer>" +
      "</section></div>";
  }

  function renderNewPlanModal(plan, modal) {
    var staffCount = plan.staff.length;
    return "<div class=\"modal-backdrop\"><section class=\"modal new-plan-modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"new-plan-title\">" +
      "<header><h2 id=\"new-plan-title\">New plan</h2><button class=\"icon-button\" data-action=\"close-modal\" title=\"Close\" aria-label=\"Close\">X</button></header>" +
      "<div class=\"modal-body\">" +
      "<label class=\"modal-field\"><span>Name</span><input data-field=\"new-plan-name\" data-focus-key=\"new-plan-name\" value=\"" + attr(modal.name) + "\"></label>" +
      "<div class=\"modal-field-row\">" +
      "<label class=\"modal-field\"><span>Start date</span><input type=\"date\" data-field=\"new-plan-start\" data-focus-key=\"new-plan-start\" value=\"" + attr(modal.dateStart) + "\"></label>" +
      "<label class=\"modal-field\"><span>End date</span><input type=\"date\" data-field=\"new-plan-end\" data-focus-key=\"new-plan-end\" value=\"" + attr(modal.dateEnd) + "\"></label>" +
      "</div>" +
      (staffCount ? "<label class=\"modal-check\"><input type=\"checkbox\" data-field=\"new-plan-keep-staff\"" + (modal.keepStaff ? " checked" : "") + "> Keep the current " + staffCount + " staff</label>" : "") +
      "<p class=\"field-hint\">This replaces the current plan. Undo brings it back.</p>" +
      (modal.error ? "<p class=\"field-error\" role=\"alert\">" + escapeHtml(modal.error) + "</p>" : "") +
      "</div>" +
      "<footer><button class=\"text-button\" data-action=\"close-modal\">Cancel</button><button class=\"text-button primary-button\" data-action=\"create-new-plan\">Create plan</button></footer>" +
      "</section></div>";
  }

  function renderHelpModal() {
    return "<div class=\"modal-backdrop help-backdrop\">" +
      "<section class=\"modal help-modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"help-title\" aria-describedby=\"help-intro\">" +
      "<header class=\"help-header\"><div><span class=\"help-eyebrow\">Quick guide</span>" +
      "<h2 id=\"help-title\">How to use Roster Scratch Planner</h2></div>" +
      "<button class=\"icon-button help-close\" data-action=\"close-modal\" title=\"Close guide\" aria-label=\"Close how-to guide\">X</button></header>" +
      "<div class=\"modal-body help-body\">" +
      "<p class=\"help-intro\" id=\"help-intro\">Build the roster directly in the grid: set the period and staff, fill cells, check warnings, then save or export.</p>" +
      "<ol class=\"help-flow\">" +
      helpFlowStep("1", "Set up", "Name the plan, choose the date range and add or import staff.") +
      helpFlowStep("2", "Fill the roster", "Type into cells or drag shifts, markers and patterns from the Palette.") +
      helpFlowStep("3", "Review & share", "Check warnings and distribution, lock finished cells, then save or export.") +
      "</ol>" +
      "<div class=\"help-guide-grid\">" +
      "<section class=\"help-card help-card-wide\"><div class=\"help-card-heading\"><span class=\"help-card-icon\">↔</span><div><h3>Manipulating cells</h3><p>Select, edit, move or protect any staff/date cell.</p></div></div>" +
      "<ul class=\"help-action-list\">" +
      helpAction("Click", "Select a cell or an item. Click the staff-name area around its controls to focus that row.") +
      helpAction("Double-click or type", "Edit a cell. Separate multiple entries with a semicolon or new line; press Enter to save, Shift+Enter for a new line, or Escape to cancel.") +
      helpAction("Drag", "Move an existing item to another cell. Hold Option (Mac) or Ctrl (Windows) while dropping to copy it. Pattern items move together.") +
      helpAction("Delete / Backspace", "Remove the selected item, or clear the selected cell. Double-click an item to edit just that item.") +
      helpAction("Copy / Paste", "Use Cmd/Ctrl+C and Cmd/Ctrl+V with a selected cell to reuse its contents.") +
      helpAction("Reorder staff", "Drag the grip beside a staff name up or down. Shifts and locks stay with that person.") +
      helpAction("Lock", "Use the padlock in the lower-right of a cell to prevent editing, dragging, clearing or structural changes.") +
      "</ul></section>" +
      "<section class=\"help-card\"><div class=\"help-card-heading\"><span class=\"help-card-icon\">⌨</span><div><h3>Shift shorthand</h3><p>Times are parsed as you type.</p></div></div>" +
      "<div class=\"help-examples\">" +
      helpExample("8 GEN ED", "0800–1600 · GEN · ED") +
      helpExample("630 CT ED", "0630–1430 · CT · ED") +
      helpExample("8-1230 EDCT", "Explicit 0800–1230 range") +
      helpExample("8 GEN ED (+call)", "Shift with on-call attached") +
      helpExample("RDO · AL · Training", "Markers need no time") +
      "</div><p class=\"help-note\">A start time without an end defaults to an 8-hour shift. Hover an item for its full parsed details.</p></section>" +
      "<section class=\"help-card\"><div class=\"help-card-heading\"><span class=\"help-card-icon\">✦</span><div><h3>Useful features</h3><p>Tools for faster planning and checking.</p></div></div>" +
      "<ul class=\"help-feature-list\">" +
      "<li><strong>Palette <span class=\"key-cap\">`</span></strong> — drag saved or recent shifts, markers and multi-day patterns. Use <strong>+</strong> to promote a recent shift.</li>" +
      "<li><strong>Full period / Week / Selected days</strong> — switch grid scope; click a date heading for its daily shift summary, or drag across date headings to show just those days.</li>" +
      "<li><strong>Available staff</strong> — type the day's FTE into its daily summary; the date heading then shows that figure less everyone rostered, on leave or away that day (On Call alone doesn't count). Clear the box to hide it.</li>" +
      "<li><strong>Distribution</strong> — compare each staff member's weekday modality mix for the dates on screen.</li>" +
      "<li><strong>Warnings</strong> — the bottom strip flags overlaps, short rest gaps and unusual multiple shifts.</li>" +
      "<li><strong>Undo / Redo</strong> — use the buttons or Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z.</li>" +
      "<li><strong>Save & export</strong> — work autosaves in this browser; Save downloads a portable plan. CSV and Print View are ready for sharing.</li>" +
      "</ul></section>" +
      "</div></div>" +
      "<footer class=\"help-footer\"><span><strong>Palette tip:</strong> group shifts by modality or start time, and use Import/Export Palette to reuse your setup.</span>" +
      "<button class=\"text-button help-done\" data-action=\"close-modal\">Got it</button></footer>" +
      "</section></div>";
  }

  function helpFlowStep(number, title, description) {
    return "<li><span class=\"help-step-number\">" + number + "</span><div><strong>" + title + "</strong><span>" + description + "</span></div></li>";
  }

  function helpAction(label, description) {
    return "<li><strong>" + label + "</strong><span>" + description + "</span></li>";
  }

  function helpExample(input, result) {
    return "<div><code>" + input + "</code><span>" + result + "</span></div>";
  }

  function renderDistributionModal(plan) {
    var dates = visibleRosterDates(plan);
    var distribution = Model.calculateModalityDistribution(plan, dates);
    var scope = formatDistributionScope(dates);
    var content;
    if (!distribution.modalities.length) {
      content = "<p class=\"distribution-empty\">No weekday shifts are assigned in this period.</p>";
    } else {
      var modalityHeaders = distribution.modalities.map(function (modality) {
        return "<th scope=\"col\">" + escapeHtml(modality) + "</th>";
      }).join("");
      var rows = distribution.rows.map(function (row) {
        return "<tr><th class=\"distribution-staff\" scope=\"row\">" + escapeHtml(row.name) + "</th>" +
          "<td class=\"distribution-worked\">" + row.workedShifts + "</td>" +
          row.cells.map(renderDistributionCell).join("") + "</tr>";
      }).join("");
      content = "<table class=\"distribution-table\">" +
        "<caption class=\"visually-hidden\">Modality distribution by staff member for " + escapeHtml(scope) + "</caption>" +
        "<thead><tr><th class=\"distribution-staff\" scope=\"col\">Staff</th><th class=\"distribution-worked\" scope=\"col\">Worked shifts</th>" +
        modalityHeaders + "</tr></thead><tbody>" + rows + "</tbody></table>";
    }
    return "<div class=\"modal-backdrop\"><section class=\"modal distribution-modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"distribution-title\">" +
      "<header><div><h2 id=\"distribution-title\">Modality distribution</h2><p class=\"distribution-subtitle\">" +
      escapeHtml(scope) + " · Weekdays only</p></div><button class=\"icon-button\" data-action=\"close-modal\" title=\"Close distribution\" aria-label=\"Close distribution\">X</button></header>" +
      "<div class=\"modal-body distribution-body\">" + content + "</div>" +
      "<footer><button class=\"text-button\" data-action=\"close-modal\">Close</button></footer></section></div>";
  }

  function renderDistributionCell(cell) {
    var percentage = formatPercentage(cell.percentage);
    var label = cell.count + (cell.count === 1 ? " shift" : " shifts") + ", " + percentage;
    if (!cell.count) {
      return "<td class=\"distribution-value distribution-zero\" aria-label=\"" + attr(label) + "\">—</td>";
    }
    return "<td class=\"distribution-value\" aria-label=\"" + attr(label) + "\"><span class=\"distribution-count\">" +
      cell.count + "</span> <span class=\"distribution-percentage\">(" + percentage + ")</span></td>";
  }

  function formatPercentage(value) {
    return (Number.isInteger(value) ? String(value) : Number(value).toFixed(1)) + "%";
  }

  function formatDistributionScope(dates) {
    if (!dates.length) {
      return "No displayed dates";
    }
    if (dates.length === 1) {
      return new Date(dates[0] + "T00:00:00Z").toLocaleDateString("en-AU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC"
      });
    }
    return formatDateRange(dates[0], dates[dates.length - 1]);
  }

  function wire(root, state, actions) {
    root.querySelectorAll("[data-action]").forEach(function (element) {
      element.addEventListener("click", function (event) {
        var action = element.dataset.action;
        if (action === "toggle-day-summary" && suppressSummaryClick) {
          suppressSummaryClick = false;
          event.preventDefault();
          return;
        }
        if (clickActions[action]) {
          event.preventDefault();
          event.stopPropagation();
          clickActions[action](element, state, actions);
        }
      });
    });

    wireDateRangeDrag(root, actions);
    wireCrosshair(root);

    root.querySelectorAll("input[data-action='rename-plan']").forEach(function (input) {
      input.addEventListener("change", function () { actions.renamePlan(input.value); });
    });
    root.querySelectorAll("input[data-action='set-day-fte']").forEach(function (input) {
      // The figure is held as a draft while typing and saved when the pane closes or on Enter,
      // so re-rendering on blur cannot swallow the click that closes the pane.
      input.addEventListener("input", function () { actions.draftDayFte(input.dataset.date, input.value); });
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          actions.commitDayFte();
        } else if (event.key === "Escape") {
          event.preventDefault();
          actions.closeDaySummary();
        }
      });
    });
    root.querySelectorAll("input[data-action='rename-staff']").forEach(function (input) {
      input.addEventListener("change", function () { actions.renameStaff(input.dataset.staffId, input.value); });
    });
    root.querySelectorAll("[data-staff-focus-target]").forEach(function (cell) {
      cell.addEventListener("click", function (event) {
        if (event.target.closest("input, button, .staff-drag-handle")) {
          return;
        }
        actions.toggleStaffFocus(cell.dataset.staffId);
      });
    });

    root.ondragover = function (event) {
      updatePaletteDragPosition(root, event);
    };

    var helpClose = root.querySelector(".help-modal .help-close");
    if (helpClose) {
      helpClose.focus();
    }

    root.querySelectorAll("[data-staff-row]").forEach(function (row) {
      row.addEventListener("dragover", function (event) {
        if (!isStaffDrag(event)) {
          return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        var after = isLowerHalf(row, event);
        root.querySelectorAll(".staff-drop-before, .staff-drop-after").forEach(function (other) {
          if (other !== row) {
            clearStaffDropIndicator(other);
          }
        });
        row.classList.toggle("staff-drop-before", !after);
        row.classList.toggle("staff-drop-after", after);
      });
      row.addEventListener("dragleave", function (event) {
        var rect = row.getBoundingClientRect();
        if (event.clientY < rect.top || event.clientY >= rect.bottom || event.clientX < rect.left || event.clientX >= rect.right) {
          clearStaffDropIndicator(row);
        }
      });
      row.addEventListener("drop", function (event) {
        if (!isStaffDrag(event)) {
          return;
        }
        event.preventDefault();
        var payload = DragDrop.getPayload(event);
        var beforeRow = isLowerHalf(row, event) ? row.nextElementSibling : row;
        clearStaffDropClasses(root);
        DragDrop.clearPayload();
        actions.moveStaff(payload.staffId, beforeRow ? beforeRow.dataset.staffRow : null);
      });
    });

    root.querySelectorAll("[data-cell]").forEach(function (cell) {
      cell.addEventListener("click", function () {
        actions.selectCell(cell.dataset.staffId, cell.dataset.date);
      });
      cell.addEventListener("dblclick", function () {
        actions.startEditCell(cell.dataset.staffId, cell.dataset.date);
      });
      cell.addEventListener("dragover", function (event) {
        if (isStaffDrag(event)) {
          return;
        }
        event.preventDefault();
        if (cell.dataset.locked === "true") {
          cell.classList.add("locked-drop-target");
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "none";
          }
          return;
        }
        cell.classList.add("drop-target");
        var payload = DragDrop.getPayload(event);
        var copyDrop = isCopyItemDrop(event, payload);
        cell.classList.toggle("copy-target", copyDrop);
        if (event.dataTransfer && payload) {
          event.dataTransfer.dropEffect = payload.type === "item" && !copyDrop ? "move" : "copy";
        }
        if (payload && payload.type === "pattern") {
          actions.previewPattern(cell.dataset.staffId, cell.dataset.date, payload.id);
        }
      });
      cell.addEventListener("dragleave", function () {
        cell.classList.remove("drop-target");
        cell.classList.remove("copy-target");
        cell.classList.remove("locked-drop-target");
      });
      cell.addEventListener("drop", function (event) {
        if (isStaffDrag(event)) {
          return;
        }
        event.preventDefault();
        var payload = DragDrop.getPayload(event);
        var copyDrop = isCopyItemDrop(event, payload);
        var shouldClosePalette = root.dataset.paletteClosedByDrag === "true";
        root.classList.remove("palette-dragging");
        root.classList.remove("palette-dragging-outside");
        delete root.dataset.paletteClosedByDrag;
        cell.classList.remove("drop-target");
        cell.classList.remove("copy-target");
        cell.classList.remove("locked-drop-target");
        actions.dropOnCell(payload, cell.dataset.staffId, cell.dataset.date, { copy: copyDrop });
        DragDrop.clearPayload();
        if (shouldClosePalette) {
          actions.closePalette();
        }
      });
    });

    root.querySelectorAll("[draggable='true']").forEach(function (element) {
      element.addEventListener("dragstart", function (event) {
        if (element.dataset.staffDrag) {
          DragDrop.setPayload(event, { type: "staff", staffId: element.dataset.staffDrag, label: "Staff" });
          var sourceRow = element.closest("[data-staff-row]");
          var sourceCell = element.closest(".staff-cell");
          if (event.dataTransfer && event.dataTransfer.setDragImage && sourceCell) {
            event.dataTransfer.setDragImage(sourceCell, 16, sourceCell.offsetHeight / 2);
          }
          if (sourceRow) {
            sourceRow.classList.add("staff-dragging");
          }
          return;
        }
        if (element.dataset.itemId) {
          DragDrop.setPayload(event, { type: "item", itemId: element.dataset.itemId });
          actions.beginItemDrag(element.dataset.itemId);
          return;
        }
        if (element.closest(".palette")) {
          root.classList.add("palette-dragging");
          root.classList.remove("palette-dragging-outside");
          delete root.dataset.paletteClosedByDrag;
        }
        DragDrop.setPayload(event, {
          type: element.dataset.dragType,
          id: element.dataset.id,
          text: element.dataset.text
        });
        updatePaletteDragPosition(root, event);
      });
      element.addEventListener("drag", function (event) {
        updatePaletteDragPosition(root, event);
      });
      element.addEventListener("dragend", function () {
        if (element.dataset.staffDrag) {
          clearStaffDropClasses(root);
          DragDrop.clearPayload();
          return;
        }
        var shouldClosePalette = root.dataset.paletteClosedByDrag === "true";
        root.classList.remove("palette-dragging");
        root.classList.remove("palette-dragging-outside");
        delete root.dataset.paletteClosedByDrag;
        actions.clearPreview();
        DragDrop.clearPayload();
        if (shouldClosePalette) {
          actions.closePalette();
        }
      });
    });

    root.querySelectorAll("[data-item-id]").forEach(function (item) {
      item.addEventListener("click", function (event) {
        event.stopPropagation();
        actions.selectItem(item.dataset.itemId);
      });
      item.addEventListener("dblclick", function (event) {
        event.stopPropagation();
        actions.editItem(item.dataset.itemId);
      });
    });

    var editor = root.querySelector("[data-editor='cell']");
    if (editor) {
      editor.focus();
      editor.selectionStart = editor.value.length;
      editor.selectionEnd = editor.value.length;
      editor.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          actions.commitCellEditor(editor.value);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          actions.cancelCellEditor();
        }
      });
      editor.addEventListener("input", function () {
        if (state.editCell) {
          state.editCell.text = editor.value;
        }
      });
      editor.addEventListener("blur", function () {
        actions.commitCellEditor(editor.value);
      });
    }

    wireInlineEditor(root.querySelector("[data-editor='item']"), {
      onInput: function (value) {
        if (state.editItem) {
          state.editItem.text = value;
        }
      },
      commit: actions.commitItemEditor,
      cancel: actions.cancelItemEditor
    });
    wireInlineEditor(root.querySelector("[data-editor='palette']"), {
      onInput: function (value) {
        if (state.paletteEdit) {
          state.paletteEdit.text = value;
        }
      },
      commit: actions.commitPaletteEditor,
      cancel: actions.cancelPaletteEditor
    });
    wireModalFields(root, state, actions);
  }

  // Full period / Selected days: drag across date headings to show just those days.
  function wireDateRangeDrag(root, actions) {
    var grid = root.querySelector(".roster-grid");
    if (!grid || grid.dataset.viewMode === "week") {
      return;
    }
    var doc = root.ownerDocument;
    grid.querySelectorAll(".date-head").forEach(function (head) {
      head.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) {
          return;
        }
        startDateRangeDrag(doc, grid, head.dataset.date, actions);
      });
    });
  }

  function startDateRangeDrag(doc, grid, startDate, actions) {
    var endDate = startDate;
    var moved = false;

    function headAt(event) {
      var target = doc.elementFromPoint(event.clientX, event.clientY);
      var head = target && target.closest ? target.closest(".date-head") : null;
      return head && grid.contains(head) ? head : null;
    }

    function onMove(event) {
      var head = headAt(event);
      if (!head || head.dataset.date === endDate) {
        return;
      }
      endDate = head.dataset.date;
      moved = moved || endDate !== startDate;
      if (moved) {
        showDateRangePreview(grid, startDate, endDate);
      }
    }

    function onUp(event) {
      var head = headAt(event);
      finish();
      if (!moved) {
        return;
      }
      // The click that follows a drag must not toggle the daily summary.
      suppressSummaryClick = true;
      setTimeout(function () { suppressSummaryClick = false; }, 0);
      if (head && head.dataset.date !== startDate) {
        actions.selectDateRange(startDate, head.dataset.date);
      }
    }

    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish();
      }
    }

    function finish() {
      doc.removeEventListener("pointermove", onMove);
      doc.removeEventListener("pointerup", onUp);
      doc.removeEventListener("pointercancel", finish);
      doc.removeEventListener("keydown", onKey, true);
      showDateRangePreview(grid, null, null);
    }

    doc.addEventListener("pointermove", onMove);
    doc.addEventListener("pointerup", onUp);
    doc.addEventListener("pointercancel", finish);
    doc.addEventListener("keydown", onKey, true);
  }

  function showDateRangePreview(grid, firstKey, secondKey) {
    var start = firstKey && secondKey && firstKey > secondKey ? secondKey : firstKey;
    var end = firstKey && secondKey && firstKey > secondKey ? firstKey : secondKey;
    grid.classList.toggle("date-range-dragging", Boolean(start));
    grid.querySelectorAll("th[data-date], td[data-cell]").forEach(function (cell) {
      var dateKey = cell.dataset.date;
      cell.classList.toggle("date-range-preview", Boolean(start) && dateKey >= start && dateKey <= end);
    });
  }

  // Highlight the row and column of the cell under the cursor, including while dragging a shift.
  function wireCrosshair(root) {
    var grid = root.querySelector(".roster-grid");
    if (!grid || !grid.addEventListener) {
      return;
    }
    applyCrosshair(grid, crosshair);

    function track(event) {
      var target = event.target && event.target.closest ?
        event.target.closest("td[data-cell], th[data-date], th.staff-cell") : null;
      var next = target && grid.contains(target) ? {
        staffId: target.dataset.staffId || null,
        date: target.dataset.date || null
      } : null;
      if (next && event.type === "dragover" && isStaffDrag(event)) {
        next = null;
      }
      if (!sameCrosshair(next, crosshair)) {
        crosshair = next;
        applyCrosshair(grid, crosshair);
      }
    }

    function clear() {
      if (crosshair) {
        crosshair = null;
        applyCrosshair(grid, null);
      }
    }

    grid.addEventListener("pointerover", function (event) {
      if (event.pointerType !== "touch") {
        track(event);
      }
    });
    grid.addEventListener("dragover", track);
    grid.addEventListener("pointerleave", clear);
    grid.addEventListener("dragleave", function (event) {
      if (!event.relatedTarget || !grid.contains(event.relatedTarget)) {
        clear();
      }
    });
  }

  function sameCrosshair(a, b) {
    return a === b || Boolean(a && b && a.staffId === b.staffId && a.date === b.date);
  }

  function applyCrosshair(grid, target) {
    grid.querySelectorAll(".crosshair-row, .crosshair-col").forEach(function (cell) {
      cell.classList.remove("crosshair-row", "crosshair-col", "crosshair-cell");
    });
    if (!target) {
      return;
    }
    grid.querySelectorAll("td[data-cell], th[data-date], th.staff-cell").forEach(function (cell) {
      var inRow = Boolean(target.staffId) && cell.dataset.staffId === target.staffId;
      var inCol = Boolean(target.date) && cell.dataset.date === target.date;
      cell.classList.toggle("crosshair-row", inRow);
      cell.classList.toggle("crosshair-col", inCol);
      cell.classList.toggle("crosshair-cell", inRow && inCol);
    });
  }

  function wireInlineEditor(input, handlers) {
    if (!input) {
      return;
    }
    var done = false;
    var preview = input.parentNode.querySelector("[data-preview]");
    ["click", "dblclick", "mousedown"].forEach(function (type) {
      input.addEventListener(type, function (event) { event.stopPropagation(); });
    });
    input.addEventListener("input", function () {
      handlers.onInput(input.value);
      if (preview) {
        updatePreview(preview, input.value);
      } else {
        input.title = Parser.describeEntry(input.value).text + "\nEnter to save, Escape to cancel, clear to delete";
      }
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        done = true;
        handlers.commit(input.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        done = true;
        handlers.cancel();
      }
    });
    input.addEventListener("blur", function () {
      if (!done) {
        done = true;
        handlers.commit(input.value);
      }
    });
  }

  function updatePreview(preview, text) {
    var described = describeForSection(text, preview.dataset.section);
    preview.className = "entry-preview tone-" + described.tone;
    preview.textContent = described.text;
  }

  function wireModalFields(root, state, actions) {
    var modal = state.modal;
    var dialog = root.querySelector(".modal");
    if (!modal || !dialog) {
      return;
    }
    dialog.querySelectorAll("input").forEach(function (input) {
      input.addEventListener("input", function () {
        var field = input.dataset.field;
        if (field === "pattern-name") {
          modal.name = input.value;
        } else if (field === "pattern-day") {
          modal.items[Number(input.dataset.index)] = input.value;
          var preview = input.parentNode.querySelector("[data-preview]");
          if (preview) {
            updatePreview(preview, input.value);
          }
        } else if (field === "new-plan-name") {
          modal.name = input.value;
        } else if (field === "new-plan-start") {
          modal.dateStart = input.value;
        } else if (field === "new-plan-end") {
          modal.dateEnd = input.value;
        }
      });
      input.addEventListener("change", function () {
        if (input.dataset.field === "new-plan-keep-staff") {
          modal.keepStaff = input.checked;
        }
      });
      input.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          actions.closeModal();
          return;
        }
        if (event.key !== "Enter" || input.type === "checkbox") {
          return;
        }
        event.preventDefault();
        if (modal.type === "new-plan") {
          actions.createNewPlan();
        } else if (modal.type === "pattern") {
          if (event.metaKey || event.ctrlKey) {
            actions.savePattern();
          } else {
            var index = input.dataset.field === "pattern-name" ? -1 : Number(input.dataset.index);
            actions.nextPatternDay(index);
          }
        }
      });
    });
  }

  function updatePaletteDragPosition(root, event) {
    if (!root.classList.contains("palette-dragging") || !event.clientX && !event.clientY) {
      return;
    }
    var palette = root.querySelector(".palette");
    if (!palette) {
      return;
    }
    var rect = palette.getBoundingClientRect();
    var outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) {
      root.classList.add("palette-dragging-outside");
      root.dataset.paletteClosedByDrag = "true";
    }
  }

  function isStaffDrag(event) {
    var payload = DragDrop.getPayload(event);
    return !!(payload && payload.type === "staff");
  }

  function isLowerHalf(row, event) {
    var rect = row.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  }

  function clearStaffDropIndicator(row) {
    row.classList.remove("staff-drop-before");
    row.classList.remove("staff-drop-after");
  }

  function clearStaffDropClasses(root) {
    root.querySelectorAll("[data-staff-row]").forEach(function (row) {
      clearStaffDropIndicator(row);
      row.classList.remove("staff-dragging");
    });
  }

  function isCopyItemDrop(event, payload) {
    return !!(payload && payload.type === "item" && (event.ctrlKey || event.altKey));
  }

  var clickActions = {
    "apply-dates": function (element, state, actions) {
      var root = element.closest(".command-bar");
      actions.applyDates(root.querySelector("[data-action='date-start']").value, root.querySelector("[data-action='date-end']").value);
    },
    "expand-before": function (element, state, actions) { actions.expandDates("before"); },
    "expand-after": function (element, state, actions) { actions.expandDates("after"); },
    "trim-start": function (element, state, actions) { actions.trimDates("start"); },
    "trim-end": function (element, state, actions) { actions.trimDates("end"); },
    "undo": function (element, state, actions) { actions.undo(); },
    "redo": function (element, state, actions) { actions.redo(); },
    "add-staff": function (element, state, actions) { actions.addStaff(); },
    "import-staff": function (element, state, actions) { actions.openStaffImport(); },
    "import-shifts": function (element, state, actions) { actions.openShiftImport(); },
    "ungroup": function (element, state, actions) { actions.ungroupSelected(); },
    "toggle-palette": function (element, state, actions) { actions.togglePalette(); },
    "close-palette": function (element, state, actions) { actions.closePalette(); },
    "date-view-mode": function (element, state, actions) { actions.setDateViewMode(element.dataset.viewMode); },
    "previous-week": function (element, state, actions) { actions.navigateWeek(-1); },
    "next-week": function (element, state, actions) { actions.navigateWeek(1); },
    "open-help": function (element, state, actions) { actions.openHelp(); },
    "open-distribution": function (element, state, actions) { actions.openDistribution(); },
    "toggle-day-summary": function (element, state, actions) { actions.toggleDaySummary(element.dataset.date); },
    "close-day-summary": function (element, state, actions) { actions.closeDaySummary(); },
    "toggle-cell-lock": function (element, state, actions) { actions.toggleCellLock(element.dataset.staffId, element.dataset.date); },
    "new-plan": function (element, state, actions) { actions.newPlan(); },
    "open-plan": function (element, state, actions) { actions.openPlan(); },
    "save-plan": function (element, state, actions) { actions.savePlan(); },
    "csv": function (element, state, actions) { actions.exportCsv(); },
    "print": function (element, state, actions) { actions.openPrintView(); },
    "export-palette": function (element, state, actions) { actions.exportPalette(); },
    "import-palette": function (element, state, actions) { actions.importPalette(); },
    "palette-group": function (element, state, actions) { actions.setPaletteGroupBy(element.dataset.groupBy); },
    "delete-staff": function (element, state, actions) { actions.deleteStaff(element.dataset.staffId); },
    "delete-item": function (element, state, actions) { actions.deleteItem(element.dataset.itemId); },
    "remove-call": function (element, state, actions) { actions.removeCall(element.dataset.itemId); },
    "promote-session": function (element, state, actions) { actions.promoteSession(element.dataset.id); },
    "edit-palette": function (element, state, actions) { actions.editPalette(element.dataset.section, element.dataset.id); },
    "delete-palette": function (element, state, actions) { actions.deletePalette(element.dataset.section, element.dataset.id); },
    "add-palette": function (element, state, actions) { actions.addPalette(element.dataset.section); },
    "add-pattern": function (element, state, actions) { actions.addPattern(); },
    "edit-pattern": function (element, state, actions) { actions.editPattern(element.dataset.id); },
    "close-modal": function (element, state, actions) { actions.closeModal(); },
    "add-pattern-day": function (element, state, actions) { actions.nextPatternDay(-2); },
    "remove-pattern-day": function (element, state, actions) { actions.removePatternDay(Number(element.dataset.index)); },
    "save-pattern": function (element, state, actions) { actions.savePattern(); },
    "create-new-plan": function (element, state, actions) { actions.createNewPlan(); },
    "choose-staff-file": function (element, state, actions) { actions.chooseStaffFile(); },
    "choose-shift-file": function (element, state, actions) { actions.chooseShiftFile(); },
    "apply-staff-import": function (element, state, actions) {
      var modal = element.closest(".modal");
      actions.applyStaffImport(modal.querySelector("[data-field='staff-text']").value);
    },
    "apply-shift-import": function (element, state, actions) {
      var modal = element.closest(".modal");
      actions.applyShiftImport(modal.querySelector("[data-field='shift-text']").value);
    }
  };

  function dragTypeFor(section) {
    if (section === "markers") {
      return "palette-marker";
    }
    return "palette-shift";
  }

  function getPaletteGroupBy(state) {
    var display = state.plan && state.plan.display ? state.plan.display : {};
    return display.paletteGroupBy === "start" ? "start" : "modality";
  }

  function groupPaletteShifts(items, groupBy) {
    var groups = {};
    items.forEach(function (entry) {
      var meta = paletteShiftMeta(entry);
      var key = groupBy === "start" ? meta.startKey : meta.modalityKey;
      var label = groupBy === "start" ? meta.startLabel : meta.modalityLabel;
      if (!groups[key]) {
        groups[key] = { key: key, label: label, sort: groupBy === "start" ? meta.startSort : label, items: [] };
      }
      groups[key].items.push(entry);
    });
    if (groupBy === "modality") {
      Object.keys(groups).forEach(function (key) {
        groups[key].items.sort(function (a, b) {
          return paletteShiftMeta(a).startSort - paletteShiftMeta(b).startSort;
        });
      });
    }
    return Object.keys(groups).map(function (key) {
      return groups[key];
    }).sort(function (a, b) {
      if (a.key === "ungrouped") {
        return 1;
      }
      if (b.key === "ungrouped") {
        return -1;
      }
      return String(a.sort).localeCompare(String(b.sort), undefined, { numeric: true });
    });
  }

  function paletteShiftMeta(entry) {
    var parsed = Parser.parseRosterText(entry.text || entry.label || "", "2000-01-01");
    var modality = parsed.kind === "shift" && parsed.modality ? String(parsed.modality).toUpperCase() : "";
    var start = parsed.startTime ? parsed.startTime.text : "";
    return {
      modalityKey: modality || "ungrouped",
      modalityLabel: modality || "Other",
      startKey: start || "ungrouped",
      startLabel: start || "No start time",
      startSort: parsed.startTime ? parsed.startTime.minutes : Number.POSITIVE_INFINITY
    };
  }

  function modalityClass(item) {
    if (item.kind !== "shift") {
      return "";
    }
    var modality = String(item.modality || "").toUpperCase();
    if (modality === "GEN") {
      return "modality-gen";
    }
    if (modality === "CT") {
      return "modality-ct";
    }
    if (modality === "MRI") {
      return "modality-mri";
    }
    return "modality-other";
  }

  function isPatternPreview(state, staffId, dateKey) {
    if (!state.dragPreview || state.dragPreview.staffId !== staffId) {
      return false;
    }
    return state.dragPreview.dates.indexOf(dateKey) !== -1;
  }

  function bindResizeWatcher() {
    if (resizeWatcherBound || typeof window === "undefined") {
      return;
    }
    resizeWatcherBound = true;
    window.addEventListener("resize", scheduleResponsiveSizing);
  }

  function scheduleResponsiveSizing() {
    if (resizeFrame || typeof window === "undefined") {
      return;
    }
    resizeFrame = window.requestAnimationFrame(function () {
      resizeFrame = 0;
      if (latestRoot && latestPlan) {
        syncCommandBarSizing(latestRoot);
        syncGridSizing(latestRoot, latestPlan);
        showScaleReadout(latestRoot);
      }
    });
  }

  function syncCommandBarSizing(root) {
    var commandBar = root.querySelector(".command-bar");
    var content = root.querySelector(".command-bar-content");
    if (!commandBar || !content) {
      return;
    }
    var styles = root.ownerDocument.defaultView.getComputedStyle(commandBar);
    var horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
    var availableWidth = Math.max(0, commandBar.clientWidth - horizontalPadding);
    var naturalWidth = content.scrollWidth;
    var scale = naturalWidth > availableWidth && naturalWidth > 0 ? availableWidth / naturalWidth : 1;
    content.style.setProperty("--command-scale", String(scale));
    content.dataset.commandScale = scale.toFixed(4);
  }

  function syncGridSizing(root, plan) {
    var gridWrap = root.querySelector(".grid-wrap");
    var grid = root.querySelector(".roster-grid");
    if (!gridWrap || !grid) {
      return;
    }
    var dateCount = Number(grid.dataset.dateCount) || Model.enumerateDates(plan.dateStart, plan.dateEnd).length;
    var viewMode = grid.dataset.viewMode === "week" ? "week" : "full";
    var fullPeriodMinWidth = Math.max(MIN_CELL_FALLBACK, measureMaxPaletteLabelWidth(root, plan) + CELL_LABEL_CHROME_WIDTH);
    var minCellWidth = viewMode === "week" ? MIN_CELL_FALLBACK : fullPeriodMinWidth;
    var styles = root.ownerDocument.defaultView.getComputedStyle(gridWrap);
    var horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
    var availableWidth = Math.max(0, gridWrap.clientWidth - horizontalPadding - STAFF_COLUMN_WIDTH);
    var fillWidth = dateCount ? Math.floor(availableWidth / dateCount) : minCellWidth;
    var cellWidth = Math.max(minCellWidth, fillWidth);
    var gridWidth = STAFF_COLUMN_WIDTH + (dateCount * cellWidth);
    var fitWidth = availableWidth + STAFF_COLUMN_WIDTH;
    // Too narrow for the minimum cell width: shrink the whole grid instead of scrolling sideways.
    var scale = gridWidth > fitWidth && gridWidth > 0 ? Math.max(0, fitWidth) / gridWidth : 1;
    grid.style.setProperty("--roster-cell-width", cellWidth + "px");
    grid.style.setProperty("--roster-grid-width", gridWidth + "px");
    grid.style.setProperty("--roster-scale", String(scale));
    grid.dataset.gridScale = scale.toFixed(4);
  }

  // Temporary tuning aid: shows the grid scale while the window is resized.
  function showScaleReadout(root) {
    var doc = root.ownerDocument;
    var grid = root.querySelector(".roster-grid");
    if (!grid) {
      return;
    }
    var readout = doc.getElementById("scale-readout");
    if (!readout) {
      readout = doc.createElement("div");
      readout.id = "scale-readout";
      readout.className = "scale-readout";
      readout.setAttribute("aria-hidden", "true");
      doc.body.appendChild(readout);
    }
    readout.textContent = "Scale " + Number(grid.dataset.gridScale || 1).toFixed(2) + " · " + doc.defaultView.innerWidth + "px wide";
    readout.classList.add("visible");
    clearTimeout(scaleReadoutTimer);
    scaleReadoutTimer = setTimeout(function () {
      readout.classList.remove("visible");
    }, 2000);
  }

  function restoreGridScroll(root, scrollTop, scrollLeft, previousViewKey) {
    var gridWrap = root.querySelector ? root.querySelector(".grid-wrap") : null;
    if (!gridWrap) {
      return;
    }
    gridWrap.scrollTop = scrollTop;
    gridWrap.scrollLeft = previousViewKey && previousViewKey !== gridWrap.dataset.viewKey ? 0 : scrollLeft;
  }

  function measureMaxPaletteLabelWidth(root, plan) {
    var labels = collectPaletteLabels(plan);
    if (!labels.length) {
      return 0;
    }
    var sample = root.querySelector(".item-label") || root.querySelector(".chip-label") || root;
    var styles = root.ownerDocument.defaultView.getComputedStyle(sample);
    var canvas = measureMaxPaletteLabelWidth.canvas || (measureMaxPaletteLabelWidth.canvas = root.ownerDocument.createElement("canvas"));
    var context = canvas.getContext("2d");
    context.font = [
      styles.fontStyle,
      styles.fontVariant,
      styles.fontWeight,
      styles.fontSize + "/" + styles.lineHeight,
      styles.fontFamily
    ].join(" ");
    return labels.reduce(function (max, label) {
      return Math.max(max, context.measureText(label).width);
    }, 0);
  }

  function collectPaletteLabels(plan) {
    var palette = plan.palette || {};
    var labels = [];
    ["savedShifts", "sessionShifts", "markers"].forEach(function (section) {
      (palette[section] || []).forEach(function (entry) {
        labels.push(String(entry.label || entry.text || ""));
      });
    });
    (palette.patterns || []).forEach(function (pattern) {
      labels.push(String(pattern.name || ""));
      (pattern.items || []).forEach(function (entry) {
        labels.push(String(entry.text || ""));
      });
    });
    return labels.filter(Boolean);
  }

  function disabled(flag) {
    return flag ? "disabled" : "";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function attr(value) {
    return escapeHtml(value).replace(/'/g, "&#39;");
  }

  return {
    render: render,
    visibleRosterDates: visibleRosterDates,
    escapeHtml: escapeHtml
  };
});
