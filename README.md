# Thunderbolt Display Brightness

Brightness control on Linux for the **Apple Thunderbolt Display** (27 inch, 2011, USB ID `05ac:9227`), for both **GNOME** and **KDE Plasma**.

Desktop brightness sliders only work for laptop panels and monitors that support DDC/CI. The Thunderbolt Display does neither: it takes brightness commands over its built in USB HID interface, so on Linux it normally has no brightness control at all. ddcutil based tools don't work with it either.

Both versions give you:

* A brightness slider covering the display's full range
* An **Automatic Brightness** switch for the display's own ambient light sensor
* Automatic detection of the display; the control hides when it isn't connected

| Desktop | Folder | What you get | Tested on |
|---|---|---|---|
| GNOME 45 to 50 | [`gnome/`](gnome) | Slider in Quick Settings; the arrow beside it holds the auto switch | Ubuntu 26.04, 2018 Mac mini |
| KDE Plasma 6 | [`kde/`](kde) | Panel or system tray widget; scroll over the icon to change brightness | EndeavourOS, 2017 MacBook Air |

Both drive the display through [acdcontrol](https://github.com/johngrimmreaper/acdcontrol).

## Step 1: acdcontrol, with two small patches

Stock acdcontrol caps brightness at 1023, which suits the LED Cinema Display. The Thunderbolt Display's range is 0 to 65535, so with the stock build the brightest you can get is about 1.5%. Stock acdcontrol also only allows the automatic brightness command on the LED Cinema Display; the second `sed` line enables it for the Thunderbolt Display, which uses the same command.

Install the build tools first: `sudo apt install build-essential git` on Ubuntu or Debian, `sudo pacman -S --needed base-devel git` on Arch or EndeavourOS. Then:

```bash
git clone https://github.com/johngrimmreaper/acdcontrol.git
cd acdcontrol
sed -i 's/^const int MAX_BRIGHTNESS *= 1023;/const int MAX_BRIGHTNESS = 65535;/' acdcontrol.cpp
sed -i 's/return vendor == APPLE && product == CINEMA_DISPLAY_27;/return vendor == APPLE \&\& (product == CINEMA_DISPLAY_27 || product == CINEMA_DISPLAY_27_2013);/' acdcontrol.cpp
grep "MAX_BRIGHTNESS =" acdcontrol.cpp    # should show 65535
grep "CINEMA_DISPLAY_27_2013);" acdcontrol.cpp    # should show the auto brightness line
make
sudo cp acdcontrol /usr/local/bin/
```

## Step 2: permission to control the display without sudo

```bash
echo 'SUBSYSTEM=="usbmisc", ATTRS{idVendor}=="05ac", ATTRS{idProduct}=="9227", MODE="0666"' | sudo tee /etc/udev/rules.d/99-apple-tb-display.rules
sudo udevadm control --reload
sudo udevadm trigger --action=change --subsystem-match=usbmisc
```

Check it works as your normal user:

```bash
acdcontrol --detect /dev/usb/hiddev*
acdcontrol /dev/usb/hiddevN --auto-brightness status    # N from the detect output
```

Lines saying "Permission denied" for other hiddev devices are normal; only the display gets opened up.

### If the display doesn't show up at all

Check `lsusb | grep -i 05ac:9227`. If it's missing but the screen shows a picture, the display's USB side hasn't been connected over Thunderbolt:

* **Thunderbolt security:** many systems (including Macs running Linux) ask you to approve each Thunderbolt device. Check `cat /sys/bus/thunderbolt/devices/0-1/authorized`; if it says `0`, approve the display permanently with [bolt](https://gitlab.freedesktop.org/bolt/bolt): `boltctl list`, then `boltctl enroll --policy auto <the display's uuid>`.
* **Daisy chains:** only the computer on the display's own attached cable gets its USB devices. A computer plugged into the display's rear Thunderbolt port does not.

## Step 3a: GNOME

Download `tbdisplay-brightness@bedrockgeo.github.io.shell-extension.zip` from [Releases](https://github.com/bedrockgeo/tbdisplay-brightness/releases), then:

```bash
gnome-extensions install --force tbdisplay-brightness@bedrockgeo.github.io.shell-extension.zip
```

Log out and back in (Wayland only loads new extensions at login), then:

```bash
gnome-extensions enable tbdisplay-brightness@bedrockgeo.github.io
```

Open Quick Settings. The slider sits with the built in ones; click the arrow beside it for Automatic Brightness.

Upgrading from version 1: the extension ID changed from `tbdisplay-brightness@local`. Remove the old one first with `gnome-extensions uninstall tbdisplay-brightness@local`.

## Step 3b: KDE Plasma 6

Download `tbdisplay-brightness-kde.plasmoid` from [Releases](https://github.com/bedrockgeo/tbdisplay-brightness/releases), then:

```bash
kpackagetool6 --type Plasma/Applet --install tbdisplay-brightness-kde.plasmoid
```

No log out needed. Then either:

* **Panel:** right click the panel, choose Add Widgets, search "Thunderbolt" and drag it onto the panel, or
* **System tray:** right click the tray arrow, choose Configure System Tray, then Entries, and set Thunderbolt Display Brightness to Always shown.

Click the icon for the slider and switch, or scroll over it to change brightness in 5% steps. To upgrade later, use `--upgrade` instead of `--install`.

## Other Apple displays

The brightness range is set near the top of `gnome/extension.js` (`MAX_LEVEL`) and `kde/package/contents/ui/main.qml` (`maxLevel`):

| Display | USB ID | Range | Max level |
|---|---|---|---|
| Thunderbolt Display 27" | 05ac:9227 | 0 to 65535 | 65535 (default) |
| LED Cinema Display 27" | 05ac:9226 | 0 to 1023 | 1023 |
| Older Cinema Displays | various | 0 to 255 | 255 |

Change the product ID in the udev rule to match your display too. Only the Thunderbolt Display has been tested.

## Troubleshooting

* **No slider or widget says "Display not found":** run `acdcontrol --detect /dev/usb/hiddev*` as your normal user. Permission denied on the display means the udev rule isn't applied; nothing found means see "If the display doesn't show up at all".
* **Slider moves but the screen stays dim:** acdcontrol still has the 1023 cap. Rebuild it with the patch in step 1.
* **No auto switch:** acdcontrol lacks the automatic brightness patch. `acdcontrol /dev/usb/hiddevN --auto-brightness status` should print `AUTO_BRIGHTNESS=on` or `off`.
* **Brightness drifts after you set it:** Automatic Brightness is on, and the display keeps adjusting from its light sensor. Turn the switch off for a fixed level.
* **Logs:** GNOME, `journalctl -f -o cat /usr/bin/gnome-shell`. KDE, run `plasmoidviewer -a io.github.bedrockgeo.tbdisplaybrightness` in a terminal.

## License

GPL 2.0 or later. See [LICENSE](LICENSE).
