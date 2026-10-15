(function (root, factory) {
  var api = factory();
  root.RosterDragDrop = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MIME = "application/x-roster-scratch";
  var fallbackPayload = null;

  function setPayload(event, payload) {
    fallbackPayload = payload;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = payload && payload.type === "item" ? "all" :
        payload && payload.type === "staff" ? "move" : "copy";
      event.dataTransfer.setData(MIME, JSON.stringify(payload));
      event.dataTransfer.setData("text/plain", payload.text || payload.label || payload.type);
    }
  }

  function getPayload(event) {
    if (event.dataTransfer) {
      var raw = event.dataTransfer.getData(MIME);
      if (raw) {
        try {
          return JSON.parse(raw);
        } catch (error) {
          return fallbackPayload;
        }
      }
    }
    return fallbackPayload;
  }

  function clearPayload() {
    fallbackPayload = null;
  }

  return {
    setPayload: setPayload,
    getPayload: getPayload,
    clearPayload: clearPayload
  };
});
