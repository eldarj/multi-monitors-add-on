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

import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';

import { getSettings, mmState } from './extension.js';
import * as MMPanel from './mmpanel.js';

export const SHOW_PANEL_ID = 'show-panel';
export const ENABLE_HOT_CORNERS = 'enable-hot-corners';

const MultiMonitorsPanelBox = class MultiMonitorsPanelBox {
    constructor(monitor) {
        this.panelBox = new St.BoxLayout({ name: 'panelBox', vertical: true, clip_to_allocation: true });
        Main.layoutManager.addChrome(this.panelBox, { affectsStruts: true, trackFullscreen: true });
        this.panelBox.set_position(monitor.x, monitor.y);
        this.panelBox.set_size(monitor.width, -1);
        Main.uiGroup.set_child_below_sibling(this.panelBox, Main.layoutManager.panelBox);
    }

    destroy() {
        this.panelBox.destroy();
    }

    updatePanel(monitor) {
        this.panelBox.set_position(monitor.x, monitor.y);
        this.panelBox.set_size(monitor.width, -1);
    }
};

export var MultiMonitorsLayoutManager = class MultiMonitorsLayoutManager {
    constructor() {
        this._settings = getSettings();
        this._desktopSettings = getSettings('org.gnome.desktop.interface');

        mmState.mmPanel = [];

        this._monitorIds = [];
        this.mmPanelBox = [];

        this._monitorsChangedId = null;

        this.statusIndicatorsController = null;
        this._layoutManager_updateHotCorners = null;
        this._changedEnableHotCornersId = null;
    }

    showPanel() {
        if (this._settings.get_boolean(SHOW_PANEL_ID)) {
            if (!this._monitorsChangedId) {
                this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', this._monitorsChanged.bind(this));
                this._monitorsChanged();
            }

            if (!this.statusIndicatorsController) {
                this.statusIndicatorsController = new MMPanel.StatusIndicatorsController();
            }

            if (!this._layoutManager_updateHotCorners) {
                this._layoutManager_updateHotCorners = Main.layoutManager._updateHotCorners;

                const _this = this;
                Main.layoutManager._updateHotCorners = function () {
                    this.hotCorners.forEach(corner => {
                        if (corner)
                            corner.destroy();
                    });
                    this.hotCorners = [];

                    if (!_this._desktopSettings.get_boolean(ENABLE_HOT_CORNERS)) {
                        this.emit('hot-corners-changed');
                        return;
                    }

                    let size = this.panelBox.height;

                    for (let i = 0; i < this.monitors.length; i++) {
                        let monitor = this.monitors[i];
                        let cornerX = this._rtl ? monitor.x + monitor.width : monitor.x;
                        let cornerY = monitor.y;

                        let corner = new Layout.HotCorner(this, monitor, cornerX, cornerY);
                        corner.setBarrierSize(size);
                        this.hotCorners.push(corner);
                    }

                    this.emit('hot-corners-changed');
                };

                if (!this._changedEnableHotCornersId) {
                    this._changedEnableHotCornersId = this._desktopSettings.connect(
                        'changed::' + ENABLE_HOT_CORNERS,
                        Main.layoutManager._updateHotCorners.bind(Main.layoutManager));
                }

                Main.layoutManager._updateHotCorners();
            }
        } else {
            this.hidePanel();
        }
    }

    hidePanel() {
        if (this._changedEnableHotCornersId) {
            this._desktopSettings.disconnect(this._changedEnableHotCornersId);
            this._changedEnableHotCornersId = null;
        }

        if (this._layoutManager_updateHotCorners) {
            Main.layoutManager['_updateHotCorners'] = this._layoutManager_updateHotCorners;
            this._layoutManager_updateHotCorners = null;
            Main.layoutManager._updateHotCorners();
        }

        if (this.statusIndicatorsController) {
            this.statusIndicatorsController.destroy();
            this.statusIndicatorsController = null;
        }

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }

        let panels2remove = this._monitorIds.length;
        for (let i = 0; i < panels2remove; i++) {
            let monitorId = this._monitorIds.pop();
            this._popPanel();
            console.log('remove: ' + monitorId);
        }
    }

    _monitorsChanged() {
        let monitorChange = Main.layoutManager.monitors.length - this._monitorIds.length - 1;
        if (monitorChange < 0) {
            for (let idx = 0; idx < -monitorChange; idx++) {
                let monitorId = this._monitorIds.pop();
                this._popPanel();
                console.log('remove: ' + monitorId);
            }
        }

        let j = 0;
        let tIndicators = false;
        for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
            if (i !== Main.layoutManager.primaryIndex) {
                let monitor = Main.layoutManager.monitors[i];
                let monitorId = 'i' + i + 'x' + monitor.x + 'y' + monitor.y + 'w' + monitor.width + 'h' + monitor.height;
                if (monitorChange > 0 && j === this._monitorIds.length) {
                    this._monitorIds.push(monitorId);
                    this._pushPanel(i, monitor);
                    console.log('new: ' + monitorId);
                    tIndicators = true;
                } else if (this._monitorIds[j] > monitorId || this._monitorIds[j] < monitorId) {
                    let oldMonitorId = this._monitorIds[j];
                    this._monitorIds[j] = monitorId;
                    this.mmPanelBox[j].updatePanel(monitor);
                    console.log('update: ' + oldMonitorId + '>' + monitorId);
                }
                j++;
            }
        }
        if (tIndicators && this.statusIndicatorsController) {
            this.statusIndicatorsController.transferIndicators();
        }
    }

    _pushPanel(i, monitor) {
        let mmPanelBox = new MultiMonitorsPanelBox(monitor);
        let panel = new MMPanel.MultiMonitorsPanel(i, mmPanelBox);

        mmState.mmPanel.push(panel);
        this.mmPanelBox.push(mmPanelBox);
    }

    _popPanel() {
        let panel = mmState.mmPanel.pop();
        if (this.statusIndicatorsController) {
            this.statusIndicatorsController.transferBack(panel);
        }
        let mmPanelBox = this.mmPanelBox.pop();
        mmPanelBox.destroy();
    }
};
