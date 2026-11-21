// SPDX-License-Identifier: GPL-2.0-or-later
// Thunderbolt Display Brightness
// Adds a brightness slider to GNOME Quick Settings for Apple displays
// that take brightness over USB HID (Thunderbolt Display, Cinema Displays).
// Requires the acdcontrol tool and a udev rule giving your user access
// to the display's /dev/usb/hiddevN node.

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {QuickSlider, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

// The Thunderbolt Display's brightness runs 0 to 65535 (it read 53852 at
// about 80%). Stock acdcontrol clamps to 1023, so it must be rebuilt with
// MAX_BRIGHTNESS = 65535 (see README). Older displays use 0 to 255 or
// 0 to 1023; change MAX_LEVEL to match yours.
const MAX_LEVEL = 65535;
// Keep the slider's bottom end from turning the backlight fully off.
const MIN_LEVEL = 1000;

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

function findTool() {
    return GLib.find_program_in_path('acdcontrol') ?? '/usr/local/bin/acdcontrol';
}

async function run(argv) {
    try {
        const proc = Gio.Subprocess.new(argv,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
        const [stdout] = await proc.communicate_utf8_async(null, null);
        return stdout ?? '';
    } catch (e) {
        console.error(`tbdisplay-brightness: ${e}`);
        return '';
    }
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
    } catch (e) {
        // /dev/usb missing means no HID devices; nothing to do.
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
        this._pending = null;
        this._dead = false;

        this._sliderId = this.slider.connect('notify::value', () => this._onSliderChanged());
        this.connect('destroy', () => {
            this._dead = true;
        });

        // Hidden until a supported display is found.
        this.visible = false;
        this.refresh();
    }

    async _detect() {
        const paths = listHiddev();
        if (paths.length === 0)
            return null;
        const out = await run([this._tool, '--detect', ...paths]);
        for (const line of out.split('\n')) {
            const m = line.match(/^(\/dev\/\S*hiddev\d+):/);
            if (m && /\bSUPPORTED\b/.test(line) && !/NOT\s+SUPPORTED|UNSUPPORTED/i.test(line))
                return m[1];
        }
        return null;
    }

    async refresh() {
        if (this._dead)
            return;
        if (!this._device)
            this._device = await this._detect();
        if (this._dead)
            return;
        if (!this._device) {
            this.visible = false;
            return;
        }

        const out = await run([this._tool, this._device]);
        if (this._dead)
            return;
        const m = out.match(/BRIGHTNESS=(\d+)/);
        if (!m) {
            // Display unplugged or hiddev number changed; detect again next time.
            this._device = null;
            this.visible = false;
            return;
        }

        this.slider.block_signal_handler(this._sliderId);
        this.slider.value = levelToValue(parseInt(m[1], 10));
        this.slider.unblock_signal_handler(this._sliderId);
        this.visible = true;
    }

    _onSliderChanged() {
        if (!this._device)
            return;
        this._pending = valueToLevel(this.slider.value);
        if (!this._busy)
            this._flush();
    }

    // Send only the latest slider position, one acdcontrol call at a time,
    // so dragging the slider doesn't spawn a pile of processes.
    async _flush() {
        this._busy = true;
        while (this._pending !== null && !this._dead) {
            const level = this._pending;
            this._pending = null;
            await run([this._tool, this._device, String(level)]);
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
        const qs = Main.panel.statusArea.quickSettings;
        // Column span 2 makes the slider full width like the built in ones.
        qs.addExternalIndicator(this._indicator, 2);

        // Re-read brightness (and re-detect the display) each time the menu opens.
        this._menuId = qs.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._indicator.slider.refresh();
        });
    }

    disable() {
        Main.panel.statusArea.quickSettings.menu.disconnect(this._menuId);
        this._menuId = null;
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
        this._indicator = null;
    }
}
