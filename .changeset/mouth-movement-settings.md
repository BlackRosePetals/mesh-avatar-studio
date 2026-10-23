---
"mesh-avatar": minor
"mesh-avatar-element": minor
---

Add optional mouth-movement settings for audio loudness and kana previews: granularity, openness and closing speed. Configure them with `lipSync` or partial `setLipSync` updates; omitted and center values preserve the existing motion. Avatar manifests store the settings and optional editor preset, and loaders apply them. The element retains explicit property or method overrides across loads.
