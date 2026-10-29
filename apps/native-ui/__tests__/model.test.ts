import { test } from "bun:test";

import { initialModel, update } from "../src/core.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const emptyDisplayFrame = new Uint8Array([1, 1, 0, 0]);
const emptyProfileFrame = new Uint8Array([1, 2, 0, 0]);
const displayFrame = new Uint8Array([
  1, 1, 1, 0, 2, 0, 68, 49, 1, 2, 0, 80, 49, 4, 0, 49, 48, 56, 48, 1, 0, 48, 1,
  0,
]);
const colorFrame = new Uint8Array([
  1, 4, 1, 0, 2, 0, 68, 49, 2, 0, 80, 49, 0, 8, 0, 110, 111, 32, 103, 97, 109,
  109, 97, 1, 10, 0, 50, 0, 100, 0, 0, 11, 0, 110, 111, 32, 99, 111, 110, 116,
  114, 97, 115, 116,
]);
const colorFrameWithTwoMonitors = new Uint8Array([
  1,
  4,
  2,
  0,
  2,
  0,
  68,
  49,
  2,
  0,
  80,
  49,
  ...colorFrame.slice(12),
  2,
  0,
  68,
  50,
  2,
  0,
  80,
  50,
  ...colorFrame.slice(12),
]);
const unsupportedColorFrame = new Uint8Array([
  1, 4, 1, 0, 2, 0, 68, 49, 2, 0, 80, 49, 0, 1, 0, 120, 0, 1, 0, 120, 0, 1, 0,
  120,
]);
const windowAreasFrame = new Uint8Array([
  1, 6, 1, 0, 2, 0, 68, 49, 7, 0, 80, 114, 105, 109, 97, 114, 121, 4, 0, 70,
  117, 108, 108, 4, 0, 70, 117, 108, 108,
]);
const windowSnapFrame = new Uint8Array([1, 7, 0]);
const windowSnapErrorFrame = new Uint8Array([
  1, 255, 7, 5, 0, 69, 114, 114, 111, 114,
]);

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
const refreshed = Array.isArray(refresh) ? refresh[0] : refresh;
assert(refreshed.colorStatus === "loading", "refresh should load color state");
assert(
  !refreshed.settingColor,
  "refresh should clear a color write in progress"
);
assert(refreshed.lastError.length === 0, "refresh should clear stale errors");

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

const loadedDisplayResult = update(initial, {
  kind: "displays_loaded",
  payload: displayFrame,
});
const loadedDisplay = Array.isArray(loadedDisplayResult)
  ? loadedDisplayResult[0]
  : loadedDisplayResult;
assert(
  loadedDisplay.displays[0]?.colorSupported === false,
  "a display needs a matching writable color state before advertising color support"
);

const loadedWindowAreasResult = update(initial, {
  kind: "window_areas_loaded",
  payload: windowAreasFrame,
});
const loadedWindowAreas = Array.isArray(loadedWindowAreasResult)
  ? loadedWindowAreasResult[0]
  : loadedWindowAreasResult;
assert(
  loadedWindowAreas.windowAreaStatus === "ready" &&
    loadedWindowAreas.windowAreas.length === 1,
  "a valid window-area frame should load built-in snap targets"
);
assert(
  loadedWindowAreas.capabilities.windowTools,
  "a valid window-area frame should advertise window tools"
);
const selectedWindowArea = update(loadedWindowAreas, {
  id: new Uint8Array([48]),
  kind: "select_window_area",
});
const snappingWindowResult = update(
  Array.isArray(selectedWindowArea)
    ? selectedWindowArea[0]
    : selectedWindowArea,
  { kind: "snap_window" }
);
assert(
  Array.isArray(snappingWindowResult) && snappingWindowResult[0].snappingWindow,
  "selecting a snap target should issue a busy window command"
);
const snappedWindow = update(
  Array.isArray(snappingWindowResult)
    ? snappingWindowResult[0]
    : snappingWindowResult,
  { kind: "window_snap_completed", payload: windowSnapFrame }
);
assert(
  !Array.isArray(snappedWindow) && !snappedWindow.snappingWindow,
  "a successful window snap should clear the busy state"
);
const snapFailureResult = update(
  Array.isArray(snappingWindowResult)
    ? snappingWindowResult[0]
    : snappingWindowResult,
  { kind: "window_snap_completed", payload: windowSnapErrorFrame }
);
const snapFailure = Array.isArray(snapFailureResult)
  ? snapFailureResult[0]
  : snapFailureResult;
assert(
  !snapFailure.snappingWindow && snapFailure.windowActionStatus === "failed",
  "a failed window snap should clear the busy state"
);
assert(
  String.fromCodePoint(...snapFailure.lastError) === "Error",
  "a window snap error frame should expose the backend reason"
);

