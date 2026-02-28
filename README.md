Multi Monitors Add-On
=====================

Extension inspired by https://github.com/darkxst/multiple-monitor-panels
and rewritten from scratch for gnome-shell. Adds panels and workspace
thumbnails for additional monitors. Settings changes are applied
dynamically — no shell restart needed.


Features
========

- **Secondary panel** — full top bar on each additional monitor
- **Activities button** — toggles the overview from any monitor
- **DateTime/clock** — clock display with calendar popup on secondary panels
- **Workspace thumbnails** — thumbnail slider on secondary monitors when the
  overview is open; position (left/right/auto) is configurable
- **Indicator transfer** — move status-area indicators from the primary panel
  to a secondary panel
- **Primary monitor indicator** — small icon in the top bar showing connected
  monitors, with a Preferences shortcut
- **Hot corners** — GNOME hot-corner triggers on all monitors


Supported GNOME Versions
========================

| Branch / Version | GNOME Shell |
|---|---|
| `master` (this branch) | **46, 47, 48, 49** |
| GNOME 3.38 (legacy) | 3.38 |
| `gnome-3-32_3-36` | 3.32 – 3.36 |
| `gnome-3-24_3-30` | 3.24 – 3.30 |
| `gnome-3-20_3-22` | 3.20 – 3.22 |
| `gnome-3-16_3-18` | 3.16 – 3.18 |
| `gnome-3-14` | 3.14 |
| `gnome-3-10` | 3.10 |


Installation
============

### From GNOME Extensions website

Visit https://extensions.gnome.org/extension/600/multi-monitors-add-on/ and
toggle the switch to install.

### From git

```bash
git clone https://github.com/spin83/multi-monitors-add-on.git
cd multi-monitors-add-on

# Copy extension files
cp -r multi-monitors-add-on@spin83 ~/.local/share/gnome-shell/extensions/

# Compile the GSettings schema (required)
glib-compile-schemas \
  ~/.local/share/gnome-shell/extensions/multi-monitors-add-on@spin83/schemas/

# Enable the extension
gnome-extensions enable multi-monitors-add-on@spin83
```

**Wayland:** Log out and back in to reload GNOME Shell with the new extension.

**X11:** Press `Alt+F2`, type `r`, press `Enter` to restart the shell in place,
then enable the extension.

### Verifying the installation

```bash
# Check for load errors
journalctl -f -o cat /usr/bin/gnome-shell | grep -i "multi\|error\|exception"

# List enabled extensions
gnome-extensions list --enabled
```


Configuration
=============

Open **Settings → Extensions → Multi Monitors Add-On** (or click the indicator
icon in the top bar and choose *Preferences*).

| Setting | Description |
|---|---|
| Show indicator on Top Panel | Toggle the monitor indicator icon |
| Show Panel on additional monitors | Enable/disable the secondary panel |
| Show Activities Button | Toggle the Activities button on secondary panels |
| Show DateTime Button | Toggle the clock/calendar on secondary panels |
| Show Thumbnails-Slider | None / Right / Left / Auto positioning |
| Enable hot corners | Hot-corner triggers on all monitors |
| Indicator Transfer table | Move specific status-area indicators to a secondary monitor |

The **Indicator Transfer** table lets you pick any indicator from the primary
panel (e.g. `keyboard`, `volume`, network applets from extensions) and assign
it to a secondary monitor index. Changes take effect immediately.


GNOME 46–49 Compatibility — What Changed
=========================================

The extension was originally written for GNOME 3.38 using the legacy
`imports.*` CommonJS module system and several Shell-internal APIs that were
later removed or made private. The master branch has been fully rewritten for
GNOME 46+.

### Module system

GNOME Shell 45 switched extensions from CommonJS (`imports.misc.*`,
`imports.ui.*`) to ES Modules (`import … from '…'`). Every source file was
converted. The helper file `convenience.js` was removed; settings access is now
provided by `getSettings()` exported from `extension.js`, and translations are
initialised by the `Extension` base class.

### Extension lifecycle

The module-level `init()` / `enable()` / `disable()` functions are replaced by
a class that extends `Extension` from the Shell extension API:

