(function (root, factory) {
  var api = factory(root.RosterModel, root.RosterParser);
  root.RosterValidation = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Model, Parser) {
  "use strict";

  function cellKey(staffId, dateKey) {
    return staffId + "|" + dateKey;
  }

  function formatDate(dateKey) {
    var date = new Date(dateKey + "T00:00:00Z");
    return date.toLocaleDateString("en-AU", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
  }

  function formatGap(hours) {
    var sign = hours < 0 ? "-" : "";
    var totalMinutes = Math.round(Math.abs(hours) * 60);
    return sign + Math.floor(totalMinutes / 60) + "h " + (totalMinutes % 60) + "m";
  }

  function isPrimaryShift(item) {
    return item.kind === "shift" && item.start && item.end && !item.onCallOnly;
  }

  function validatePlan(plan) {
    var issues = [];
    var byCell = {};
    var issueIndex = 1;

    function addIssue(issue) {
      issue.id = "issue_" + issueIndex++;
      issues.push(issue);
      var key = cellKey(issue.staffId, issue.date);
      if (!byCell[key]) {
        byCell[key] = [];
      }
      byCell[key].push(issue);
    }

    plan.staff.forEach(function (staff) {
      Model.enumerateDates(plan.dateStart, plan.dateEnd).forEach(function (dateKey) {
        var cellItems = Model.getCellItems(plan, staff.id, dateKey);
        var primary = cellItems.filter(isPrimaryShift);
        if (primary.length > 1) {
          addIssue({
            type: "multiple-primary",
            severity: "warning",
            staffId: staff.id,
            staffName: staff.name,
            date: dateKey,
            itemIds: primary.map(function (item) { return item.id; }),
            message: staff.name + " has " + primary.length + " primary shifts on " + formatDate(dateKey) + "."
          });
        }
      });

      var shifts = plan.items
        .filter(function (item) { return item.staffId === staff.id && isPrimaryShift(item); })
        .sort(function (a, b) { return new Date(a.start) - new Date(b.start); });

      for (var index = 0; index < shifts.length - 1; index += 1) {
        var current = shifts[index];
        var next = shifts[index + 1];
        var gapHours = (new Date(next.start) - new Date(current.end)) / 3600000;
        if (gapHours < 10) {
          addIssue({
            type: "rest-gap",
            severity: "warning",
            staffId: next.staffId,
            staffName: staff.name,
            date: next.date,
            itemIds: [current.id, next.id],
            message: "Only " + formatGap(gapHours) + " between " +
              formatDate(current.date) + " " + Parser.formatTimeForDisplay(current.end) +
              " finish and " + formatDate(next.date) + " " +
              Parser.formatTimeForDisplay(next.start) + " start for " + staff.name + "."
          });
        }
      }
    });

    return { issues: issues, byCell: byCell };
  }

  return {
    cellKey: cellKey,
    validatePlan: validatePlan,
    isPrimaryShift: isPrimaryShift
  };
});
