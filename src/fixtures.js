(function (root, factory) {
  var api = factory(root.RosterModel);
  root.RosterFixtures = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Model) {
  "use strict";

  function createFixturePlan() {
    var plan = Model.createPlan({
      name: "Example scratch roster",
      dateStart: "2026-07-06",
      dateEnd: "2026-07-19",
      staffNames: ["Alex Chen", "Morgan Lee", "Priya Singh", "Sam Taylor"]
    });
    Model.addItemFromText(plan, plan.staff[0].id, "2026-07-06", "630 CT ED", { addSession: false });
    Model.addItemFromText(plan, plan.staff[0].id, "2026-07-07", "4 GEN", { addSession: false });
    Model.addItemFromText(plan, plan.staff[1].id, "2026-07-06", "8 GEN ED (+call)", { addSession: false });
    Model.addItemFromText(plan, plan.staff[1].id, "2026-07-08", "Training", { addSession: false });
    Model.addItemFromText(plan, plan.staff[2].id, "2026-07-06", "RDO", { addSession: false });
    Model.addItemFromText(plan, plan.staff[3].id, "2026-07-07", "8-1230 EDCT", { addSession: false });
    return plan;
  }

  return {
    createFixturePlan: createFixturePlan
  };
});
