# Native mesh avatars

[English](README.md) · [日本語](README.ja.md)

> **实验性功能。** 原生运行时仍在开发中，尚未作为软件包发布。
> API、操作方式和文件保存位置可能会在不另行通知的情况下变更。参考实现仍是 `packages/runtime` 中的 JavaScript 运行时。

Rust 运行时可以加载与 JavaScript 运行时相同的 `.mavatar` 文件和已构建的项目文件夹。
其中包含一个透明的桌面虚拟形象程序和一个 PNG 渲染器。桌面端的主要目标平台是使用 Metal 的 macOS。

## 准备工作

- Rust 1.88 或更高版本，以及 Cargo。
- 在 macOS 上需要 Xcode Command Line Tools 和支持 Metal 的 GPU。
- 一个虚拟形象归档文件，或包含 `rig.json`、`built/layers.json` 和已构建 PNG 资源的项目。
  仅有插画本身无法作为虚拟形象运行。

以下命令均在仓库根目录执行。默认虚拟形象为 `samples/miko-qipao`，需要先安装其图片。
该示例适用[素材使用条款](../samples/miko-qipao/MIKO_ASSET_TERMS.md)。

## 桌面程序

```sh
cargo build --release --manifest-path native/Cargo.toml -p mesh-avatar-desktop
native/target/release/mesh-avatar-desktop
```

打开其他虚拟形象：

```sh
native/target/release/mesh-avatar-desktop /path/to/avatar.mavatar
native/target/release/mesh-avatar-desktop /path/to/project
```

不带参数时，程序会根据当前源码检出位置或可执行文件位置查找示例。
如果把可执行文件复制到其他位置，需要显式指定虚拟形象路径。

在 macOS 上，窗口透明、无边框、显示在普通窗口之上，并且没有阴影。
初始宽度为 400 逻辑像素，高度由虚拟形象的图像和视图边距决定。内置示例的初始尺寸约为 400 × 372，图像顶部平直的裁切边位于窗口之外。
动作幅度较大时，裁切位置可能会稍微收紧，以免露出这条边。缩放时保持窗口的宽高比。
滚轮和键盘缩放的范围为 40%–400%，并会进一步受显示器尺寸和 GPU 纹理上限限制。
连续的输入会先合并再调整窗口大小；渲染会等到绘制表面与窗口尺寸一致后再进行。

在 macOS 上，**File → Open Avatar…** 会打开系统对话框，可选择 `.mavatar` 归档文件，或包含 `rig.json` 和 `built/` 的项目文件夹。
也可以把它们直接拖放到虚拟形象窗口上。加载在后台进行；如果虚拟形象无效，会继续显示当前虚拟形象并提示错误。
切换成功后，程序会重建 GPU 资源和视图，在新尺寸限制内恢复保存的位置和缩放比例，保持点击穿透状态，并在终端输出新的动作列表。

**File → Open Recent** 会保留最近 8 个成功打开的路径，保存在操作系统用户配置目录（macOS 上为 `~/Library/Application Support/`）下的 `mesh-avatar-desktop/recent.json`。
已不存在的路径会在启动时以及程序重新获得焦点时被移除。**File → Reload** 用于在编辑后重新加载当前虚拟形象。
加载新的虚拟形象时，表情和动画状态会被重置。

窗口左上角位置（逻辑坐标）和缩放比例会按虚拟形象路径保存在同一配置目录的 `mesh-avatar-desktop/settings.json` 中。
启动和切换虚拟形象时会恢复对应设置；如果该虚拟形象尚无设置，则使用最近的窗口位置和缩放比例。
恢复时会将窗口限制在当前连接的显示器内，即使原来的显示器已经断开；在 macOS 上会避开 Dock 和菜单栏。
移动或缩放停止0.5秒后，以及正常退出时会保存设置。设置文件缺失或损坏时使用默认位置。

