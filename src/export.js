(function (root, factory) {
  var api = factory(root.RosterModel, root.RosterParser, root.RosterValidation);
  root.RosterExport = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Model, Parser, Validation) {
  "use strict";

  function csvEscape(value) {
    var text = value == null ? "" : String(value);
    if (/[",\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  function planToCsv(plan, validation) {
    var checks = validation || Validation.validatePlan(plan);
    var rows = [
      ["staff", "date", "display", "start", "end", "modality", "location", "marker_or_call", "kind", "notes", "warnings"]
    ];
    plan.staff.forEach(function (staff) {
      Model.enumerateDates(plan.dateStart, plan.dateEnd).forEach(function (dateKey) {
        var items = Model.getCellItems(plan, staff.id, dateKey);
        var cellDisplay = items.map(Parser.formatCompact).join(" | ");
        var warnings = (checks.byCell[Validation.cellKey(staff.id, dateKey)] || []).map(function (issue) {
          return issue.message;
        }).join(" | ");
        if (!items.length) {
          return;
        }
        items.forEach(function (item) {
          rows.push([
            staff.name,
            dateKey,
            cellDisplay,
            item.start ? Parser.formatTimeForDisplay(item.start) : "",
            item.end ? Parser.formatTimeForDisplay(item.end) : "",
            item.modality || "",
            item.location || "",
            markerOrCall(item),
            item.kind || "",
            item.notes || "",
            warnings
          ]);
        });
      });
    });
    return rows.map(function (row) { return row.map(csvEscape).join(","); }).join("\n");
  }

  function markerOrCall(item) {
    var parts = [];
    if (item.marker) {
      parts.push(item.marker);
    }
    if (item.call && item.call.enabled) {
      parts.push(item.call.text || "call");
    }
    return parts.join(" ");
  }

  function printableHtml(plan, validation) {
    var checks = validation || Validation.validatePlan(plan);
    var dates = Model.enumerateDates(plan.dateStart, plan.dateEnd);
    var headCells = dates.map(function (dateKey) {
      return "<th>" + escapeHtml(dateLabel(dateKey)) + "</th>";
    }).join("");
    var rows = plan.staff.map(function (staff) {
      var cells = dates.map(function (dateKey) {
        var items = Model.getCellItems(plan, staff.id, dateKey);
        var warnings = checks.byCell[Validation.cellKey(staff.id, dateKey)] || [];
        var itemHtml = items.map(function (item) {
          return "<div class=\"print-item\">" + escapeHtml(Parser.formatCompact(item)) + "</div>";
        }).join("");
        var warningHtml = warnings.length ? "<div class=\"print-warning\">" + escapeHtml(warnings.map(function (issue) { return issue.message; }).join(" | ")) + "</div>" : "";
        return "<td>" + itemHtml + warningHtml + "</td>";
      }).join("");
      return "<tr><th>" + escapeHtml(staff.name) + "</th>" + cells + "</tr>";
    }).join("");
    var issueList = checks.issues.map(function (issue) {
      return "<li>" + escapeHtml(issue.message) + "</li>";
    }).join("");
    return "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + escapeHtml(plan.name) + "</title>" +
      "<style>" + printCss() + "</style></head><body><header><h1>" + escapeHtml(plan.name) +
      "</h1><p>" + escapeHtml(plan.dateStart + " to " + plan.dateEnd) + "</p></header><main><table><thead><tr><th>Staff</th>" +
      headCells + "</tr></thead><tbody>" + rows + "</tbody></table>" +
      (issueList ? "<section><h2>Warnings</h2><ul>" + issueList + "</ul></section>" : "") +
      "</main></body></html>";
  }

  function dateLabel(dateKey) {
    var date = new Date(dateKey + "T00:00:00Z");
    return date.toLocaleDateString("en-AU", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function printCss() {
    return [
      "body{margin:24px;background:#150f22;color:#f9fbff;font-family:Inter,Arial,sans-serif}",
      "header{border-bottom:3px solid #00d9ff;margin-bottom:18px}",
      "h1{margin:0;font-size:28px;color:#ffe35a}",
      "p{color:#b7c3d7}",
      "table{width:100%;border-collapse:collapse;background:#1b2030}",
      "th,td{border:1px solid #465066;vertical-align:top;padding:7px;min-width:92px}",
      "thead th{background:#252a3b;color:#00d9ff}",
      "tbody th{background:#252a3b;color:#ffe35a;text-align:left;min-width:130px}",
      ".print-item{margin:0 0 4px;padding:4px 6px;border-radius:4px;background:linear-gradient(90deg,rgba(0,217,255,.2),rgba(255,79,216,.15));white-space:nowrap}",
      ".print-warning{margin-top:4px;color:#ffc857;font-size:11px}",
      "section{margin-top:20px}",
      "@media print{body{background:white;color:#111}thead th,tbody th{background:#eee;color:#111}.print-item{background:#f2f2f2}.print-warning{color:#8a4d00}}"
    ].join("");
  }

  function openPrintView(plan, validation) {
    var html = printableHtml(plan, validation);
    var win = window.open("", "_blank");
    if (!win) {
      return false;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    return true;
  }

  return {
    planToCsv: planToCsv,
    printableHtml: printableHtml,
    openPrintView: openPrintView
  };
});
