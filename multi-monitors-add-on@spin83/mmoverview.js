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
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as WorkspaceThumbnail from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';
import * as Overview from 'resource:///org/gnome/shell/ui/overview.js';
import * as LayoutManager from 'resource:///org/gnome/shell/ui/layout.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';

import { gettext as _, getSettings, copyClass, mmState } from './extension.js';

const THUMBNAILS_SLIDER_POSITION_ID = 'thumbnails-slider-position';
const SLIDE_ANIMATION_TIME = 200; // ms
const ANIMATION_TIME = 400; // ms

var MultiMonitorsWorkspaceThumbnail = (() => {
    let MultiMonitorsWorkspaceThumbnail = class MultiMonitorsWorkspaceThumbnail extends St.Widget {
        _init(metaWorkspace, monitorIndex) {
            super._init({
                clip_to_allocation: true,
                style_class: 'workspace-thumbnail',
            });
            this._delegate = this;

            this.metaWorkspace = metaWorkspace;
            this.monitorIndex = monitorIndex;

            this._removed = false;

            this._contents = new Clutter.Actor();
            this.add_child(this._contents);

            this.connect('destroy', this._onDestroy.bind(this));

            this._createBackground();

            let workArea = Main.layoutManager.getWorkAreaForMonitor(this.monitorIndex);
            this.setPorthole(workArea.x, workArea.y, workArea.width, workArea.height);

            let windows = global.get_window_actors().filter(actor => {
                let win = actor.meta_window;
                return win.located_on_workspace(metaWorkspace);
            });

            // Create clones for windows that should be visible in the Overview
            this._windows = [];
            this._allWindows = [];
            this._minimizedChangedIds = [];
            for (let i = 0; i < windows.length; i++) {
                let minimizedChangedId =
                    windows[i].meta_window.connect('notify::minimized',
                        this._updateMinimized.bind(this));
                this._allWindows.push(windows[i].meta_window);
                this._minimizedChangedIds.push(minimizedChangedId);

                if (this._isMyWindow(windows[i]) && this._isOverviewWindow(windows[i]))
                    this._addWindowClone(windows[i]);
            }

            // Track window changes
            this._windowAddedId = this.metaWorkspace.connect('window-added',
                this._windowAdded.bind(this));
            this._windowRemovedId = this.metaWorkspace.connect('window-removed',
                this._windowRemoved.bind(this));
            this._windowEnteredMonitorId = global.display.connect('window-entered-monitor',
                this._windowEnteredMonitor.bind(this));
            this._windowLeftMonitorId = global.display.connect('window-left-monitor',
                this._windowLeftMonitor.bind(this));

            this.state = WorkspaceThumbnail.ThumbnailState.NORMAL;
            this._slidePosition = 0; // Fully slid in
            this._collapseFraction = 0; // Not collapsed
        }

        _createBackground() {
            this._bgManager = new Background.BackgroundManager({
                monitorIndex: this.monitorIndex,
                container: this._contents,
                vignette: false,
            });
        }
    };

    copyClass(WorkspaceThumbnail.WorkspaceThumbnail, MultiMonitorsWorkspaceThumbnail);
    return GObject.registerClass({
        Properties: {
            'collapse-fraction': GObject.ParamSpec.double(
                'collapse-fraction', 'collapse-fraction', 'collapse-fraction',
                GObject.ParamFlags.READWRITE,
                0, 1, 0),
            'slide-position': GObject.ParamSpec.double(
                'slide-position', 'slide-position', 'slide-position',
                GObject.ParamFlags.READWRITE,
                0, 1, 0),
        },
    }, MultiMonitorsWorkspaceThumbnail);
})();

