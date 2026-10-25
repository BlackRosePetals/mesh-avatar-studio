//! Native macOS menus and dialogs. All AppKit entry points stay on the main thread.
use crate::UserEvent;
use anyhow::Result;
use std::path::{Path, PathBuf};
use winit::{event_loop::EventLoopProxy, window::Window};

pub enum Command {
    Open,
    Recent(PathBuf),
    Reload,
    Quit,
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use muda::{
        accelerator::{Accelerator, Code, Modifiers},
        Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu,
    };

    // Supply the unbundled executable's application name without creating an .app.
    const INFO: &[u8] = include_bytes!("app-info.plist");
    #[used]
    #[link_section = "__TEXT,__info_plist"]
    static APP_INFO: [u8; INFO.len()] = *include_bytes!("app-info.plist");

    pub struct AppMenu {
        _root: Menu,
        recent: Submenu,
        entries: Vec<(MenuItem, PathBuf)>,
    }
    impl AppMenu {
        pub fn install(proxy: EventLoopProxy<UserEvent>, paths: &[PathBuf]) -> Result<Self> {
            let root = Menu::new();
            let app = Submenu::new("Mesh Avatar", true);
            let quit = MenuItem::with_id(
                "quit",
                "Quit Mesh Avatar",
                true,
                Some(Accelerator::new(Some(Modifiers::SUPER), Code::KeyQ)),
            );
            app.append_items(&[
                &PredefinedMenuItem::hide(Some("Hide Mesh Avatar")),
                &PredefinedMenuItem::hide_others(None),
                &PredefinedMenuItem::show_all(None),
                &PredefinedMenuItem::separator(),
                &quit,
            ])?;
            let file = Submenu::new("File", true);
            let open = MenuItem::with_id(
                "open",
                "Open Avatar…",
                true,
                Some(Accelerator::new(Some(Modifiers::SUPER), Code::KeyO)),
            );
            let recent = Submenu::new("Open Recent", true);
            let reload = MenuItem::with_id(
                "reload",
                "Reload",
                true,
                Some(Accelerator::new(Some(Modifiers::SUPER), Code::KeyR)),
            );
            file.append_items(&[&open, &recent, &PredefinedMenuItem::separator(), &reload])?;
            let edit = Submenu::with_items(
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(None),
                    &PredefinedMenuItem::redo(None),
                    &PredefinedMenuItem::separator(),
                    &PredefinedMenuItem::cut(None),
                    &PredefinedMenuItem::copy(None),
                    &PredefinedMenuItem::paste(None),
                    &PredefinedMenuItem::select_all(None),
                ],
            )?;
            root.append_items(&[&app, &file, &edit])?;
            let mut menu = Self {
                _root: root,
                recent,
                entries: Vec::new(),
            };
            menu.set_recent(paths)?;
            MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
                let _ = proxy.send_event(UserEvent::Menu(event.id.0));
            }));
            menu._root.init_for_nsapp();
            Ok(menu)
        }
        pub fn set_recent(&mut self, paths: &[PathBuf]) -> Result<()> {
            if !paths.is_empty() && paths.iter().eq(self.entries.iter().map(|(_, path)| path)) {
                return Ok(());
            }
            while self.recent.remove_at(0).is_some() {}
            self.entries.clear();
            for path in paths {
                // Escape muda's mnemonic marker in real filenames.
                let label = path.to_string_lossy().replace('&', "&&");
                let item = MenuItem::new(label, true, None);
                self.recent.append(&item)?;
                self.entries.push((item, path.clone()));
            }
            if paths.is_empty() {
                self.recent
                    .append(&MenuItem::new("No Recent Avatars", false, None))?;
            }
            Ok(())
        }
        pub fn command(&self, id: &str) -> Option<Command> {
            match id {
                "open" => Some(Command::Open),
                "reload" => Some(Command::Reload),
                "quit" => Some(Command::Quit),
                _ => self
                    .entries
                    .iter()
                    .find(|(item, _)| item.id().as_ref() == id)
                    .map(|(_, path)| Command::Recent(path.clone())),
            }
        }
    }

    pub fn open(
        proxy: EventLoopProxy<UserEvent>,
        window: &Window,
        directory: Option<&Path>,
    ) -> Result<()> {
        let mut dialog = rfd::AsyncFileDialog::new()
            .set_title("Open Avatar")
            .add_filter("Mesh Avatar", &["mavatar"])
            .set_can_create_directories(false)
            .set_parent(window);
        if let Some(directory) = directory {
            dialog = dialog.set_directory(directory);
        }
        // Construct on the main thread; the sheet runs asynchronously on AppKit.
        let selected = dialog.pick_file_or_folder();
        std::thread::Builder::new()
            .name("avatar file dialog".into())
            .spawn(move || {
                let path = pollster::block_on(selected).map(|file| file.path().to_path_buf());
                let _ = proxy.send_event(UserEvent::Picked(path));
            })?;
        Ok(())
    }
    pub fn alert(proxy: EventLoopProxy<UserEvent>, window: &Window, message: &str) -> Result<()> {
        let alert = rfd::AsyncMessageDialog::new()
            .set_parent(window)
            .set_title("Could Not Open Avatar")
            .set_description(message)
            .set_level(rfd::MessageLevel::Error)
            .show();
        std::thread::Builder::new()
            .name("avatar error dialog".into())
            .spawn(move || {
                pollster::block_on(alert);
                let _ = proxy.send_event(UserEvent::AlertClosed);
            })?;
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;
    pub struct AppMenu;
    impl AppMenu {
        pub fn install(_: EventLoopProxy<UserEvent>, _: &[PathBuf]) -> Result<Self> {
            Ok(Self)
        }
        pub fn set_recent(&mut self, _: &[PathBuf]) -> Result<()> {
            Ok(())
        }
        pub fn command(&self, _: &str) -> Option<Command> {
            None
        }
    }
    pub fn open(_: EventLoopProxy<UserEvent>, _: &Window, _: Option<&Path>) -> Result<()> {
        anyhow::bail!("the native Open Avatar dialog is currently available only on macOS")
    }
    pub fn alert(proxy: EventLoopProxy<UserEvent>, _: &Window, _: &str) -> Result<()> {
        let _ = proxy.send_event(UserEvent::AlertClosed);
        Ok(())
    }
}
pub use platform::*;
