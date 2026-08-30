// Stub <esp_system.h> — host -fsyntax-only.
#pragma once
#include <cstdint>
extern "C" {
uint32_t esp_random(void);
uint32_t esp_get_free_heap_size(void);
void     esp_restart(void);
}
