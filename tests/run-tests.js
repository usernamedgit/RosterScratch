#!/usr/bin/env node
"use strict";

const assert = require("assert");

globalThis.RosterParser = require("../src/parser.js");
globalThis.RosterModel = require("../src/model.js");
globalThis.RosterHistory = require("../src/history.js");
globalThis.RosterValidation = require("../src/validation.js");
globalThis.RosterStorage = require("../src/storage.js");
globalThis.RosterExport = require("../src/export.js");
globalThis.RosterFixtures = require("../src/fixtures.js");
globalThis.RosterDragDrop = require("../src/dragdrop.js");
globalThis.RosterRender = require("../src/render.js");

const Parser = globalThis.RosterParser;
const Model = globalThis.RosterModel;
const History = globalThis.RosterHistory;
const Validation = globalThis.RosterValidation;
const Storage = globalThis.RosterStorage;
const Exporter = globalThis.RosterExport;
const Render = globalThis.RosterRender;
const DragDrop = globalThis.RosterDragDrop;

function testParserExamples() {
  const cases = [
    ["630 CT ED", "0630", "1430", "CT", "ED"],
    ["630 MRI", "0630", "1430", "MRI", ""],
    ["8 GEN ED", "0800", "1600", "GEN", "ED"],
    ["4 GEN", "1600", "0000", "GEN", ""],
    ["12 GEN", "1200", "2000", "GEN", ""],
    ["8 MAM", "0800", "1600", "MAM", ""],
    ["8-1230 EDCT", "0800", "1230", "EDCT", ""]
  ];
  cases.forEach(([input, start, end, modality, location]) => {
    const parsed = Parser.parseRosterText(input, "2026-07-06");
    assert.equal(parsed.valid, true, input);
    assert.equal(parsed.kind, "shift", input);
    assert.equal(parsed.startTime.text, start, input);
    assert.equal(parsed.endTime.text, end, input);
    assert.equal(Parser.formatTimeForDisplay(parsed.start), start, input);
    assert.equal(Parser.formatTimeForDisplay(parsed.end), end, input);
    assert.equal(parsed.modality, modality, input);
    assert.equal(parsed.location, location, input);
  });
  const marker = Parser.parseRosterText("Training", "2026-07-06");
  assert.equal(marker.kind, "marker");
  const ado = Parser.parseRosterText("ADO", "2026-07-06");
  assert.equal(ado.kind, "marker");
  assert.equal(ado.marker, "ADO");
  const call = Parser.parseRosterText("8 GEN ED (+call)", "2026-07-06");
  assert.equal(call.call.enabled, true);
}

function testPolishFixes() {
  const early = Parser.parseRosterText("0300 CT", "2026-07-06");
  assert.equal(early.label, "0300 CT");
  assert.equal(Parser.parseRosterText(early.label, "2026-07-06").startTime.text, "0300");
  assert.equal(Parser.parseRosterText("3 CT", "2026-07-06").label, "3 CT");
  assert.equal(Parser.parseRosterText("8 GEN ED", "2026-07-06").label, "8 GEN ED");
  assert.deepEqual(Parser.parseRosterText("RDO", "2026-07-06").call, { enabled: false });
  assert.equal(Parser.formatDuration(7.999), "8h");

  const plan = Model.createPlan({ dateStart: "2026-07-06", dateEnd: "2026-07-12", staffNames: ["A"] });
  const staffId = plan.staff[0].id;
  for (let index = 0; index < 8; index += 1) {
    Model.addItemFromText(plan, staffId, "2026-07-07", "note " + index);
  }
  Model.replaceCellFromText(plan, staffId, "2026-07-06", "first; second");
  assert.deepEqual(Model.getCellItems(plan, staffId, "2026-07-06").map((item) => item.label), ["first", "second"]);

  assert.equal(Model.isDateKey("2026-07-06"), true);
  assert.equal(Model.isDateKey("2026-02-30"), false);
  assert.equal(Model.isDateKey("06/07/2026"), false);

}