test("native UI model keeps its initial section", () => {
  assert(initialModel().section === "displays", "the model starts on displays");
});

const unsupportedColorsResult = update(loadedDisplay, {
  kind: "colors_loaded",
  payload: unsupportedColorFrame,
});
const unsupportedColors = Array.isArray(unsupportedColorsResult)
  ? unsupportedColorsResult[0]
  : unsupportedColorsResult;
assert(
  unsupportedColors.colorStatus === "ready",
  "an all-unsupported color state should still load successfully"
);
assert(
  unsupportedColors.capabilities.color === false,
  "unsupported color state must not advertise color capability"
);
assert(
  unsupportedColors.displays[0]?.colorSupported === false,
  "a display must not advertise color support when every matching control is unsupported"
);

const colorsResult = update(loadedDisplay, {
  kind: "colors_loaded",
  payload: colorFrame,
});
const colors = Array.isArray(colorsResult) ? colorsResult[0] : colorsResult;
assert(colors.colorStatus === "ready", "a color frame should load color state");
assert(colors.colors.length === 1, "one color monitor should be decoded");
assert(
  colors.colors[0]?.brightnessSupported === true,
  "supported physical brightness should remain enabled"
);
assert(
  colors.colors[0]?.contrastSupported === false,
  "unsupported physical contrast should remain disabled"
);
assert(
  colors.capabilities.color,
  "one supported color control should advertise color capability"
);
assert(
  colors.displays[0]?.colorSupported === true,
  "a display should advertise color support when its matching state is writable"
);
const gammaAction = update(colors, {
  id: new Uint8Array([68, 49]),
  kind: "set_color_gamma",
});
assert(
  !Array.isArray(gammaAction),
  "unsupported gamma must not issue a backend write"
);

const brightnessAction = update(colors, {
  id: new Uint8Array([68, 49]),
  kind: "increase_color_brightness",
});
assert(
  Array.isArray(brightnessAction),
  "supported brightness should issue a write"
);
const writingColors = Array.isArray(brightnessAction)
  ? brightnessAction[0]
  : brightnessAction;
assert(writingColors.settingColor, "a color write should set the busy state");
const colorWriteFailureResult = update(writingColors, {
  kind: "color_set_failed",
  reason: new Uint8Array([69, 114, 114, 111, 114]),
});
const colorWriteFailure = Array.isArray(colorWriteFailureResult)
  ? colorWriteFailureResult[0]
  : colorWriteFailureResult;
assert(
  !colorWriteFailure.settingColor,
  "a failed color write should clear the busy state"
);
assert(
  colorWriteFailure.ipcState === colors.ipcState,
  "a failed color write should not fail global IPC state"
);
const retryAction = update(colorWriteFailure, {
  id: new Uint8Array([68, 49]),
  kind: "increase_color_brightness",
});
assert(
  Array.isArray(retryAction),
  "a failed color write should leave the control retryable"
);

const twoColorsResult = update(initial, {
  kind: "colors_loaded",
  payload: colorFrameWithTwoMonitors,
});
const twoColors = Array.isArray(twoColorsResult)
  ? twoColorsResult[0]
  : twoColorsResult;
assert(
  twoColors.colors.length === 2,
  "a full color frame should keep every monitor"
);
const mergedColorResult = update(twoColors, {
  kind: "color_set_completed",
  payload: colorFrame,
});
const mergedColors = Array.isArray(mergedColorResult)
  ? mergedColorResult[0]
  : mergedColorResult;
assert(
  mergedColors.colors.length === 2,
  "a single-monitor color write response must not discard other monitors"
);
assert(
  mergedColors.colors[1]?.id[1] === 50,
  "a single-monitor color write response should preserve the other monitor"
);

const colorFailureResult = update(colors, {
  kind: "colors_failed",
  reason: new Uint8Array([69, 114, 114, 111, 114]),
});
const colorFailure = Array.isArray(colorFailureResult)
  ? colorFailureResult[0]
  : colorFailureResult;
assert(
  colorFailure.colorStatus === "failed",
  "a color backend failure should fail the color state"
);
assert(
  colorFailure.displayStatus === colors.displayStatus &&
    colorFailure.profileStatus === colors.profileStatus &&
    colorFailure.ipcState === colors.ipcState,
  "a color backend failure should not fail unrelated state"
);

const failureResult = update(initial, {
  kind: "displays_failed",
  reason: new Uint8Array([69, 114, 114, 111, 114]),
});
const failure = Array.isArray(failureResult) ? failureResult[0] : failureResult;
assert(
  failure.displayStatus === "failed",
  "IPC failure should produce an error state"
);
assert(
  failure.ipcState === "failed",
  "IPC failure should be visible in global state"
);
