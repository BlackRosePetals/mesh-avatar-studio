mod presentation;
mod scaling;
use anyhow::{bail, ensure, Context, Result};
use mesh_avatar_core::{
    engine::{expression::OVERLAY_EXPRESSIONS, motion::SpeakOptions},
    Avatar, Frame,
};
use mesh_avatar_wgpu::{Fit, Renderer, ViewOptions};
use presentation::StraightAlpha;
use scaling::{render_size, ScaleBounds, Scaling};
use std::{
    env,
    panic::{catch_unwind, AssertUnwindSafe},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};
use winit::{
    application::ApplicationHandler,
    dpi::{LogicalSize, PhysicalPosition, PhysicalSize},
    event::{ElementState, MouseButton, WindowEvent},
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
    keyboard::{KeyCode, ModifiersState, PhysicalKey},
    window::{Window, WindowId, WindowLevel},
};

fn default_sample() -> Result<PathBuf> {
    let current = env::current_dir()?;
    let executable = env::current_exe()?;
    for start in [
        current.as_path(),
        executable.parent().unwrap_or(Path::new(".")),
    ] {
        for root in start.ancestors() {
            let sample = root.join("samples/miko-qipao");
            if root.join("native/Cargo.toml").is_file() && sample.join("rig.json").is_file() {
                return Ok(sample);
            }
        }
    }
    bail!("Default sample not found. Run from a source checkout or pass a .mavatar file or built project folder.")
}
fn base_size(view: &ViewOptions) -> LogicalSize<f64> {
    LogicalSize::new(
        400.0,
        400.0 * f64::from(view.image_size[1]) * (1.0 + view.pad_top)
            / (f64::from(view.image_size[0]) * (1.0 + 2.0 * view.pad_side)),
    )
}

/// Keep a painted source-image cutoff outside the window, including extreme poses.
struct TopEdgeGuard {
    vertices: Vec<usize>,
}
impl TopEdgeGuard {
    fn new(avatar: &Avatar, frame: &Frame) -> Self {
        let Some(base) = frame.layers.iter().find(|l| l.name == "base") else {
            return Self { vertices: vec![] };
        };
        let Some(image) = avatar.textures().get("base.png") else {
            return Self { vertices: vec![] };
        };
        let radius = avatar.package().rig.mesh.base_cell as usize + 2;
        let vertices = base
            .uvs
            .as_chunks::<2>()
            .0
            .iter()
            .enumerate()
            .filter_map(|(i, &[u, v])| {
                if v != 0.0 {
                    return None;
                }
                let x = (u * image.width as f32) as usize;
                let from = x.saturating_sub(radius);
                let to = (x + radius + 1).min(image.width as usize);
                (from..to).any(|x| image.rgba[x * 4 + 3] > 3).then_some(i)
            })
            .collect();
        Self { vertices }
    }
    fn view(&self, frame: &Frame, view: ViewOptions, size: [u32; 2]) -> ViewOptions {
        let Some(base) = frame.layers.iter().find(|l| l.name == "base") else {
            return view;
        };
        let max_y = self
            .vertices
            .iter()
            .filter_map(|&i| base.positions.get(i * 2 + 1))
            .copied()
            .map(f64::from)
            .reduce(f64::max);
        let Some(y) = max_y else {
            return view;
        };
        guarded_view(view, size, y)
    }
}
fn guarded_view(view: ViewOptions, size: [u32; 2], y: f64) -> ViewOptions {
    let Ok(transform) = view.transform(size) else {
        return view;
    };
    let current_scale = f64::from(transform[0]) * f64::from(size[0]) / 2.0;
    let height = f64::from(view.image_size[1]);
    let width = f64::from(view.image_size[0]);
    let remaining = height - y - 2.0 / current_scale;
    if remaining <= 0.0 {
        return view;
    }
    let scale = (f64::from(size[1]) / remaining).max(current_scale);
    ViewOptions {
        pad_top: f64::from(size[1]) / (height * scale) - 1.0,
        pad_side: f64::from(size[0]) / (width * scale) / 2.0 - 0.5,
        ..view
    }
}

