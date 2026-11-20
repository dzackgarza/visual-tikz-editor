// Zettlr host bridge for the vendored Quiver fork. This file deliberately
// contains no diagram-editing implementation: Quiver owns that. It only maps
// parent-window messages to Quiver's public import/export/macro/theme surfaces.

window.__ZETTLR_QUIVER_HOST__ = true;

const [{ DOM }, { UI, load_katex }, { CONSTANTS }, { clamp }] = await Promise.all([
    import("./dom.mjs"),
    import("./ui.mjs"),
    import("./arrow.mjs"),
    import("./ds.mjs"),
]);

await load_katex();

const body = new DOM.Element(document.body);
const ui = new UI(body);
ui.initialise();

// This fork is an editor embedded in a Markdown authoring environment, not
// Quiver's web publication surface. Force the output settings needed to keep
// the source as one raw tikzcd environment owned by the document.
ui.settings.set("quiver.renderer", "katex");
ui.settings.set("quiver.autosave", false);
ui.settings.set("export.centre_diagram", false);
ui.settings.set("export.standalone", false);

const host_origin = new URL(document.referrer).origin;
let session_id = null;
let revision = 0;
let current_source = "";
// The bytes Quiver last imported, and Quiver's own export of that diagram.
let loaded_source = "";
let loaded_export = null;
let source_dirty = false;
let suppress_change = false;
let emit_timer = null;
let fullscreen = false;
// A menu of the host is open. The next press here closes it.
let host_popover_open = false;
// The stage of a press on the diagram that closed a menu of the host: "down" until its release,
// "released" until its click, and null when no such press is in progress.
let closing_press = null;

function post(message) {
    window.parent.postMessage({ sessionId: session_id, revision, ...message }, host_origin);
}

function diagnostic_text(message) {
    if (!Array.isArray(message)) {
        return String(message ?? "");
    }
    return message.map((part) => {
        if (typeof part === "string") {
            return part;
        }
        return part?.element?.textContent ?? String(part ?? "");
    }).join("");
}

function serialise_diagnostics(diagnostics) {
    return diagnostics.map((diagnostic) => ({
        severity: diagnostic.constructor?.name?.includes("Warning") ? "warning" : "error",
        message: diagnostic_text(diagnostic.message),
        from: diagnostic.range?.start ?? 0,
        to: (diagnostic.range?.start ?? 0) + (diagnostic.range?.length ?? 0),
    }));
}

function strip_quiver_link(source) {
    // Quiver intentionally embeds a round-trip URL as the first comment of a
    // normal export. Zettlr persists the actual diagram state in the document,
    // so that web-share URL is redundant and would churn on every edit. In the
    // vendored iframe Quiver quite correctly uses its *current* URL as the
    // round-trip base (dev-server http://…/zettlr-host.html or packaged
    // file://…/zettlr-host.html), not q.uiver.app. Identify the generated line
    // by its encoded `q=` fragment rather than by a hosted-domain assumption.
    return source.replace(/^%\s+[^\n]*#[^\n]*q=[^\n]*\n/u, "");
}

function export_source() {
    const { data } = ui.quiver.export(
        "tikz-cd",
        ui.settings,
        ui.options(),
        ui.definitions(),
    );
    return strip_quiver_link(data).trim();
}

function load_source(source, macros, theme) {
    if (emit_timer !== null) clearTimeout(emit_timer);
    emit_timer = null;
    current_source = source;
    loaded_source = source;
    loaded_export = null;
    source_dirty = false;
    suppress_change = true;
    try {
        ui.reset();
        ui.settings.set("quiver.renderer", "katex");
        ui.settings.set("quiver.autosave", false);
        ui.settings.set("export.centre_diagram", false);
        ui.settings.set("export.standalone", false);
        const host_macros = macros !== null && typeof macros === "object" ? macros : {};
        ui.macro_text = null;
        ui.load_host_macros(host_macros);
        if (theme === "dark" || theme === "light") {
            ui.switch_theme(theme);
        }
        const { diagnostics } = ui.quiver.import(ui, "tikz-cd", source, ui.settings);
        loaded_export = export_source();
        post({
            type: "zettlr-quiver:loaded",
            diagnostics: serialise_diagnostics(diagnostics),
        });
    } catch (error) {
        post({
            type: "zettlr-quiver:error",
            message: error instanceof Error ? error.message : String(error),
        });
    } finally {
        suppress_change = false;
    }
}

function read_source() {
    if (source_dirty) {
        // A history step back to the imported diagram returns the document's own
        // bytes, not Quiver's rewrite of them.
        const exported = export_source();
        current_source = exported === loaded_export ? loaded_source : exported;
        source_dirty = false;
    }
    return current_source;
}

// One Quiver history event is one step of the host's document history: the
// edits that Quiver collapses into one event, such as a label typed letter by
// letter, post the same step.
const history_steps = new WeakMap();
let next_history_step = 0;
let pending_step = 0;

window.addEventListener("zettlr-quiver-change", (event) => {
    if (suppress_change) {
        return;
    }
    if (!(event.detail instanceof Object)) {
        throw new Error("Quiver changed the diagram outside its history");
    }
    if (!history_steps.has(event.detail)) history_steps.set(event.detail, ++next_history_step);
    pending_step = history_steps.get(event.detail);
    source_dirty = true;
    if (emit_timer !== null) {
        clearTimeout(emit_timer);
    }
    // Label edits are deliberately collapsed by Quiver's History. A tiny
    // debounce mirrors that semantic boundary and avoids rewriting the
    // Markdown document on every internal render step.
    emit_timer = setTimeout(emit_change, 40);
});

// Only `zettlr-quiver:change` carries an edit to the host, with its step.
function emit_change() {
    emit_timer = null;
    try {
        post({ type: "zettlr-quiver:change", source: read_source(), step: pending_step });
    } catch (error) {
        post({
            type: "zettlr-quiver:error",
            message: error instanceof Error ? error.message : String(error),
        });
    }
}

window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== host_origin || event.data === null || typeof event.data !== "object") {
        return;
    }
    const message = event.data;
    if (message.action === "source") {
        if (typeof message.sessionId !== "string" || !Number.isSafeInteger(message.revision) ||
            typeof message.requestId !== "string") return;
        const identity = { event: "reply", action: "source", sessionId: message.sessionId,
            revision: message.revision, requestId: message.requestId };
        if (message.sessionId !== session_id || message.revision !== revision) {
            post({ ...identity, status: "failed", error: "stale-target" });
            return;
        }
        // The host reads the source only after the edit not yet posted.
        if (emit_timer !== null) {
            clearTimeout(emit_timer);
            emit_change();
        }
        try {
            post({ ...identity, status: "ok", source: read_source() });
        } catch {
            post({ ...identity, status: "failed", error: "edit-rejected" });
        }
        return;
    }
    if (typeof message.sessionId !== "string" || !Number.isSafeInteger(message.revision)) return;
    if (message.type === "zettlr-quiver:load" || message.type === "zettlr-quiver:source") {
        if (typeof message.source !== "string" || message.revision <= 0) return;
        if (message.sessionId === session_id && message.revision <= revision) return;
        if (message.type === "zettlr-quiver:source" && message.sessionId !== session_id) return;
        session_id = message.sessionId;
        revision = message.revision;
        load_source(message.source, message.macros ?? {}, message.theme ?? ui.theme);
        return;
    }
    if (message.sessionId !== session_id || message.revision !== revision) return;
    if (message.type === "zettlr-quiver:theme") {
        if (message.theme === "dark" || message.theme === "light") ui.switch_theme(message.theme);
    } else if (message.type === "zettlr-quiver:display") {
        fullscreen = message.fullscreen === true;
        document.body.classList.toggle("zettlr-fullscreen", fullscreen);
    } else if (message.type === "zettlr-quiver:host-popover") {
        host_popover_open = message.open === true;
    } else if (message.type === "zettlr-quiver:zoom") {
        // One step of a pinch on a touchpad, which the host reports because WebKitGTK gives a page
        // no event of it. Quiver's scale is a power of two, and Quiver zooms about its view, as
        // its own wheel with Shift does.
        if (typeof message.factor !== "number" || !(message.factor > 0)) return;
        ui.pan_to(ui.view, clamp(CONSTANTS.MIN_ZOOM, ui.scale + Math.log2(message.factor), CONSTANTS.MAX_ZOOM));
        ui.toolbar.update(ui);
    }
});

