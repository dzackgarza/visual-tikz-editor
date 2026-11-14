use std::fs::{self, File};
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{http, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent, TerminatedPayload};
use tauri_plugin_shell::ShellExt;
use webkit2gtk::WebViewExt;

struct Host(Mutex<Option<CommandChild>>);

/// The scheme of the page that the shell serves itself (`start-failure://localhost/`). The file
/// host serves every other page, and this page shows when the file host has stopped.
const START_FAILURE_SCHEME: &str = "start-failure";

/// The page at `START_FAILURE_SCHEME`, set when the file host stops before the window opens.
static START_FAILURE_PAGE: OnceLock<String> = OnceLock::new();

/// The page that the window shows when the file host stops before it gives the address of the
/// workbench: what the host wrote to stderr, how it ended, and the log of this start. It has the
/// structure and the style of the file host's own page for a file that it cannot read
/// (standalone/start-failure.ts).
fn start_failure_page(output: &str, status: &TerminatedPayload, log: &Path) -> String {
    let ended = match status {
        TerminatedPayload { code: Some(code), .. } => format!("The application's file host ended with exit code {code}."),
        TerminatedPayload { signal: Some(signal), .. } => format!("Signal {signal} ended the application's file host."),
        _ => panic!("the file host ended with neither an exit code nor a signal"),
    };
    let reason = match output.trim_end() {
        "" => "The file host wrote no message.",
        message => message,
    };
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Visual TikZ Editor cannot start</title>
  <style>{style}</style>
</head>
<body>
  <main>
    <h1>Visual TikZ Editor cannot start</h1>
    <p class="lead">The application stopped before it opened its window.</p>
    <dl role="alert">
      <dt>Reason</dt>
      <dd><pre>{reason}</pre></dd>
      <dt>Exit status</dt>
      <dd>{ended}</dd>
      <dt>Log of this start</dt>
      <dd><code>{log}</code></dd>
    </dl>
    <p>Correct the cause that the reason gives. Then start the application again.</p>
  </main>
</body>
</html>
"#,
        style = include_str!("../../standalone/start-failure.css"),
        reason = html_escape::encode_text(reason),
        log = html_escape::encode_text(&log.to_string_lossy()),
    )
}

/// The launch logs kept in the log directory, newest first (FR-066).
const KEPT_LOGS: usize = 10;

/// Sends stdout and stderr to a new log in `$XDG_STATE_HOME/visual-tikz-editor/logs/` and
/// deletes all but the newest logs. The file host's output passes through these streams,
/// and WebKit's processes inherit them, so the log holds every process of the app (FR-066).
/// A launcher sends the streams to /dev/null; the log path goes to them first. Returns the log's path.
fn open_launch_log() -> PathBuf {
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
    path
}

fn main() {
    let log = open_launch_log();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .register_uri_scheme_protocol(START_FAILURE_SCHEME, |_context, _request| {
            let page = START_FAILURE_PAGE.get().expect("the start-failure page is not set");
            http::Response::builder()
                .header(http::header::CONTENT_TYPE, "text/html; charset=utf-8")
                .body(page.as_bytes())
                .expect("could not make the start-failure response")
        })
        .setup(move |app| {
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
                let mut window_open = false;
                // What the host writes to stderr before the window opens: the reason, if the host stops there.
                let mut reason = String::new();
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
                                window_open = true;
                            }
                        }
                        CommandEvent::Stderr(bytes) => {
                            let text = String::from_utf8_lossy(&bytes);
                            eprint!("{text}");
                            if !window_open {
                                reason.push_str(&text);
                            }
                        }
                        CommandEvent::Error(error) => eprintln!("Workbench host: {error}"),
                        CommandEvent::Terminated(status) => {
                            eprintln!("Workbench host stopped: {status:?}");
                            if window_open {
                                handle.exit(1);
                                continue;
                            }
                            // The plugin sends this event after all of the host's output, so the reason is complete.
                            START_FAILURE_PAGE
                                .set(start_failure_page(&reason, &status, &log))
                                .expect("the file host stopped twice");
                            let url = format!("{START_FAILURE_SCHEME}://localhost/").parse().expect("invalid start-failure URL");
                            WebviewWindowBuilder::new(&handle, START_FAILURE_SCHEME, WebviewUrl::CustomProtocol(url))
                                .title("Visual TikZ Editor")
                                .inner_size(760.0, 560.0)
                                .build()
                                .expect("could not open the start-failure window");
                        }
                        _ => {}
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("could not start Visual TikZ Editor")
        .run(|app, event| match event {
            // The close of the last window asks for an exit with no code. A start that failed ends with code 1.
            RunEvent::ExitRequested { code: None, api, .. } if START_FAILURE_PAGE.get().is_some() => {
                api.prevent_exit();
                app.exit(1);
            }
            RunEvent::Exit => {
                if let Some(host) = app.try_state::<Host>() {
                    if let Some(child) = host.0.lock().expect("host lock poisoned").take() {
                        child.kill().expect("could not stop workbench host");
                    }
                }
            }
            _ => {}
        });
}
