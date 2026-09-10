export {
  CURRENT_MONITOR_SELECTOR,
  currentMonitorForRect,
  currentMonitorSelector,
  isCurrentMonitorSelector,
  monitorForRect,
  resolveCurrentMonitor,
  resolveCurrentMonitorSelector,
  resolveDmtMonitorSelector,
  selectCurrentMonitor,
} from "./current-monitor";
export {
  encodeMagicWordParameter,
  expandMagicWord,
  expandMagicWords,
  findMagicWordByAlias,
  findMagicWordsByAlias,
  getAutoCompleteWords,
  getMagicWordCompletions,
  matchMagicWordPrefix,
  parseMagicWord,
  parseMagicWords,
} from "./magic-words";
export type {
  MagicParameter,
  MagicParameterKind,
  MagicParameterValues,
  MagicWord,
  MagicWordExpansionOptions,
  MagicWordToken,
} from "./magic-words";
export {
  CursorPointUnavailable,
  monitorForCursorPoint,
  planCursorRoute,
  routeCursorPoint,
  routeCursorToMonitor,
} from "./cursor-routing";
export type { CursorRoutingError, CursorRoutingResult } from "./cursor-routing";
export {
  nextMonitor,
  previousMonitor,
  selectMonitorAtOffset,
  selectNextMonitor,
  selectPreviousMonitor,
} from "./monitor-navigation";
export type { MonitorNavigationError } from "./monitor-navigation";
export {
  makeSystemSnapAreaGroups,
  makeSystemSnapAreas,
  makeSystemSnapAreasForTopology,
  systemDefinedSnapAreaGroups,
  systemDefinedSnapAreas,
  systemSnapAreaGroups,
  systemSnapAreas,
  systemSnapAreasForTopology,
  usableMonitorArea,
} from "./snap-areas";
export type {
  SnapArea,
  SnapAreaGroup,
  SnapAreaKind,
  SnapAreaSource,
} from "./snap-areas";
export {
  addUserDefinedArea,
  appendUserDefinedArea,
  makeUserArea,
  makeUserAreas,
  makeUserDefinedArea,
  makeUserDefinedAreas,
  MAX_USER_DEFINED_AREAS,
  InvalidUserDefinedArea,
  UserDefinedAreaLimitExceeded,
} from "./user-areas";
export type { UserDefinedArea, UserDefinedAreaInput } from "./user-areas";
export {
  clampRect,
  clampRectToUsableArea,
  maximizedWindowState,
  minimizedWindowState,
  normalWindowState,
  planWindowMove,
  planWindowPlacement,
  planWindowSnap,
  snapWindowToArea,
  translateRectBetweenMonitors,
  translateRectBetweenWorkAreas,
  translateWindowBetweenMonitors,
} from "./window-placement";
export type {
  WindowPlacementInput,
  WindowPlacementInputWithWindowRect,
  WindowPlacementOperation,
  WindowPlacementPlan,
  WindowState,
} from "./window-placement";