function testModalityDistributionUsesWorkedWeekdayShifts() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-12",
    staffNames: ["Alex", "Blake"]
  });
  const alex = plan.staff[0].id;
  const blake = plan.staff[1].id;

  Model.addItemFromText(plan, alex, "2026-07-06", "8 CT ED", {});
  Model.addItemFromText(plan, alex, "2026-07-07", "8 ct", {});
  Model.addItemFromText(plan, alex, "2026-07-08", "630 MRI (+call)", {});
  Model.addItemFromText(plan, alex, "2026-07-09", "AL", {});
  Model.addItemFromText(plan, alex, "2026-07-10", "ADO", {});
  Model.addItemFromText(plan, alex, "2026-07-11", "8 GEN", {});

  Model.addItemFromText(plan, blake, "2026-07-06", "8 GEN", {});
  Model.addItemFromText(plan, blake, "2026-07-07", "Training", {});
  Model.addItemFromText(plan, blake, "2026-07-08", "On Call", {});
  Model.addItemFromText(plan, blake, "2026-07-09", "Conference", {});

  const distribution = Model.calculateModalityDistribution(
    plan,
    Model.enumerateDates(plan.dateStart, plan.dateEnd)
  );
  assert.deepEqual(distribution.modalities, ["CT", "GEN", "MRI"]);
  assert.equal(distribution.rows[0].workedShifts, 3);
  assert.deepEqual(distribution.rows[0].cells, [
    { modality: "CT", count: 2, percentage: 66.7 },
    { modality: "GEN", count: 0, percentage: 0 },
    { modality: "MRI", count: 1, percentage: 33.3 }
  ]);
  assert.equal(distribution.rows[1].workedShifts, 1);
  assert.deepEqual(distribution.rows[1].cells, [
    { modality: "CT", count: 0, percentage: 0 },
    { modality: "GEN", count: 1, percentage: 100 },
    { modality: "MRI", count: 0, percentage: 0 }
  ]);

  const mondayOnly = Model.calculateModalityDistribution(plan, ["2026-07-06"]);
  assert.deepEqual(mondayOnly.modalities, ["CT", "GEN"]);
  assert.equal(mondayOnly.rows[0].workedShifts, 1);
  assert.equal(mondayOnly.rows[1].workedShifts, 1);
}

function testModelHistory() {
  let plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-12",
    staffNames: ["Alex"]
  });
  const history = new History.PlanHistory(
    () => plan,
    (next) => { plan = Model.normalizePlan(next); },
    () => {}
  );
  history.execute("Add item", (draft) => {
    Model.addItemFromText(draft, draft.staff[0].id, "2026-07-06", "8 GEN ED", { addSession: true });
  });
  assert.equal(plan.items.length, 1);
  assert.equal(plan.palette.sessionShifts.length, 0, "saved shift should not duplicate in session");
  history.execute("Edit item", (draft) => {
    Model.updateItemFromText(draft, draft.items[0].id, "630 CT ED");
  });
  assert.equal(plan.items[0].modality, "CT");
  history.undo();
  assert.equal(plan.items[0].modality, "GEN");
  history.undo();
  assert.equal(plan.items.length, 0);
  history.redo();
  assert.equal(plan.items.length, 1);
}

function testRemoveOnCall() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-12",
    staffNames: ["Alex"]
  });
  const staffId = plan.staff[0].id;
  const shift = Model.addItemFromText(plan, staffId, "2026-07-06", "8 GEN ED (+call)", {});
  const call = Model.addItemFromText(plan, staffId, "2026-07-07", "On Call", {});

  Model.removeCallFromItem(plan, shift.id);
  assert.equal(plan.items.length, 2);
  assert.equal(Model.getItem(plan, shift.id).call.enabled, false);
  assert.equal(Model.getItem(plan, shift.id).label, "8 GEN ED");
  assert.equal(Model.getItem(plan, shift.id).raw, "8 GEN ED");

  Model.removeCallFromItem(plan, call.id);
  assert.equal(plan.items.length, 1);
  assert.equal(Model.getItem(plan, call.id), null);
}

