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

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import GObject from 'gi://GObject';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const SHOW_INDICATOR_ID = 'show-indicator';
const SHOW_PANEL_ID = 'show-panel';
const SHOW_ACTIVITIES_ID = 'show-activities';
const SHOW_DATE_TIME_ID = 'show-date-time';
const THUMBNAILS_SLIDER_POSITION_ID = 'thumbnails-slider-position';
const AVAILABLE_INDICATORS_ID = 'available-indicators';
const TRANSFER_INDICATORS_ID = 'transfer-indicators';
const ENABLE_HOT_CORNERS = 'enable-hot-corners';

const Columns = {
    INDICATOR_NAME: 0,
    MONITOR_NUMBER: 1,
};

export default class MultiMonitorsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const desktopSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });

        const page = new Adw.PreferencesPage({
            title: _('Settings'),
            icon_name: 'preferences-other-symbolic',
        });
        window.add(page);

        // Panel settings group
        const panelGroup = new Adw.PreferencesGroup({ title: _('Panel') });
        page.add(panelGroup);

        panelGroup.add(this._createSwitchRow(
            _('Show Multi Monitors indicator on Top Panel.'), settings, SHOW_INDICATOR_ID));
        panelGroup.add(this._createSwitchRow(
            _('Show Panel on additional monitors.'), settings, SHOW_PANEL_ID));
        panelGroup.add(this._createSwitchRow(
            _('Show Activities-Button on additional monitors.'), settings, SHOW_ACTIVITIES_ID));
        panelGroup.add(this._createSwitchRow(
            _('Show DateTime-Button on additional monitors.'), settings, SHOW_DATE_TIME_ID));
        panelGroup.add(this._createSwitchRow(
            _('Enable hot corners.'), desktopSettings, ENABLE_HOT_CORNERS));

        // Thumbnails slider position combo
        panelGroup.add(this._createComboRow(
            _('Show Thumbnails-Slider on additional monitors.'),
            settings,
            THUMBNAILS_SLIDER_POSITION_ID,
            {
                none: _('No'),
                right: _('On the right'),
                left: _('On the left'),
                auto: _('Auto'),
            }));

        // Indicator transfer group
        const transferGroup = new Adw.PreferencesGroup({
            title: _('Indicator Transfer'),
            description: _('A list of indicators for transfer to additional monitors.'),
        });
        page.add(transferGroup);

        // TreeView for indicators (still functional in GTK4, deprecated but works)
        const store = new Gtk.ListStore();
        store.set_column_types([GObject.TYPE_STRING, GObject.TYPE_INT]);

        const treeView = new Gtk.TreeView({ model: store, hexpand: true, vexpand: true });
        treeView.get_selection().set_mode(Gtk.SelectionMode.SINGLE);

        const appColumn = new Gtk.TreeViewColumn({
            expand: true,
            sort_column_id: Columns.INDICATOR_NAME,
            title: _('Indicator'),
        });

        let nameRenderer = new Gtk.CellRendererText();
        appColumn.pack_start(nameRenderer, true);
        appColumn.add_attribute(nameRenderer, 'text', Columns.INDICATOR_NAME);

        nameRenderer = new Gtk.CellRendererText();
        appColumn.pack_start(nameRenderer, true);
        appColumn.add_attribute(nameRenderer, 'text', Columns.MONITOR_NUMBER);

        treeView.append_column(appColumn);

        const updateIndicators = () => {
            store.clear();
            let transfers = settings.get_value(TRANSFER_INDICATORS_ID).deep_unpack();
            for (let indicator in transfers) {
                if (transfers.hasOwnProperty(indicator)) {
                    let monitor = transfers[indicator];
                    let iter = store.append();
                    store.set(iter,
                        [Columns.INDICATOR_NAME, Columns.MONITOR_NUMBER],
                        [indicator, monitor]);
                }
            }
        };

        settings.connect('changed::' + TRANSFER_INDICATORS_ID, updateIndicators);
        updateIndicators();

        // Toolbar buttons
        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            tooltip_text: _('Add indicator'),
        });
        addButton.connect('clicked', () => {
            this._addIndicator(window, settings);
        });

        const removeButton = new Gtk.Button({
            icon_name: 'list-remove-symbolic',
            tooltip_text: _('Remove indicator'),
        });
        removeButton.connect('clicked', () => {
            const [any, model, iter] = treeView.get_selection().get_selected();
            if (any) {
                let indicator = model.get_value(iter, Columns.INDICATOR_NAME);
                let transfers = settings.get_value(TRANSFER_INDICATORS_ID).deep_unpack();
                if (transfers.hasOwnProperty(indicator)) {
                    delete transfers[indicator];
                    settings.set_value(TRANSFER_INDICATORS_ID,
                        new GLib.Variant('a{si}', transfers));
                }
            }
        });

        const toolbar = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 4,
            margin_top: 4,
        });
        toolbar.append(addButton);
        toolbar.append(removeButton);

        const treeBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            margin_start: 6,
            margin_end: 6,
            margin_top: 6,
            margin_bottom: 6,
        });
        treeBox.append(treeView);
        treeBox.append(toolbar);

        transferGroup.add(treeBox);
    }

    _createSwitchRow(label, settings, schemaId) {
        const row = new Adw.ActionRow({ title: label });
        const sw = new Gtk.Switch({
            active: settings.get_boolean(schemaId),
            valign: Gtk.Align.CENTER,
        });
        settings.bind(schemaId, sw, 'active', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(sw);
        row.activatable_widget = sw;
        return row;
    }

    _createComboRow(label, settings, schemaId, options) {
        const row = new Adw.ActionRow({ title: label });
        const combo = new Gtk.ComboBoxText({ valign: Gtk.Align.CENTER });
        Object.entries(options).forEach(([key, val]) => {
            combo.append(key, val);
        });
        settings.bind(schemaId, combo, 'active-id', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(combo);
        row.activatable_widget = combo;
        return row;
    }

    _addIndicator(parentWindow, settings) {
        const dialog = new Gtk.Dialog({
            title: _('Select indicator'),
            transient_for: parentWindow,
            modal: true,
            use_header_bar: 1,
        });
        dialog.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
        dialog.add_button(_('Add'), Gtk.ResponseType.OK);
        dialog.set_default_response(Gtk.ResponseType.OK);

        const dialogStore = new Gtk.ListStore();
        dialogStore.set_column_types([GObject.TYPE_STRING]);

        const dialogTreeView = new Gtk.TreeView({
            model: dialogStore,
            hexpand: true,
            vexpand: true,
        });
        dialogTreeView.get_selection().set_mode(Gtk.SelectionMode.SINGLE);

        const col = new Gtk.TreeViewColumn({
            expand: true,
            sort_column_id: Columns.INDICATOR_NAME,
            title: _('Indicators on Top Panel'),
        });
        const renderer = new Gtk.CellRendererText();
        col.pack_start(renderer, true);
        col.add_attribute(renderer, 'text', Columns.INDICATOR_NAME);
        dialogTreeView.append_column(col);

        const availableIndicators = () => {
            let transfers = settings.get_value(TRANSFER_INDICATORS_ID).unpack();
            dialogStore.clear();
            settings.get_strv(AVAILABLE_INDICATORS_ID).forEach(indicator => {
                if (!transfers.hasOwnProperty(indicator)) {
                    let iter = dialogStore.append();
                    dialogStore.set(iter, [Columns.INDICATOR_NAME], [indicator]);
                }
            });
        };

        const availableIndicatorsId = settings.connect(
            'changed::' + AVAILABLE_INDICATORS_ID, availableIndicators);
        const transferIndicatorsId = settings.connect(
            'changed::' + TRANSFER_INDICATORS_ID, availableIndicators);

        availableIndicators();

        // Monitor index spinner
        const display = Gdk.Display.get_default();
        const n_monitors = display ? display.get_monitors().get_n_items() - 1 : 0;
        const adjustment = new Gtk.Adjustment({
            lower: 0.0,
            upper: n_monitors,
            step_increment: 1.0,
        });
        const spinButton = new Gtk.SpinButton({
            halign: Gtk.Align.END,
            adjustment,
            numeric: true,
        });
        adjustment.set_value(n_monitors);

        let monitorsChangedId = 0;
        if (display) {
            monitorsChangedId = display.connect('monitors-changed', () => {
                const n = display.get_monitors().get_n_items() - 1;
                adjustment.set_upper(n);
                adjustment.set_value(n);
            });
        }

        const monitorLabel = new Gtk.Label({
            label: _('Monitor index:'),
            halign: Gtk.Align.START,
        });
        const monitorBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 20,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
            hexpand: true,
        });
        monitorBox.append(monitorLabel);
        monitorBox.append(spinButton);

        const grid = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
        });
        grid.append(dialogTreeView);
        grid.append(monitorBox);

        dialog.get_content_area().append(grid);

        dialog.connect('response', (_dialog, id) => {
            if (display && monitorsChangedId)
                display.disconnect(monitorsChangedId);
            settings.disconnect(availableIndicatorsId);
            settings.disconnect(transferIndicatorsId);

            if (id === Gtk.ResponseType.OK) {
                const [any, model, iter] = dialogTreeView.get_selection().get_selected();
                if (any) {
                    let indicator = model.get_value(iter, Columns.INDICATOR_NAME);
                    let transfers = settings.get_value(TRANSFER_INDICATORS_ID).deep_unpack();
                    if (!transfers.hasOwnProperty(indicator)) {
                        transfers[indicator] = adjustment.get_value();
                        settings.set_value(TRANSFER_INDICATORS_ID,
                            new GLib.Variant('a{si}', transfers));
                    }
                }
            }

            dialog.destroy();
        });

        dialog.present();
    }
}
