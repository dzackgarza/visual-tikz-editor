use std::sync::Mutex;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{process::CommandChild, process::CommandEvent, ShellExt};

struct Host(Mutex<Option<CommandChild>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let assets = app.path().resource_dir()?;
            let file = std::env::args().nth(1);
            let mut command = app
                .shell()
                .sidecar("workbench-host")?
                .env("TIKZ_WORKBENCH_ASSETS", assets);
            if let Some(file) = file {
                command = command.args([file]);
            }
            let (mut events, child) = command.spawn()?;
            app.manage(Host(Mutex::new(Some(child))));
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            let line = String::from_utf8_lossy(&bytes);
                            if let Some(url) = line.trim().strip_prefix("TikZ workbench: ") {
                                let url = url.parse().expect("invalid workbench URL");
                                WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(url))
                                    .title("Visual TikZ Editor")
                                    .inner_size(1280.0, 800.0)
                                    .build()
                                    .expect("could not open workbench window");
                            }
                        }
                        CommandEvent::Stderr(bytes) => eprint!("{}", String::from_utf8_lossy(&bytes)),
                        CommandEvent::Error(error) => eprintln!("Workbench host: {error}"),
                        CommandEvent::Terminated(status) => {
                            eprintln!("Workbench host stopped: {status:?}");
                            handle.exit(1);
                        }
                        _ => {}
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("could not start Visual TikZ Editor")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(host) = app.try_state::<Host>() {
                    if let Some(child) = host.0.lock().expect("host lock poisoned").take() {
                        child.kill().expect("could not stop workbench host");
                    }
                }
            }
        });
}