function testPatternsAndValidation() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-12",
    staffNames: ["Alex"]
  });
  const patternId = plan.palette.patterns[0].id;
  const items = Model.placePattern(plan, patternId, plan.staff[0].id, "2026-07-06");
  assert.equal(items.length, 4);
  assert.ok(items.every((item) => item.groupId === items[0].groupId));
  Model.moveGroup(plan, items[0].groupId, plan.staff[0].id, "2026-07-07");
  assert.equal(Model.getGroupItems(plan, items[0].groupId)[0].date, "2026-07-07");
  Model.moveGroup(plan, items[0].groupId, plan.staff[0].id, "2026-07-10", items[1].id);
  assert.equal(Model.getItem(plan, items[1].id).date, "2026-07-10");
  Model.ungroup(plan, items[0].groupId);
  assert.equal(Model.getGroupItems(plan, items[0].groupId).length, 0);

  const warnPlan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-07",
    staffNames: ["Alex"]
  });
  Model.addItemFromText(warnPlan, warnPlan.staff[0].id, "2026-07-06", "4 GEN", {});
  Model.addItemFromText(warnPlan, warnPlan.staff[0].id, "2026-07-07", "8 GEN", {});
  const checks = Validation.validatePlan(warnPlan);
  assert.ok(checks.issues.some((issue) => issue.type === "rest-gap"));
  Model.addItemFromText(warnPlan, warnPlan.staff[0].id, "2026-07-07", "12 GEN", {});
  const multi = Validation.validatePlan(warnPlan);
  assert.ok(multi.issues.some((issue) => issue.type === "multiple-primary"));
}

function testCopyItemsAndGroups() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-12",
    staffNames: ["Alex", "Blake"]
  });
  const alex = plan.staff[0].id;
  const blake = plan.staff[1].id;
  const shift = Model.addItemFromText(plan, alex, "2026-07-06", "8 GEN ED", {});

  const copiedShift = Model.copyItem(plan, shift.id, blake, "2026-07-08");
  assert.equal(plan.items.length, 2);
  assert.notEqual(copiedShift.id, shift.id);
  assert.equal(copiedShift.staffId, blake);
  assert.equal(copiedShift.date, "2026-07-08");
  assert.equal(copiedShift.groupId, null);
  assert.equal(Model.getItem(plan, shift.id).staffId, alex);
  assert.equal(Parser.formatTimeForDisplay(copiedShift.start), "0800");

  const patternItems = Model.placePattern(plan, plan.palette.patterns[0].id, alex, "2026-07-06");
  const copiedGroup = Model.copyGroup(plan, patternItems[0].groupId, blake, "2026-07-09", patternItems[1].id);

  assert.equal(copiedGroup.length, patternItems.length);
  assert.ok(copiedGroup.every((item) => item.staffId === blake));
  assert.ok(copiedGroup.every((item) => item.groupId === copiedGroup[0].groupId));
  assert.notEqual(copiedGroup[0].groupId, patternItems[0].groupId);
  assert.deepEqual(copiedGroup.map((item) => item.date), [
    "2026-07-08",
    "2026-07-09",
    "2026-07-10",
    "2026-07-11"
  ]);
  assert.deepEqual(Model.getGroupItems(plan, patternItems[0].groupId).map((item) => item.staffId), [
    alex,
    alex,
    alex,
    alex
  ]);
}

function testItemDragAllowsModifierDrops() {
  const event = {
    dataTransfer: {
      effectAllowed: "",
      data: {},
      setData(type, value) {
        this.data[type] = value;
      }
    }
  };

  DragDrop.setPayload(event, { type: "item", itemId: "item_1" });

  assert.equal(event.dataTransfer.effectAllowed, "all");
}

function testPalettePatternCreation() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-12",
    staffNames: ["Alex"]
  });
  const initialShiftCount = plan.palette.savedShifts.length;
  const initialPatternCount = plan.palette.patterns.length;

  const pattern = Model.addPalettePattern(plan, "Weekend", ["8 GEN ED", "12 GEN"]);

  assert.equal(plan.palette.patterns.length, initialPatternCount + 1);
  assert.equal(plan.palette.savedShifts.length, initialShiftCount);
  assert.equal(pattern.type, "pattern");
  assert.equal(pattern.name, "Weekend");
  assert.deepEqual(pattern.items.map((item) => item.text), ["8 GEN ED", "12 GEN"]);
}

function testPaletteGroupingPreference() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-12",
    staffNames: ["Alex"]
  });
  assert.equal(plan.display.paletteGroupBy, "modality");

  const normalized = Model.normalizePlan({ palette: {}, display: {} });
  assert.equal(normalized.display.paletteGroupBy, "modality");

  const startGrouped = Model.normalizePlan({ palette: {}, display: { paletteGroupBy: "start" } });
  assert.equal(startGrouped.display.paletteGroupBy, "start");
}

