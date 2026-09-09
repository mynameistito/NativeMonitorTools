export {
  DisplayApplierUnsupported,
  MonitorSourceUnsupported,
  UnsupportedCapability,
} from "./capabilities";
export { DisplayApplier, MonitorSource } from "./capabilities";
export type {
  CapabilityName,
  DisplayApplierApi,
  MonitorSourceApi,
} from "./capabilities";
export { makeDesktopApplicationLayer } from "./composition";
export { DesktopApplication, DesktopApplicationLive } from "./service";
export type { DesktopApplicationApi, DesktopApplicationError } from "./service";
