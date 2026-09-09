import { initialModel, update } from "../src/core.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const emptyDisplayFrame = new Uint8Array([1, 1, 0, 0]);
const emptyProfileFrame = new Uint8Array([1, 2, 0, 0]);

const initial = initialModel();
assert(initial.section === "displays", "initial section should be Displays");
assert(
  initial.displayStatus === "empty",
  "initial display state should be honest empty state"
);

const profilesResult = update(initial, { kind: "show_profiles" });
const profilesPage = Array.isArray(profilesResult)
  ? profilesResult[0]
  : profilesResult;
assert(
  profilesPage.section === "profiles",
  "navigation should update the active section"
);

const refresh = update(profilesPage, { kind: "refresh" });
assert(Array.isArray(refresh), "refresh should return an IPC command");

const displaysResult = update(initial, {
  kind: "displays_loaded",
  payload: emptyDisplayFrame,
});
const displays = Array.isArray(displaysResult)
  ? displaysResult[0]
  : displaysResult;
assert(
  displays.displayStatus === "empty",
  "an empty display frame should remain empty"
);
assert(
  displays.capabilities.displays,
  "a valid empty frame still proves display capability"
);

const loadedProfilesResult = update(initial, {
  kind: "profiles_loaded",
  payload: emptyProfileFrame,
});
const profiles = Array.isArray(loadedProfilesResult)
  ? loadedProfilesResult[0]
  : loadedProfilesResult;
assert(
  profiles.profileStatus === "empty",
  "an empty profile frame should remain empty"
);
assert(
  profiles.capabilities.profiles,
  "a valid empty frame still proves profile capability"
);

const failureResult = update(initial, {
  kind: "displays_failed",
  reason: new Uint8Array([69, 114, 114, 111, 114]),
});
const failure = Array.isArray(failureResult) ? failureResult[0] : failureResult;
assert(
  failure.displayStatus === "error",
  "IPC failure should produce an error state"
);
assert(
  failure.ipcState === "error",
  "IPC failure should be visible in global state"
);
