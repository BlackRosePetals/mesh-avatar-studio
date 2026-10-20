---
'mesh-avatar-studio': patch
---

Pin the local tool runner's `uv --python` request below 3.14 so it cannot resolve to a free-threaded interpreter that `opencv-python-headless` has no wheel for.
