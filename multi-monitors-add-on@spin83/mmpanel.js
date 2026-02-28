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
import St from 'gi://St';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Panel from 'resource:///org/gnome/shell/ui/panel.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as CtrlAltTab from 'resource:///org/gnome/shell/ui/ctrlAltTab.js';

import { gettext as _, getSettings, copyClass, mmState } from './extension.js';
import * as MMCalendar from './mmcalendar.js';

const SHOW_ACTIVITIES_ID = 'show-activities';
const SHOW_DATE_TIME_ID = 'show-date-time';
const AVAILABLE_INDICATORS_ID = 'available-indicators';
const TRANSFER_INDICATORS_ID = 'transfer-indicators';

export var StatusIndicatorsController = class StatusIndicatorsController {
    constructor() {
        this._transfered_indicators = [];
        this._settings = getSettings();

        this._updatedSessionId = Main.sessionMode.connect('updated', this._updateSessionIndicators.bind(this));
        this._updateSessionIndicators();
        this._extensionStateChangedId = Main.extensionManager.connect('extension-state-changed',
            this._extensionStateChanged.bind(this));

        this._transferIndicatorsId = this._settings.connect('changed::' + TRANSFER_INDICATORS_ID,
            this.transferIndicators.bind(this));
    }

    destroy() {
        this._settings.disconnect(this._transferIndicatorsId);
        Main.extensionManager.disconnect(this._extensionStateChangedId);
        Main.sessionMode.disconnect(this._updatedSessionId);
        this._settings.set_strv(AVAILABLE_INDICATORS_ID, []);
        this._transferBack(this._transfered_indicators);
    }

    transferBack(panel) {
        let transfer_back = this._transfered_indicators.filter(element => {
            return element.monitor === panel.monitorIndex;
        });

        this._transferBack(transfer_back, panel);
    }

    transferIndicators() {
        let boxs = ['_leftBox', '_centerBox', '_rightBox'];
        let transfers = this._settings.get_value(TRANSFER_INDICATORS_ID).deep_unpack();

        let transfer_back = this._transfered_indicators.filter(element => {
            return !transfers.hasOwnProperty(element.iname);
        });

        this._transferBack(transfer_back);

        for (let iname in transfers) {
            if (transfers.hasOwnProperty(iname) && Main.panel.statusArea[iname]) {
                let monitor = transfers[iname];

                let indicator = Main.panel.statusArea[iname];
                let panel = this._findPanel(monitor);
                boxs.forEach(box => {
                    if (Main.panel[box].contains(indicator.container) && panel) {
                        console.log('a ' + box + ' > ' + iname + ' : ' + monitor);
                        this._transfered_indicators.push({ iname, box, monitor });
                        Main.panel[box].remove_child(indicator.container);
                        panel[box].insert_child_at_index(indicator.container, 0);
                    }
                });
            }
        }
    }

    _findPanel(monitor) {
        for (let i = 0; i < mmState.mmPanel.length; i++) {
            if (mmState.mmPanel[i].monitorIndex === monitor) {
                return mmState.mmPanel[i];
            }
        }
        return null;
    }

    _transferBack(transfer_back, panel) {
        transfer_back.forEach(element => {
            this._transfered_indicators.splice(this._transfered_indicators.indexOf(element), 1);
            if (Main.panel.statusArea[element.iname]) {
                let indicator = Main.panel.statusArea[element.iname];
                if (!panel) {
                    panel = this._findPanel(element.monitor);
                }
                if (panel && panel[element.box].contains(indicator.container)) {
                    console.log('r ' + element.box + ' > ' + element.iname + ' : ' + element.monitor);
                    panel[element.box].remove_child(indicator.container);
                    Main.panel[element.box].insert_child_at_index(indicator.container, 0);
                }
            }
        });
    }

    _extensionStateChanged() {
        this._findAvailableIndicators();
        this.transferIndicators();
    }

    _updateSessionIndicators() {
        let session_indicators = [];
        session_indicators.push('MultiMonitorsAddOn');
        let sessionPanel = Main.sessionMode.panel;
        for (let sessionBox in sessionPanel) {
            sessionPanel[sessionBox].forEach(sesionIndicator => {
                session_indicators.push(sesionIndicator);
            });
        }
        this._session_indicators = session_indicators;
        this._available_indicators = [];

        this._findAvailableIndicators();
        this.transferIndicators();
    }

    _findAvailableIndicators() {
        let available_indicators = [];
        let statusArea = Main.panel.statusArea;
        for (let indicator in statusArea) {
            if (statusArea.hasOwnProperty(indicator) && this._session_indicators.indexOf(indicator) < 0) {
                available_indicators.push(indicator);
            }
        }
        if (available_indicators.length !== this._available_indicators.length) {
            this._available_indicators = available_indicators;
            this._settings.set_strv(AVAILABLE_INDICATORS_ID, this._available_indicators);
        }
    }
};

export const MultiMonitorsActivitiesButton = GObject.registerClass(
class MultiMonitorsActivitiesButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, null, true);
        this.accessible_role = Atk.Role.TOGGLE_BUTTON;
        this.name = 'mmPanelActivities';

        this._label = new St.Label({
            text: _('Activities'),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);
        this.label_actor = this._label;

        this._showingId = Main.overview.connect('showing', () => {
            this.add_style_pseudo_class('overview');
            this.add_accessible_state(Atk.StateType.CHECKED);
        });
        this._hidingId = Main.overview.connect('hiding', () => {
            this.remove_style_pseudo_class('overview');
            this.remove_accessible_state(Atk.StateType.CHECKED);
        });
    }

    vfunc_event(event) {
        if (event.type() === Clutter.EventType.TOUCH_BEGIN ||
            event.type() === Clutter.EventType.BUTTON_PRESS)
            Main.overview.toggle();
        return Clutter.EVENT_PROPAGATE;
    }

    _onDestroy() {
        Main.overview.disconnect(this._showingId);
        Main.overview.disconnect(this._hidingId);
        super._onDestroy();
    }
});

