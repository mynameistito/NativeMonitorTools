#ifndef NATIVE_MONITOR_TOOLS_WINDOWS_DIRENT_H
#define NATIVE_MONITOR_TOOLS_WINDOWS_DIRENT_H

#include <errno.h>
#include <io.h>
#include <stdlib.h>
#include <string.h>

#ifndef DT_UNKNOWN
#define DT_UNKNOWN 0
#define DT_FIFO 1
#define DT_CHR 2
#define DT_DIR 4
#define DT_BLK 6
#define DT_REG 8
#define DT_LNK 10
#define DT_SOCK 12
#endif

struct dirent {
  unsigned char d_type;
  char d_name[_MAX_PATH];
};

typedef struct {
  intptr_t handle;
  int has_first;
  struct _finddata_t data;
  struct dirent entry;
} DIR;

static inline DIR *opendir(const char *path) {
  size_t path_length = strlen(path);
  if (path_length + 2 >= _MAX_PATH) {
    errno = ENAMETOOLONG;
    return NULL;
  }

  char pattern[_MAX_PATH];
  memcpy(pattern, path, path_length);
  if (path_length > 0 && pattern[path_length - 1] != '\\' &&
      pattern[path_length - 1] != '/') {
    pattern[path_length++] = '\\';
  }
  pattern[path_length++] = '*';
  pattern[path_length] = '\0';

  DIR *directory = (DIR *)malloc(sizeof(*directory));
  if (directory == NULL) {
    errno = ENOMEM;
    return NULL;
  }
  directory->handle = _findfirst(pattern, &directory->data);
  if (directory->handle == -1) {
    free(directory);
    return NULL;
  }
  directory->has_first = 1;
  return directory;
}

static inline struct dirent *readdir(DIR *directory) {
  if (directory == NULL) {
    errno = EBADF;
    return NULL;
  }
  if (directory->has_first) {
    directory->has_first = 0;
  } else if (_findnext(directory->handle, &directory->data) != 0) {
    return NULL;
  }

  directory->entry.d_type =
      (directory->data.attrib & _A_SUBDIR) != 0 ? DT_DIR : DT_REG;
  strncpy(directory->entry.d_name, directory->data.name,
          sizeof(directory->entry.d_name) - 1);
  directory->entry.d_name[sizeof(directory->entry.d_name) - 1] = '\0';
  return &directory->entry;
}

static inline int closedir(DIR *directory) {
  if (directory == NULL) {
    errno = EBADF;
    return -1;
  }
  int result = _findclose(directory->handle);
  free(directory);
  return result;
}

#endif
