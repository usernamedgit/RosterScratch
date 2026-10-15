(function (root, factory) {
  var api = factory(root.RosterParser);
  root.RosterModel = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Parser) {
  "use strict";

  var SCHEMA_VERSION = 2;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function todayKey() {
    var now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  }

  function compareIds(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }

  function isDateKey(value) {
    var text = String(value || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(text) && keyFromDate(dateFromKey(text)) === text;
  }

  function dateFromKey(dateKey) {
    var parts = String(dateKey).split("-").map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  }

  function keyFromDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function addDays(dateKey, days) {
    var date = dateFromKey(dateKey);
    date.setUTCDate(date.getUTCDate() + days);
    return keyFromDate(date);
  }

  function daysBetween(startKey, endKey) {
    return Math.round((dateFromKey(endKey) - dateFromKey(startKey)) / 86400000);
  }

  function enumerateDates(startKey, endKey) {
    var dates = [];
    if (!startKey || !endKey) {
      return dates;
    }
    var cursor = startKey;
    while (cursor <= endKey) {
      dates.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return dates;
  }

  function weekStartForPlan(plan, dateKey) {
    if (!plan || !plan.dateStart || !plan.dateEnd) {
      return "";
    }
    var target = dateKey || plan.dateStart;
    if (target < plan.dateStart) {
      target = plan.dateStart;
    }
    if (target > plan.dateEnd) {
      target = plan.dateEnd;
    }
    return addDays(plan.dateStart, Math.floor(daysBetween(plan.dateStart, target) / 7) * 7);
  }

  function ensureMeta(plan) {
    if (!plan.meta) {
      plan.meta = {};
    }
    if (!plan.meta.nextIds) {
      plan.meta.nextIds = {};
    }
  }

  function createId(plan, prefix) {
    ensureMeta(plan);
    var next = plan.meta.nextIds[prefix] || 1;
    plan.meta.nextIds[prefix] = next + 1;
    return prefix + "_" + next;
  }

  function defaultPalette(plan) {
    var shifts = ["630 CT ED", "630 MRI", "8 GEN ED", "4 GEN", "12 GEN", "8 MAM"].map(function (text) {
      return { id: createId(plan, "shift"), type: "shift", text: text, label: text };
    });
    var markers = ["RDO", "ADO", "AL", "Training", "On Call"].map(function (text) {
      return { id: createId(plan, "marker"), type: "marker", text: text, label: text };
    });
    var patterns = [
      {
        id: createId(plan, "pattern"),
        type: "pattern",
        name: "GEN call run",
        items: [
          { dayOffset: 0, text: "8 GEN ED (+call)" },
          { dayOffset: 1, text: "4 GEN" },
          { dayOffset: 2, text: "3 GEN" },
          { dayOffset: 3, text: "12 GEN" }
        ]
      }
    ];
    return {
      savedShifts: shifts,
      sessionShifts: [],
      patterns: patterns,
      markers: markers
    };
  }

  function createPlan(options) {
    var config = options || {};
    var plan = {
      schemaVersion: SCHEMA_VERSION,
      name: config.name || "Scratch roster",
      dateStart: config.dateStart || todayKey(),
      dateEnd: config.dateEnd || addDays(config.dateStart || todayKey(), 13),
      staff: [],
      items: [],
      lockedCells: [],
      palette: null,
      display: {
        selectedTheme: "outrun",
        paletteGroupBy: "modality",
        dateViewMode: "full",
        weekStart: config.dateStart || todayKey()
      },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nextIds: {}
      }
    };
    plan.palette = defaultPalette(plan);
    (config.staffNames || []).forEach(function (name) {
      addStaff(plan, name);
    });
    return plan;
  }

  function normalizePlan(plan) {
    var normalized = clone(plan || {});
    normalized.schemaVersion = normalized.schemaVersion || SCHEMA_VERSION;
    normalized.name = normalized.name || "Scratch roster";
    normalized.dateStart = normalized.dateStart || todayKey();
    normalized.dateEnd = normalized.dateEnd || addDays(normalized.dateStart, 13);
    normalized.staff = Array.isArray(normalized.staff) ? normalized.staff : [];
    normalized.items = Array.isArray(normalized.items) ? normalized.items : [];
    normalized.lockedCells = Array.isArray(normalized.lockedCells) ?
      normalized.lockedCells.filter(function (key, index, keys) {
        return typeof key === "string" && key && keys.indexOf(key) === index;
      }) : [];
    normalized.display = normalized.display || {};
    normalized.display.selectedTheme = normalized.display.selectedTheme || "outrun";
    normalized.display.paletteGroupBy = normalized.display.paletteGroupBy === "start" ? "start" : "modality";
    normalized.display.dateViewMode = normalized.display.dateViewMode === "week" ? "week" : "full";
    normalized.display.weekStart = weekStartForPlan(normalized, normalized.display.weekStart);
    normalized.meta = normalized.meta || {};
    normalized.meta.nextIds = normalized.meta.nextIds || {};
    normalized.palette = normalized.palette || {};
    normalized.palette.savedShifts = normalized.palette.savedShifts || [];
    normalized.palette.sessionShifts = normalized.palette.sessionShifts || [];
    normalized.palette.patterns = normalized.palette.patterns || [];
    normalized.palette.markers = normalized.palette.markers || [];
    reseedIds(normalized);
    return normalized;
  }

  function reseedIds(plan) {
    ensureMeta(plan);
    ["staff", "item", "shift", "marker", "pattern", "group"].forEach(function (prefix) {
      plan.meta.nextIds[prefix] = plan.meta.nextIds[prefix] || 1;
    });
    function visit(id) {
      var match = String(id || "").match(/^([a-z]+)_(\d+)$/);
      if (match) {
        var prefix = match[1];
        var next = Number(match[2]) + 1;
        plan.meta.nextIds[prefix] = Math.max(plan.meta.nextIds[prefix] || 1, next);
      }
    }
    plan.staff.forEach(function (staff) { visit(staff.id); });
    plan.items.forEach(function (item) {
      visit(item.id);
      visit(item.groupId);
    });
    ["savedShifts", "sessionShifts", "patterns", "markers"].forEach(function (key) {
      (plan.palette[key] || []).forEach(function (entry) { visit(entry.id); });
    });
  }

  function touch(plan) {
    if (!plan.meta) {
      plan.meta = {};
    }
    plan.meta.updatedAt = new Date().toISOString();
  }

  function addStaff(plan, name, index) {
    var staff = {
      id: createId(plan, "staff"),
      name: String(name || "New staff").trim() || "New staff"
    };
    if (typeof index === "number") {
      plan.staff.splice(index, 0, staff);
    } else {
      plan.staff.push(staff);
    }
    touch(plan);
    return staff;
  }

  function renameStaff(plan, staffId, name) {
    var staff = getStaff(plan, staffId);
    if (staff) {
      staff.name = String(name || "").trim() || "Unnamed staff";
      touch(plan);
    }
    return staff;
  }

  function deleteStaff(plan, staffId) {
    var index = plan.staff.findIndex(function (staff) { return staff.id === staffId; });
    if (index === -1 || hasLockedCellForStaff(plan, staffId)) {
      return null;
    }
    var removed = plan.staff.splice(index, 1)[0];
    plan.items = plan.items.filter(function (item) { return item.staffId !== staffId; });
    touch(plan);
    return removed;
  }

  function reorderStaff(plan, staffId, direction) {
    var index = plan.staff.findIndex(function (staff) { return staff.id === staffId; });
    if (index === -1) {
      return;
    }
    var nextIndex = Math.max(0, Math.min(plan.staff.length - 1, index + direction));
    if (nextIndex === index) {
      return;
    }
    var staff = plan.staff.splice(index, 1)[0];
    plan.staff.splice(nextIndex, 0, staff);
    touch(plan);
  }

  function getStaff(plan, staffId) {
    return plan.staff.find(function (staff) { return staff.id === staffId; }) || null;
  }

  function getItem(plan, itemId) {
    return plan.items.find(function (item) { return item.id === itemId; }) || null;
  }

  function getCellItems(plan, staffId, dateKey) {
    return plan.items
      .filter(function (item) { return item.staffId === staffId && item.date === dateKey; })
      .sort(function (a, b) { return compareIds(a.id, b.id); });
  }

  function cellLockKey(staffId, dateKey) {
    return String(staffId) + "|" + String(dateKey);
  }

  function isCellLocked(plan, staffId, dateKey) {
    return (plan.lockedCells || []).indexOf(cellLockKey(staffId, dateKey)) !== -1;
  }

  function setCellLocked(plan, staffId, dateKey, locked) {
    plan.lockedCells = plan.lockedCells || [];
    var key = cellLockKey(staffId, dateKey);
    var index = plan.lockedCells.indexOf(key);
    if (locked && index === -1) {
      plan.lockedCells.push(key);
      touch(plan);
      return true;
    }
    if (!locked && index !== -1) {
      plan.lockedCells.splice(index, 1);
      touch(plan);
      return true;
    }
    return false;
  }

  function hasLockedCellForStaff(plan, staffId) {
    return (plan.lockedCells || []).some(function (key) {
      return key.indexOf(String(staffId) + "|") === 0;
    });
  }

  function hasLockedCellOutsideRange(plan, startKey, endKey) {
    return (plan.lockedCells || []).some(function (key) {
      var dateKey = key.slice(key.lastIndexOf("|") + 1);
      return dateKey < startKey || dateKey > endKey;
    });
  }

  function getGroupItems(plan, groupId) {
    if (!groupId) {
      return [];
    }
    return plan.items
      .filter(function (item) { return item.groupId === groupId; })
      .sort(function (a, b) {
        if (a.date === b.date) {
          return compareIds(a.id, b.id);
        }
        return a.date.localeCompare(b.date);
      });
  }

  function createItemFromText(plan, staffId, dateKey, text, options) {
    var parsed = Parser.parseRosterText(text, dateKey);
    if (!parsed.valid && parsed.kind !== "invalid") {
      return null;
    }
    if (parsed.kind === "invalid") {
      parsed = {
        valid: true,
        kind: "note",
        raw: text,
        label: text,
        notes: text,
        parseError: parsed.error
      };
    }
    var item = {
      id: createId(plan, "item"),
      staffId: staffId,
      date: dateKey,
      kind: parsed.kind,
      label: parsed.label || String(text || ""),
      raw: parsed.raw || String(text || ""),
      start: parsed.start || null,
      end: parsed.end || null,
      durationHours: parsed.durationHours || null,
      modality: parsed.modality || "",
      location: parsed.location || "",
      marker: parsed.marker || "",
      call: parsed.call || { enabled: false },
      onCallOnly: !!parsed.onCallOnly,
      groupId: options && options.groupId ? options.groupId : null,
      sourcePatternId: options && options.sourcePatternId ? options.sourcePatternId : null,
      notes: parsed.notes || "",
      parseError: parsed.parseError || "",
      createdAt: new Date().toISOString()
    };
    return item;
  }

  function addItem(plan, item) {
    if (!item) {
      return null;
    }
    plan.items.push(item);
    touch(plan);
    return item;
  }

  function replaceCellFromText(plan, staffId, dateKey, text) {
    if (isCellLocked(plan, staffId, dateKey)) {
      return false;
    }
    var entries = splitEntries(text);
    plan.items = plan.items.filter(function (item) {
      return !(item.staffId === staffId && item.date === dateKey);
    });
    entries.forEach(function (entry) {
      addItemFromText(plan, staffId, dateKey, entry, { addSession: true });
    });
    touch(plan);
    return true;
  }

  function splitEntries(text) {
    return String(text || "")
      .split(/\s*(?:;|\n)\s*/)
      .map(function (entry) { return entry.trim(); })
      .filter(Boolean);
  }

  function addItemFromText(plan, staffId, dateKey, text, options) {
    if (isCellLocked(plan, staffId, dateKey)) {
      return null;
    }
    var item = createItemFromText(plan, staffId, dateKey, text, options || {});
    if (!item) {
      return null;
    }
    addItem(plan, item);
    if (options && options.addSession && item.kind === "shift") {
      addSessionShift(plan, item.raw || item.label);
    }
    return item;
  }

  function updateItemFromText(plan, itemId, text) {
    var existing = getItem(plan, itemId);
    if (!existing || isCellLocked(plan, existing.staffId, existing.date)) {
      return null;
    }
    var replacement = createItemFromText(plan, existing.staffId, existing.date, text, {
      groupId: existing.groupId,
      sourcePatternId: existing.sourcePatternId
    });
    if (!replacement) {
      return null;
    }
    Object.keys(existing).forEach(function (key) {
      delete existing[key];
    });
    Object.assign(existing, replacement, { id: itemId });
    touch(plan);
    return existing;
  }

  function removeItem(plan, itemId) {
    var index = plan.items.findIndex(function (item) { return item.id === itemId; });
    if (index !== -1 && !isCellLocked(plan, plan.items[index].staffId, plan.items[index].date)) {
      var removed = plan.items.splice(index, 1)[0];
      touch(plan);
      return removed;
    }
    return null;
  }

  function removeCallFromItem(plan, itemId) {
    var item = getItem(plan, itemId);
    if (!item || isCellLocked(plan, item.staffId, item.date) || !item.call || !item.call.enabled) {
      return null;
    }
    if (item.onCallOnly || item.kind === "call") {
      return removeItem(plan, itemId);
    }
    item.call = { enabled: false };
    item.raw = stripTrailingCall(item.raw || item.label);
    item.label = stripTrailingCall(item.label || item.raw);
    touch(plan);
    return item;
  }

  function stripTrailingCall(text) {
    return Parser.normalizeText(String(text || "").replace(/\s*\(?\+?call\)?\s*$/i, ""));
  }

  function removeCellItems(plan, staffId, dateKey) {
    if (isCellLocked(plan, staffId, dateKey)) {
      return [];
    }
    var removed = getCellItems(plan, staffId, dateKey);
    plan.items = plan.items.filter(function (item) {
      return !(item.staffId === staffId && item.date === dateKey);
    });
    if (removed.length) {
      touch(plan);
    }
    return removed;
  }

  function moveItem(plan, itemId, staffId, dateKey) {
    var item = getItem(plan, itemId);
    if (!item ||
        isCellLocked(plan, item.staffId, item.date) ||
        isCellLocked(plan, staffId, dateKey)) {
      return null;
    }
    item.staffId = staffId;
    item.date = dateKey;
    refreshItemTimingForDate(item, dateKey);
    touch(plan);
    return item;
  }

  function refreshItemTimingForDate(item, dateKey) {
    if (!item.start || !item.end) {
      return;
    }
    var parsed = Parser.parseRosterText(item.raw || item.label, dateKey);
    if (parsed.valid) {
      item.start = parsed.start || item.start;
      item.end = parsed.end || item.end;
      if (parsed.durationHours != null) {
        item.durationHours = parsed.durationHours;
      }
    }
  }

  function copyItemToCell(plan, source, staffId, dateKey, options) {
    var config = options || {};
    var item = clone(source);
    item.id = createId(plan, "item");
    item.staffId = staffId;
    item.date = dateKey;
    item.groupId = Object.prototype.hasOwnProperty.call(config, "groupId") ? config.groupId : null;
    item.sourcePatternId = Object.prototype.hasOwnProperty.call(config, "sourcePatternId") ? config.sourcePatternId : null;
    item.createdAt = new Date().toISOString();
    refreshItemTimingForDate(item, dateKey);
    plan.items.push(item);
    return item;
  }

  function copyItem(plan, itemId, staffId, dateKey) {
    var source = getItem(plan, itemId);
    if (!source || isCellLocked(plan, staffId, dateKey)) {
      return null;
    }
    var copied = copyItemToCell(plan, source, staffId, dateKey);
    touch(plan);
    return copied;
  }

  function moveGroup(plan, groupId, targetStaffId, targetDate, anchorItemId) {
    var groupItems = getGroupItems(plan, groupId);
    if (!groupItems.length) {
      return [];
    }
    var anchor = anchorItemId ? getItem(plan, anchorItemId) : groupItems[0];
    if (!anchor || anchor.groupId !== groupId) {
      anchor = groupItems[0];
    }
    var anchorDate = anchor.date;
    var delta = daysBetween(anchorDate, targetDate);
    var blocked = groupItems.some(function (item) {
      return isCellLocked(plan, item.staffId, item.date) ||
        isCellLocked(plan, targetStaffId, addDays(item.date, delta));
    });
    if (blocked) {
      return [];
    }
    groupItems.forEach(function (item) {
      moveItem(plan, item.id, targetStaffId, addDays(item.date, delta));
    });
    touch(plan);
    return groupItems;
  }

  function copyGroup(plan, groupId, targetStaffId, targetDate, anchorItemId) {
    var groupItems = getGroupItems(plan, groupId);
    if (!groupItems.length) {
      return [];
    }
    var anchor = anchorItemId ? getItem(plan, anchorItemId) : groupItems[0];
    if (!anchor || anchor.groupId !== groupId) {
      anchor = groupItems[0];
    }
    var delta = daysBetween(anchor.date, targetDate);
    var blocked = groupItems.some(function (item) {
      return isCellLocked(plan, targetStaffId, addDays(item.date, delta));
    });
    if (blocked) {
      return [];
    }
    var newGroupId = createId(plan, "group");
    var copied = groupItems.map(function (item) {
      return copyItemToCell(plan, item, targetStaffId, addDays(item.date, delta), {
        groupId: newGroupId,
        sourcePatternId: item.sourcePatternId
      });
    });
    touch(plan);
    return copied;
  }

  function placePattern(plan, patternId, staffId, dateKey) {
    var pattern = plan.palette.patterns.find(function (entry) { return entry.id === patternId; });
    if (!pattern) {
      return [];
    }
    var blocked = pattern.items.some(function (entry) {
      var targetDate = addDays(dateKey, entry.dayOffset || 0);
      return targetDate >= plan.dateStart && targetDate <= plan.dateEnd &&
        isCellLocked(plan, staffId, targetDate);
    });
    if (blocked) {
      return [];
    }
    var groupId = createId(plan, "group");
    var created = [];
    pattern.items.forEach(function (entry) {
      var targetDate = addDays(dateKey, entry.dayOffset || 0);
      if (targetDate < plan.dateStart || targetDate > plan.dateEnd) {
        return;
      }
      var item = addItemFromText(plan, staffId, targetDate, entry.text, {
        groupId: groupId,
        sourcePatternId: pattern.id,
        addSession: false
      });
      if (item) {
        created.push(item);
      }
    });
    touch(plan);
    return created;
  }

  function ungroup(plan, groupId) {
    var groupItems = getGroupItems(plan, groupId);
    if (groupItems.some(function (item) {
      return isCellLocked(plan, item.staffId, item.date);
    })) {
      return false;
    }
    groupItems.forEach(function (item) {
      item.groupId = null;
      item.sourcePatternId = null;
    });
    touch(plan);
    return true;
  }

  function addSessionShift(plan, text) {
    var normalized = Parser.normalizeText(text).toLowerCase();
    var saved = plan.palette.savedShifts.some(function (entry) {
      return Parser.normalizeText(entry.text).toLowerCase() === normalized;
    });
    var existing = plan.palette.sessionShifts.some(function (entry) {
      return Parser.normalizeText(entry.text).toLowerCase() === normalized;
    });
    if (!saved && !existing) {
      plan.palette.sessionShifts.push({
        id: createId(plan, "shift"),
        type: "shift",
        text: Parser.normalizeText(text),
        label: Parser.normalizeText(text)
      });
      touch(plan);
    }
  }

  function promoteSessionShift(plan, shiftId) {
    var index = plan.palette.sessionShifts.findIndex(function (entry) { return entry.id === shiftId; });
    if (index === -1) {
      return null;
    }
    var shift = plan.palette.sessionShifts.splice(index, 1)[0];
    shift.id = createId(plan, "shift");
    plan.palette.savedShifts.push(shift);
    touch(plan);
    return shift;
  }

  function addPaletteShift(plan, text) {
    var parsed = Parser.parseRosterText(text, "2000-01-01");
    var shift = {
      id: createId(plan, "shift"),
      type: "shift",
      text: parsed.kind === "shift" ? parsed.raw : Parser.normalizeText(text),
      label: parsed.kind === "shift" ? parsed.label : Parser.normalizeText(text)
    };
    plan.palette.savedShifts.push(shift);
    touch(plan);
    return shift;
  }

  function addPaletteMarker(plan, text) {
    var marker = { id: createId(plan, "marker"), type: "marker", text: Parser.normalizeText(text), label: Parser.normalizeText(text) };
    plan.palette.markers.push(marker);
    touch(plan);
    return marker;
  }

  function addPalettePattern(plan, name, itemTexts) {
    var pattern = {
      id: createId(plan, "pattern"),
      type: "pattern",
      name: Parser.normalizeText(name),
      items: patternItemsFromDays(itemTexts)
    };
    plan.palette.patterns.push(pattern);
    touch(plan);
    return pattern;
  }

  function patternItemsFromDays(dayTexts) {
    var items = [];
    (dayTexts || []).forEach(function (dayText, index) {
      splitEntries(dayText).forEach(function (entry) {
        items.push({ dayOffset: index, text: Parser.normalizeText(entry) });
      });
    });
    return items;
  }

  function updatePalettePattern(plan, id, name, itemTexts) {
    var pattern = plan.palette.patterns.find(function (entry) { return entry.id === id; });
    if (!pattern) {
      return null;
    }
    pattern.name = Parser.normalizeText(name) || pattern.name;
    pattern.items = patternItemsFromDays(itemTexts);
    touch(plan);
    return pattern;
  }

  function updatePaletteEntry(plan, section, id, patch) {
    var list = plan.palette[section] || [];
    var entry = list.find(function (item) { return item.id === id; });
    if (entry) {
      Object.assign(entry, patch);
      touch(plan);
    }
    return entry;
  }

  function removePaletteEntry(plan, section, id) {
    var list = plan.palette[section] || [];
    var index = list.findIndex(function (item) { return item.id === id; });
    if (index !== -1) {
      var removed = list.splice(index, 1)[0];
      touch(plan);
      return removed;
    }
    return null;
  }

  function setDateRange(plan, startKey, endKey, trim) {
    if (trim && hasLockedCellOutsideRange(plan, startKey, endKey)) {
      return false;
    }
    plan.dateStart = startKey;
    plan.dateEnd = endKey;
    if (trim) {
      plan.items = plan.items.filter(function (item) {
        return item.date >= startKey && item.date <= endKey;
      });
    }
    touch(plan);
    return true;
  }

  function itemsOutsideRange(plan, startKey, endKey) {
    return plan.items.filter(function (item) {
      return item.date < startKey || item.date > endKey;
    });
  }

  function calculateModalityDistribution(plan, dateKeys) {
    var includedWeekdays = {};
    (dateKeys || []).forEach(function (dateKey) {
      var day = dateFromKey(dateKey).getUTCDay();
      if (day !== 0 && day !== 6) {
        includedWeekdays[dateKey] = true;
      }
    });

    var rowsByStaff = {};
    var modalitiesByKey = {};
    var rows = (plan.staff || []).map(function (staff) {
      var row = {
        staffId: staff.id,
        name: staff.name,
        workedShifts: 0,
        counts: {}
      };
      rowsByStaff[staff.id] = row;
      return row;
    });

    (plan.items || []).forEach(function (item) {
      var row = rowsByStaff[item.staffId];
      if (!row || item.kind !== "shift" || !includedWeekdays[item.date]) {
        return;
      }
      var modality = Parser.normalizeText(item.modality).toUpperCase() || "OTHER";
      row.workedShifts += 1;
      row.counts[modality] = (row.counts[modality] || 0) + 1;
      modalitiesByKey[modality] = true;
    });

    var modalities = Object.keys(modalitiesByKey).sort(function (a, b) {
      return a.localeCompare(b, undefined, { numeric: true });
    });
    rows.forEach(function (row) {
      row.cells = modalities.map(function (modality) {
        var count = row.counts[modality] || 0;
        return {
          modality: modality,
          count: count,
          percentage: row.workedShifts ?
            Math.round((count / row.workedShifts) * 1000) / 10 :
            0
        };
      });
    });

    return {
      modalities: modalities,
      rows: rows
    };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    clone: clone,
    compareIds: compareIds,
    isDateKey: isDateKey,
    createPlan: createPlan,
    normalizePlan: normalizePlan,
    createId: createId,
    addDays: addDays,
    daysBetween: daysBetween,
    enumerateDates: enumerateDates,
    weekStartForPlan: weekStartForPlan,
    addStaff: addStaff,
    renameStaff: renameStaff,
    deleteStaff: deleteStaff,
    reorderStaff: reorderStaff,
    getStaff: getStaff,
    getItem: getItem,
    getCellItems: getCellItems,
    cellLockKey: cellLockKey,
    isCellLocked: isCellLocked,
    setCellLocked: setCellLocked,
    hasLockedCellForStaff: hasLockedCellForStaff,
    hasLockedCellOutsideRange: hasLockedCellOutsideRange,
    getGroupItems: getGroupItems,
    createItemFromText: createItemFromText,
    addItemFromText: addItemFromText,
    updateItemFromText: updateItemFromText,
    replaceCellFromText: replaceCellFromText,
    removeItem: removeItem,
    removeCallFromItem: removeCallFromItem,
    removeCellItems: removeCellItems,
    moveItem: moveItem,
    copyItem: copyItem,
    moveGroup: moveGroup,
    copyGroup: copyGroup,
    placePattern: placePattern,
    ungroup: ungroup,
    addSessionShift: addSessionShift,
    promoteSessionShift: promoteSessionShift,
    addPaletteShift: addPaletteShift,
    addPaletteMarker: addPaletteMarker,
    addPalettePattern: addPalettePattern,
    updatePalettePattern: updatePalettePattern,
    updatePaletteEntry: updatePaletteEntry,
    removePaletteEntry: removePaletteEntry,
    setDateRange: setDateRange,
    itemsOutsideRange: itemsOutsideRange,
    calculateModalityDistribution: calculateModalityDistribution,
    splitEntries: splitEntries
  };
});
