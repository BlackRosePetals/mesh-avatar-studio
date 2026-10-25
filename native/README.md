# Native mesh avatars

[日本語](README.ja.md) · [简体中文](README.zh.md)

> **Experimental.** The native runtime is a work in progress. It is not published
> as a package, and its API, controls and file locations may change without notice.
> The JavaScript runtime in `packages/runtime` remains the reference implementation.

The Rust runtime loads the same `.mavatar` files and built project folders as the
JavaScript runtime. It includes a transparent desktop avatar and a PNG renderer.
The primary desktop target is macOS with Metal.

## Prerequisites

- Rust 1.88 or newer, with Cargo.
- On macOS, the Xcode Command Line Tools and a Metal-capable GPU.
- An avatar archive, or a project containing `rig.json`, `built/layers.json` and
  the built PNG assets. The illustration alone is not a playable avatar.

The commands below run from the repository root. The default avatar uses
`samples/miko-qipao`; its images must be installed. The sample's
[asset terms](../samples/miko-qipao/MIKO_ASSET_TERMS.md) apply.

## Desktop app

```sh
cargo build --release --manifest-path native/Cargo.toml -p mesh-avatar-desktop
native/target/release/mesh-avatar-desktop
```

Open another avatar:

```sh
native/target/release/mesh-avatar-desktop /path/to/avatar.mavatar
native/target/release/mesh-avatar-desktop /path/to/project
```

Without an argument, the app finds the sample relative to the current source
checkout or the executable. An executable copied elsewhere needs an explicit
avatar path.

The window is transparent, borderless, above normal windows, and has no shadow on
macOS. Its initial width is 400 logical pixels; the height follows the avatar's
image and viewport padding. The bundled sample starts around 400 × 372, with its
flat image edge cropped above the window. Large movements can tighten this crop
slightly to keep that edge hidden. Scaling preserves the window's aspect ratio.
Scroll and keyboard scaling share a 40%–400% range, further limited by the
monitor's size and the GPU's texture limit. Input bursts are combined before
resizing; rendering waits until the surface and window have matching sizes.

On macOS, **File → Open Avatar…** opens a native dialog for either a `.mavatar`
archive or a project folder containing `rig.json` and `built/`. You can also drop
either onto the avatar window. Loading runs in the background; an invalid avatar
leaves the current one displayed and shows an error. A successful switch rebuilds
its GPU resources and viewport, restores the saved placement within the new size limits,
preserves the click-through state, and prints the
new motion list in the terminal.

**File → Open Recent** keeps the last eight successfully opened paths. They are
stored in `mesh-avatar-desktop/recent.json` under the OS user configuration
directory (`~/Library/Application Support/` on macOS). Missing paths are removed
at startup and when the app regains focus. **File → Reload** reopens the current
avatar after edits. Loading a new avatar resets expressions and animation state.

Window position (the outer top-left in logical coordinates) and zoom are saved
per avatar path in `mesh-avatar-desktop/settings.json` in the same configuration
directory. On launch and avatar switches, the app restores that avatar's settings,
or uses the last window placement if that avatar has no saved settings. Restored
windows are fitted to a connected monitor; on macOS this excludes the Dock and
menu bar. Changes are saved after 0.5 seconds without further movement or scaling,
and on normal quit. Missing or corrupt settings use the default placement.

On macOS, **Avatar → Motion** lists every motion by label, and
**Avatar → Expression** selects a live expression. These menus are rebuilt when
switching avatars; the keyboard controls below continue to work.

| Control | Action |
|---|---|
| Command + `O` | Open an avatar archive or built project folder on macOS |
| Command + `R` | Reload the current avatar |
| Drop a `.mavatar` or project folder | Switch avatars in the same window |
| Left-drag | Move the avatar window |
| Scroll | Scale the window |
| Command + `+` / `-` | Scale the window |
| `1`–`9` | Play the first nine built-in motions, listed in the terminal |
| `E` | Cycle live expressions |
| `K` | Run a kana mouth-shape demo; no audio is played |
| `C` | Toggle cursor click-through; off at startup |
| Escape or Command + `Q` | Quit |

Controls apply while the avatar app has keyboard focus. With click-through on,
mouse events go to the window underneath. Use the Dock or Command-Tab to focus
the avatar app again, then press `C` to turn click-through off. The toggle is not
a global shortcut. If focus cannot be restored, quit from the Dock and relaunch;
click-through always starts off.

Idle movement, blinking, breathing and occasional motions run automatically.
Rendering follows the display's presentation rate. Resizing and monitor scale
changes update the physical render size; animation time steps are capped at
0.05 seconds after a stall or sleep.

## Render a PNG

```sh
cargo run --release --manifest-path native/Cargo.toml -p mesh-avatar-wgpu \
  --bin mesh-avatar-render -- samples/miko-qipao --size 512x640 -o avatar.png
```

Supply a JSON object such as `{"angleX":20,"mouthOpen":0.8}` with `--pose`.
Unspecified pose parameters use their defaults. `--seconds` advances the avatar
at 60 simulation steps per second before rendering. `--help` lists options for
viewport padding, fit, expressions and multisampling.

## Checks and visual comparison

Node.js 22.17 or newer and the repository's npm dependencies are needed only for
comparison with the JavaScript runtime:

```sh
node --experimental-strip-types native/conformance/dump.mjs
cargo test --manifest-path native/Cargo.toml
cargo clippy --manifest-path native/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path native/Cargo.toml --all --check
node native/conformance/compare-pixels.mjs
```

The dump checks that the embedded motion data matches the JavaScript source.
To intentionally update it, run
`node --experimental-strip-types native/conformance/sync-motion-data.mjs`.
Numeric comparison data, PNGs and reports go into ignored `native/target/`.
Comparison tests print a skip message when their generated data is absent.
The pixel comparison uses Playwright's installed Chromium; `--metal` selects its
Metal backend on macOS, and `--dpr=2` checks equal physical sizes at HiDPI.

## Limitations

- Windows and Linux desktop behavior has not been verified. Window transparency,
  always-on-top behavior and cursor click-through depend on the OS compositor.
  The app exits if a transparent surface is unavailable.
- The native menu bar and Open Avatar dialog are macOS-only. The executable
  embeds the name “Mesh Avatar” without an app bundle; the name shown elsewhere
  by macOS can depend on how it was launched.
- Desktop input is limited to the controls above. Camera tracking, microphone
  input, audio playback and lighting are not included.
- The desktop is a Cargo-built executable, without an installer, signed app
  bundle or global keyboard shortcuts.
- GPU rasterization and antialiasing can differ slightly from Chromium. Compare
  premultiplied colors when inspecting nearly transparent image edges.
