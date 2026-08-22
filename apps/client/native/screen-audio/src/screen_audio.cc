#include <napi.h>

// Platform-specific forward declarations
#if defined(_WIN32)
bool platform_is_supported();
bool platform_start(uint32_t excludePid, uint32_t sampleRate, uint32_t channels,
                    Napi::ThreadSafeFunction tsfn);
void platform_stop();
#elif defined(__MACOS__)
bool platform_is_supported();
bool platform_start(uint32_t excludePid, uint32_t sampleRate, uint32_t channels,
                    Napi::ThreadSafeFunction tsfn);
void platform_stop();
#else
bool platform_is_supported() { return false; }
bool platform_start(uint32_t, uint32_t, uint32_t, Napi::ThreadSafeFunction) { return false; }
void platform_stop() {}
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

  g_tsfn = Napi::ThreadSafeFunction::New(
    env,
    callback,
    "ScreenAudioCallback",
    0,   // unlimited queue
    1    // one thread
  );

  bool ok = platform_start(excludePid, sampleRate, channels, g_tsfn);
  if (ok) {
    g_running = true;
    result.Set("success", Napi::Boolean::New(env, true));
  } else {
    g_tsfn.Release();
    result.Set("success", Napi::Boolean::New(env, false));
    result.Set("error", Napi::String::New(env, "Platform start failed"));
  }
  return result;
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);

  if (g_running) {
    platform_stop();
    g_tsfn.Release();
    g_running = false;
    result.Set("success", Napi::Boolean::New(env, true));
  } else {
    result.Set("success", Napi::Boolean::New(env, false));
  }
  return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("isSupported", Napi::Function::New(env, IsSupported));
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  return exports;
}

NODE_API_MODULE(screen_audio, Init)
