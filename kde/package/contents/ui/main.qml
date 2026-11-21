// SPDX-License-Identifier: GPL-2.0-or-later
// Thunderbolt Display Brightness, Plasma 6 widget.
// Brightness slider and automatic brightness switch for the Apple
// Thunderbolt Display, driven through the acdcontrol command line tool
// (built with its 1023 cap removed and auto brightness enabled for 0x9227).

import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.plasma5support as P5Support
import org.kde.kirigami as Kirigami

PlasmoidItem {
    id: root

    // The Thunderbolt Display's brightness runs 0 to 65535. Older Apple
    // displays use 0 to 255 or 0 to 1023; change maxLevel to match yours.
    readonly property int maxLevel: 65535
    // Keep the slider's bottom end from turning the backlight fully off.
    readonly property int minLevel: 1000
    // Scroll wheel step on the panel icon, as a share of the range.
    readonly property real wheelStep: 0.05

    property string device: ""
    property int level: 0
    property bool autoSupported: false
    property bool autoOn: false
    property bool busy: false
    property var pending: null
    property double lastUserChange: 0
    property int seq: 0

    readonly property int percent: Math.round(100 * (level - minLevel) / (maxLevel - minLevel))

    Plasmoid.status: device !== "" ? PlasmaCore.Types.ActiveStatus : PlasmaCore.Types.PassiveStatus
    toolTipMainText: i18n("Thunderbolt Display")
    toolTipSubText: device === "" ? i18n("Display not found")
                  : autoOn ? i18n("Brightness %1% (automatic)", Math.max(0, percent))
                  : i18n("Brightness %1%", Math.max(0, percent))

    // Runs shell commands. Each command ends in a "# tag N" comment so the
    // reply can be matched to what was asked and repeated commands stay unique.
    P5Support.DataSource {
        id: exec
        engine: "executable"
        connectedSources: []
        onNewData: (sourceName, data) => {
            exec.disconnectSource(sourceName);
            root.handle(sourceName, (data["stdout"] || "") + (data["stderr"] || ""));
        }
    }

    function run(cmd, tag) {
        seq += 1;
        exec.connectSource(cmd + " 2>&1 # " + tag + " " + seq);
    }

    function detect() {
        run("acdcontrol --detect /dev/usb/hiddev*", "detect");
    }

    function refresh() {
        if (device === "") {
            detect();
            return;
        }
        run("acdcontrol " + device + " --auto-brightness status", "status");
    }

    function setLevel(newLevel) {
        lastUserChange = Date.now();
        level = Math.max(minLevel, Math.min(maxLevel, Math.round(newLevel)));
        pending = level;
        if (!busy)
            flush();
    }

    // Send only the latest slider position, one acdcontrol call at a time.
    function flush() {
        if (pending === null || device === "") {
            busy = false;
            return;
        }
        busy = true;
        const value = pending;
        pending = null;
        run("acdcontrol " + device + " " + value, "set");
    }

    function setAuto(on) {
        autoOn = on;
        run("acdcontrol " + device + " --auto-brightness " + (on ? "on" : "off"), "auto");
    }

    function applyBrightness(out) {
        const m = out.match(/BRIGHTNESS=(\d+)/);
        if (!m) {
            // Display unplugged or hiddev number changed; detect again next time.
            device = "";
            return false;
        }
        const recentlyMoved = Date.now() - lastUserChange < 1500;
        if (!busy && !recentlyMoved)
            level = parseInt(m[1], 10);
        return true;
    }

    function handle(source, out) {
        const tag = source.split("# ")[1].split(" ")[0];
        if (tag === "detect") {
            device = "";
            const lines = out.split("\n");
            for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(/^(\/dev\/\S*hiddev\d+):/);
                if (m && /\bSUPPORTED\b/.test(lines[i]) && !/NOT\s+SUPPORTED|UNSUPPORTED/i.test(lines[i])) {
                    device = m[1];
                    break;
                }
            }
            if (device !== "")
                refresh();
        } else if (tag === "status") {
            const a = out.match(/AUTO_BRIGHTNESS=(on|off)/);
            autoSupported = a !== null;
            if (autoSupported) {
                autoOn = a[1] === "on";
                applyBrightness(out);
            } else if (device !== "") {
                run("acdcontrol " + device, "read");
            }
        } else if (tag === "read") {
            applyBrightness(out);
        } else if (tag === "set") {
            flush();
        } else if (tag === "auto") {
            refresh();
        }
    }

    Component.onCompleted: detect()

    // Reread when the popup opens, and follow the display while automatic
    // brightness is on and the popup is showing.
    onExpandedChanged: if (expanded) refresh()
    Timer {
        interval: 2000
        repeat: true
        running: root.expanded && root.autoOn && root.device !== ""
        onTriggered: root.refresh()
    }

    compactRepresentation: MouseArea {
        acceptedButtons: Qt.LeftButton
        onClicked: root.expanded = !root.expanded
        onWheel: wheel => {
            if (root.device === "")
                return;
            const step = (root.maxLevel - root.minLevel) * root.wheelStep;
            root.setLevel(root.level + (wheel.angleDelta.y > 0 ? step : -step));
        }
        Kirigami.Icon {
            anchors.fill: parent
            source: Plasmoid.icon
            active: parent.containsMouse
        }
        hoverEnabled: true
    }

    fullRepresentation: ColumnLayout {
        Layout.preferredWidth: Kirigami.Units.gridUnit * 18
        spacing: Kirigami.Units.smallSpacing

        Kirigami.Heading {
            level: 4
            text: i18n("Thunderbolt Display")
        }

        PlasmaComponents3.Label {
            visible: root.device === ""
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            text: i18n("Display not found. Check that it is connected and that acdcontrol --detect /dev/usb/hiddev* finds it without sudo.")
        }

        RowLayout {
            visible: root.device !== ""
            Layout.fillWidth: true
            Kirigami.Icon {
                source: "video-display-brightness"
                Layout.preferredWidth: Kirigami.Units.iconSizes.small
                Layout.preferredHeight: Kirigami.Units.iconSizes.small
            }
            PlasmaComponents3.Slider {
                id: slider
                Layout.fillWidth: true
                from: root.minLevel
                to: root.maxLevel
                value: root.level
                onMoved: root.setLevel(value)
            }
            PlasmaComponents3.Label {
                text: Math.max(0, root.percent) + "%"
                Layout.minimumWidth: Kirigami.Units.gridUnit * 2.5
                horizontalAlignment: Text.AlignRight
            }
        }

        PlasmaComponents3.Switch {
            visible: root.device !== "" && root.autoSupported
            text: i18n("Automatic Brightness")
            checked: root.autoOn
            onToggled: root.setAuto(checked)
        }
    }
}