function testDateViewPreferenceAndWeekPaging() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-25",
    staffNames: ["Alex"]
  });
  assert.equal(plan.display.dateViewMode, "full");
  assert.equal(plan.display.weekStart, "2026-07-06");
  assert.equal(Model.weekStartForPlan(plan, "2026-07-17"), "2026-07-13");
  assert.equal(Model.weekStartForPlan(plan, "2026-08-20"), "2026-07-20");

  const normalized = Model.normalizePlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-25",
    palette: {},
    display: {
      dateViewMode: "week",
      weekStart: "2026-07-17"
    }
  });
  assert.equal(normalized.display.dateViewMode, "week");
  assert.equal(normalized.display.weekStart, "2026-07-13");
}

function testDateViewControlsAndVisibleDatesRender() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-25",
    staffNames: ["Alex"]
  });
  const root = {
    innerHTML: "",
    querySelectorAll: () => [],
    querySelector: () => null
  };
  const state = {
    plan,
    validation: Validation.validatePlan(plan),
    canUndo: false,
    canRedo: false
  };

  Render.render(root, state, {});
  assert.ok(root.innerHTML.includes('data-view-mode="full" aria-pressed="true"'));
  assert.ok(root.innerHTML.includes("Scroll sideways to view the full period"));
  assert.equal((root.innerHTML.match(/class="date-head"/g) || []).length, 20);

  plan.display.dateViewMode = "week";
  plan.display.weekStart = "2026-07-13";
  Render.render(root, state, {});
  assert.ok(root.innerHTML.includes('data-view-mode="week" aria-pressed="true"'));
  assert.equal((root.innerHTML.match(/class="date-head"/g) || []).length, 7);
  assert.ok(root.innerHTML.includes("13–19 July 2026"));
  assert.ok(root.innerHTML.includes("Week 2 of 3"));
  assert.ok(root.innerHTML.includes('data-action="previous-week"'));
  assert.ok(root.innerHTML.includes('data-action="next-week"'));

  plan.display.weekStart = "2026-07-20";
  Render.render(root, state, {});
  assert.equal((root.innerHTML.match(/class="date-head"/g) || []).length, 6);
  assert.ok(root.innerHTML.includes("20–25 July 2026"));
  assert.ok(/data-action="next-week"[^>]*disabled/.test(root.innerHTML));
}

function testPatternAddButtonRenders() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-12",
    staffNames: ["Alex"]
  });
  const root = {
    innerHTML: "",
    querySelectorAll: () => [],
    querySelector: () => null
  };

  Render.render(root, {
    plan,
    validation: Validation.validatePlan(plan),
    canUndo: false,
    canRedo: false
  }, {});

  assert.ok(root.innerHTML.includes('data-action="add-pattern"'));
  assert.ok(root.innerHTML.includes("Add Pattern"));
}

function testPaletteShortcutRenders() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-12",
    staffNames: ["Alex"]
  });
  const root = {
    innerHTML: "",
    querySelectorAll: () => [],
    querySelector: () => null
  };

  Render.render(root, {
    plan,
    validation: Validation.validatePlan(plan),
    paletteOpen: false,
    canUndo: false,
    canRedo: false
  }, {});

  assert.ok(root.innerHTML.includes('aria-keyshortcuts="`"'));
  assert.ok(root.innerHTML.includes('title="Toggle palette (`)"'));
  assert.ok(root.innerHTML.includes('Palette <kbd>`</kbd>'));
  assert.ok(root.innerHTML.includes('class="command-bar-content"'));
}

