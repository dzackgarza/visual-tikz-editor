use std::fs::{self, File};
use std::os::fd::AsRawFd;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{process::CommandChild, process::CommandEvent, ShellExt};
use webkit2gtk::WebViewExt;

struct Host(Mutex<Option<CommandChild>>);

/// The launch logs kept in the log directory, newest first (FR-066).
const KEPT_LOGS: usize = 10;

/// Sends stdout and stderr to a new log in `$XDG_STATE_HOME/visual-tikz-editor/logs/` and
/// deletes all but the newest logs. The file host's output passes through these streams,
/// and WebKit's processes inherit them, so the log holds every process of the app (FR-066).
/// A launcher sends the streams to /dev/null; the log path goes to them first.
fn open_launch_log() {
    let state_home = match std::env::var_os("XDG_STATE_HOME").filter(|value| !value.is_empty()) {
        Some(value) => PathBuf::from(value),
        None => PathBuf::from(std::env::var_os("HOME").expect("HOME is not set")).join(".local/state"),
    };
    assert!(state_home.is_absolute(), "XDG_STATE_HOME must be an absolute path");
    let directory = state_home.join("visual-tikz-editor").join("logs");
    fs::create_dir_all(&directory).expect("could not create the log directory");
    let started = SystemTime::now().duration_since(UNIX_EPOCH).expect("clock before 1970").as_secs();
    // Names begin with the launch time in seconds, so their order is the launch order.
    let path = directory.join(format!("{started}-{}.log", std::process::id()));
    let log = File::options().create_new(true).append(true).open(&path).expect("could not create the launch log");
    eprintln!("Visual TikZ Editor log: {}", path.display());
    for stream in [libc::STDOUT_FILENO, libc::STDERR_FILENO] {
        // SAFETY: both descriptors are open; dup2 replaces `stream` with a copy of the log's.
        assert_ne!(unsafe { libc::dup2(log.as_raw_fd(), stream) }, -1, "could not redirect output to the log");
    }
    eprintln!(
        "Visual TikZ Editor {} started at {started} (Unix time) with {:?}",
        env!("CARGO_PKG_VERSION"),
        std::env::args().skip(1).collect::<Vec<_>>()
    );
    let mut logs: Vec<PathBuf> = fs::read_dir(&directory)
        .expect("could not read the log directory")
        .map(|entry| entry.expect("could not read the log directory").path())
        .filter(|entry| entry.extension().is_some_and(|extension| extension == "log"))
        .collect();
    logs.sort();
    for old in &logs[..logs.len().saturating_sub(KEPT_LOGS)] {
        fs::remove_file(old).expect("could not delete an old launch log");
    }
}

fn main() {
    open_launch_log();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let assets = app.path().resource_dir()?;
            // The file host owns the command line: a diagram file and the launch options.
            let (mut events, child) = app
                .shell()
                .sidecar("workbench-host")?
                .env("TIKZ_WORKBENCH_ASSETS", assets)
                // The shell holds the write end of the host's standard input (CommandChild). The kernel
                // closes it when the shell ends for any cause, and the host stops at that end of input.
                .env("TIKZ_WORKBENCH_STOP_AT_STDIN_END", "1")
                .args(std::env::args().skip(1))
                .spawn()?;
            app.manage(Host(Mutex::new(Some(child))));
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            let line = String::from_utf8_lossy(&bytes);
                            print!("{line}");
                            if let Some(url) = line.trim().strip_prefix("TikZ workbench: ") {
                                let url = url.parse().expect("invalid workbench URL");
                                let window = WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(url))
                                    .title("Visual TikZ Editor")
                                    .on_document_title_changed(|window, title| {
                                        window.set_title(&title).expect("could not set the window title");
                                    })
                                    .inner_size(1280.0, 800.0)
                                    .build()
                                    .expect("could not open workbench window");
                                // WebKit names why the web process ended: a crash, the memory limit, or a request.
                                // https://webkitgtk.org/reference/webkit2gtk/stable/signal.WebView.web-process-terminated.html
                                window
                                    .with_webview(|webview| {
                                        webview.inner().connect_web_process_terminated(|_, reason| {
                                            eprintln!("WebKit web process terminated: {reason:?}");
                                        });
                                    })
                                    .expect("could not watch the web process");
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
