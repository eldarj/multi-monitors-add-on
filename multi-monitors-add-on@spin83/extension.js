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

import { Extension, gettext } from 'resource:///org/gnome/shell/extensions/extension.js';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as MMLayout from './mmlayout.js';
import * as MMOverview from './mmoverview.js';
import * as MMIndicator from './indicator.js';

// Re-export gettext so sub-modules can import it from here
export { gettext };

// Shared mutable state — cannot use Main.X because module namespace objects are sealed
export const mmState = {
    mmOverview: null,
    mmPanel: null,
};

const MUTTER_SCHEMA = 'org.gnome.mutter';
const WORKSPACES_ONLY_ON_PRIMARY_ID = 'workspaces-only-on-primary';
const SHOW_INDICATOR_ID = 'show-indicator';
const THUMBNAILS_SLIDER_POSITION_ID = 'thumbnails-slider-position';

export function copyClass(s, d) {
    let propertyNames = Reflect.ownKeys(s.prototype);
    for (let pName of propertyNames.values()) {
        if (typeof pName === 'symbol') continue;
        if (d.prototype.hasOwnProperty(pName)) continue;
        if (pName === 'prototype') continue;
        if (pName === 'constructor') continue;
        let pDesc = Reflect.getOwnPropertyDescriptor(s.prototype, pName);
        if (typeof pDesc !== 'object') continue;
        Reflect.defineProperty(d.prototype, pName, pDesc);
    }
}

let _extension = null;

export function getSettings(schemaId) {
    if (schemaId)
        return new Gio.Settings({ schema_id: schemaId });
    return _extension.getSettings();
}

export default class MultiMonitorsAddOn extends Extension {
    enable() {
        _extension = this;
        this.initTranslations();

        const metaVersion = this.metadata['version'];
        let version;
        if (Number.isFinite(metaVersion)) {
            version = 'v' + Math.trunc(metaVersion);
            switch (Math.round((metaVersion % 1) * 10)) {
                case 0:
                    break;
                case 1:
                    version += '+bugfix';
                    break;
                case 2:
                    version += '+develop';
                    break;
                default:
                    version += '+modified';
                    break;
            }
        } else {
            version = metaVersion;
        }

        console.log(`Enable Multi Monitors Add-On (${version})...`);

        this._settings = this.getSettings();
        this._mu_settings = new Gio.Settings({ schema_id: MUTTER_SCHEMA });

        this.mmIndicator = null;
        mmState.mmOverview = null;
        this._mmLayoutManager = null;
        this._mmMonitors = 0;

        this._switchOffThumbnailsMuId = this._mu_settings.connect(
            'changed::' + WORKSPACES_ONLY_ON_PRIMARY_ID,
            this._switchOffThumbnails.bind(this));

        this._showIndicatorId = this._settings.connect(
            'changed::' + SHOW_INDICATOR_ID,
            this._showIndicator.bind(this));
        this._showIndicator();

        this._mmLayoutManager = new MMLayout.MultiMonitorsLayoutManager();
        this._showPanelId = this._settings.connect(
            'changed::' + MMLayout.SHOW_PANEL_ID,
            this._mmLayoutManager.showPanel.bind(this._mmLayoutManager));
        this._mmLayoutManager.showPanel();

        this._thumbnailsSliderPositionId = this._settings.connect(
            'changed::' + THUMBNAILS_SLIDER_POSITION_ID,
            this._showThumbnailsSlider.bind(this));
        this._relayoutId = Main.layoutManager.connect(
            'monitors-changed',
            this._relayout.bind(this));
        this._relayout();
    }

    disable() {
        Main.layoutManager.disconnect(this._relayoutId);
        this._mu_settings.disconnect(this._switchOffThumbnailsMuId);

        this._settings.disconnect(this._showPanelId);
        this._settings.disconnect(this._thumbnailsSliderPositionId);
        this._settings.disconnect(this._showIndicatorId);

        this._hideIndicator();

        this._mmLayoutManager.hidePanel();
        this._mmLayoutManager = null;

        this._hideThumbnailsSlider();
        this._mmMonitors = 0;

        _extension = null;
        console.log('Disable Multi Monitors Add-On ...');
    }

    _showIndicator() {
        if (this._settings.get_boolean(SHOW_INDICATOR_ID)) {
            if (!this.mmIndicator) {
                this.mmIndicator = Main.panel.addToStatusArea(
                    'MultiMonitorsAddOn',
                    new MMIndicator.MultiMonitorsIndicator());
            }
        } else {
            this._hideIndicator();
        }
    }

    _hideIndicator() {
        if (this.mmIndicator) {
            this.mmIndicator.destroy();
            this.mmIndicator = null;
        }
    }

    _showThumbnailsSlider() {
        if (this._settings.get_string(THUMBNAILS_SLIDER_POSITION_ID) === 'none') {
            this._hideThumbnailsSlider();
            return;
        }

        if (this._mu_settings.get_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID))
            this._mu_settings.set_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID, false);

        if (mmState.mmOverview)
            return;

        mmState.mmOverview = [];
        for (let idx = 0; idx < Main.layoutManager.monitors.length; idx++) {
            if (idx !== Main.layoutManager.primaryIndex) {
                mmState.mmOverview[idx] = new MMOverview.MultiMonitorsOverview(idx);
            }
        }
    }

    _hideThumbnailsSlider() {
        if (!mmState.mmOverview)
            return;

        for (let idx = 0; idx < mmState.mmOverview.length; idx++) {
            if (mmState.mmOverview[idx])
                mmState.mmOverview[idx].destroy();
        }
        mmState.mmOverview = null;
    }

    _relayout() {
        if (this._mmMonitors !== Main.layoutManager.monitors.length) {
            this._mmMonitors = Main.layoutManager.monitors.length;
            console.log('pi:' + Main.layoutManager.primaryIndex);
            for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
                let monitor = Main.layoutManager.monitors[i];
                console.log(`i:${i} x:${monitor.x} y:${monitor.y} w:${monitor.width} h:${monitor.height}`);
            }
            this._hideThumbnailsSlider();
            this._showThumbnailsSlider();
        }
    }

    _switchOffThumbnails() {
        if (this._mu_settings.get_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID)) {
            this._settings.set_string(THUMBNAILS_SLIDER_POSITION_ID, 'none');
        }
    }
}
