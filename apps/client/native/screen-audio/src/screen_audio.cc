#include <napi.h>

// Platform-specific forward declarations
#if defined(_WIN32)
bool platform_is_supported();
bool platform_start(uint32_t targetPid, uint32_t loopbackMode, uint32_t sampleRate, uint32_t channels,
                    Napi::ThreadSafeFunction tsfn);
uint32_t platform_pid_for_hwnd(int64_t hwnd);
void platform_stop();
const char* platform_get_last_error();
int platform_get_status();
#elif defined(__MACOS__)
bool platform_is_supported();
bool platform_start(uint32_t targetPid, uint32_t loopbackMode, uint32_t sampleRate, uint32_t channels,
                    Napi::ThreadSafeFunction tsfn);
void platform_stop();
const char* platform_get_last_error() { return ""; }
int platform_get_status() { return 0; }
#else
bool platform_is_supported() { return false; }
bool platform_start(uint32_t, uint32_t, uint32_t, uint32_t, Napi::ThreadSafeFunction) { return false; }
void platform_stop() {}
const char* platform_get_last_error() { return ""; }
int platform_get_status() { return 0; }
#endif

static Napi::ThreadSafeFunction g_tsfn;
static bool g_running = false;

Napi::Value IsSupported(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), platform_is_supported());
}

Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);

  if (g_running) {
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", Napi::String::New(env, "Already capturing"));
    return result;
  }

  if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", Napi::String::New(env, "Expected (options, callback)"));
    return result;
  }

  Napi::Object opts = info[0].As<Napi::Object>();
  Napi::Function callback = info[1].As<Napi::Function>();

  uint32_t excludePid = 0;
  uint32_t sampleRate = 48000;
  uint32_t channels = 2;

  if (opts.Has("excludePid") && opts.Get("excludePid").IsNumber()) {
    excludePid = opts.Get("excludePid").As<Napi::Number>().Uint32Value();
  }
  if (opts.Has("sampleRate") && opts.Get("sampleRate").IsNumber()) {
    sampleRate = opts.Get("sampleRate").As<Napi::Number>().Uint32Value();
  }
  if (opts.Has("channels") && opts.Get("channels").IsNumber()) {
    channels = opts.Get("channels").As<Napi::Number>().Uint32Value();
  }

  // By default capture the whole system minus our own process tree (EXCLUDE).
  // When a specific window handle is provided, capture ONLY that window's
  // application process tree (INCLUDE) so unrelated app audio is not shared.
  uint32_t targetPid = excludePid;
  uint32_t loopbackMode = 0; // 0 = exclude tree, 1 = include tree
#if defined(_WIN32)
  if (opts.Has("includeHwnd") && opts.Get("includeHwnd").IsNumber()) {
    int64_t includeHwnd = opts.Get("includeHwnd").As<Napi::Number>().Int64Value();
    if (includeHwnd != 0) {
      uint32_t appPid = platform_pid_for_hwnd(includeHwnd);
      if (appPid != 0) {
        targetPid = appPid;
        loopbackMode = 1;
      }
    }
  }
#endif

  g_tsfn = Napi::ThreadSafeFunction::New(
    env,
    callback,
    "ScreenAudioCallback",
    0,   // unlimited queue
    1    // one thread
  );

  bool ok = platform_start(targetPid, loopbackMode, sampleRate, channels, g_tsfn);
  if (ok) {
    g_running = true;
    result.Set("success", Napi::Boolean::New(env, true));
  } else {
    g_tsfn.Release();
    result.Set("success", Napi::Boolean::New(env, false));
    // Return the detailed error from the platform layer
    const char* err = platform_get_last_error();
    result.Set("error", Napi::String::New(env, (err && err[0]) ? err : "Platform start failed"));
  }
  return result;
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);

  if (g_running) {
    g_running = false;
    platform_stop();
    g_tsfn.Release();
    result.Set("success", Napi::Boolean::New(env, true));
  } else {
    result.Set("success", Napi::Boolean::New(env, false));
  }
  return result;
}

Napi::Value GetLastError(const Napi::CallbackInfo& info) {
  const char* err = platform_get_last_error();
  return Napi::String::New(info.Env(), err ? err : "");
}

Napi::Value GetStatus(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), platform_get_status());
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("isSupported", Napi::Function::New(env, IsSupported));
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("getLastError", Napi::Function::New(env, GetLastError));
  exports.Set("getStatus", Napi::Function::New(env, GetStatus));
  return exports;
}

NODE_API_MODULE(screen_audio, Init)
