(function (root, factory) {
  var api = factory(root.RosterModel);
  root.RosterHistory = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Model) {
  "use strict";

  function sameState(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function PlanHistory(getPlan, setPlan, onChange) {
    this.getPlan = getPlan;
    this.setPlan = setPlan;
    this.onChange = onChange || function () {};
    this.undoStack = [];
    this.redoStack = [];
    this.limit = 100;
  }

  PlanHistory.prototype.execute = function (label, mutator) {
    var before = Model.clone(this.getPlan());
    var result = mutator(this.getPlan());
    if (result) {
      this.setPlan(Model.normalizePlan(result));
    }
    var after = Model.clone(this.getPlan());
    if (sameState(before, after)) {
      this.onChange();
      return false;
    }
    this.undoStack.push({ label: label, before: before, after: after });
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.onChange();
    return true;
  };

  PlanHistory.prototype.replace = function (label, nextPlan) {
    return this.execute(label, function () {
      return nextPlan;
    });
  };

  PlanHistory.prototype.undo = function () {
    var entry = this.undoStack.pop();
    if (!entry) {
      return false;
    }
    this.redoStack.push(entry);
    this.setPlan(Model.normalizePlan(entry.before));
    this.onChange();
    return true;
  };

  PlanHistory.prototype.redo = function () {
    var entry = this.redoStack.pop();
    if (!entry) {
      return false;
    }
    this.undoStack.push(entry);
    this.setPlan(Model.normalizePlan(entry.after));
    this.onChange();
    return true;
  };

  PlanHistory.prototype.canUndo = function () {
    return this.undoStack.length > 0;
  };

  PlanHistory.prototype.canRedo = function () {
    return this.redoStack.length > 0;
  };

  PlanHistory.prototype.clear = function () {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange();
  };

  return {
    PlanHistory: PlanHistory
  };
});
