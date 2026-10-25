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
mouse events go to the window underneath. On macOS, click the monochrome avatar
icon in the system status bar to open its menu. **Hide Avatar / Show Avatar**
toggles the avatar window; the status icon stays available while it is hidden.
**Click-through** has a checkmark when enabled and can turn click-through off
without focusing the avatar. The `C` key and this checkmark use the same state.

The status menu also has **Open Avatar…**, the same **Open Recent** list as the
app menu, and **Quit Mesh Avatar**. Opening an avatar from this menu first shows
the avatar window, including when the file dialog is cancelled. Hiding keeps the
avatar loaded and pauses rendering. Visibility and click-through are not saved;
the avatar starts visible with click-through off on the next launch.

If the status icon is unavailable, use the Dock or Command-Tab to focus the app,
then press `C`. This is not a global shortcut. If focus cannot be restored, quit
from the Dock and relaunch.

Idle movement, blinking, breathing and occasional motions run automatically.
Rendering follows the display's presentation rate. Resizing and monitor scale
changes update the physical render size; animation time steps are capped at
0.05 seconds after a stall or sleep.

## Microphone lip sync (macOS)

The app menu and status menu both have a **Microphone** submenu. Capture is off
at startup. Choose **Enable Microphone** to drive the mouth from input volume;
**Input Device** selects System Default or a named microphone. **Sensitivity**
offers Low, Normal (default), and High. Try High for a quiet voice or Low if
background noise opens the mouth. The noise gate, smoothing and release hold
reduce rapid opening and closing around quiet input.

On first enable, macOS asks for microphone permission. With this unbundled
executable, permission is attributed to the terminal app used to launch it.
Allow that terminal in **System Settings → Privacy & Security → Microphone**
if permission was denied, then enable the microphone again.

Only input levels are used; audio is not recorded or uploaded. This feature does
not capture system playback. Capture stays enabled when the avatar is hidden or
switched. Turn it off from either menu when finished; device, sensitivity and
enabled state are not saved across launches. Disable it before using the `K`
kana demo. Turning it off stops driving the mouth and returns to normal animation.

If a device disconnects, the stream fails, or callbacks stop arriving, the
microphone turns off and the submenu shows **Off:** followed by a reason.
It does not restart automatically. Select an available input and enable it again;
**Input Device → Refresh Devices** refreshes the device list.

## Render a PNG

```sh
cargo run --release --manifest-path native/Cargo.toml -p mesh-avatar-wgpu \
  --bin mesh-avatar-render -- samples/miko-qipao --size 512x640 -o avatar.png
```

Supply a JSON object such as `{"angleX":20,"mouthOpen":0.8}` with `--pose`.
Unspecified pose parameters use their defaults. `--seconds` advances the avatar
at 60 simulation steps per second before rendering. `--help` lists options for
viewport padding, fit, expressions and multisampling.

## Use the C ABI

```sh
cargo build --release --manifest-path native/Cargo.toml -p mesh-avatar-ffi
make -C native/examples/c run
```

The CPU-only library produces `libmesh_avatar_ffi.a` and a platform shared library
(`libmesh_avatar_ffi.dylib` on macOS) in `native/target/release/`. Include
[`mesh_avatar.h`](include/mesh_avatar.h) in your host. The C example opens the
sample, applies a pose, ticks it, reads geometry/uniforms/textures and checks
invalid-input behavior. It does not create a window or capture audio.

Open a built folder/archive with `mesh_avatar_open_path`, or an in-memory archive
with `mesh_avatar_open_bytes`. Inputs are copied or consumed during the call;
the archive buffer can be released after opening. Handles are opaque `uint64_t`
tokens, with zero invalid. They can move between threads; calls on the same
handle are serialized internally. Always call `mesh_avatar_destroy` when finished.

Frame and layer descriptors contain borrowed, read-only pointers. They remain
valid until the next tick or destroy on that handle; setters leave the cached
frame intact. Texture names and straight RGBA8 pixels remain valid until destroy.
Do not free these pointers. Copy data if it must outlive a tick, and synchronize
borrowed reads against tick/destroy on other threads. Check every `MaStatus`;
`mesh_avatar_last_error` returns a thread-local message until the next API call
on that thread. A contained Rust panic requires destroying and reopening that
handle. The generated header documents pointer/count and ownership requirements.

Normal library builds do not need a header generator. To regenerate the checked-in
header, install the pinned development tool into the ignored build directory:

```sh
cargo install cbindgen --version 0.29.4 --locked --root native/target/header-tools
bash native/conformance/ffi-header.sh
bash native/conformance/ffi-header.sh --check
```

CI installs that version, verifies the header has no drift, builds both library
types, and builds/runs the C example. The C ABI is experimental and has no GPU
rendering entry point yet; use the frame data with a host renderer.

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
- The native menu bar, status-bar icon and Open Avatar dialog are macOS-only. The executable
  embeds the name “Mesh Avatar” without an app bundle; the name shown elsewhere
  by macOS can depend on how it was launched.
- Microphone capture is currently macOS-only. Camera tracking, system-audio
  capture, audio playback and lighting are not included.
- The desktop is a Cargo-built executable, without an installer, signed app
  bundle or global keyboard shortcuts.
- GPU rasterization and antialiasing can differ slightly from Chromium. Compare
  premultiplied colors when inspecting nearly transparent image edges.