function testHelpGuideRenders() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-12",
    staffNames: ["Alex"]
  });
  const root = {
    innerHTML: "",
    querySelectorAll: () => [],
    querySelector: () => null
  };
  const state = {
    plan,
    validation: Validation.validatePlan(plan),
    modal: null,
    canUndo: false,
    canRedo: false
  };

  Render.render(root, state, {});
  assert.ok(root.innerHTML.includes('data-action="open-help"'));
  assert.ok(root.innerHTML.includes('aria-label="Open how-to guide"'));
  assert.ok(root.innerHTML.indexOf('data-action="open-help"') > root.innerHTML.indexOf('data-action="import-palette"'));
  assert.ok(!root.innerHTML.includes('id="help-title"'));

  state.modal = { type: "help" };
  Render.render(root, state, {});
  assert.ok(root.innerHTML.includes('class="modal help-modal"'));
  assert.ok(root.innerHTML.includes('aria-labelledby="help-title"'));
  assert.ok(root.innerHTML.includes('id="help-title">How to use Roster Scratch Planner'));
  assert.ok(root.innerHTML.includes("Manipulating cells"));
  assert.ok(root.innerHTML.includes("Shift shorthand"));
  assert.ok(root.innerHTML.includes("Useful features"));
  assert.ok(root.innerHTML.includes('data-action="close-modal"'));
}

function testPaletteGroupingRenders() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-12",
    staffNames: ["Alex"]
  });
  const root = {
    innerHTML: "",
    querySelectorAll: () => [],
    querySelector: () => null
  };

  Render.render(root, {
    plan,
    validation: Validation.validatePlan(plan),
    canUndo: false,
    canRedo: false
  }, {});

  assert.ok(root.innerHTML.includes('data-action="palette-group"'));
  assert.ok(root.innerHTML.includes('aria-pressed="true">Modality'));
  assert.ok(root.innerHTML.includes('<div class="palette-subheading">GEN</div>'));
  assert.ok(root.innerHTML.includes('<div class="palette-subheading">CT</div>'));
  assert.ok(root.innerHTML.includes('<div class="palette-subheading">MRI</div>'));
  const genGroup = root.innerHTML.match(/<div class="palette-subheading">GEN<\/div><div class="palette-sublist">([\s\S]*?)<\/div><\/div>/)[1];
  assert.ok(genGroup.indexOf('data-text="8 GEN ED"') < genGroup.indexOf('data-text="12 GEN"'));
  assert.ok(genGroup.indexOf('data-text="12 GEN"') < genGroup.indexOf('data-text="4 GEN"'));

  plan.display.paletteGroupBy = "start";
  Render.render(root, {
    plan,
    validation: Validation.validatePlan(plan),
    canUndo: false,
    canRedo: false
  }, {});

  assert.ok(root.innerHTML.includes('aria-pressed="true">Start time'));
  assert.ok(root.innerHTML.includes('<div class="palette-subheading">0630</div>'));
  assert.ok(root.innerHTML.includes('<div class="palette-subheading">0800</div>'));
  assert.ok(root.innerHTML.includes('<div class="palette-subheading">1200</div>'));
  assert.ok(root.innerHTML.includes('<div class="palette-subheading">1600</div>'));
}

function testRosterModalityClassesRender() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-06",
    staffNames: ["Alex"]
  });
  const staffId = plan.staff[0].id;
  Model.addItemFromText(plan, staffId, "2026-07-06", "8 GEN ED", {});
  Model.addItemFromText(plan, staffId, "2026-07-06", "630 CT ED", {});
  Model.addItemFromText(plan, staffId, "2026-07-06", "630 MRI", {});
  Model.addItemFromText(plan, staffId, "2026-07-06", "8 MAM", {});
  const root = {
    innerHTML: "",
    querySelectorAll: () => [],
    querySelector: () => null
  };

  Render.render(root, {
    plan,
    validation: Validation.validatePlan(plan),
    canUndo: false,
    canRedo: false
  }, {});

  assert.ok(root.innerHTML.includes("modality-gen"));
  assert.ok(root.innerHTML.includes("modality-ct"));
  assert.ok(root.innerHTML.includes("modality-mri"));
  assert.ok(root.innerHTML.includes("modality-other"));
}

