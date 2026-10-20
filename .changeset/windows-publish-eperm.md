---
'mesh-avatar-studio': patch
---

Retry a locked rename during publish (EPERM/EBUSY) and fall back to copy and remove, so a real rebuild no longer fails while the dev server's watcher still holds the directory, mainly on Windows.
