#pragma once
#include <napi.h>
#include <cstdint>

bool platform_is_supported();
bool platform_start(uint32_t targetPid, uint32_t loopbackMode, uint32_t sampleRate, uint32_t channels,
                    Napi::ThreadSafeFunction tsfn);
void platform_stop();
