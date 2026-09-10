#ifndef NATIVE_MONITOR_TOOLS_WINDOWS_UNISTD_H
#define NATIVE_MONITOR_TOOLS_WINDOWS_UNISTD_H

#include <direct.h>
#include <io.h>
#include <sys/stat.h>
#include <time.h>

#define access _access
#define chmod _chmod
#define close _close
#define getcwd _getcwd
#define isatty _isatty
#define mkdir _mkdir
#define read _read
#define rmdir _rmdir
#define unlink _unlink
#define write _write

__declspec(dllimport) void __stdcall Sleep(unsigned long milliseconds);

static inline int nanosleep(
  const struct timespec *request,
  struct timespec *remaining
) {
  unsigned long milliseconds = (unsigned long)(request->tv_sec * 1000);
  milliseconds += (unsigned long)(request->tv_nsec / 1000000);
  if (milliseconds == 0 && request->tv_nsec > 0) {
    milliseconds = 1;
  }
  Sleep(milliseconds);
  if (remaining != NULL) {
    remaining->tv_sec = 0;
    remaining->tv_nsec = 0;
  }
  return 0;
}

#endif
