#pragma once
#include <napi.h>
#include <cstdint>

bool platform_is_supported();
bool platform_start(uint32_t targetPid, uint32_t loopbackMode, int64_t includeWindowId,
                    uint32_t sampleRate, uint32_t channels,
                    Napi::ThreadSafeFunction tsfn);
uint32_t platform_pid_for_hwnd(int64_t hwnd);
void platform_stop();
const char* platform_get_last_error();
int platform_get_status();