// A press on the diagram that closes a menu of the host does nothing else, as a touch outside
// a UIKit popover only dismisses it
// (https://developer.apple.com/documentation/uikit/uipopoverpresentationcontroller/passthroughviews).
// Quiver gets no event of that press, from its pointerdown to its click. A press on a control
// of Quiver closes the menu, and the control acts. These listeners are on the window in the
// capture phase, so they run before each listener of Quiver.
function withhold_from_quiver(event) {
    event.stopImmediatePropagation();
    // The browser ignores preventDefault in a touch listener on the window, which is passive.
    if (!event.type.startsWith("touch")) event.preventDefault();
}

window.addEventListener("pointerdown", (event) => {
    // A new press ends a closing press whose click did not come.
    closing_press = null;
    if (!host_popover_open) return;
    host_popover_open = false;
    post({ type: "zettlr-quiver:host-popover-dismissed" });
    // `.container` holds the grid and its cells; the toolbar and the panels are outside it.
    if (event.target.closest(".container") === null) return;
    closing_press = "down";
    withhold_from_quiver(event);
}, true);

for (const type of ["pointermove", "touchstart", "touchmove"]) {
    window.addEventListener(type, (event) => {
        if (closing_press === "down") withhold_from_quiver(event);
    }, true);
}

for (const type of ["pointerup", "pointercancel"]) {
    window.addEventListener(type, (event) => {
        if (closing_press !== "down") return;
        // A click follows only the release of the primary button.
        closing_press = type === "pointerup" && event.button === 0 ? "released" : null;
        withhold_from_quiver(event);
    }, true);
}

// A touch sends its touchend after its pointerup.
window.addEventListener("touchend", (event) => {
    if (closing_press !== null) withhold_from_quiver(event);
}, true);

window.addEventListener("click", (event) => {
    if (closing_press === null) return;
    closing_press = null;
    withhold_from_quiver(event);
}, true);

window.addEventListener("zettlr-quiver-undo-request", () => post({ type: "zettlr-quiver:undo-request" }));
window.addEventListener("zettlr-quiver-redo-request", () => post({ type: "zettlr-quiver:redo-request" }));

// Escape must work while focus is inside the iframe; keyboard events do not
// bubble across frame boundaries.
window.addEventListener("keydown", (event) => {
    // Escape closes an open menu of the host, as it does with the focus in the host.
    if (event.key === "Escape" && host_popover_open) {
        host_popover_open = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        post({ type: "zettlr-quiver:host-popover-dismissed" });
        return;
    }
    if (event.key === "Escape" && fullscreen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        post({ type: "zettlr-quiver:close-request" });
        return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopImmediatePropagation();
        post({ type: "zettlr-quiver:save" });
        return;
    }

    // The parent owns file persistence, while Quiver's web build binds these
    // chords to import/export/share. Do not let those web-only actions open
    // hidden panes inside the embedded editor.
    if ((event.ctrlKey || event.metaKey) && ["e", "i"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }
}, true);

post({ type: "zettlr-quiver:ready" });
