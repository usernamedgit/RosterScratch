(function (root, factory) {
  var api = factory();
  root.RosterParser = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var KNOWN_MARKERS = [
    { key: "rdo", label: "RDO" },
    { key: "ado", label: "ADO" },
    { key: "al", label: "AL" },
    { key: "annual leave", label: "Annual Leave" },
    { key: "training", label: "Training" },
    { key: "on call", label: "On Call", onCallOnly: true }
  ];

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function normalizeText(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function markerFor(text) {
    var cleaned = normalizeText(text).toLowerCase();
    return KNOWN_MARKERS.find(function (marker) {
      return marker.key === cleaned;
    }) || null;
  }

  function parseTimeToken(rawToken) {
    var token = String(rawToken || "").trim();
    if (!/^\d{1,4}$/.test(token)) {
      return null;
    }

    var hour;
    var minute = 0;

    if (token.length <= 2) {
      hour = Number(token);
      if (token.length === 1 && hour >= 1 && hour <= 6) {
        hour += 12;
      }
    } else {
      var normalized = token.padStart(4, "0");
      hour = Number(normalized.slice(0, 2));
      minute = Number(normalized.slice(2));
    }

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }

    return {
      hour: hour,
      minute: minute,
      text: pad2(hour) + pad2(minute),
      minutes: hour * 60 + minute
    };
  }

  function parseRangeToken(token) {
    var match = String(token || "").match(/^(\d{1,4})-(\d{1,4})$/);
    if (!match) {
      return null;
    }
    var start = parseTimeToken(match[1]);
    var end = parseTimeToken(match[2]);
    if (!start || !end) {
      return null;
    }
    return { start: start, end: end, explicit: true };
  }

  function isoFor(dateKey, minutes, dayOffset) {
    var parts = dateKey.split("-").map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + (dayOffset || 0), 0, minutes, 0, 0));
    return date.toISOString().replace(".000Z", "Z");
  }

  function durationHours(start, end, overnight) {
    var delta = end.minutes - start.minutes;
    if (overnight) {
      delta += 24 * 60;
    }
    return Math.round((delta / 60) * 100) / 100;
  }

  function startDisplayToken(time) {
    if (time.minute === 0) {
      if (time.hour >= 13 && time.hour <= 18) {
        return String(time.hour - 12);
      }
      if (time.hour >= 1 && time.hour <= 6) {
        // A bare 1-6 is read back as an afternoon start, so keep early starts explicit.
        return pad2(time.hour) + "00";
      }
      return String(time.hour);
    }
    if (time.hour < 10) {
      return String(time.hour) + pad2(time.minute);
    }
    return pad2(time.hour) + pad2(time.minute);
  }

  function formatTimeForDisplay(value) {
    if (!value) {
      return "";
    }
    var match = String(value).match(/T(\d{2}):(\d{2})/);
    if (match) {
      return match[1] + match[2];
    }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return pad2(date.getUTCHours()) + pad2(date.getUTCMinutes());
  }

  function formatDuration(hours) {
    if (hours == null || Number.isNaN(Number(hours))) {
      return "";
    }
    var totalMinutes = Math.round(hours * 60);
    var whole = Math.floor(totalMinutes / 60);
    var minutes = totalMinutes % 60;
    if (minutes === 0) {
      return whole + "h";
    }
    return whole + "h " + minutes + "m";
  }

  function buildShiftLabel(parsed) {
    var core;
    if (!parsed.rangeExplicit && parsed.durationHours === 8) {
      core = startDisplayToken(parsed.startTime) + " " + parsed.modality;
      if (parsed.location) {
        core += " " + parsed.location;
      }
    } else {
      core = parsed.startTime.text + "-" + parsed.endTime.text + " " + parsed.modality;
      if (parsed.location) {
        core += " " + parsed.location;
      }
    }
    if (parsed.call && parsed.call.enabled) {
      core += " +call";
    }
    return core;
  }

  function stripCallText(text) {
    var call = { enabled: false };
    var cleaned = String(text || "");
    if (/(^|\s)\(?\+?call\)?\s*$/i.test(cleaned)) {
      call.enabled = true;
      call.text = "call";
      cleaned = cleaned.replace(/\s*\(?\+?call\)?\s*$/i, "");
    }
    return { cleaned: normalizeText(cleaned), call: call };
  }

  function parseRosterText(input, dateKey) {
    var original = normalizeText(input);
    if (!original) {
      return {
        valid: false,
        kind: "empty",
        raw: input,
        error: "Enter a shift, marker, or note."
      };
    }

    var plainMarker = markerFor(original);
    if (plainMarker) {
      return {
        valid: true,
        kind: plainMarker.onCallOnly ? "call" : "marker",
        raw: original,
        label: plainMarker.label,
        marker: plainMarker.label,
        call: plainMarker.onCallOnly ? { enabled: true, text: plainMarker.label } : { enabled: false },
        onCallOnly: !!plainMarker.onCallOnly
      };
    }

    var callResult = stripCallText(original);
    var text = callResult.cleaned;
    var call = callResult.call;

    var tokens = text.split(" ");
    var range = parseRangeToken(tokens[0]);
    var start = null;
    var end = null;
    var rangeExplicit = false;
    var remainder = "";

    if (range) {
      start = range.start;
      end = range.end;
      rangeExplicit = true;
      remainder = tokens.slice(1).join(" ");
    } else {
      start = parseTimeToken(tokens[0]);
      if (start) {
        end = {
          hour: Math.floor(((start.minutes + 480) % 1440) / 60),
          minute: (start.minutes + 480) % 60,
          minutes: (start.minutes + 480) % 1440,
          text: pad2(Math.floor(((start.minutes + 480) % 1440) / 60)) + pad2((start.minutes + 480) % 60)
        };
        remainder = tokens.slice(1).join(" ");
      }
    }

    if (!start) {
      return {
        valid: true,
        kind: "note",
        raw: original,
        label: original,
        notes: original,
        parseError: "Stored as a note because no time or known marker was recognized."
      };
    }

    var timedMarker = markerFor(remainder);
    var overnight = end.minutes <= start.minutes;
    var duration = durationHours(start, end, overnight);
    var startIso = dateKey ? isoFor(dateKey, start.minutes, 0) : null;
    var endIso = dateKey ? isoFor(dateKey, end.minutes, overnight ? 1 : 0) : null;

    if (timedMarker) {
      return {
        valid: true,
        kind: timedMarker.onCallOnly ? "call" : "marker",
        raw: original,
        label: start.text + "-" + end.text + " " + timedMarker.label,
        marker: timedMarker.label,
        start: startIso,
        end: endIso,
        startTime: start,
        endTime: end,
        durationHours: duration,
        overnight: overnight,
        call: timedMarker.onCallOnly ? { enabled: true, text: timedMarker.label } : call,
        onCallOnly: !!timedMarker.onCallOnly
      };
    }

    if (!remainder) {
      return {
        valid: false,
        kind: "invalid",
        raw: original,
        error: "Timed shifts need a modality after the time."
      };
    }

    var remainderTokens = remainder.split(" ");
    var modality = remainderTokens.shift();
    var location = remainderTokens.join(" ");
    var parsed = {
      valid: true,
      kind: "shift",
      raw: original,
      start: startIso,
      end: endIso,
      startTime: start,
      endTime: end,
      durationHours: duration,
      overnight: overnight,
      rangeExplicit: rangeExplicit,
      modality: modality,
      location: location,
      call: call
    };
    parsed.label = buildShiftLabel(parsed);
    return parsed;
  }

  function formatCompact(item) {
    if (!item) {
      return "";
    }
    if (item.label) {
      return item.label + (item.parseError ? " ?" : "");
    }
    if (item.kind === "shift") {
      var parts = [];
      if (item.start && item.end) {
        parts.push(formatTimeForDisplay(item.start) + "-" + formatTimeForDisplay(item.end));
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
      return parts.join(" ");
    }
    return item.marker || item.notes || item.raw || "";
  }

  function formatFull(item) {
    if (!item) {
      return "";
    }
    var lines = [formatCompact(item)];
    if (item.kind === "shift" || item.start || item.end) {
      lines.push("Time: " + formatTimeForDisplay(item.start) + "-" + formatTimeForDisplay(item.end));
    }
    if (item.durationHours != null) {
      lines.push("Duration: " + formatDuration(item.durationHours));
    }
    if (item.modality) {
      lines.push("Modality: " + item.modality);
    }
    if (item.location) {
      lines.push("Location: " + item.location);
    }
    if (item.call && item.call.enabled) {
      lines.push("Call: " + (item.call.text || "call"));
    }
    if (item.marker) {
      lines.push("Marker: " + item.marker);
    }
    if (item.notes) {
      lines.push("Notes: " + item.notes);
    }
    if (item.groupId) {
      lines.push("Pattern group: " + item.groupId);
    }
    if (item.parseError) {
      lines.push(item.parseError);
    }
    return lines.join("\n");
  }

  return {
    KNOWN_MARKERS: KNOWN_MARKERS,
    normalizeText: normalizeText,
    markerFor: markerFor,
    parseTimeToken: parseTimeToken,
    parseRosterText: parseRosterText,
    formatCompact: formatCompact,
    formatFull: formatFull,
    formatTimeForDisplay: formatTimeForDisplay,
    formatDuration: formatDuration
  };
});