const MultiMonitorsThumbnailsBox = (() => {
    let MultiMonitorsThumbnailsBox = class MultiMonitorsThumbnailsBox extends St.Widget {
        _init(scrollAdjustment, monitorIndex) {
            super._init({
                reactive: true,
                style_class: 'workspace-thumbnails',
                request_mode: Clutter.RequestMode.WIDTH_FOR_HEIGHT,
            });

            this._delegate = this;
            this._monitorIndex = monitorIndex;

            let indicator = new St.Bin({ style_class: 'workspace-thumbnail-indicator' });

            // We don't want the indicator to affect drag-and-drop
            Shell.util_set_hidden_from_pick(indicator, true);

            this._indicator = indicator;
            this.add_child(indicator);

            // The porthole is the part of the screen we're showing in the thumbnails
            this._porthole = {
                width: global.stage.width,
                height: global.stage.height,
                x: global.stage.x,
                y: global.stage.y,
            };

            this._dropWorkspace = -1;
            this._dropPlaceholderPos = -1;
            this._dropPlaceholder = new St.Bin({ style_class: 'placeholder' });
            this.add_child(this._dropPlaceholder);
            this._spliceIndex = -1;

            this._targetScale = 0;
            this._scale = 0;
            this._pendingScaleUpdate = false;
            this._stateUpdateQueued = false;
            this._animatingIndicator = false;

            this._stateCounts = {};
            for (let key in WorkspaceThumbnail.ThumbnailState)
                this._stateCounts[WorkspaceThumbnail.ThumbnailState[key]] = 0;

            this._thumbnails = [];

            this._showingId = Main.overview.connect('showing',
                this._createThumbnails.bind(this));
            this._hiddenId = Main.overview.connect('hidden',
                this._destroyThumbnails.bind(this));

            this._itemDragBeginId = Main.overview.connect('item-drag-begin',
                this._onDragBegin.bind(this));
            this._itemDragEndId = Main.overview.connect('item-drag-end',
                this._onDragEnd.bind(this));
            this._itemDragCancelledId = Main.overview.connect('item-drag-cancelled',
                this._onDragCancelled.bind(this));
            this._windowDragBeginId = Main.overview.connect('window-drag-begin',
                this._onDragBegin.bind(this));
            this._windowDragEndId = Main.overview.connect('window-drag-end',
                this._onDragEnd.bind(this));
            this._windowDragCancelledId = Main.overview.connect('window-drag-cancelled',
                this._onDragCancelled.bind(this));

            this._settings = new Gio.Settings({ schema_id: WorkspaceThumbnail.MUTTER_SCHEMA });
            this._changedDynamicWorkspacesId = this._settings.connect('changed::dynamic-workspaces',
                this._updateSwitcherVisibility.bind(this));

            this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
                this._destroyThumbnails();
                if (Main.overview.visible)
                    this._createThumbnails();
            });

            this._workareasChangedPortholeId = global.display.connect('workareas-changed',
                this._updatePorthole.bind(this));

            this._switchWorkspaceNotifyId = 0;
            this._nWorkspacesNotifyId = 0;
            this._syncStackingId = 0;
            this._workareasChangedId = 0;

            this._scrollAdjustment = scrollAdjustment;

            this._scrollAdjustmentNotifyValueId = this._scrollAdjustment.connect('notify::value', adj => {
                let workspaceManager = global.workspace_manager;
                let activeIndex = workspaceManager.get_active_workspace_index();

                this._animatingIndicator = adj.value !== activeIndex;

                if (!this._animatingIndicator)
                    this._queueUpdateStates();

                this.queue_relayout();
            });

            this.connect('destroy', this._onDestroy.bind(this));
        }

        _onDestroy() {
            this._destroyThumbnails();
            this._scrollAdjustment.disconnect(this._scrollAdjustmentNotifyValueId);
            Main.overview.disconnect(this._showingId);
            Main.overview.disconnect(this._hiddenId);

            Main.overview.disconnect(this._itemDragBeginId);
            Main.overview.disconnect(this._itemDragEndId);
            Main.overview.disconnect(this._itemDragCancelledId);
            Main.overview.disconnect(this._windowDragBeginId);
            Main.overview.disconnect(this._windowDragEndId);
            Main.overview.disconnect(this._windowDragCancelledId);

            this._settings.disconnect(this._changedDynamicWorkspacesId);
            Main.layoutManager.disconnect(this._monitorsChangedId);
            global.display.disconnect(this._workareasChangedPortholeId);
        }

        addThumbnails(start, count) {
            let workspaceManager = global.workspace_manager;

            for (let k = start; k < start + count; k++) {
                let metaWorkspace = workspaceManager.get_workspace_by_index(k);
                let thumbnail = new MultiMonitorsWorkspaceThumbnail(metaWorkspace, this._monitorIndex);
                thumbnail.setPorthole(this._porthole.x, this._porthole.y,
                    this._porthole.width, this._porthole.height);
                this._thumbnails.push(thumbnail);
                this.add_child(thumbnail);

                if (start > 0 && this._spliceIndex === -1) {
                    // not the initial fill, and not splicing via DND
                    thumbnail.state = WorkspaceThumbnail.ThumbnailState.NEW;
                    thumbnail.slide_position = 1; // start slid out
                    this._haveNewThumbnails = true;
                } else {
                    thumbnail.state = WorkspaceThumbnail.ThumbnailState.NORMAL;
                }

                this._stateCounts[thumbnail.state]++;
            }

            this._queueUpdateStates();

            // The thumbnails indicator actually needs to be on top of the thumbnails
            this.set_child_above_sibling(this._indicator, null);

            // Clear the splice index, we got the message
            this._spliceIndex = -1;
        }

        _updatePorthole() {
            this._porthole = Main.layoutManager.getWorkAreaForMonitor(this._monitorIndex);
            this.queue_relayout();
        }
    };

    copyClass(WorkspaceThumbnail.ThumbnailsBox, MultiMonitorsThumbnailsBox);
    return GObject.registerClass({
        Properties: {
            'indicator-y': GObject.ParamSpec.double(
                'indicator-y', 'indicator-y', 'indicator-y',
                GObject.ParamFlags.READWRITE,
                0, Infinity, 0),
            'scale': GObject.ParamSpec.double(
                'scale', 'scale', 'scale',
                GObject.ParamFlags.READWRITE,
                0, Infinity, 0),
        },
    }, MultiMonitorsThumbnailsBox);
})();