function testStaffRowFocusRenders() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-06",
    staffNames: ["Alex", "Blake"]
  });
  const focusedStaffId = plan.staff[0].id;
  const root = {
    innerHTML: "",
    querySelectorAll: () => [],
    querySelector: () => null
  };

  Render.render(root, {
    plan,
    validation: Validation.validatePlan(plan),
    focusedStaffId,
    canUndo: false,
    canRedo: false
  }, {});

  assert.ok(root.innerHTML.includes('class="roster-grid staff-focus-active"'));
  assert.equal((root.innerHTML.match(/class="staff-focused"/g) || []).length, 1);
  assert.ok(root.innerHTML.includes('data-staff-focus-target="true"'));
  assert.ok(root.innerHTML.includes('aria-label="Disable focus for Alex"'));
  assert.ok(root.innerHTML.includes('aria-label="Focus row for Blake"'));

  Render.render(root, {
    plan,
    validation: Validation.validatePlan(plan),
    focusedStaffId: null,
    canUndo: false,
    canRedo: false
  }, {});

  assert.ok(root.innerHTML.includes('class="roster-grid"'));
  assert.ok(!root.innerHTML.includes('class="roster-grid staff-focus-active"'));
  assert.equal((root.innerHTML.match(/class="staff-focused"/g) || []).length, 0);
}

function testDaySummaryRendersChronologically() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-06",
    staffNames: ["Alex", "Blake"]
  });
  Model.addItemFromText(plan, plan.staff[0].id, "2026-07-06", "12 GEN", {});
  Model.addItemFromText(plan, plan.staff[1].id, "2026-07-06", "630 MRI", {});
  Model.addItemFromText(plan, plan.staff[0].id, "2026-07-06", "8 CT ED", {});
  Model.addItemFromText(plan, plan.staff[0].id, "2026-07-06", "Training", {});
  const root = {
    innerHTML: "",
    querySelectorAll: () => [],
    querySelector: () => null
  };

  Render.render(root, {
    plan,
    validation: Validation.validatePlan(plan),
    summaryDate: "2026-07-06",
    canUndo: false,
    canRedo: false
  }, {});

  assert.ok(root.innerHTML.includes('data-action="toggle-day-summary"'));
  assert.ok(root.innerHTML.includes('aria-expanded="true"'));
  assert.ok(root.innerHTML.includes("3 shifts"));
  assert.ok(root.innerHTML.includes("modality-gen"));
  assert.ok(root.innerHTML.includes("modality-ct"));
  assert.ok(root.innerHTML.includes("modality-mri"));
  assert.ok(!root.innerHTML.includes("day-summary-shift modality-other\">Training"));
  assert.ok(root.innerHTML.indexOf("0630–1430 MRI") < root.innerHTML.indexOf("0800–1600 CT ED"));
  assert.ok(root.innerHTML.indexOf("0800–1600 CT ED") < root.innerHTML.indexOf("1200–2000 GEN"));
}

function testModalityDistributionModalUsesDisplayedDates() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-19",
    staffNames: ["Alex", "Blake"]
  });
  Model.addItemFromText(plan, plan.staff[0].id, "2026-07-06", "8 CT ED", {});
  Model.addItemFromText(plan, plan.staff[0].id, "2026-07-07", "630 CT", {});
  Model.addItemFromText(plan, plan.staff[0].id, "2026-07-13", "8 MRI", {});
  Model.addItemFromText(plan, plan.staff[1].id, "2026-07-14", "8 GEN", {});
  const root = {
    innerHTML: "",
    querySelectorAll: () => [],
    querySelector: () => null
  };
  const state = {
    plan,
    validation: Validation.validatePlan(plan),
    modal: { type: "distribution" },
    canUndo: false,
    canRedo: false
  };

  Render.render(root, state, {});
  assert.ok(root.innerHTML.includes('data-action="open-distribution"'));
  assert.ok(root.innerHTML.includes('aria-haspopup="dialog"'));
  assert.ok(root.innerHTML.includes('id="distribution-title">Modality distribution'));
  assert.ok(root.innerHTML.includes("6–19 July 2026 · Weekdays only"));
  let table = root.innerHTML.match(/<table class="distribution-table">([\s\S]*?)<\/table>/)[1];
  assert.ok(table.includes('<th scope="col">CT</th>'));
  assert.ok(table.includes('<th scope="col">GEN</th>'));
  assert.ok(table.includes('<th scope="col">MRI</th>'));
  assert.ok(table.includes('<span class="distribution-count">2</span> <span class="distribution-percentage">(66.7%)</span>'));
  assert.ok(table.includes('aria-label="0 shifts, 0%">—'));

  plan.display.dateViewMode = "week";
  plan.display.weekStart = "2026-07-13";
  Render.render(root, state, {});
  assert.ok(root.innerHTML.includes("13–19 July 2026 · Weekdays only"));
  table = root.innerHTML.match(/<table class="distribution-table">([\s\S]*?)<\/table>/)[1];
  assert.ok(!table.includes('<th scope="col">CT</th>'));
  assert.ok(table.includes('<th scope="col">GEN</th>'));
  assert.ok(table.includes('<th scope="col">MRI</th>'));
}

