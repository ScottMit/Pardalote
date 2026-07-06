title: WiFi configuration
lede: Two ways to give Pardalote your network details — use either, or both.
---
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

Credentials survive re-uploads and power cycles. Up to **5 networks** can be stored — useful for moving between home, studio, and classroom. Press `w` within 5 seconds of any boot to update them.

## Both options together

If `SECRET_SSID` is defined and EEPROM networks are also stored, Pardalote tries `secrets.h` first, then falls back to the EEPROM networks in order.

## After connecting

The board announces its IP address:

- **UNO R4 WiFi:** scrolls across the LED matrix
- **ESP32:** printed in the Serial Monitor at 115200 baud

That's the address your browser connects to — see [Connecting](connecting.html).