const MULTI_MONITOR_PANEL_ITEM_IMPLEMENTATIONS = {
    'activities': MultiMonitorsActivitiesButton,
    'dateMenu': MMCalendar.MultiMonitorsDateMenuButton,
};

export var MultiMonitorsPanel = (() => {
    let MultiMonitorsPanel = class MultiMonitorsPanel extends St.Widget {
        _init(monitorIndex, mmPanelBox) {
            super._init({
                name: 'panel',
                reactive: true,
            });

            this.monitorIndex = monitorIndex;

            this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);

            this._sessionStyle = null;

            this.statusArea = {};

            this.menuManager = new PopupMenu.PopupMenuManager(this);

            this._leftBox = new St.BoxLayout({ name: 'panelLeft' });
            this.add_child(this._leftBox);
            this._centerBox = new St.BoxLayout({ name: 'panelCenter' });
            this.add_child(this._centerBox);
            this._rightBox = new St.BoxLayout({ name: 'panelRight' });
            this.add_child(this._rightBox);

            this._showingId = Main.overview.connect('showing', () => {
                this.add_style_pseudo_class('overview');
            });
            this._hidingId = Main.overview.connect('hiding', () => {
                this.remove_style_pseudo_class('overview');
            });

            mmPanelBox.panelBox.add_child(this);
            Main.ctrlAltTabManager.addGroup(this, _('Top Bar'), 'focus-top-bar-symbolic',
                { sortGroup: CtrlAltTab.SortGroup.TOP });

            this._updatedId = Main.sessionMode.connect('updated', this._updatePanel.bind(this));

            this._workareasChangedId = global.display.connect('workareas-changed', () => this.queue_relayout());
            this._updatePanel();

            this._settings = getSettings();
            this._showActivitiesId = this._settings.connect('changed::' + SHOW_ACTIVITIES_ID,
                this._showActivities.bind(this));
            this._showActivities();

            this._showDateTimeId = this._settings.connect('changed::' + SHOW_DATE_TIME_ID,
                this._showDateTime.bind(this));
            this._showDateTime();

            this.connect('destroy', this._onDestroy.bind(this));
        }

        _onDestroy() {
            global.display.disconnect(this._workareasChangedId);
            Main.overview.disconnect(this._showingId);
            Main.overview.disconnect(this._hidingId);

            this._settings.disconnect(this._showActivitiesId);
            this._settings.disconnect(this._showDateTimeId);

            Main.ctrlAltTabManager.removeGroup(this);
            Main.sessionMode.disconnect(this._updatedId);
        }

        _showActivities() {
            let name = 'activities';
            if (this._settings.get_boolean(SHOW_ACTIVITIES_ID)) {
                if (this.statusArea[name])
                    this.statusArea[name].visible = true;
            } else {
                if (this.statusArea[name])
                    this.statusArea[name].visible = false;
            }
        }

        _showDateTime() {
            let name = 'dateMenu';
            if (this._settings.get_boolean(SHOW_DATE_TIME_ID)) {
                if (this.statusArea[name])
                    this.statusArea[name].visible = true;
            } else {
                if (this.statusArea[name])
                    this.statusArea[name].visible = false;
            }
        }

        vfunc_get_preferred_width(forHeight) {
            if (Main.layoutManager.monitors.length > this.monitorIndex)
                return [0, Main.layoutManager.monitors[this.monitorIndex].width];

            return [0, 0];
        }

        _hideIndicators() {
            for (let role in MULTI_MONITOR_PANEL_ITEM_IMPLEMENTATIONS) {
                let indicator = this.statusArea[role];
                if (!indicator)
                    continue;
                indicator.container.hide();
            }
        }

        _ensureIndicator(role) {
            let indicator = this.statusArea[role];
            if (indicator) {
                indicator.container.show();
                return null;
            } else {
                let constructor = MULTI_MONITOR_PANEL_ITEM_IMPLEMENTATIONS[role];
                if (!constructor) {
                    // This icon is not implemented (this is a bug)
                    return null;
                }
                indicator = new constructor(this);
                this.statusArea[role] = indicator;
            }
            return indicator;
        }

        _getDraggableWindowForPosition(stageX) {
            let workspaceManager = global.workspace_manager;
            const windows = workspaceManager.get_active_workspace().list_windows();
            const allWindowsByStacking =
                global.display.sort_windows_by_stacking(windows).reverse();

            return allWindowsByStacking.find(metaWindow => {
                let rect = metaWindow.get_frame_rect();
                return metaWindow.get_monitor() === this.monitorIndex &&
                       metaWindow.showing_on_its_workspace() &&
                       metaWindow.get_window_type() !== Meta.WindowType.DESKTOP &&
                       metaWindow.maximized_vertically &&
                       stageX > rect.x && stageX < rect.x + rect.width;
            });
        }
    };

    copyClass(Panel.Panel, MultiMonitorsPanel);
    return GObject.registerClass(MultiMonitorsPanel);
})();