function testCellLocksGuardDirectChanges() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-07",
    staffNames: ["Alex"]
  });
  const staffId = plan.staff[0].id;
  const date = "2026-07-06";
  const item = Model.addItemFromText(plan, staffId, date, "8 GEN ED (+call)", {});
  const originalLabel = item.label;

  assert.equal(Model.setCellLocked(plan, staffId, date, true), true);
  assert.equal(Model.isCellLocked(plan, staffId, date), true);
  assert.equal(Model.addItemFromText(plan, staffId, date, "Training", {}), null);
  assert.equal(Model.replaceCellFromText(plan, staffId, date, "630 MRI"), false);
  assert.equal(Model.updateItemFromText(plan, item.id, "630 CT ED"), null);
  assert.equal(Model.removeCallFromItem(plan, item.id), null);
  assert.equal(Model.removeItem(plan, item.id), null);
  assert.deepEqual(Model.removeCellItems(plan, staffId, date), []);
  assert.equal(Model.getCellItems(plan, staffId, date).length, 1);
  assert.equal(Model.getItem(plan, item.id).label, originalLabel);

  assert.equal(Model.setCellLocked(plan, staffId, date, false), true);
  assert.equal(Model.isCellLocked(plan, staffId, date), false);
  assert.equal(Model.replaceCellFromText(plan, staffId, date, "630 MRI"), true);
  assert.equal(Model.getCellItems(plan, staffId, date)[0].label, "630 MRI");
}

function testCellLocksGuardDragAndGroupedChanges() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-20",
    staffNames: ["Alex", "Blake"]
  });
  const alex = plan.staff[0].id;
  const blake = plan.staff[1].id;
  const item = Model.addItemFromText(plan, alex, "2026-07-06", "8 GEN ED", {});

  Model.setCellLocked(plan, alex, "2026-07-06", true);
  assert.equal(Model.moveItem(plan, item.id, blake, "2026-07-07"), null);
  assert.equal(Model.copyItem(plan, item.id, blake, "2026-07-07").staffId, blake, "copying must not change the locked source");

  Model.setCellLocked(plan, blake, "2026-07-08", true);
  assert.equal(Model.copyItem(plan, item.id, blake, "2026-07-08"), null);
  Model.setCellLocked(plan, alex, "2026-07-06", false);
  assert.equal(Model.moveItem(plan, item.id, blake, "2026-07-08"), null);
  assert.equal(Model.getItem(plan, item.id).staffId, alex);

  const group = Model.placePattern(plan, plan.palette.patterns[0].id, alex, "2026-07-10");
  Model.setCellLocked(plan, alex, group[1].date, true);
  const beforeDates = group.map((entry) => entry.date);
  assert.deepEqual(Model.moveGroup(plan, group[0].groupId, blake, "2026-07-14", group[0].id), []);
  assert.deepEqual(Model.getGroupItems(plan, group[0].groupId).map((entry) => entry.date), beforeDates);
  assert.equal(Model.ungroup(plan, group[0].groupId), false);
  assert.equal(Model.getGroupItems(plan, group[0].groupId).length, 4);

  const copied = Model.copyGroup(plan, group[0].groupId, blake, "2026-07-10", group[0].id);
  assert.equal(copied.length, 4, "copying must not alter locked source cells");
  Model.setCellLocked(plan, blake, "2026-07-15", true);
  assert.deepEqual(Model.copyGroup(plan, group[0].groupId, blake, "2026-07-14", group[0].id), []);
}

