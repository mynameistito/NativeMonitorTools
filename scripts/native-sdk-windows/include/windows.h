#ifndef NATIVE_MONITOR_TOOLS_WINDOWS_WINDOWS_H
#define NATIVE_MONITOR_TOOLS_WINDOWS_WINDOWS_H

/* The runtime only needs the lean Win32 API surface.  The full Windows
 * umbrella header pulls in OLE declarations and a uuid.lib default-library
 * directive that Zig's GNU linker misreads as libuuid.a. */
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include_next <windows.h>

#endif