struct Scene {
    surface: wgpu::Surface<'static>,
    window: Arc<Window>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    view_format: wgpu::TextureFormat,
    renderer: Renderer,
    straight: Option<StraightAlpha>,
    avatar: Avatar,
    view: ViewOptions,
    top_edge: TopEdgeGuard,
    last_frame: Instant,
    scaling: Scaling,
    pending_surface_size: Option<PhysicalSize<u32>>,
    redraw_requested: bool,
    gpu_failed: Arc<AtomicBool>,
    modifiers: ModifiersState,
    expression_index: usize,
    click_through: bool,
    occluded: bool,
}
impl Scene {
    async fn new(event_loop: &ActiveEventLoop, mut avatar: Avatar) -> Result<Self> {
        let rig = &avatar.package().rig;
        let view = ViewOptions {
            image_size: [rig.image.width, rig.image.height],
            pad_top: rig.view.pad_top,
            pad_side: rig.view.pad_side,
            fit: Fit::Contain,
        };
        let mut base_size = base_size(&view);
        Scaling::new(base_size)?;
        if let Some(monitor) = event_loop.primary_monitor() {
            let screen = monitor.size().to_logical::<f64>(monitor.scale_factor());
            let fit = (screen.width * 0.85 / base_size.width)
                .min(screen.height * 0.85 / base_size.height)
                .min(1.0);
            base_size.width *= fit;
            base_size.height *= fit;
        }
        let attributes = Window::default_attributes()
            .with_title("Mesh Avatar")
            .with_inner_size(base_size)
            .with_transparent(true)
            .with_decorations(false)
            .with_resizable(false)
            .with_window_level(WindowLevel::AlwaysOnTop)
            .with_visible(false);
        #[cfg(target_os = "macos")]
        let attributes = {
            use winit::platform::macos::WindowAttributesExtMacOS;
            attributes.with_has_shadow(false)
        };
        let window = Arc::new(event_loop.create_window(attributes)?);
        let instance = wgpu::Instance::new(&Default::default());
        let surface = instance.create_surface(window.clone())?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::LowPower,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await?;
        let info = adapter.get_info();
        let caps = surface.get_capabilities(&adapter);
        let alpha_mode = [
            wgpu::CompositeAlphaMode::PreMultiplied,
            wgpu::CompositeAlphaMode::PostMultiplied,
        ]
        .into_iter()
        .find(|mode| caps.alpha_modes.contains(mode))
        .context("The graphics compositor does not support transparent windows")?;
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| !f.is_srgb())
            .or_else(|| caps.formats.first().copied())
            .context("No supported surface format")?;
        let view_format = format.remove_srgb_suffix();
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("desktop avatar"),
                ..Default::default()
            })
            .await?;
        let gpu_failed = Arc::new(AtomicBool::new(false));
        let failed = gpu_failed.clone();
        device.on_uncaptured_error(Arc::new(move |error| {
            eprintln!("Desktop graphics error: {error}");
            failed.store(true, Ordering::Relaxed);
        }));
        let size = window.inner_size();
        ensure!(
            render_size(size, size, device.limits().max_texture_dimension_2d).is_some(),
            "initial window exceeds graphics device limits"
        );
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: wgpu::PresentMode::Fifo,
            desired_maximum_frame_latency: 2,
            alpha_mode,
            view_formats: if format == view_format {
                vec![]
            } else {
                vec![view_format]
            },
        };
        surface.configure(&device, &config);
        // wgpu 27's Metal backend labels transparent CAMetalLayer surfaces PostMultiplied,
        // but CoreAnimation consumes the premultiplied pixels produced by our renderer.
        let mut straight = (alpha_mode == wgpu::CompositeAlphaMode::PostMultiplied
            && info.backend != wgpu::Backend::Metal)
            .then(|| StraightAlpha::new(&device, view_format));
        if let Some(pass) = &mut straight {
            pass.resize(&device, view_format, [config.width, config.height]);
        }
        let renderer = Renderer::new(&device, &queue, view_format, 4, avatar.textures())?;
        avatar.set_auto_idle(true);
        avatar.set_auto_motion(true);
        let initial = avatar.tick(0.0);
        let top_edge = TopEdgeGuard::new(&avatar, &initial);
        if let Some(monitor) = window
            .current_monitor()
            .or_else(|| event_loop.primary_monitor())
        {
            let origin = monitor.position();
            let screen = monitor.size();
            let scale = window.scale_factor();
            window.set_outer_position(PhysicalPosition::new(
                origin.x + screen.width as i32 - size.width as i32 - (32.0 * scale) as i32,
                origin.y + screen.height as i32 - size.height as i32 - (64.0 * scale) as i32,
            ));
        }
        eprintln!(
            "Mesh Avatar: {} — {} ({:?}), {:?} transparency, {:.0}×{:.0} logical pixels at {:.1}×",
            avatar.package().manifest.name,
            info.name,
            info.backend,
            alpha_mode,
            base_size.width,
            base_size.height,
            window.scale_factor()
        );
        eprintln!("Drag to move · scroll or Cmd +/- to scale · E expression · K kana · C click-through · Esc quit");
        for (i, motion) in avatar.motions().iter().take(9).enumerate() {
            eprintln!("{}: {}", i + 1, motion.label);
        }
        window.set_visible(true);
        window.focus_window();
        window.request_redraw();
        Ok(Self {
            surface,
            window,
            device,
            queue,
            config,
            view_format,
            renderer,
            straight,
            avatar,
            view,
            top_edge,
            last_frame: Instant::now(),
            scaling: Scaling::new(base_size)?,
            pending_surface_size: None,
            redraw_requested: true,
            gpu_failed,
            modifiers: ModifiersState::empty(),
            expression_index: 0,
            click_through: false,
            occluded: false,
        })
    }
    fn resize(&mut self, size: PhysicalSize<u32>) -> Result<()> {
        if size.width == 0 || size.height == 0 {
            return Ok(());
        }
        ensure!(
            render_size(size, size, self.device.limits().max_texture_dimension_2d).is_some(),
            "window dimensions exceed graphics device limits: {}×{}",
            size.width,
            size.height
        );
        self.config.width = size.width;
        self.config.height = size.height;
        self.surface.configure(&self.device, &self.config);
        if let Some(pass) = &mut self.straight {
            pass.resize(&self.device, self.view_format, [size.width, size.height]);
        }
        self.window.request_redraw();
        Ok(())
    }
    fn scale_bounds(&self) -> ScaleBounds {
        ScaleBounds {
            dpi: self.window.scale_factor(),
            screen: self
                .window
                .current_monitor()
                .map(|m| m.size().to_logical(m.scale_factor())),
            texture_limit: self.device.limits().max_texture_dimension_2d,
        }
    }
    /// Run native resize and GPU work after input/drawRect callbacks return.
    fn service(&mut self) -> Result<()> {
        ensure!(
            !self.gpu_failed.load(Ordering::Relaxed),
            "graphics device reported an error"
        );
        if let Some(desired) = self.scaling.take_request() {
            if desired != self.window.inner_size() {
                // macOS returns None and queues Resized. Synchronous platforms may return
                // the accepted size without sending a notification; treat it identically.
                if let Some(accepted) = self.window.request_inner_size(desired) {
                    self.pending_surface_size = Some(accepted);
                }
            }
        }
        if let Some(size) = self.pending_surface_size.take() {
            // Several notifications can be queued during a trackpad input burst.
            if size == self.window.inner_size() {
                self.resize(size)?;
            }
        }
        if std::mem::take(&mut self.redraw_requested) && !self.occluded {
            self.redraw()?;
        }
        ensure!(
            !self.gpu_failed.load(Ordering::Relaxed),
            "graphics device reported an error"
        );
        if !self.occluded {
            self.window.request_redraw();
        }
        Ok(())
    }
    fn redraw(&mut self) -> Result<()> {
        let now = Instant::now();
        let dt = (now - self.last_frame).as_secs_f64().min(0.05);
        self.last_frame = now;
        let Some(size) = render_size(
            PhysicalSize::new(self.config.width, self.config.height),
            self.window.inner_size(),
            self.device.limits().max_texture_dimension_2d,
        ) else {
            return Ok(());
        };
        let surface_frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                // Reconfigure on the next service pass with no acquired texture alive.
                eprintln!("Desktop surface changed; reconfiguring before the next frame");
                self.pending_surface_size = Some(self.window.inner_size());
                return Ok(());
            }
            Err(wgpu::SurfaceError::Timeout) => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        if surface_frame.texture.width() != size[0] || surface_frame.texture.height() != size[1] {
            self.pending_surface_size = Some(self.window.inner_size());
            return Ok(());
        }
        let frame = self.avatar.tick(dt);
        let view = self.top_edge.view(&frame, self.view, size);
        let target = surface_frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor {
                format: Some(self.view_format),
                ..Default::default()
            });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        let output = match &self.straight {
            Some(pass) => pass
                .view()
                .context("surface alpha target is not configured")?,
            None => &target,
        };
        self.renderer
            .render(&mut encoder, output, size, &frame, &view)?;
        if let Some(pass) = &self.straight {
            pass.encode(&mut encoder, &target)?;
        }
        self.queue.submit([encoder.finish()]);
        self.window.pre_present_notify();
        surface_frame.present();
        Ok(())
    }
    fn key(&mut self, event_loop: &ActiveEventLoop, key: KeyCode, repeat: bool) {
        let command = if cfg!(target_os = "macos") {
            self.modifiers.super_key()
        } else {
            self.modifiers.control_key()
        };
        match key {
            KeyCode::Escape => event_loop.exit(),
            KeyCode::KeyQ if command => event_loop.exit(),
            KeyCode::Equal | KeyCode::NumpadAdd if command => {
                self.scaling.keyboard(true, self.scale_bounds())
            }
            KeyCode::Minus | KeyCode::NumpadSubtract if command => {
                self.scaling.keyboard(false, self.scale_bounds())
            }
            _ if repeat => {}
            KeyCode::KeyE => {
                self.expression_index = (self.expression_index + 1) % OVERLAY_EXPRESSIONS.len();
                let name = OVERLAY_EXPRESSIONS[self.expression_index].0;
                self.avatar.set_expression(name);
                eprintln!("Expression: {name}");
            }
            KeyCode::KeyK => self.avatar.speak_kana(
                "こんにちは。きょうも、いっしょにあいうえおをれんしゅうしましょう。",
                SpeakOptions::default(),
            ),
            KeyCode::KeyC => match self.window.set_cursor_hittest(self.click_through) {
                Ok(()) => {
                    self.click_through = !self.click_through;
                    eprintln!("Click-through {}. Focus Mesh Avatar with the Dock or app switcher, then press C to turn it off.",if self.click_through {"on"} else {"off"});
                }
                Err(error) => eprintln!("Could not change click-through: {error}"),
            },
            KeyCode::Digit1
            | KeyCode::Digit2
            | KeyCode::Digit3
            | KeyCode::Digit4
            | KeyCode::Digit5
            | KeyCode::Digit6
            | KeyCode::Digit7
            | KeyCode::Digit8
            | KeyCode::Digit9 => {
                let index = match key {
                    KeyCode::Digit1 => 0,
                    KeyCode::Digit2 => 1,
                    KeyCode::Digit3 => 2,
                    KeyCode::Digit4 => 3,
                    KeyCode::Digit5 => 4,
                    KeyCode::Digit6 => 5,
                    KeyCode::Digit7 => 6,
                    KeyCode::Digit8 => 7,
                    _ => 8,
                };
                if let Some(motion) = self.avatar.motions().get(index) {
                    self.avatar.play(&motion.id);
                }
            }
            _ => {}
        }
    }
}

