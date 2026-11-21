// SPDX-License-Identifier: GPL-2.0-or-later
// Thunderbolt Display Brightness
// Adds a brightness slider to GNOME Quick Settings for the Apple
// Thunderbolt Display, which takes brightness over USB HID instead of DDC/CI.
// The slider's menu arrow holds a switch for the display's own automatic
// brightness (its ambient light sensor).
// Requires the acdcontrol tool (built without its 1023 cap, and with auto
// brightness enabled for 0x9227) and a udev rule giving your user access
// to the display's /dev/usb/hiddevN node.

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {QuickSlider, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

// The Thunderbolt Display's brightness runs 0 to 65535. Older Apple displays
// use 0 to 255 or 0 to 1023; change MAX_LEVEL to match yours.
const MAX_LEVEL = 65535;
// Keep the slider's bottom end from turning the backlight fully off.
const MIN_LEVEL = 1000;
// While Quick Settings is open and automatic brightness is on, reread the
// brightness this often so the slider follows the display.
const POLL_SECONDS = 2;
// Don't overwrite the slider from a reread right after the user moved it.
const USER_GRACE_MS = 1500;

function findTool() {
    return GLib.find_program_in_path('acdcontrol') ?? '/usr/local/bin/acdcontrol';
}

// Run a command and resolve with its combined output ('' on failure).
function run(argv, cancellable) {
    return new Promise(resolve => {
        let proc;
        try {
            proc = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
        } catch (e) {
            console.error(`tbdisplay-brightness: ${e.message}`);
            resolve('');
            return;
        }
        proc.communicate_utf8_async(null, cancellable, (p, res) => {
            try {
                const [, stdout] = p.communicate_utf8_finish(res);
                resolve(stdout ?? '');
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.error(`tbdisplay-brightness: ${e.message}`);
                resolve('');
            }
        });
    });
}

function listHiddev() {
    const paths = [];
    try {
        const dir = Gio.File.new_for_path('/dev/usb');
        const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null)) !== null) {
            const name = info.get_name();
            if (name.startsWith('hiddev'))
                paths.push(`/dev/usb/${name}`);
        }
        en.close(null);
    } catch {
        // No /dev/usb means no HID devices; nothing to do.
    }
    return paths.sort();
}

function levelToValue(level) {
    return Math.min(1, Math.max(0, (level - MIN_LEVEL) / (MAX_LEVEL - MIN_LEVEL)));
}

function valueToLevel(value) {
    return Math.round(MIN_LEVEL + value * (MAX_LEVEL - MIN_LEVEL));
}

