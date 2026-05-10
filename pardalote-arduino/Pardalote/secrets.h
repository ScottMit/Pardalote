// ==============================================================
// secrets.h
// Optional compile-time WiFi credentials
// ==============================================================
//
// Two ways to configure WiFi — use one or both:
//
// OPTION A — Compile-time (this file)
//   Uncomment SECRET_SSID and SECRET_PASS below.
//   The Arduino tries this network first on every boot.
//   Simple, credentials are baked into the firmware binary.
//   Best for: personal projects, single-network setups.
//
// OPTION B — EEPROM (Serial Monitor config menu)
//   Leave this file unchanged (defines commented out).
//   Enter credentials via the Serial Monitor on first boot.
//   Credentials survive re-uploads and are stored on-device.
//   Best for: multiple networks, classrooms.
//
// Both options can be active at the same time — secrets.h is
// tried first, then EEPROM networks in order.
//
// SECURITY NOTE: if this file contains real credentials,
// add secrets.h to .gitignore before committing to a repository.
// ==============================================================

// #define SECRET_SSID "YourWiFiName"
// #define SECRET_PASS "YourWiFiPassword"