// New sliding mechanism — no base class available in GNOME 46+
var MultiMonitorsThumbnailsSlider = GObject.registerClass(
class MultiMonitorsThumbnailsSlider extends St.Bin {
    _init(thumbnailsBox) {
        super._init({
            style_class: 'overview-controls',
            clip_to_allocation: true,
            x_expand: false,
            y_expand: true,
            request_mode: Clutter.RequestMode.WIDTH_FOR_HEIGHT,
            reactive: true,
            track_hover: true,
        });

        this._thumbnailsBox = thumbnailsBox;
        this._sliderVisible = true;
        this.add_child(this._thumbnailsBox);
        this._thumbnailsBox.bind_property('visible', this, 'visible',
            GObject.BindingFlags.SYNC_CREATE);

        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', this._updateSlide.bind(this));
        this._activeWorkspaceChangedId = global.workspace_manager.connect(
            'active-workspace-changed', this._updateSlide.bind(this));
        this._notifyNWorkspacesId = global.workspace_manager.connect(
            'notify::n-workspaces', this._updateSlide.bind(this));

        this.connect('destroy', this._onDestroy.bind(this));
    }

    _onDestroy() {
        Main.layoutManager.disconnect(this._monitorsChangedId);
        global.workspace_manager.disconnect(this._activeWorkspaceChangedId);
        global.workspace_manager.disconnect(this._notifyNWorkspacesId);
    }

    slideIn() {
        this.ease({
            opacity: 255,
            duration: SLIDE_ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._sliderVisible = true;
    }

    slideOut() {
        this.ease({
            opacity: 0,
            duration: SLIDE_ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._sliderVisible = false;
    }

    pageEmpty() { /* no-op for compatibility */ }

    _updateSlide() {
        // visibility handled externally by ControlsManager
    }
});

var MultiMonitorsControlsManager = GObject.registerClass(
class MultiMonitorsControlsManager extends St.Widget {
    _init(index) {
        this._monitorIndex = index;
        this._workspacesViews = null;
        this._spacer_height = 0;
        this._fixGeometry = 0;
        this._visible = false;
        this._onLeftSide = false;

        super._init({
            x_expand: true,
            y_expand: true,
            clip_to_allocation: true,
        });

        this._workspaceAdjustment = Main.overview._overview._controls._workspaceAdjustment;

        this._thumbnailsBox =
            new MultiMonitorsThumbnailsBox(this._workspaceAdjustment, this._monitorIndex);
        this._thumbnailsSlider = new MultiMonitorsThumbnailsSlider(this._thumbnailsBox);

        this._viewSelector = new St.Widget({ visible: false, x_expand: true, y_expand: true, clip_to_allocation: true });

        // Connect to overview state adjustment instead of removed viewSelector
        this._overviewAdjustment = Main.overview._overview._controls._stateAdjustment;
        this._stateChangedId = this._overviewAdjustment.connect(
            'notify::value', this._onStateChanged.bind(this));

        this._group = new St.BoxLayout({
            name: 'mm-overview-group-' + index,
            x_expand: true,
            y_expand: true,
        });
        this.add_child(this._group);

        this._group.add_child(this._viewSelector);
        this._group.add_child(this._thumbnailsSlider);

        this._settings = getSettings();

        this._monitorsChanged();
        this._thumbnailsSlider.slideOut();
        this._thumbnailsBox._updatePorthole();

        this.connect('notify::allocation', this._updateSpacerVisibility.bind(this));
        this.connect('destroy', this._onDestroy.bind(this));
        this._thumbnailsSelectSideId = this._settings.connect(
            'changed::' + THUMBNAILS_SLIDER_POSITION_ID,
            this._thumbnailsSelectSide.bind(this));
        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', this._monitorsChanged.bind(this));
    }

    _onDestroy() {
        this._overviewAdjustment.disconnect(this._stateChangedId);
        this._settings.disconnect(this._thumbnailsSelectSideId);
        Main.layoutManager.disconnect(this._monitorsChangedId);
    }

    _monitorsChanged() {
        this._primaryMonitorOnTheLeft =
            Main.layoutManager.monitors[this._monitorIndex].x > Main.layoutManager.primaryMonitor.x;
        this._thumbnailsSelectSide();
    }

    _thumbnailsSelectSide() {
        const sett = this._settings.get_string(THUMBNAILS_SLIDER_POSITION_ID);
        const onLeftSide = sett === 'left' || (sett === 'auto' && this._primaryMonitorOnTheLeft);
        this._onLeftSide = onLeftSide;

        if (onLeftSide) {
            const first = this._group.get_first_child();
            if (first !== this._thumbnailsSlider) {
                this._thumbnailsBox.remove_style_class_name('workspace-thumbnails');
                this._thumbnailsBox.set_style_class_name('workspace-thumbnails workspace-thumbnails-left');
                this._group.set_child_below_sibling(this._thumbnailsSlider, first);
            }
        } else {
            const last = this._group.get_last_child();
            if (last !== this._thumbnailsSlider) {
                this._thumbnailsBox.remove_style_class_name('workspace-thumbnails workspace-thumbnails-left');
                this._thumbnailsBox.set_style_class_name('workspace-thumbnails');
                this._group.set_child_above_sibling(this._thumbnailsSlider, last);
            }
        }
        this._fixGeometry = 3;
    }

    _onStateChanged() {
        if (!Main.overview.visible ||
            (Main.overview.animationInProgress && !Main.overview.visibleTarget))
            return;

        const state = Math.round(this._overviewAdjustment.value);
        const thumbnailsVisible = state === OverviewControls.ControlsState.WINDOW_PICKER;

        if (thumbnailsVisible) {
            if (this._fixGeometry === 1)
                this._fixGeometry = 0;
            this._thumbnailsSlider.slideIn();
        } else {
            this._fixGeometry = 1;
            this._thumbnailsSlider.slideOut();
        }

        if (!this._workspacesViews)
            return;

        this._workspacesViews.ease({
            opacity: thumbnailsVisible ? 255 : 0,
            duration: 250,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _updateSpacerVisibility() {
        if (Main.layoutManager.monitors.length < this._monitorIndex)
            return;

        let top_spacer_height = Main.layoutManager.primaryMonitor.height;

        let panelGhost_height = 0;
        if (mmState.mmOverview[this._monitorIndex]._overview._panelGhost)
            panelGhost_height = mmState.mmOverview[this._monitorIndex]._overview._panelGhost.get_height();

        let allocation = Main.overview._overview._controls.allocation;
        let primaryControl_height = allocation.get_height();
        let bottom_spacer_height = Main.layoutManager.primaryMonitor.height - allocation.y2;

        top_spacer_height -= primaryControl_height + panelGhost_height + bottom_spacer_height;
        top_spacer_height = Math.round(top_spacer_height);

        let spacer = mmState.mmOverview[this._monitorIndex]._overview._spacer;
        if (spacer.get_height() !== top_spacer_height) {
            this._spacer_height = top_spacer_height;
            spacer.set_height(top_spacer_height);
        }
    }

    getWorkspacesActualGeometry() {
        let geometry;
        if (this._visible) {
            const [x, y] = this._viewSelector.get_transformed_position();
            const width = this._viewSelector.allocation.get_width();
            const height = this._viewSelector.allocation.get_height();
            geometry = { x, y, width, height };
        } else {
            let [x, y] = this.get_transformed_position();
            const width = this.allocation.get_width();
            let height = this.allocation.get_height();
            y -= this._spacer_height;
            height += this._spacer_height;
            geometry = { x, y, width, height };
        }
        if (isNaN(geometry.x))
            return null;
        return geometry;
    }

    show() {
        this._viewSelector.visible = true;
        this._workspacesViews =
            Main.overview._overview._controls._workspacesDisplay._workspacesViews[this._monitorIndex];
        this._visible = true;
        const geometry = this.getWorkspacesActualGeometry();

        if (!geometry) {
            this._fixGeometry = 0;
            return;
        }

        if (this._fixGeometry) {
            const width = this._thumbnailsSlider.get_width();
            if (this._fixGeometry === 2) {
                geometry.width = geometry.width - width;
                if (this._onLeftSide)
                    geometry.x = geometry.x + width;
            } else if (this._fixGeometry === 3) {
                if (this._onLeftSide)
                    geometry.x = geometry.x + width;
                else
                    geometry.x = geometry.x - width;
            }
            this._fixGeometry = 0;
        }

        if (this._workspacesViews) {
            this._workspacesViews.ease({
                ...geometry,
                duration: Main.overview.animationInProgress ? ANIMATION_TIME : 0,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    hide() {
        this._visible = false;
        if (this._workspacesViews)
            this._workspacesViews.opacity = 255;
        if (this._fixGeometry === 1)
            this._fixGeometry = 2;
        const geometry = this.getWorkspacesActualGeometry();
        if (this._workspacesViews && geometry) {
            this._workspacesViews.ease({
                ...geometry,
                duration: Main.overview.animationInProgress ? ANIMATION_TIME : 0,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this._viewSelector.visible = false;
                },
            });
        } else {
            this._viewSelector.visible = false;
        }
        this._workspacesViews = null;
    }
});

var MultiMonitorsOverviewActor = GObject.registerClass(
class MultiMonitorsOverviewActor extends St.BoxLayout {
    _init(index) {
        this._monitorIndex = index;
        super._init({
            name: 'mm-overview-' + index,
            /* Translators: This is the main view to select
               activities. See also note for "Activities" string. */
            accessible_name: _('MMOverview@' + index),
            vertical: true,
        });

        this.add_constraint(new LayoutManager.MonitorConstraint({ index: this._monitorIndex }));

        this._panelGhost = null;
        if (mmState.mmPanel) {
            for (let idx in mmState.mmPanel) {
                if (mmState.mmPanel[idx].monitorIndex !== this._monitorIndex)
                    continue;
                // Add a clone of the panel to the overview so spacing and such is
                // automatic
                this._panelGhost = new St.Bin({
                    child: new Clutter.Clone({ source: mmState.mmPanel[idx] }),
                    reactive: false,
                    opacity: 0,
                });
                this.add_child(this._panelGhost);
                break;
            }
        }

        this._spacer = new St.Widget();
        this.add_child(this._spacer);

        this._controls = new MultiMonitorsControlsManager(this._monitorIndex);

        // Add our same-line elements after the search entry
        this.add_child(this._controls);
    }
});


export var MultiMonitorsOverview = class MultiMonitorsOverview {
    constructor(index) {
        this.monitorIndex = index;

        this._initCalled = true;
        this._overview = new MultiMonitorsOverviewActor(this.monitorIndex);
        this._overview._delegate = this;
        this._overview.connect('destroy', this._onDestroy.bind(this));
        Main.layoutManager.overviewGroup.add_child(this._overview);

        this._showingId = Main.overview.connect('showing', this._show.bind(this));
        this._hidingId = Main.overview.connect('hiding', this._hide.bind(this));
    }

    getWorkspacesActualGeometry() {
        return this._overview._controls.getWorkspacesActualGeometry();
    }

    _onDestroy() {
        Main.overview.disconnect(this._showingId);
        Main.overview.disconnect(this._hidingId);

        Main.layoutManager.overviewGroup.remove_child(this._overview);
        this._overview._delegate = null;
    }

    _show() {
        this._overview._controls.show();
    }

    _hide() {
        this._overview._controls.hide();
    }

    destroy() {
        this._overview.destroy();
    }

    addAction(action) {
        this._overview.add_action(action);
    }

    removeAction(action) {
        if (action.get_actor())
            this._overview.remove_action(action);
    }
};
