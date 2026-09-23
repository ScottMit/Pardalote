title: WiFi configuration
lede: Two ways to give Pardalote your network details — use either, or both.
---
WiFi is Pardalote's default transport, but not the only one — the same code runs over the USB cable. The default `begin()` even listens on both: a board on WiFi will [switch to USB](connecting.html#switching-to-usb) when a browser connects over the cable. With no network at all, `Pardalote.begin(PARDALOTE_SERIAL)` skips WiFi entirely and the browser connects with [`connectSerial()`](connecting.html#connectserial) — nothing on this page is needed in that mode.

## Option A — compile-time (secrets.h)

Create a `secrets.h` file in the same folder as your sketch:

```cpp secrets.h
#define SECRET_SSID "YourWiFiName"
#define SECRET_PASS "YourWiFiPassword"
```

The credentials are baked into the firmware. Simple — but if you share or publish your code, add `secrets.h` to `.gitignore` first. Pardalote picks the file up automatically via `__has_include`; no other changes are needed.

## Option B — EEPROM (Serial Monitor)

If no `secrets.h` is present, Pardalote detects that no credentials are stored on first boot and prompts you via the Serial Monitor at 115200 baud:

```text Serial Monitor — first boot
=== Pardalote ===
No WiFi networks stored.
=== WiFi Configuration ===
[a]dd  [d]elete  [c]lear all  [s]how  [x] exit
> a
SSID: YourWiFiName
Password: ********
Saved: YourWiFiName
> x
```

Credentials survive re-uploads and power cycles. Up to **5 networks** can be stored — useful for moving between home, studio, and classroom. Press `w` in the Serial Monitor at any point while the board is trying to connect to update them.

> **Native-USB boards (ESP32-C5 / C3 / S3):** if the Serial Monitor stays blank and this menu never appears, set **Tools → USB CDC On Boot → `Enabled`** and re-upload — otherwise `Serial` isn't routed to the USB port. See [Troubleshooting](troubleshooting.html#serial-monitor-is-blank-on-an-esp32-c5-c3-or-s3-no-w-menu-board-seems-dead).

## Both options together

If `SECRET_SSID` is defined and EEPROM networks are also stored, Pardalote tries `secrets.h` first, then falls back to the EEPROM networks in order.

## How the board connects

At boot the board goes straight to connecting — there's no pause. It tries each network for up to 10 seconds, in order, and if none connects it loops back to the first one and keeps going until one does. So a board that powers up before its router is ready will join as soon as the network appears.

Before each attempt it prints a reminder:

```text Serial Monitor — connecting
=== Pardalote ===
Stored networks:
  1. Studio
  2. HomeWiFi
Press 'w' to configure WiFi (or connect over USB)
Trying: Studio
Failed.
Press 'w' to configure WiFi (or connect over USB)
Trying: HomeWiFi
```

Press `w` at any time to stop and open the configuration menu. Connecting stays paused while you're in the menu. When you exit with `x`, it starts again from the first network.

## After connecting

The board announces its IP address:

- **UNO R4 WiFi:** scrolls across the LED matrix
- **ESP32:** printed in the Serial Monitor at 115200 baud

That's the address your browser connects to — see [Connecting](connecting.html).