const BrightnessSlider = GObject.registerClass(
class BrightnessSlider extends QuickSlider {
    _init() {
        super._init({iconName: 'display-brightness-symbolic'});
        this.slider.accessible_name = 'Thunderbolt Display Brightness';

        this._tool = findTool();
        this._device = null;
        this._busy = false;
        this._refreshing = false;
        this._pending = null;
        this._lastUserChange = 0;
        this._autoSupported = false;
        this._cancellable = new Gio.Cancellable();

        this._sliderId = this.slider.connect('notify::value', () => this._onSliderChanged());

        // Menu arrow beside the slider, holding the automatic brightness switch.
        this.menu.setHeader('display-brightness-symbolic', 'Thunderbolt Display');
        this._autoItem = new PopupMenu.PopupSwitchMenuItem('Automatic Brightness', false);
        this._autoId = this._autoItem.connect('toggled', (_item, state) => this._setAuto(state));
        this.menu.addMenuItem(this._autoItem);
        this.menuEnabled = false;

        // Hidden until a supported display is found.
        this.visible = false;
        this.refresh();
    }

    // Called from disable() before the widget is destroyed.
    cleanup() {
        this._cancellable.cancel();
        this._pending = null;
        if (this._sliderId) {
            this.slider.disconnect(this._sliderId);
            this._sliderId = 0;
        }
        if (this._autoId) {
            this._autoItem.disconnect(this._autoId);
            this._autoId = 0;
        }
        if (this._autoItem) {
            this._autoItem.destroy();
            this._autoItem = null;
        }
    }

    get _stopped() {
        return this._cancellable.is_cancelled();
    }

    get autoOn() {
        return this._autoSupported && (this._autoItem?.state ?? false);
    }

    async _detect() {
        const paths = listHiddev();
        if (paths.length === 0)
            return null;
        const out = await run([this._tool, '--detect', ...paths], this._cancellable);
        for (const line of out.split('\n')) {
            const m = line.match(/^(\/dev\/\S*hiddev\d+):/);
            if (m && /\bSUPPORTED\b/.test(line) && !/NOT\s+SUPPORTED|UNSUPPORTED/i.test(line))
                return m[1];
        }
        return null;
    }

    async refresh() {
        if (this._stopped || this._refreshing)
            return;
        this._refreshing = true;
        try {
            await this._refresh();
        } finally {
            this._refreshing = false;
        }
    }

    async _refresh() {
        if (!this._device)
            this._device = await this._detect();
        if (this._stopped)
            return;
        if (!this._device) {
            this.visible = false;
            return;
        }

        // One call returns both the auto state and the brightness when
        // acdcontrol supports auto brightness for this display.
        let out = await run([this._tool, this._device, '--auto-brightness', 'status'], this._cancellable);
        if (this._stopped)
            return;
        const auto = out.match(/AUTO_BRIGHTNESS=(on|off)/);
        this._autoSupported = auto !== null;
        if (!this._autoSupported) {
            out = await run([this._tool, this._device], this._cancellable);
            if (this._stopped)
                return;
        }

        const m = out.match(/BRIGHTNESS=(\d+)/);
        if (!m) {
            // Display unplugged or hiddev number changed; detect again next time.
            this._device = null;
            this.visible = false;
            return;
        }

        this.menuEnabled = this._autoSupported;
        if (this._autoSupported && this._autoItem)
            this._autoItem.setToggleState(auto[1] === 'on');

        const recentlyMoved = Date.now() - this._lastUserChange < USER_GRACE_MS;
        if (!this._busy && !recentlyMoved) {
            this.slider.block_signal_handler(this._sliderId);
            this.slider.value = levelToValue(parseInt(m[1], 10));
            this.slider.unblock_signal_handler(this._sliderId);
        }
        this.visible = true;
    }

    async _setAuto(on) {
        if (!this._device || this._stopped)
            return;
        await run([this._tool, this._device, '--auto-brightness', on ? 'on' : 'off'], this._cancellable);
        this.refresh();
    }

    _onSliderChanged() {
        if (!this._device || this._stopped)
            return;
        this._lastUserChange = Date.now();
        this._pending = valueToLevel(this.slider.value);
        if (!this._busy)
            this._flush();
    }

    // Send only the latest slider position, one acdcontrol call at a time,
    // so dragging the slider doesn't spawn a pile of processes.
    async _flush() {
        this._busy = true;
        while (this._pending !== null && !this._stopped) {
            const level = this._pending;
            this._pending = null;
            await run([this._tool, this._device, String(level)], this._cancellable);
        }
        this._busy = false;
    }
});

const BrightnessIndicator = GObject.registerClass(
class BrightnessIndicator extends SystemIndicator {
    _init() {
        super._init();
        this.slider = new BrightnessSlider();
        this.quickSettingsItems.push(this.slider);
    }
});

export default class TbDisplayBrightnessExtension extends Extension {
    enable() {
        this._indicator = new BrightnessIndicator();
        this._pollId = 0;
        const qs = Main.panel.statusArea.quickSettings;
        // Column span 2 makes the slider full width like the built in ones.
        qs.addExternalIndicator(this._indicator, 2);

        // Reread brightness each time the menu opens, and keep following the
        // display while it is open so automatic changes show on the slider.
        this._menuId = qs.menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this._indicator.slider.refresh();
                this._startPolling();
            } else {
                this._stopPolling();
            }
        });
    }

    _startPolling() {
        this._stopPolling();
        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
            if (this._indicator?.slider.autoOn)
                this._indicator.slider.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPolling() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
    }

    disable() {
        this._stopPolling();
        if (this._menuId) {
            Main.panel.statusArea.quickSettings.menu.disconnect(this._menuId);
            this._menuId = null;
        }
        this._indicator.slider.cleanup();
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
        this._indicator = null;
    }
}
