(function (root) {
  "use strict";

  var Model = root.RosterModel;
  var Parser = root.RosterParser;
  var History = root.RosterHistory;
  var Validation = root.RosterValidation;
  var Storage = root.RosterStorage;
  var Exporter = root.RosterExport;
  var Fixtures = root.RosterFixtures;
  var Render = root.RosterRender;

  var appRoot = document.getElementById("app");
  var planInput = document.getElementById("plan-file-input");
  var paletteInput = document.getElementById("palette-file-input");
  var staffInput = document.getElementById("staff-file-input");
  var shiftInput = document.getElementById("shift-file-input");

  var state = {
    plan: loadInitialPlan(),
    validation: null,
    selectedCell: null,
    selectedItemId: null,
    selectedGroupId: null,
    focusedStaffId: null,
    editCell: null,
    dragPreview: null,
    modal: null,
    paletteOpen: false,
    summaryDate: null,
    toast: "",
    canUndo: false,
    canRedo: false
  };

  var history = new History.PlanHistory(
    function () { return state.plan; },
    function (plan) { state.plan = Model.normalizePlan(plan); },
    afterStateChange
  );

  var actions = {
    renamePlan: renamePlan,
    applyDates: applyDates,
    expandDates: expandDates,
    trimDates: trimDates,
    undo: function () { history.undo(); },
    redo: function () { history.redo(); },
    addStaff: addStaff,
    renameStaff: renameStaff,
    reorderStaff: reorderStaff,
    deleteStaff: deleteStaff,
    openStaffImport: function () { state.modal = { type: "staff-import", text: "" }; render(); },
    chooseStaffFile: function () { staffInput.click(); },
    applyStaffImport: applyStaffImport,
    openShiftImport: function () { state.modal = { type: "shift-import", text: "" }; render(); },
    chooseShiftFile: function () { shiftInput.click(); },
    applyShiftImport: applyShiftImport,
    openHelp: openHelp,
    openDistribution: openDistribution,
    closeModal: closeModal,
    ungroupSelected: ungroupSelected,
    newPlan: newPlan,
    openPlan: function () { planInput.click(); },
    savePlan: savePlan,
    exportCsv: exportCsv,
    openPrintView: openPrintView,
    exportPalette: exportPalette,
    importPalette: function () { paletteInput.click(); },
    togglePalette: togglePalette,
    closePalette: closePalette,
    setDateViewMode: setDateViewMode,
    navigateWeek: navigateWeek,
    toggleDaySummary: toggleDaySummary,
    closeDaySummary: closeDaySummary,
    toggleStaffFocus: toggleStaffFocus,
    selectCell: selectCell,
    toggleCellLock: toggleCellLock,
    startEditCell: startEditCell,
    commitCellEditor: commitCellEditor,
    cancelCellEditor: cancelCellEditor,
    selectItem: selectItem,
    beginItemDrag: beginItemDrag,
    editItem: editItem,
    deleteItem: deleteItem,
    removeCall: removeCall,
    dropOnCell: dropOnCell,
    previewPattern: previewPattern,
    clearPreview: clearPreview,
    promoteSession: promoteSession,
    editPalette: editPalette,
    deletePalette: deletePalette,
    addPalette: addPalette,
    addPattern: addPattern,
    editPattern: editPattern,
    setPaletteGroupBy: setPaletteGroupBy
  };

  planInput.addEventListener("change", function () {
    if (!planInput.files || !planInput.files[0]) {
      return;
    }
    Storage.readFileAsText(planInput.files[0]).then(function (text) {
      var parsed = Storage.parsePlan(text);
      if (parsed.warnings.length && !confirm(parsed.warnings.join("\n") + "\n\nOpen anyway?")) {
        return;
      }
      history.replace("Open plan", parsed.plan);
      showToast("Plan opened.");
    }).catch(function (error) {
      showToast("Could not open plan: " + error.message);
    }).finally(function () {
      planInput.value = "";
    });
  });

  paletteInput.addEventListener("change", function () {
    if (!paletteInput.files || !paletteInput.files[0]) {
      return;
    }
    Storage.readFileAsText(paletteInput.files[0]).then(function (text) {
      var parsed = Storage.parsePalette(text);
      if (parsed.warnings.length && !confirm(parsed.warnings.join("\n") + "\n\nImport anyway?")) {
        return;
      }
      var mode = confirm("Replace the current saved palette? Choose Cancel to add imported items.") ? "replace" : "add";
      history.execute("Import palette", function (plan) {
        Storage.mergePalette(plan, parsed.palette, mode);
        return plan;
      });
      showToast("Palette imported.");
    }).catch(function (error) {
      showToast("Could not import palette: " + error.message);
    }).finally(function () {
      paletteInput.value = "";
    });
  });

  staffInput.addEventListener("change", function () {
    if (!staffInput.files || !staffInput.files[0]) {
      return;
    }
    Storage.readFileAsText(staffInput.files[0]).then(function (text) {
      state.modal = { type: "staff-import", text: text };
      render();
    }).catch(function (error) {
      showToast("Could not read staff file: " + error.message);
    }).finally(function () {
      staffInput.value = "";
    });
  });

  shiftInput.addEventListener("change", function () {
    if (!shiftInput.files || !shiftInput.files[0]) {
      return;
    }
    Storage.readFileAsText(shiftInput.files[0]).then(function (text) {
      state.modal = { type: "shift-import", text: text };
      render();
    }).catch(function (error) {
      showToast("Could not read shift file: " + error.message);
    }).finally(function () {
      shiftInput.value = "";
    });
  });

  document.addEventListener("keydown", handleKeydown);

  afterStateChange();

  function loadInitialPlan() {
    var saved = "";
    try {
      saved = localStorage.getItem("roster-scratch-autosave");
    } catch (error) {
      saved = "";
    }
    if (saved) {
      try {
        return Storage.parsePlan(saved).plan;
      } catch (error) {
        try {
          localStorage.removeItem("roster-scratch-autosave");
        } catch (ignore) {}
      }
    }
    return Fixtures.createFixturePlan();
  }

  function autosave() {
    try {
      localStorage.setItem("roster-scratch-autosave", Storage.serializePlan(state.plan));
    } catch (error) {
      // Autosave is best effort only.
    }
  }

  function afterStateChange() {
    state.validation = Validation.validatePlan(state.plan);
    state.canUndo = history.canUndo();
    state.canRedo = history.canRedo();
    var selected = state.selectedItemId ? Model.getItem(state.plan, state.selectedItemId) : null;
    state.selectedGroupId = selected && selected.groupId ? selected.groupId : null;
    if (state.editCell && Model.isCellLocked(state.plan, state.editCell.staffId, state.editCell.date)) {
      state.editCell = null;
    }
    if (state.focusedStaffId && !Model.getStaff(state.plan, state.focusedStaffId)) {
      state.focusedStaffId = null;
    }
    if (state.summaryDate && (state.summaryDate < state.plan.dateStart || state.summaryDate > state.plan.dateEnd)) {
      state.summaryDate = null;
    }
    autosave();
    render();
  }

  function render() {
    state.validation = state.validation || Validation.validatePlan(state.plan);
    Render.render(appRoot, state, actions);
  }

  function togglePalette() {
    state.paletteOpen = !state.paletteOpen;
    if (state.paletteOpen) {
      state.summaryDate = null;
    }
    render();
  }

  function closePalette() {
    if (!state.paletteOpen) {
      return;
    }
    state.paletteOpen = false;
    render();
  }

  function setDateViewMode(mode) {
    var next = mode === "week" ? "week" : "full";
    state.plan.display = state.plan.display || {};
    var changed = state.plan.display.dateViewMode !== next;
    if (next === "week") {
      var focusDate = state.summaryDate ||
        (state.selectedCell && state.selectedCell.date) ||
        state.plan.display.weekStart ||
        state.plan.dateStart;
      var weekStart = Model.weekStartForPlan(state.plan, focusDate);
      changed = changed || state.plan.display.weekStart !== weekStart;
      state.plan.display.weekStart = weekStart;
    }
    if (!changed) {
      return;
    }
    state.plan.display.dateViewMode = next;
    autosave();
    render();
  }

  function navigateWeek(direction) {
    state.plan.display = state.plan.display || {};
    var current = Model.weekStartForPlan(state.plan, state.plan.display.weekStart);
    var next = Model.addDays(current, direction < 0 ? -7 : 7);
    if (next < state.plan.dateStart || next > state.plan.dateEnd) {
      return;
    }
    state.plan.display.weekStart = next;
    state.summaryDate = null;
    autosave();
    render();
  }

  function toggleDaySummary(dateKey) {
    state.summaryDate = state.summaryDate === dateKey ? null : dateKey;
    if (state.summaryDate) {
      state.paletteOpen = false;
    }
    render();
  }

  function closeDaySummary() {
    if (!state.summaryDate) {
      return;
    }
    state.summaryDate = null;
    render();
  }

  function toggleStaffFocus(staffId) {
    state.focusedStaffId = state.focusedStaffId === staffId ? null : staffId;
    render();
  }

  function openHelp() {
    state.modal = { type: "help" };
    state.paletteOpen = false;
    state.summaryDate = null;
    render();
  }

  function openDistribution() {
    state.modal = { type: "distribution" };
    state.paletteOpen = false;
    state.summaryDate = null;
    render();
  }

  function closeModal() {
    if (!state.modal) {
      return;
    }
    var returnToHelp = state.modal.type === "help";
    state.modal = null;
    render();
    if (returnToHelp) {
      var helpButton = appRoot.querySelector("[data-action='open-help']");
      if (helpButton) {
        helpButton.focus();
      }
    }
  }

  function showToast(message) {
    state.toast = message;
    render();
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () {
      state.toast = "";
      render();
    }, 3600);
  }

  function renamePlan(name) {
    history.execute("Rename plan", function (plan) {
      plan.name = String(name || "").trim() || "Scratch roster";
    });
  }

  function applyDates(start, end) {
    if (!start || !end || start > end) {
      showToast("Choose a valid start and end date.");
      return;
    }
    if (Model.hasLockedCellOutsideRange(state.plan, start, end)) {
      showToast("Unlock cells outside the new date range before trimming.");
      return;
    }
    var outside = Model.itemsOutsideRange(state.plan, start, end);
    if (outside.length && !confirm("This trims " + outside.length + " roster items outside the new range. Continue?")) {
      return;
    }
    history.execute("Change date range", function (plan) {
      Model.setDateRange(plan, start, end, true);
    });
  }

  function expandDates(where) {
    history.execute(where === "before" ? "Add week before" : "Add week after", function (plan) {
      if (where === "before") {
        Model.setDateRange(plan, Model.addDays(plan.dateStart, -7), plan.dateEnd, false);
      } else {
        Model.setDateRange(plan, plan.dateStart, Model.addDays(plan.dateEnd, 7), false);
      }
    });
  }

  function trimDates(where) {
    var start = state.plan.dateStart;
    var end = state.plan.dateEnd;
    var nextStart = where === "start" ? Model.addDays(start, 7) : start;
    var nextEnd = where === "end" ? Model.addDays(end, -7) : end;
    if (nextStart > nextEnd) {
      showToast("The date range cannot be trimmed further.");
      return;
    }
    if (Model.hasLockedCellOutsideRange(state.plan, nextStart, nextEnd)) {
      showToast("Unlock cells in that week before trimming it.");
      return;
    }
    var outside = Model.itemsOutsideRange(state.plan, nextStart, nextEnd);
    if (outside.length && !confirm("This removes " + outside.length + " roster items. Undo can restore them. Continue?")) {
      return;
    }
    history.execute(where === "start" ? "Trim start week" : "Trim end week", function (plan) {
      Model.setDateRange(plan, nextStart, nextEnd, true);
    });
  }

  function addStaff() {
    var name = prompt("Staff name", "New staff");
    if (name == null) {
      return;
    }
    history.execute("Add staff", function (plan) {
      Model.addStaff(plan, name);
    });
  }

  function renameStaff(staffId, name) {
    history.execute("Rename staff", function (plan) {
      Model.renameStaff(plan, staffId, name);
    });
  }

  function reorderStaff(staffId, direction) {
    history.execute("Reorder staff", function (plan) {
      Model.reorderStaff(plan, staffId, direction);
    });
  }

  function deleteStaff(staffId) {
    var staff = Model.getStaff(state.plan, staffId);
    var hasItems = state.plan.items.some(function (item) { return item.staffId === staffId; });
    if (!staff) {
      return;
    }
    if (Model.hasLockedCellForStaff(state.plan, staffId)) {
      showToast("Unlock this staff member's cells before deleting them.");
      return;
    }
    if (!confirm("Delete " + staff.name + (hasItems ? " and their roster items" : "") + "?")) {
      return;
    }
    history.execute("Delete staff", function (plan) {
      Model.deleteStaff(plan, staffId);
    });
  }

  function applyStaffImport(text) {
    var names = Storage.parseStaffText(text);
    if (!names.length) {
      showToast("No staff names found.");
      return;
    }
    history.execute("Import staff", function (plan) {
      names.forEach(function (name) {
        Model.addStaff(plan, name);
      });
    });
    state.modal = null;
    showToast("Imported " + names.length + " staff.");
  }

  function applyShiftImport(text) {
    var parsed = Storage.parseShiftText(text);
    if (!parsed.shifts.length) {
      showToast("No shifts found.");
      return;
    }
    history.execute("Import shifts", function (plan) {
      parsed.shifts.forEach(function (shift) {
        var entry = Model.addPaletteShift(plan, shift.text);
        entry.label = shift.label;
      });
    });
    state.modal = null;
    showToast("Imported " + parsed.shifts.length + " shifts" + (parsed.skipped.length ? "; skipped " + parsed.skipped.length + "." : "."));
  }

  function ungroupSelected() {
    if (!state.selectedGroupId) {
      return;
    }
    var groupItems = Model.getGroupItems(state.plan, state.selectedGroupId);
    if (groupItems.some(function (item) {
      return Model.isCellLocked(state.plan, item.staffId, item.date);
    })) {
      showToast("Unlock every cell in this pattern before ungrouping it.");
      return;
    }
    history.execute("Ungroup pattern", function (plan) {
      Model.ungroup(plan, state.selectedGroupId);
    });
    state.selectedGroupId = null;
  }

  function newPlan() {
    if (!confirm("Create a new scratch plan? Undo can bring back the current one.")) {
      return;
    }
    var dateStart = prompt("Start date (YYYY-MM-DD)", state.plan.dateStart);
    if (dateStart == null) {
      return;
    }
    var dateEnd = prompt("End date (YYYY-MM-DD)", state.plan.dateEnd);
    if (dateEnd == null) {
      return;
    }
    dateStart = dateStart.trim() || state.plan.dateStart;
    dateEnd = dateEnd.trim() || state.plan.dateEnd;
    if (!Model.isDateKey(dateStart) || !Model.isDateKey(dateEnd)) {
      showToast("Enter dates as YYYY-MM-DD.");
      return;
    }
    if (dateStart > dateEnd) {
      showToast("Start date must be before end date.");
      return;
    }
    var names = state.plan.staff.map(function (staff) { return staff.name; });
    var next = Model.createPlan({
      name: "Scratch roster",
      dateStart: dateStart,
      dateEnd: dateEnd,
      staffNames: names
    });
    history.replace("New plan", next);
    showToast("New plan created.");
  }

  function savePlan() {
    var filename = fileName(state.plan.name || "roster", ".roster.json");
    Storage.downloadText(filename, Storage.serializePlan(state.plan), "application/json");
    showToast("Plan saved.");
  }

  function exportCsv() {
    var filename = fileName(state.plan.name || "roster", ".csv");
    Storage.downloadText(filename, Exporter.planToCsv(state.plan, state.validation), "text/csv");
    showToast("CSV exported.");
  }

  function openPrintView() {
    if (!Exporter.openPrintView(state.plan, state.validation)) {
      showToast("The print view was blocked by the browser.");
    }
  }

  function exportPalette() {
    Storage.downloadText(fileName(state.plan.name || "palette", ".palette.json"), Storage.serializePalette(state.plan), "application/json");
    showToast("Palette exported.");
  }

  function setPaletteGroupBy(groupBy) {
    var next = groupBy === "start" ? "start" : "modality";
    state.plan.display = state.plan.display || {};
    if (state.plan.display.paletteGroupBy === next) {
      return;
    }
    state.plan.display.paletteGroupBy = next;
    autosave();
    render();
  }

  function selectCell(staffId, dateKey) {
    state.selectedCell = { staffId: staffId, date: dateKey };
    state.selectedItemId = null;
    state.selectedGroupId = null;
    state.editCell = null;
    render();
  }

  function toggleCellLock(staffId, dateKey) {
    var locked = Model.isCellLocked(state.plan, staffId, dateKey);
    if (!locked && state.editCell &&
        state.editCell.staffId === staffId && state.editCell.date === dateKey) {
      state.editCell = null;
    }
    history.execute(locked ? "Unlock cell" : "Lock cell", function (plan) {
      Model.setCellLocked(plan, staffId, dateKey, !locked);
    });
    showToast(locked ? "Cell unlocked." : "Cell locked.");
  }

  function guardLockedCell(staffId, dateKey) {
    if (!Model.isCellLocked(state.plan, staffId, dateKey)) {
      return false;
    }
    showToast("This cell is locked. Unlock it to make changes.");
    return true;
  }

  function startEditCell(staffId, dateKey, initialText) {
    if (guardLockedCell(staffId, dateKey)) {
      return;
    }
    var items = Model.getCellItems(state.plan, staffId, dateKey);
    state.selectedCell = { staffId: staffId, date: dateKey };
    state.selectedItemId = null;
    state.editCell = {
      staffId: staffId,
      date: dateKey,
      text: initialText != null ? initialText : items.map(function (item) { return item.raw || item.label; }).join("; ")
    };
    render();
  }

  function commitCellEditor(text) {
    if (!state.editCell) {
      return;
    }
    var edit = state.editCell;
    state.editCell = null;
    if (guardLockedCell(edit.staffId, edit.date)) {
      return;
    }
    history.execute("Edit cell", function (plan) {
      Model.replaceCellFromText(plan, edit.staffId, edit.date, text);
    });
  }

  function cancelCellEditor() {
    state.editCell = null;
    render();
  }

  function selectItem(itemId) {
    var item = Model.getItem(state.plan, itemId);
    if (!item) {
      return;
    }
    state.selectedItemId = itemId;
    state.selectedGroupId = item.groupId || null;
    state.selectedCell = { staffId: item.staffId, date: item.date };
    state.editCell = null;
    render();
  }

  function beginItemDrag(itemId) {
    var item = Model.getItem(state.plan, itemId);
    if (!item) {
      return;
    }
    state.selectedItemId = itemId;
    state.selectedGroupId = item.groupId || null;
    state.selectedCell = { staffId: item.staffId, date: item.date };
    state.editCell = null;
  }

  function editItem(itemId) {
    var item = Model.getItem(state.plan, itemId);
    if (!item) {
      return;
    }
    if (guardLockedCell(item.staffId, item.date)) {
      return;
    }
    var text = prompt("Edit item", item.raw || item.label);
    if (text == null) {
      return;
    }
    history.execute("Edit item", function (plan) {
      Model.updateItemFromText(plan, itemId, text);
      var updated = Model.getItem(plan, itemId);
      if (updated && updated.kind === "shift") {
        Model.addSessionShift(plan, text);
      }
    });
  }

  function deleteItem(itemId) {
    var item = Model.getItem(state.plan, itemId);
    if (!item) {
      return;
    }
    if (guardLockedCell(item.staffId, item.date)) {
      return;
    }
    history.execute("Delete item", function (plan) {
      Model.removeItem(plan, itemId);
    });
    state.selectedItemId = null;
  }

  function removeCall(itemId) {
    var item = Model.getItem(state.plan, itemId);
    if (!item) {
      return;
    }
    if (guardLockedCell(item.staffId, item.date)) {
      return;
    }
    history.execute("Remove on call", function (plan) {
      Model.removeCallFromItem(plan, itemId);
    });
    state.selectedItemId = null;
  }

  function dropOnCell(payload, staffId, dateKey, options) {
    clearPreview();
    if (!payload) {
      return;
    }
    if (payload.type === "palette-shift" || payload.type === "palette-marker") {
      if (guardLockedCell(staffId, dateKey)) {
        return;
      }
      state.paletteOpen = false;
      history.execute("Place palette item", function (plan) {
        Model.addItemFromText(plan, staffId, dateKey, payload.text, { addSession: false });
      });
      return;
    }
    if (payload.type === "item") {
      var item = Model.getItem(state.plan, payload.itemId);
      if (!item) {
        return;
      }
      if (itemDropTouchesLockedCell(item, staffId, dateKey, options && options.copy)) {
        showToast("That change touches a locked cell. Unlock it first.");
        return;
      }
      if (options && options.copy) {
        history.execute(item.groupId ? "Copy pattern group" : "Copy item", function (plan) {
          var copied = Model.getItem(plan, payload.itemId);
          if (copied && copied.groupId) {
            Model.copyGroup(plan, copied.groupId, staffId, dateKey, payload.itemId);
          } else {
            Model.copyItem(plan, payload.itemId, staffId, dateKey);
          }
        });
      } else {
        history.execute(item.groupId ? "Move pattern group" : "Move item", function (plan) {
          var moved = Model.getItem(plan, payload.itemId);
          if (moved && moved.groupId) {
            Model.moveGroup(plan, moved.groupId, staffId, dateKey, payload.itemId);
          } else {
            Model.moveItem(plan, payload.itemId, staffId, dateKey);
          }
        });
      }
      return;
    }
    if (payload.type === "pattern") {
      var pattern = state.plan.palette.patterns.find(function (entry) { return entry.id === payload.id; });
      if (!pattern) {
        return;
      }
      var touchesLockedCell = pattern.items.some(function (entry) {
        var targetDate = Model.addDays(dateKey, entry.dayOffset || 0);
        return targetDate >= state.plan.dateStart && targetDate <= state.plan.dateEnd &&
          Model.isCellLocked(state.plan, staffId, targetDate);
      });
      if (touchesLockedCell) {
        showToast("That pattern touches a locked cell. Unlock it first.");
        return;
      }
      var occupied = pattern.items.some(function (entry) {
        return Model.getCellItems(state.plan, staffId, Model.addDays(dateKey, entry.dayOffset || 0)).length > 0;
      });
      if (occupied && !confirm("The pattern touches populated cells. Add it anyway?")) {
        return;
      }
      state.paletteOpen = false;
      history.execute("Place pattern", function (plan) {
        Model.placePattern(plan, payload.id, staffId, dateKey);
      });
    }
  }

  function itemDropTouchesLockedCell(item, targetStaffId, targetDate, copy) {
    var items = item.groupId ? Model.getGroupItems(state.plan, item.groupId) : [item];
    var delta = Model.daysBetween(item.date, targetDate);
    return items.some(function (entry) {
      var sourceLocked = !copy && Model.isCellLocked(state.plan, entry.staffId, entry.date);
      var destinationDate = item.groupId ? Model.addDays(entry.date, delta) : targetDate;
      var destinationLocked = Model.isCellLocked(state.plan, targetStaffId, destinationDate);
      return sourceLocked || destinationLocked;
    });
  }

  function previewPattern(staffId, dateKey, patternId) {
    var pattern = state.plan.palette.patterns.find(function (entry) { return entry.id === patternId; });
    if (!pattern) {
      return;
    }
    var dates = pattern.items.map(function (entry) {
      return Model.addDays(dateKey, entry.dayOffset || 0);
    }).filter(function (date) {
      return date >= state.plan.dateStart && date <= state.plan.dateEnd;
    });
    var current = JSON.stringify(state.dragPreview || {});
    var next = JSON.stringify({ staffId: staffId, patternId: patternId, dates: dates });
    if (current !== next) {
      state.dragPreview = { staffId: staffId, patternId: patternId, dates: dates };
      render();
    }
  }

  function clearPreview() {
    if (state.dragPreview) {
      state.dragPreview = null;
      render();
    }
  }

  function promoteSession(shiftId) {
    history.execute("Promote session shift", function (plan) {
      Model.promoteSessionShift(plan, shiftId);
    });
  }

  function editPalette(section, id) {
    var entry = (state.plan.palette[section] || []).find(function (item) { return item.id === id; });
    if (!entry) {
      return;
    }
    if (section === "patterns") {
      editPattern(id);
      return;
    }
    var text = prompt("Palette text", entry.text || entry.label);
    if (text == null) {
      return;
    }
    history.execute("Edit palette item", function (plan) {
      Model.updatePaletteEntry(plan, section, id, {
        text: Parser.normalizeText(text),
        label: Parser.normalizeText(text)
      });
    });
  }

  function deletePalette(section, id) {
    if (!confirm("Delete this palette item?")) {
      return;
    }
    history.execute("Delete palette item", function (plan) {
      Model.removePaletteEntry(plan, section, id);
    });
  }

  function addPalette(section) {
    var text = prompt(section === "markers" ? "Marker text" : "Shift text", section === "markers" ? "Training" : "8 GEN ED");
    if (text == null) {
      return;
    }
    history.execute("Add palette item", function (plan) {
      if (section === "markers") {
        Model.addPaletteMarker(plan, text);
      } else {
        Model.addPaletteShift(plan, text);
      }
    });
  }

  function addPattern() {
    var name = prompt("Pattern name", "New pattern");
    if (name == null) {
      return;
    }
    var text = prompt("Pattern items separated by commas", "8 GEN ED (+call), 4 GEN, 3 GEN, 12 GEN");
    if (text == null) {
      return;
    }
    history.execute("Add pattern", function (plan) {
      Model.addPalettePattern(plan, name, text.split(","));
    });
  }

  function editPattern(id) {
    var pattern = state.plan.palette.patterns.find(function (entry) { return entry.id === id; });
    if (!pattern) {
      return;
    }
    var name = prompt("Pattern name", pattern.name);
    if (name == null) {
      return;
    }
    var text = prompt("Pattern items separated by commas", pattern.items.map(function (entry) { return entry.text; }).join(", "));
    if (text == null) {
      return;
    }
    history.execute("Edit pattern", function (plan) {
      var target = plan.palette.patterns.find(function (entry) { return entry.id === id; });
      if (target) {
        target.name = Parser.normalizeText(name);
        target.items = text.split(",").map(function (entry, index) {
          return { dayOffset: index, text: Parser.normalizeText(entry) };
        }).filter(function (entry) { return entry.text; });
      }
    });
  }

  function handleKeydown(event) {
    var target = event.target;
    var isTextField = target && (["INPUT", "TEXTAREA", "SELECT"].indexOf(target.tagName) !== -1 || target.isContentEditable);
    if (isTextField && (event.metaKey || event.ctrlKey) && ["z", "y"].indexOf(event.key.toLowerCase()) !== -1) {
      // Leave text undo to the browser while typing; plan undo would discard the edit in progress.
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        history.redo();
      } else {
        history.undo();
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      history.redo();
      return;
    }
    if (!isTextField && !state.modal && !event.altKey && !event.metaKey && !event.ctrlKey &&
        (event.code === "Backquote" || event.key === "`")) {
      event.preventDefault();
      togglePalette();
      return;
    }
    if (!isTextField && !state.modal && (state.paletteOpen || state.summaryDate) && event.key === "Escape") {
      event.preventDefault();
      if (state.paletteOpen) {
        closePalette();
      } else {
        closeDaySummary();
      }
      return;
    }
    if (!isTextField && state.modal && event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }
    if (isTextField) {
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (state.selectedItemId) {
        var itemId = state.selectedItemId;
        deleteItem(itemId);
      } else if (state.selectedCell) {
        var cell = state.selectedCell;
        if (guardLockedCell(cell.staffId, cell.date)) {
          event.preventDefault();
          return;
        }
        history.execute("Clear cell", function (plan) {
          Model.removeCellItems(plan, cell.staffId, cell.date);
        });
      }
      event.preventDefault();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && state.selectedCell) {
      var text = Model.getCellItems(state.plan, state.selectedCell.staffId, state.selectedCell.date)
        .map(function (item) { return item.raw || item.label; })
        .join("; ");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () {});
      } else {
        showToast("Clipboard copy is unavailable in this browser context.");
      }
      event.preventDefault();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v" && state.selectedCell) {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (text) {
          startEditCell(state.selectedCell.staffId, state.selectedCell.date, text);
        }).catch(function () {});
      } else {
        showToast("Clipboard paste is unavailable in this browser context.");
      }
      event.preventDefault();
      return;
    }
    if (state.selectedCell && event.key.length === 1 && !event.altKey && !event.metaKey && !event.ctrlKey) {
      startEditCell(state.selectedCell.staffId, state.selectedCell.date, event.key);
      event.preventDefault();
    }
  }

  function fileName(name, extension) {
    var slug = String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return (slug || "roster") + extension;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
