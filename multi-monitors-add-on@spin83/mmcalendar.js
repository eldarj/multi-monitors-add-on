/*
Copyright (C) 2014  spin83

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, visit https://www.gnu.org/licenses/.
*/

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import GnomeDesktop from 'gi://GnomeDesktop';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';

import { gettext as _, copyClass } from './extension.js';

var MultiMonitorsCalendar = (() => {
    let MultiMonitorsCalendar = class MultiMonitorsCalendar extends St.Widget {
        _init() {
            this._weekStart = Shell.util_get_week_start();
            this._settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.calendar' });

            // Use string directly instead of Calendar.SHOW_WEEKDATE_KEY (not exported in GNOME 46+)
            this._showWeekdateKeyId = this._settings.connect(
                'changed::show-weekdate', this._onSettingsChange.bind(this));
            this._useWeekdate = this._settings.get_boolean('show-weekdate');

            this._headerFormatWithoutYear = _('%OB');
            this._headerFormat = _('%OB %Y');

            // Start off with the current date
            this._selectedDate = new Date();

            this._shouldDateGrabFocus = false;

            super._init({
                style_class: 'calendar',
                layout_manager: new Clutter.GridLayout(),
                reactive: true,
            });

            this._buildHeader();
            this.connect('destroy', this._onDestroy.bind(this));
        }

        _onDestroy() {
            this._settings.disconnect(this._showWeekdateKeyId);
        }
    };
    copyClass(Calendar.Calendar, MultiMonitorsCalendar);
    return GObject.registerClass({
        Signals: { 'selected-date-changed': { param_types: [GLib.DateTime.$gtype] } },
    }, MultiMonitorsCalendar);
})();

export const MultiMonitorsDateMenuButton = GObject.registerClass(
class MultiMonitorsDateMenuButton extends PanelMenu.Button {
    _init() {
        super._init(0.5);
        this.add_style_class_name('clock-display');

        this._clockDisplay = new St.Label({ style_class: 'clock' });
        this._clockDisplay.clutter_text.y_align = Clutter.ActorAlign.CENTER;
        this._clockDisplay.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        const box = new St.BoxLayout({ style_class: 'clock-display-box' });
        box.add_child(this._clockDisplay);
        this.label_actor = this._clockDisplay;
        this.add_child(box);

        // Popup: calendar only
        this._calendar = new MultiMonitorsCalendar();
        const hbox = new St.BoxLayout({ name: 'calendarArea' });
        hbox.add_child(this._calendar);
        this.menu.box.add_child(hbox);

        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen)
                this._calendar.setDate(new Date());
        });

        this._clock = new GnomeDesktop.WallClock();
        this._clock.bind_property(
            'clock', this._clockDisplay, 'text',
            GObject.BindingFlags.SYNC_CREATE);
        this._clockNotifyTimezoneId = this._clock.connect(
            'notify::timezone', this._updateTimeZone.bind(this));

        this._sessionModeUpdatedId = Main.sessionMode.connect(
            'updated', this._sessionUpdated.bind(this));
        this._sessionUpdated();
    }

    _updateTimeZone() {
        this._clock.notify('clock');
    }

    _sessionUpdated() {
        const visible = Main.sessionMode.isUser || Main.sessionMode.isGreeter;
        this.visible = visible;
    }

    _onDestroy() {
        Main.sessionMode.disconnect(this._sessionModeUpdatedId);
        this._clock.disconnect(this._clockNotifyTimezoneId);
        super._onDestroy();
    }
});