struct App {
    avatar: Option<Avatar>,
    scene: Option<Scene>,
    error: Option<anyhow::Error>,
}
impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if let Some(scene) = &mut self.scene {
            scene.last_frame = Instant::now();
            scene.occluded = false;
            scene.pending_surface_size = Some(scene.window.inner_size());
            return;
        }
        if let Some(avatar) = self.avatar.take() {
            match pollster::block_on(Scene::new(event_loop, avatar)) {
                Ok(scene) => self.scene = Some(scene),
                Err(error) => {
                    self.error = Some(error);
                    event_loop.exit();
                }
            }
        }
    }
    fn window_event(&mut self, event_loop: &ActiveEventLoop, id: WindowId, event: WindowEvent) {
        let Some(scene) = &mut self.scene else {
            return;
        };
        if scene.window.id() != id {
            return;
        }
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => scene.pending_surface_size = Some(size),
            WindowEvent::ScaleFactorChanged { .. } => scene.scaling.refresh(scene.scale_bounds()),
            WindowEvent::Occluded(value) => {
                scene.occluded = value;
                scene.last_frame = Instant::now();
            }
            WindowEvent::Focused(false) => scene.modifiers = ModifiersState::empty(),
            WindowEvent::ModifiersChanged(value) => scene.modifiers = value.state(),
            WindowEvent::KeyboardInput { event, .. } if event.state == ElementState::Pressed => {
                if let PhysicalKey::Code(key) = event.physical_key {
                    scene.key(event_loop, key, event.repeat);
                }
            }
            WindowEvent::MouseInput {
                state: ElementState::Pressed,
                button: MouseButton::Left,
                ..
            } => {
                if let Err(error) = scene.window.drag_window() {
                    eprintln!("Could not move window: {error}");
                }
            }
            WindowEvent::MouseWheel { delta, .. } => {
                scene.scaling.scroll(delta, scene.scale_bounds());
            }
            WindowEvent::RedrawRequested => scene.redraw_requested = true,
            _ => {}
        }
    }
    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if let Some(scene) = &mut self.scene {
            // Contain unexpected backend panics before they cross an AppKit C ABI boundary.
            let result =
                catch_unwind(AssertUnwindSafe(|| scene.service())).unwrap_or_else(|payload| {
                    let message = payload
                        .downcast_ref::<String>()
                        .map(String::as_str)
                        .or_else(|| payload.downcast_ref::<&str>().copied())
                        .unwrap_or("unknown graphics backend panic");
                    Err(anyhow::anyhow!("desktop update failed: {message}"))
                });
            if let Err(error) = result {
                eprintln!("Desktop update stopped: {error:#}");
                self.error = Some(error);
                event_loop.exit();
            }
        }
    }
}
fn run() -> Result<()> {
    let mut args = env::args_os().skip(1);
    let path = match args.next() {
        Some(value) if value == "--help" || value == "-h" => {
            println!("Usage: mesh-avatar-desktop [avatar.mavatar | project-folder]\nDefault: samples/miko-qipao in the source checkout.\nDrag to move; scroll/Cmd +/- to scale; 1–9 motions; E expressions; K kana; C click-through; Esc/Cmd+Q quit.");
            return Ok(());
        }
        Some(value) => PathBuf::from(value),
        None => default_sample()?,
    };
    ensure!(args.next().is_none(), "expected at most one avatar path");
    let avatar = Avatar::open(path)
        .context("Could not load avatar; a built project needs rig.json and built/ PNG assets")?;
    let mut builder = EventLoop::builder();
    #[cfg(target_os = "macos")]
    {
        use winit::platform::macos::{ActivationPolicy, EventLoopBuilderExtMacOS};
        builder.with_activation_policy(ActivationPolicy::Regular);
    }
    let event_loop = builder.build()?;
    event_loop.set_control_flow(ControlFlow::Wait);
    let mut app = App {
        avatar: Some(avatar),
        scene: None,
        error: None,
    };
    event_loop.run_app(&mut app)?;
    if let Some(error) = app.error {
        return Err(error);
    }
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("mesh-avatar-desktop: {error:#}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_aspect_preserves_top_crop_at_both_pixel_ratios() {
        let view = ViewOptions {
            image_size: [1254, 1254],
            pad_top: -0.07,
            pad_side: 0.0,
            fit: Fit::Contain,
        };
        let size = base_size(&view);
        assert!((size.height - 372.0).abs() < 1e-8);
        for dpr in [1.0, 2.0] {
            let physical: PhysicalSize<u32> = size.to_physical(dpr);
            let t = view.transform([physical.width, physical.height]).unwrap();
            let top = f64::from(physical.height) * (1.0 - f64::from(t[3])) / 2.0;
            assert!(top < -27.9 * dpr);
        }
        let adjusted = guarded_view(view, [400, 372], 120.0);
        let transform = adjusted.transform([400, 372]).unwrap();
        let scale = f64::from(transform[0]) * 400.0 / 2.0;
        let offset = 372.0 * (1.0 - f64::from(transform[3])) / 2.0;
        assert!(120.0 * scale + offset < -1.99);
        assert!((1254.0 * scale + offset - 372.0).abs() < 1e-3);
    }
}