在 macOS 上，**Avatar → Motion** 按名称列出所有动作，**Avatar → Expression** 用于选择实时表情。
切换虚拟形象后会重建这些菜单；以下键盘操作仍然有效。

| 操作 | 作用 |
|---|---|
| Command + `O` | 打开虚拟形象归档文件或已构建的项目文件夹（macOS） |
| Command + `R` | 重新加载当前虚拟形象 |
| 拖放 `.mavatar` 或项目文件夹 | 在同一窗口中切换虚拟形象 |
| 左键拖动 | 移动虚拟形象窗口 |
| 滚轮 | 缩放窗口 |
| Command + `+` / `-` | 缩放窗口 |
| `1`–`9` | 播放前 9 个内置动作（列表输出在终端） |
| `E` | 依次切换实时表情 |
| `K` | 播放假名口型演示（不播放声音） |
| `C` | 切换鼠标点击穿透（启动时为关闭） |
| Escape 或 Command + `Q` | 退出 |

以上操作在虚拟形象程序拥有键盘焦点时有效。开启点击穿透后，鼠标事件会传给下方的窗口。
要关闭点击穿透，请通过 Dock 或 Command-Tab 让虚拟形象程序重新获得焦点，然后按 `C`。该按键不是全局快捷键。
如果无法恢复焦点，请从 Dock 退出后重新启动；点击穿透在启动时总是关闭的。

待机动作、眨眼、呼吸和不定时的动作会自动播放。
渲染频率跟随显示器的刷新节奏。窗口尺寸或显示器缩放比例变化时会更新实际渲染尺寸；在卡顿或从睡眠恢复后，动画的时间步长上限为 0.05 秒。

## 渲染 PNG

```sh
cargo run --release --manifest-path native/Cargo.toml -p mesh-avatar-wgpu \
  --bin mesh-avatar-render -- samples/miko-qipao --size 512x640 -o avatar.png
```

通过 `--pose` 传入类似 `{"angleX":20,"mouthOpen":0.8}` 的 JSON 对象。
未指定的姿势参数使用默认值。`--seconds` 会在渲染前以每秒 60 步推进虚拟形象的时间。
`--help` 会列出视图边距、fit、表情和多重采样等选项。

## 检查与画面对比

只有在与 JavaScript 运行时对比时，才需要 Node.js 22.17 或更高版本以及仓库的 npm 依赖：

```sh
node --experimental-strip-types native/conformance/dump.mjs
cargo test --manifest-path native/Cargo.toml
cargo clippy --manifest-path native/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path native/Cargo.toml --all --check
node native/conformance/compare-pixels.mjs
```

dump 会检查嵌入的动作数据是否与 JavaScript 源码一致。
如需有意更新，请运行 `node --experimental-strip-types native/conformance/sync-motion-data.mjs`。
数值对比数据、PNG 和报告会输出到被 git 忽略的 `native/target/`。缺少生成数据时，对比测试会输出跳过提示。
像素对比使用 Playwright 安装的 Chromium；在 macOS 上，`--metal` 选择其 Metal 后端，`--dpr=2` 在 HiDPI 下以相同物理尺寸进行对比。

## 限制

- 尚未验证 Windows 和 Linux 上的桌面行为。窗口透明、置顶和鼠标点击穿透取决于操作系统的合成器。
  如果无法使用透明绘制表面，程序会退出。
- 原生菜单栏和 Open Avatar 对话框仅支持 macOS。可执行文件在没有应用包的情况下嵌入了名称“Mesh Avatar”；
  macOS 在其他位置显示的名称可能取决于启动方式。
- 桌面端的输入仅限上述操作。不包含摄像头追踪、麦克风输入、音频播放和光照。
- 桌面程序是用 Cargo 构建的可执行文件，没有安装程序、已签名的应用包或全局快捷键。
- GPU 光栅化和抗锯齿可能与 Chromium 略有差异。检查接近透明的图像边缘时，请比较预乘后的颜色。
