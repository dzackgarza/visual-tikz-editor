/*
 * A touchpad for the stories of the desktop package. Xvfb has no touchpad and WebKitWebDriver has
 * no pinch, so this library, loaded into the application with LD_PRELOAD, gives the application's
 * WebKitWebView the events that GDK makes for a two-finger pinch on a touchpad
 * (GDK_TOUCHPAD_PINCH: one begin, the updates, one end;
 * https://docs.gtk.org/gdk3/struct.EventTouchpadPinch.html). GTK and WebKit then take them as
 * they take a pinch of the window system.
 *
 * A pinch is one line in the file that TOUCHPAD_FILE names: "x y scale scale ...", with the
 * place in the widget's pixels and each scale relative to the start of the pinch. The library
 * removes the file when it starts the pinch and writes one line to stderr when the pinch has ended.
 */

#include <gtk/gtk.h>
#include <stdio.h>
#include <unistd.h>

#define MAX_UPDATES 64

typedef struct {
  GtkWidget *view;
  double x, y;
  double scales[MAX_UPDATES];
  int count, next;
} Pinch;

static GtkWidget *web_view_in(GtkWidget *widget) {
  if (g_str_has_prefix(G_OBJECT_TYPE_NAME(widget), "WebKitWebView")) return widget;
  GtkWidget *found = NULL;
  if (GTK_IS_CONTAINER(widget)) {
    GList *children = gtk_container_get_children(GTK_CONTAINER(widget));
    for (GList *child = children; child != NULL && found == NULL; child = child->next) found = web_view_in(child->data);
    g_list_free(children);
  }
  return found;
}

static void send(const Pinch *pinch, GdkTouchpadGesturePhase phase, double scale) {
  GdkWindow *window = gtk_widget_get_window(pinch->view);
  GdkDevice *pointer = gdk_seat_get_pointer(gdk_display_get_default_seat(gdk_window_get_display(window)));
  GdkEvent *event = gdk_event_new(GDK_TOUCHPAD_PINCH);
  int left, top;
  gdk_window_get_origin(window, &left, &top);
  event->touchpad_pinch.window = g_object_ref(window);
  event->touchpad_pinch.phase = phase;
  event->touchpad_pinch.n_fingers = 2;
  event->touchpad_pinch.time = (guint32)(g_get_monotonic_time() / 1000);
  event->touchpad_pinch.x = pinch->x;
  event->touchpad_pinch.y = pinch->y;
  event->touchpad_pinch.x_root = left + pinch->x;
  event->touchpad_pinch.y_root = top + pinch->y;
  event->touchpad_pinch.scale = scale;
  gdk_event_set_device(event, pointer);
  gdk_event_set_source_device(event, pointer);
  gtk_main_do_event(event);
  gdk_event_free(event);
}

static gboolean step(gpointer data) {
  Pinch *pinch = data;
  if (pinch->next == 0) send(pinch, GDK_TOUCHPAD_GESTURE_PHASE_BEGIN, 1.0);
  if (pinch->next < pinch->count) {
    send(pinch, GDK_TOUCHPAD_GESTURE_PHASE_UPDATE, pinch->scales[pinch->next]);
    pinch->next += 1;
    return G_SOURCE_CONTINUE;
  }
  send(pinch, GDK_TOUCHPAD_GESTURE_PHASE_END, pinch->scales[pinch->count - 1]);
  fprintf(stderr, "touchpad: a pinch of %d updates ended\n", pinch->count);
  g_free(pinch);
  return G_SOURCE_REMOVE;
}

static gboolean read_pinch(gpointer unused) {
  const char *path = g_getenv("TOUCHPAD_FILE");
  char *text = NULL;
  if (path == NULL || !g_file_get_contents(path, &text, NULL, NULL)) return G_SOURCE_CONTINUE;
  GtkWidget *view = NULL;
  GList *windows = gtk_window_list_toplevels();
  for (GList *window = windows; window != NULL && view == NULL; window = window->next) view = web_view_in(window->data);
  g_list_free(windows);
  g_assert_nonnull(view);
  g_assert_cmpint(unlink(path), ==, 0);

  Pinch *pinch = g_new0(Pinch, 1);
  pinch->view = view;
  char *rest = text;
  pinch->x = g_ascii_strtod(rest, &rest);
  pinch->y = g_ascii_strtod(rest, &rest);
  for (;;) {
    char *end;
    double scale = g_ascii_strtod(rest, &end);
    if (end == rest) break;
    g_assert_cmpint(pinch->count, <, MAX_UPDATES);
    pinch->scales[pinch->count] = scale;
    pinch->count += 1;
    rest = end;
  }
  g_assert_cmpint(pinch->count, >, 0);
  g_free(text);
  // A touchpad reports about one update for each frame of the display.
  g_timeout_add(16, step, pinch);
  return G_SOURCE_CONTINUE;
}

__attribute__((constructor)) static void start(void) {
  // LD_PRELOAD reaches the file host and WebKit's processes too; only the shell has the view.
  char program[512] = {0};
  if (readlink("/proc/self/exe", program, sizeof program - 1) < 0) return;
  if (!g_str_has_suffix(program, "/visual-tikz-editor")) return;
  g_timeout_add(50, read_pinch, NULL);
}
