---
"mesh-avatar": minor
---

Add optional overlay layers: full-size accessory drawings such as glasses, listed in `built/overlays/overlays.json` and switched by name with `setOverlays`. Only their opaque area is meshed, and hidden overlays are not deformed. Avatars without overlays render as before, and older runtimes ignore the directory. `validateAvatarFiles`, `openAvatar` and project packing read, check and include the overlay files.
