(function (root, factory) {
  var api = factory(root.RosterModel, root.RosterParser);
  root.RosterStorage = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Model, Parser) {
  "use strict";

  function serializePlan(plan) {
    var copy = Model.clone(plan);
    copy.schemaVersion = Model.SCHEMA_VERSION;
    if (copy.meta) {
      copy.meta.updatedAt = new Date().toISOString();
    }
    return JSON.stringify(copy, null, 2);
  }

  function parsePlan(json) {
    var raw = JSON.parse(json);
    var warnings = [];
    if (raw.schemaVersion > Model.SCHEMA_VERSION) {
      warnings.push("This plan was saved with schema version " + raw.schemaVersion + ", which is newer than this app understands.");
    }
    return {
      plan: Model.normalizePlan(raw),
      warnings: warnings
    };
  }

  function serializePalette(plan) {
    return JSON.stringify({
      schemaVersion: Model.SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      savedShifts: Model.clone(plan.palette.savedShifts),
      patterns: Model.clone(plan.palette.patterns),
      markers: Model.clone(plan.palette.markers)
    }, null, 2);
  }

  function parsePalette(json) {
    var raw = JSON.parse(json);
    var warnings = [];
    if (raw.schemaVersion > Model.SCHEMA_VERSION) {
      warnings.push("This palette was saved with a newer schema version.");
    }
    return {
      palette: {
        savedShifts: raw.savedShifts || [],
        patterns: raw.patterns || [],
        markers: raw.markers || []
      },
      warnings: warnings
    };
  }

  function mergePalette(plan, palette, mode) {
    if (mode === "replace") {
      plan.palette.savedShifts = (palette.savedShifts || []).map(function (entry) {
        return remapEntry(plan, entry, "shift");
      });
      plan.palette.patterns = (palette.patterns || []).map(function (entry) {
        return remapEntry(plan, entry, "pattern");
      });
      plan.palette.markers = (palette.markers || []).map(function (entry) {
        return remapEntry(plan, entry, "marker");
      });
      return;
    }

    appendUnique(plan, plan.palette.savedShifts, palette.savedShifts || [], "text", "shift");
    appendUnique(plan, plan.palette.markers, palette.markers || [], "text", "marker");
    appendUnique(plan, plan.palette.patterns, palette.patterns || [], "name", "pattern");
  }

  function appendUnique(plan, target, incoming, key, idPrefix) {
    incoming.forEach(function (entry) {
      var value = String(entry[key] || entry.label || entry.text || "").toLowerCase();
      var exists = target.some(function (current) {
        return String(current[key] || current.label || current.text || "").toLowerCase() === value;
      });
      if (!exists) {
        target.push(remapEntry(plan, entry, idPrefix));
      }
    });
  }

  function remapEntry(plan, entry, idPrefix) {
    var next = Model.clone(entry);
    next.id = Model.createId(plan, idPrefix);
    return next;
  }

  function downloadText(filename, text, mimeType) {
    var blob = new Blob([text], { type: mimeType || "text/plain" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsText(file);
    });
  }

  function parseStaffText(text) {
    var rows = parseCsvish(text);
    return rows
      .map(function (row) { return row.map(trim).filter(Boolean); })
      .reduce(function (all, row) {
        if (row.length === 1) {
          all.push(row[0]);
        } else if (row.length > 1) {
          row.forEach(function (cell) { all.push(cell); });
        }
        return all;
      }, [])
      .filter(function (name, index, list) {
        return name && list.indexOf(name) === index;
      });
  }

  function parseShiftText(text) {
    var skipped = [];
    var seen = {};
    var shifts = String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map(trim)
      .filter(Boolean)
      .map(function (line) {
        var parsed = Parser.parseRosterText(line, "2000-01-01");
        if (parsed.kind !== "shift") {
          skipped.push(line);
          return null;
        }
        return {
          text: parsed.raw || line,
          label: parsed.label || Parser.normalizeText(line)
        };
      })
      .filter(Boolean)
      .filter(function (entry) {
        var key = Parser.normalizeText(entry.text).toLowerCase();
        if (seen[key]) {
          return false;
        }
        seen[key] = true;
        return true;
      });
    return { shifts: shifts, skipped: skipped };
  }

  function trim(value) {
    return String(value || "").trim();
  }

  function parseCsvish(text) {
    var rows = [];
    var row = [];
    var cell = "";
    var inQuotes = false;
    var input = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (var index = 0; index < input.length; index += 1) {
      var char = input[index];
      var next = input[index + 1];
      if (char === '"' && inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        row.push(cell);
        cell = "";
      } else if (char === "\n" && !inQuotes) {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    row.push(cell);
    rows.push(row);
    return rows;
  }

  return {
    serializePlan: serializePlan,
    parsePlan: parsePlan,
    serializePalette: serializePalette,
    parsePalette: parsePalette,
    mergePalette: mergePalette,
    downloadText: downloadText,
    readFileAsText: readFileAsText,
    parseStaffText: parseStaffText,
    parseShiftText: parseShiftText,
    parseCsvish: parseCsvish
  };
});
