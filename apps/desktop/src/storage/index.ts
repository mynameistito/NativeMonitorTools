export { parseDesktopPlatform, resolveDesktopPaths } from "./configuration";
export type {
  DesktopEnvironment,
  DesktopPaths,
  DesktopPlatform,
} from "./configuration";
export {
  InvalidProfileName,
  parseProfileName,
  profileFileName,
} from "./profile-name";
export type { ProfileName } from "./profile-name";
export {
  makeJsonProfileStore,
  ProfileNotFound,
  ProfileStore,
  ProfileStoreError,
} from "./profile-store";
export type { ProfileStoreApi } from "./profile-store";