function testCellLocksGuardPatternsAndDestructiveStructureChanges() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-19",
    staffNames: ["Alex"]
  });
  const staffId = plan.staff[0].id;

  Model.setCellLocked(plan, staffId, "2026-07-08", true);
  const itemCount = plan.items.length;
  assert.deepEqual(Model.placePattern(plan, plan.palette.patterns[0].id, staffId, "2026-07-06"), []);
  assert.equal(plan.items.length, itemCount, "a blocked pattern must not be partially placed");
  assert.equal(Model.deleteStaff(plan, staffId), null);
  assert.equal(Model.setDateRange(plan, "2026-07-09", "2026-07-19", true), false);
  assert.equal(plan.dateStart, "2026-07-06");

  const roundTrip = Storage.parsePlan(Storage.serializePlan(plan)).plan;
  assert.equal(roundTrip.schemaVersion, Model.SCHEMA_VERSION);
  assert.equal(Model.isCellLocked(roundTrip, staffId, "2026-07-08"), true);
}

function testCellLockControlsRender() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-06",
    staffNames: ["Alex"]
  });
  const staffId = plan.staff[0].id;
  const root = {
    innerHTML: "",
    querySelectorAll: () => [],
    querySelector: () => null
  };

  Render.render(root, {
    plan,
    validation: Validation.validatePlan(plan),
    canUndo: false,
    canRedo: false
  }, {});
  assert.ok(root.innerHTML.includes('class="cell-lock-toggle"'));
  assert.ok(root.innerHTML.includes('aria-label="Lock cell"'));
  assert.ok(root.innerHTML.includes('data-locked="false"'));

  Model.addItemFromText(plan, staffId, "2026-07-06", "8 GEN ED", {});
  Model.setCellLocked(plan, staffId, "2026-07-06", true);
  Render.render(root, {
    plan,
    validation: Validation.validatePlan(plan),
    canUndo: false,
    canRedo: false
  }, {});
  assert.ok(root.innerHTML.includes('class="cell locked'));
  assert.ok(root.innerHTML.includes('aria-label="Unlock cell"'));
  assert.ok(root.innerHTML.includes('data-locked="true"'));
  assert.ok(root.innerHTML.includes('aria-readonly="true"'));
  assert.ok(root.innerHTML.includes('title="Cell is locked" disabled'));
}

function testStorageAndCsv() {
  const plan = Model.createPlan({
    dateStart: "2026-07-06",
    dateEnd: "2026-07-07",
    staffNames: ["Alex"]
  });
  Model.addItemFromText(plan, plan.staff[0].id, "2026-07-06", "630 CT ED", {});
  const roundTrip = Storage.parsePlan(Storage.serializePlan(plan)).plan;
  assert.equal(roundTrip.items[0].label, "630 CT ED");
  const palette = Storage.parsePalette(Storage.serializePalette(plan)).palette;
  assert.ok(palette.savedShifts.length > 0);
  const staff = Storage.parseStaffText("Avery\nBlake,Casey\n\"Dana Lee\"");
  assert.deepEqual(staff, ["Avery", "Blake", "Casey", "Dana Lee"]);
  const shifts = Storage.parseShiftText("0630 CT ED\nTraining\n8 GEN ED\n8 GEN ED\n");
  assert.deepEqual(shifts.shifts, [
    { text: "0630 CT ED", label: "630 CT ED" },
    { text: "8 GEN ED", label: "8 GEN ED" }
  ]);
  assert.deepEqual(shifts.skipped, ["Training"]);
  const csv = Exporter.planToCsv(plan, Validation.validatePlan(plan));
  assert.ok(csv.includes("staff,date,display"));
  assert.ok(csv.includes("630 CT ED"));
}

testParserExamples();
testPolishFixes();
testModalityDistributionUsesWorkedWeekdayShifts();
testModelHistory();
testRemoveOnCall();
testPatternsAndValidation();
testCopyItemsAndGroups();
testItemDragAllowsModifierDrops();
testPalettePatternCreation();
testPaletteGroupingPreference();
testDateViewPreferenceAndWeekPaging();
testDateViewControlsAndVisibleDatesRender();
testPatternAddButtonRenders();
testPaletteShortcutRenders();
testHelpGuideRenders();
testPaletteGroupingRenders();
testRosterModalityClassesRender();
testStaffRowFocusRenders();
testDaySummaryRendersChronologically();
testModalityDistributionModalUsesDisplayedDates();
testCellLocksGuardDirectChanges();
testCellLocksGuardDragAndGroupedChanges();
testCellLocksGuardPatternsAndDestructiveStructureChanges();
testCellLockControlsRender();
testStorageAndCsv();

console.log("All tests passed.");
