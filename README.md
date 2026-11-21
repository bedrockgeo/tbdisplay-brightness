# Thunderbolt Display Brightness

A GNOME Shell extension that adds a brightness slider to Quick Settings for the **Apple Thunderbolt Display** (27 inch, 2011, USB ID `05ac:9227`).

GNOME's own brightness slider only works for laptop panels and monitors that support DDC/CI. The Thunderbolt Display does neither: it takes brightness commands over its built in USB HID interface, so on Linux it normally has no brightness control at all. ddcutil based extensions don't work with it either.

This extension drives the display through [acdcontrol](https://github.com/johngrimmreaper/acdcontrol).

Tested on Ubuntu 26.04 (GNOME 50, Wayland) with a 2018 Mac mini. Declared for GNOME 45 through 50.

## Features

* Full width slider in Quick Settings, like the built in one
* Finds the display automatically and hides the slider when it isn't connected
* Rereads the brightness each time the menu opens, so changes made elsewhere show up
* Only sends the latest slider position while you drag, so it doesn't pile up processes

## Requirements

### 1. acdcontrol, patched for the full brightness range

Stock acdcontrol caps brightness at 1023, which suits the LED Cinema Display. The Thunderbolt Display's range is 0 to 65535, so with the stock build the brightest you can get is about 1.5%. Remove the cap before building:

```bash
sudo apt install build-essential git
git clone https://github.com/johngrimmreaper/acdcontrol.git
cd acdcontrol
sed -i 's/^const int MAX_BRIGHTNESS *= 1023;/const int MAX_BRIGHTNESS = 65535;/' acdcontrol.cpp
grep "MAX_BRIGHTNESS =" acdcontrol.cpp    # should show 65535
make
sudo cp acdcontrol /usr/local/bin/
```

### 2. Permission to control the display without sudo

```bash
echo 'SUBSYSTEM=="usbmisc", ATTRS{idVendor}=="05ac", ATTRS{idProduct}=="9227", MODE="0666"' | sudo tee /etc/udev/rules.d/99-apple-tb-display.rules
sudo udevadm control --reload && sudo udevadm trigger
```

Check it works as your normal user:

```bash
acdcontrol --detect /dev/usb/hiddev*
acdcontrol /dev/usb/hiddevN 50000    # N from the detect output
```

## Install

From the [Releases](https://github.com/bedrockgeo/tbdisplay-brightness/releases) page, download the zip, then:

```bash
gnome-extensions install --force tbdisplay-brightness@bedrockgeo.github.io.shell-extension.zip
```

Or from a clone of this repo:

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/tbdisplay-brightness@bedrockgeo.github.io
cp metadata.json extension.js ~/.local/share/gnome-shell/extensions/tbdisplay-brightness@bedrockgeo.github.io/
```

Log out and back in (Wayland only loads new extensions at login), then:

```bash
gnome-extensions enable tbdisplay-brightness@bedrockgeo.github.io
```

**Upgrading from version 1:** the extension ID changed from `tbdisplay-brightness@local`. Remove the old one first with `gnome-extensions uninstall tbdisplay-brightness@local`.

## Other Apple displays

The brightness range is set by `MAX_LEVEL` near the top of `extension.js`:

| Display | USB ID | Range | MAX_LEVEL |
|---|---|---|---|
| Thunderbolt Display 27" | 05ac:9227 | 0 to 65535 | 65535 (default) |
| LED Cinema Display 27" | 05ac:9226 | 0 to 1023 | 1023 |
| Older Cinema Displays | various | 0 to 255 | 255 |

Change the product ID in the udev rule to match your display too. Only the Thunderbolt Display has been tested.

## Troubleshooting

* **No slider:** run `acdcontrol --detect /dev/usb/hiddev*` as your normal user. Permission denied means the udev rule isn't applied.
* **Slider moves but the screen stays dim:** acdcontrol still has the 1023 cap. Rebuild it with the patch in step 1.
* **Logs:** `journalctl -f -o cat /usr/bin/gnome-shell`

## License

GPL 2.0 or later. See [LICENSE](LICENSE).