```js
export default class MultiMonitorsAddOn extends Extension {
    enable()  { … }
    disable() { … }
}
```

### Removed: `org.gnome.shell.overrides` schema

This GSettings schema was removed in GNOME 46. All references to it
(`OVERRIDE_SCHEMA`, `_ov_settings`) are gone. The only mutter setting still
used is `workspaces-only-on-primary` via `org.gnome.mutter`.

### Removed: AppMenu button

`Panel.AppMenuButton` was deleted from GNOME Shell in GNOME 49 and was
already un-exported in GNOME 46. The feature is removed entirely:
`MultiMonitorsAppMenuButton`, `SHOW_APP_MENU_ID`, and the corresponding
preferences row and schema key (`show-app-menu`) are all gone.

### Rewritten: Activities button

The original implementation used `copyClass(Panel.ActivitiesButton, …)` to
inherit from a Shell-internal class that is no longer exported. The button is
now a standalone `PanelMenu.Button` subclass that uses `vfunc_event` to handle
clicks (safe through GNOME 49, where `Clutter.ClickAction` was removed).

### Removed: PanelCorner

`Panel.PanelCorner` is not exported in GNOME 46. The corner rendering is
handled entirely by CSS on the panel element in modern GNOME, so the code that
created `_leftCorner` / `_rightCorner` is simply removed.

### Rewritten: Workspace thumbnails slider

The slider was based on `OverviewControls.SlidingControl`,
`OverviewControls.SlideLayout`, and `OverviewControls.SlideDirection` — all
removed in GNOME 40. The new `MultiMonitorsThumbnailsSlider` extends `St.Bin`
directly and uses opacity-based `ease()` animations for slide-in / slide-out.

### Rewritten: Overview controls state tracking

`Main.overview.viewSelector` and its `page-changed` / `page-empty` signals
were removed in GNOME 40. The controls manager now connects to:

```js
Main.overview._overview._controls._stateAdjustment  // notify::value
```

The state is compared against `OverviewControls.ControlsState.WINDOW_PICKER`
to decide whether thumbnails should be visible.

The secondary workspace view is accessed via:

```js
Main.overview._overview._controls._workspacesDisplay._workspacesViews[idx]
```

Both paths are Shell internals and may change in future versions, but are
stable across GNOME 46–49.

### Simplified: DateTime / calendar button

The original `MultiMonitorsDateMenuButton` depended on several private Shell
classes (`DateMenu.FreezableBinLayout`, `DateMenu.TodayButton`,
`DateMenu.CalendarColumnLayout`, `DateMenu._gDateTimeToDate`,
`Calendar.NotificationSection`, `Calendar.DoNotDisturbSwitch`, etc.) that are
not exported in GNOME 46. The button is now a standalone implementation
showing only the clock label and a calendar popup. Notification/event sections
and the Do-Not-Disturb switch are not included.

### Updated: Preferences (GTK4)

GNOME 45+ requires the preferences UI to use GTK4. `prefs.js` is rewritten
using:

- `ExtensionPreferences` with `fillPreferencesWindow(window)`
- `Adw.PreferencesPage` / `Adw.PreferencesGroup` / `Adw.ActionRow`
- GTK4 widget API (`append` instead of `add`, no `show_all`, etc.)
- `Gdk.Display.get_default().get_monitors()` instead of `Gdk.Screen`

### Other fixes

- `add_actor()` / `remove_actor()` replaced with `add_child()` / `remove_child()`
  throughout (removed in GNOME 46)
- `global.log()` replaced with `console.log()`
- `global.settings.disconnect()` bug in `mmlayout.js` fixed (now correctly
  calls `this._desktopSettings.disconnect()`)
- `splice(indexOf(element))` bug in `StatusIndicatorsController` fixed to
  `splice(indexOf(element), 1)`
- Extension path in `indicator.js` now derived from `import.meta.url` via
  `GLib.filename_from_uri()`


License
=======

Multi Monitors Add-On is distributed under the terms of the GNU General Public
License, version 2 or later. See the `LICENSE` file for details.
