#ifndef NATIVE_MONITOR_TOOLS_WINDOWS_SYS_TYPES_H
#define NATIVE_MONITOR_TOOLS_WINDOWS_SYS_TYPES_H

#include_next <sys/types.h>
#include <time.h>

#ifndef _SSIZE_T_DEFINED
typedef __INTPTR_TYPE__ ssize_t;
#define _SSIZE_T_DEFINED
#endif

#ifndef NATIVE_MONITOR_TOOLS_MODE_T_DEFINED
typedef unsigned short mode_t;
#define NATIVE_MONITOR_TOOLS_MODE_T_DEFINED
#endif

#ifndef F_OK
#define F_OK 0
#define R_OK 4
#define W_OK 2
#define X_OK 1
#endif

#ifndef S_ISDIR
#define S_ISDIR(mode) (((mode) & _S_IFMT) == _S_IFDIR)
#define S_ISREG(mode) (((mode) & _S_IFMT) == _S_IFREG)
#define S_ISLNK(mode) 0
#endif

#ifndef S_ISFIFO
#define S_ISFIFO(mode) (((mode) & _S_IFMT) == _S_IFIFO)
#define S_ISCHR(mode) (((mode) & _S_IFMT) == _S_IFCHR)
#define S_ISBLK(mode) 0
#endif

#if defined(_WIN32) && defined(_MSC_VER)
#include <windows.h>

#ifndef CLOCK_REALTIME
#define CLOCK_REALTIME 0
#endif

#ifndef CLOCK_MONOTONIC
#define CLOCK_MONOTONIC 1
#endif

static inline int native_monitor_tools_clock_gettime(
  int clock_id,
  struct timespec *ts
) {
  if (clock_id == CLOCK_MONOTONIC) {
    LARGE_INTEGER counter;
    LARGE_INTEGER frequency;
    if (!QueryPerformanceCounter(&counter) ||
        !QueryPerformanceFrequency(&frequency) ||
        frequency.QuadPart <= 0) {
      return -1;
    }

    const LONGLONG seconds = counter.QuadPart / frequency.QuadPart;
    const LONGLONG remainder = counter.QuadPart % frequency.QuadPart;
    ts->tv_sec = (time_t)seconds;
    ts->tv_nsec = (long)((remainder * 1000000000LL) / frequency.QuadPart);
    return 0;
  }

  if (clock_id != CLOCK_REALTIME) {
    return -1;
  }

  return timespec_get(ts, TIME_UTC) == TIME_UTC ? 0 : -1;
}

#define clock_gettime native_monitor_tools_clock_gettime
#endif

#endif
