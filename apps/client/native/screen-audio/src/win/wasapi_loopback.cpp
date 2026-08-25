/**
 * WASAPI Process Loopback Capture (Windows 10 2004+)
 *
 * Two capture targets are supported via ActivateAudioInterfaceAsync:
 *   - loopbackMode 0 (EXCLUDE): capture the whole system audio EXCLUDING the
 *     Monky process tree (targetPid = our own pid). Used for full-screen
 *     sharing.
 *   - loopbackMode 1 (INCLUDE): capture ONLY the target application's process
 *     tree (targetPid = shared window's pid). Used for single-app sharing.
 *
 * Uses the device's mix format (GetMixFormat) and converts to float32 stereo
 * 48 kHz before delivering frames to JS via Napi::ThreadSafeFunction.
 */

#include "wasapi_loopback.h"

#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <functiondiscoverykeys_devpkey.h>
#include <combaseapi.h>
#include <avrt.h>
#include <wrl/client.h>
#include <wrl/implements.h>
#include <atomic>
#include <thread>
#include <vector>
#include <string>
#include <mutex>
#include <cstring>
#include <cmath>

#include <audioclientactivationparams.h>

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::FtmBase;

static std::atomic<bool> g_captureRunning{false};
static std::thread g_captureThread;
static Napi::ThreadSafeFunction g_tsfn_win;

// Error / status reporting (thread-safe)
static std::mutex g_statusMutex;
static std::string g_lastError;
static std::atomic<int> g_status{0}; // 0=idle, 1=starting, 2=capturing, 3=error

static void setError(const std::string& msg) {
  std::lock_guard<std::mutex> lock(g_statusMutex);
  g_lastError = msg;
  g_status.store(3);
}

static void setCapturing() {
  std::lock_guard<std::mutex> lock(g_statusMutex);
  g_lastError.clear();
  g_status.store(2);
}

// Event used to signal that the capture thread has finished initialisation
static HANDLE g_initDoneEvent = nullptr;

// Completion handler for ActivateAudioInterfaceAsync
class ActivateAudioInterfaceCompletionHandler
    : public RuntimeClass<RuntimeClassFlags<ClassicCom>, IActivateAudioInterfaceCompletionHandler, FtmBase> {
public:
  ActivateAudioInterfaceCompletionHandler() : m_hEvent(CreateEventW(nullptr, FALSE, FALSE, nullptr)) {}
  ~ActivateAudioInterfaceCompletionHandler() { if (m_hEvent) CloseHandle(m_hEvent); }

  STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* operation) {
    m_operation = operation;
    SetEvent(m_hEvent);
    return S_OK;
  }

  HANDLE GetEvent() const { return m_hEvent; }
  IActivateAudioInterfaceAsyncOperation* GetOperation() const { return m_operation.Get(); }

private:
  HANDLE m_hEvent;
  ComPtr<IActivateAudioInterfaceAsyncOperation> m_operation;
};

// Helper: convert a single sample from the source format to float32 [-1,1]
static inline float sampleToFloat(const BYTE* src, WORD bitsPerSample, WORD formatTag) {
  if (formatTag == WAVE_FORMAT_IEEE_FLOAT) {
    if (bitsPerSample == 32) return *reinterpret_cast<const float*>(src);
    if (bitsPerSample == 64) return static_cast<float>(*reinterpret_cast<const double*>(src));
  }
  // PCM integer
  if (bitsPerSample == 16) {
    int16_t v = *reinterpret_cast<const int16_t*>(src);
    return v / 32768.0f;
  }
  if (bitsPerSample == 24) {
    int32_t v = (static_cast<int32_t>(src[2]) << 24) |
                (static_cast<int32_t>(src[1]) << 16) |
                (static_cast<int32_t>(src[0]) << 8);
    return v / 2147483648.0f;
  }
  if (bitsPerSample == 32) {
    int32_t v = *reinterpret_cast<const int32_t*>(src);
    return v / 2147483648.0f;
  }
  return 0.0f;
}

static void CaptureThreadFunc(uint32_t targetPid, uint32_t loopbackMode, uint32_t targetSampleRate, uint32_t targetChannels) {
  auto signalInitDone = [&]() { if (g_initDoneEvent) SetEvent(g_initDoneEvent); };

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) {
    setError("CoInitializeEx failed: " + std::to_string(hr));
    signalInitDone();
    return;
  }

  // Setup activation params for process loopback (include or exclude tree)
  AUDIOCLIENT_ACTIVATION_PARAMS clientParams = {};
  clientParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  clientParams.ProcessLoopbackParams.TargetProcessId = targetPid;
  clientParams.ProcessLoopbackParams.ProcessLoopbackMode =
      (loopbackMode == 1) ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
                          : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT activateParams = {};
  activateParams.vt = VT_BLOB;
  activateParams.blob.cbSize = sizeof(clientParams);
  activateParams.blob.pBlobData = reinterpret_cast<BYTE*>(&clientParams);

  auto completionHandler = Microsoft::WRL::Make<ActivateAudioInterfaceCompletionHandler>();
  ComPtr<IActivateAudioInterfaceAsyncOperation> asyncOp;

  hr = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
      __uuidof(IAudioClient),
      &activateParams,
      completionHandler.Get(),
      &asyncOp);

  if (FAILED(hr)) {
    setError("ActivateAudioInterfaceAsync failed: " + std::to_string(hr));
    signalInitDone();
    CoUninitialize();
    return;
  }

  DWORD waitRet = WaitForSingleObject(completionHandler->GetEvent(), 5000);
  if (waitRet != WAIT_OBJECT_0) {
    setError("ActivateAudioInterfaceAsync timed out");
    signalInitDone();
    CoUninitialize();
    return;
  }

  HRESULT activateResult = E_FAIL;
  ComPtr<IUnknown> activatedInterface;
  hr = completionHandler->GetOperation()->GetActivateResult(&activateResult, &activatedInterface);
  if (FAILED(hr) || FAILED(activateResult)) {
    setError("GetActivateResult failed: hr=" + std::to_string(hr) + " activate=" + std::to_string(activateResult));
    signalInitDone();
    CoUninitialize();
    return;
  }

  ComPtr<IAudioClient> audioClient;
  hr = activatedInterface.As(&audioClient);
  if (FAILED(hr)) {
    setError("QueryInterface IAudioClient failed: " + std::to_string(hr));
    signalInitDone();
    CoUninitialize();
    return;
  }

  // The virtual process-loopback device does NOT support GetMixFormat()
  // (returns E_NOTIMPL).  Query the default render endpoint instead — the
  // loopback capture delivers samples in the render engine's mix format.
  WAVEFORMATEX* pMixFormat = nullptr;
  {
    ComPtr<IMMDeviceEnumerator> enumerator;
    hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                          __uuidof(IMMDeviceEnumerator),
                          reinterpret_cast<void**>(enumerator.GetAddressOf()));
    if (FAILED(hr)) {
      setError("CoCreateInstance(MMDeviceEnumerator) failed: " + std::to_string(hr));
      signalInitDone();
      CoUninitialize();
      return;
    }

    ComPtr<IMMDevice> defaultDevice;
    hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, defaultDevice.GetAddressOf());
    if (FAILED(hr)) {
      setError("GetDefaultAudioEndpoint failed: " + std::to_string(hr));
      signalInitDone();
      CoUninitialize();
      return;
    }

    ComPtr<IAudioClient> tmpClient;
    hr = defaultDevice->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                                  reinterpret_cast<void**>(tmpClient.GetAddressOf()));
    if (FAILED(hr)) {
      setError("Activate default endpoint IAudioClient failed: " + std::to_string(hr));
      signalInitDone();
      CoUninitialize();
      return;
    }

    hr = tmpClient->GetMixFormat(&pMixFormat);
    if (FAILED(hr) || !pMixFormat) {
      setError("GetMixFormat (default endpoint) failed: " + std::to_string(hr));
      signalInitDone();
      CoUninitialize();
      return;
    }
  }

  // Determine actual format details (may be WAVEFORMATEXTENSIBLE)
  WORD srcFormatTag = pMixFormat->wFormatTag;
  if (srcFormatTag == WAVE_FORMAT_EXTENSIBLE) {
    auto* ext = reinterpret_cast<WAVEFORMATEXTENSIBLE*>(pMixFormat);
    if (ext->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT) {
      srcFormatTag = WAVE_FORMAT_IEEE_FLOAT;
    } else if (ext->SubFormat == KSDATAFORMAT_SUBTYPE_PCM) {
      srcFormatTag = WAVE_FORMAT_PCM;
    }
  }

  WORD srcChannels = pMixFormat->nChannels;
  DWORD srcSampleRate = pMixFormat->nSamplesPerSec;
  WORD srcBitsPerSample = pMixFormat->wBitsPerSample;
  WORD srcBlockAlign = pMixFormat->nBlockAlign;
  WORD srcBytesPerSample = srcBitsPerSample / 8;

  HANDLE hCaptureEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);

  hr = audioClient->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
      0, 0, pMixFormat, nullptr);

  if (FAILED(hr)) {
    setError("IAudioClient::Initialize failed: " + std::to_string(hr) +
             " (fmt=" + std::to_string(srcFormatTag) +
             " ch=" + std::to_string(srcChannels) +
             " sr=" + std::to_string(srcSampleRate) +
             " bps=" + std::to_string(srcBitsPerSample) + ")");
    CoTaskMemFree(pMixFormat);
    CloseHandle(hCaptureEvent);
    signalInitDone();
    CoUninitialize();
    return;
  }

  hr = audioClient->SetEventHandle(hCaptureEvent);
  if (FAILED(hr)) {
    setError("SetEventHandle failed: " + std::to_string(hr));
    CoTaskMemFree(pMixFormat);
    CloseHandle(hCaptureEvent);
    signalInitDone();
    CoUninitialize();
    return;
  }

  ComPtr<IAudioCaptureClient> captureClient;
  hr = audioClient->GetService(__uuidof(IAudioCaptureClient),
                               reinterpret_cast<void**>(captureClient.GetAddressOf()));
  if (FAILED(hr)) {
    setError("GetService(IAudioCaptureClient) failed: " + std::to_string(hr));
    CoTaskMemFree(pMixFormat);
    CloseHandle(hCaptureEvent);
    signalInitDone();
    CoUninitialize();
    return;
  }

  DWORD taskIndex = 0;
  HANDLE hTask = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);

  hr = audioClient->Start();
  if (FAILED(hr)) {
    setError("IAudioClient::Start failed: " + std::to_string(hr));
    if (hTask) AvRevertMmThreadCharacteristics(hTask);
    CoTaskMemFree(pMixFormat);
    CloseHandle(hCaptureEvent);
    signalInitDone();
    CoUninitialize();
    return;
  }

  // Successfully started — report to JS
  setCapturing();
  signalInitDone();

  // Resampling state (simple nearest-neighbour; sufficient for loopback audio)
  double resampleRatio = (srcSampleRate != targetSampleRate)
      ? static_cast<double>(targetSampleRate) / srcSampleRate
      : 1.0;
  bool needsResample = (srcSampleRate != targetSampleRate);
  bool needsChannelConvert = (srcChannels != static_cast<WORD>(targetChannels));
  bool needsFormatConvert = !(srcFormatTag == WAVE_FORMAT_IEEE_FLOAT && srcBitsPerSample == 32
                              && !needsResample && !needsChannelConvert);

  while (g_captureRunning.load()) {
    DWORD waitResult = WaitForSingleObject(hCaptureEvent, 100);
    if (waitResult != WAIT_OBJECT_0) continue;

    UINT32 packetLength = 0;
    hr = captureClient->GetNextPacketSize(&packetLength);
    while (SUCCEEDED(hr) && packetLength > 0 && g_captureRunning.load()) {
      BYTE* data = nullptr;
      UINT32 numFrames = 0;
      DWORD flags = 0;

      hr = captureClient->GetBuffer(&data, &numFrames, &flags, nullptr, nullptr);
      if (FAILED(hr)) break;

      if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT) && numFrames > 0) {
        std::vector<uint8_t>* outBuf = nullptr;

        if (!needsFormatConvert) {
          // Already float32, same SR and channels — pass through
          size_t byteLen = numFrames * srcBlockAlign;
          outBuf = new std::vector<uint8_t>(data, data + byteLen);
        } else {
          // Convert to float32 interleaved, target SR and channels
          uint32_t outFrames = needsResample
              ? static_cast<uint32_t>(std::ceil(numFrames * resampleRatio))
              : numFrames;
          size_t outSize = outFrames * targetChannels * sizeof(float);
          outBuf = new std::vector<uint8_t>(outSize);
          float* out = reinterpret_cast<float*>(outBuf->data());

          for (uint32_t i = 0; i < outFrames; i++) {
            // Source frame index (nearest-neighbour resampling)
            uint32_t srcFrame = needsResample
                ? static_cast<uint32_t>(i / resampleRatio)
                : i;
            if (srcFrame >= numFrames) srcFrame = numFrames - 1;

            const BYTE* frameStart = data + srcFrame * srcBlockAlign;
            for (uint32_t ch = 0; ch < targetChannels; ch++) {
              uint32_t srcCh = (ch < srcChannels) ? ch : 0; // mono→stereo: duplicate
              const BYTE* samplePtr = frameStart + srcCh * srcBytesPerSample;
              out[i * targetChannels + ch] = sampleToFloat(samplePtr, srcBitsPerSample, srcFormatTag);
            }
          }
        }

        g_tsfn_win.NonBlockingCall(outBuf, [](Napi::Env env, Napi::Function jsCallback,
                                              std::vector<uint8_t>* bufData) {
          auto nodeBuffer = Napi::Buffer<uint8_t>::Copy(env, bufData->data(), bufData->size());
          jsCallback.Call({nodeBuffer});
          delete bufData;
        });
      }

      captureClient->ReleaseBuffer(numFrames);
      hr = captureClient->GetNextPacketSize(&packetLength);
    }
  }

  audioClient->Stop();
  if (hTask) AvRevertMmThreadCharacteristics(hTask);
  CoTaskMemFree(pMixFormat);
  CloseHandle(hCaptureEvent);
  CoUninitialize();
}

bool platform_is_supported() {
  OSVERSIONINFOEXW osvi = {};
  osvi.dwOSVersionInfoSize = sizeof(osvi);
  typedef NTSTATUS(NTAPI* RtlGetVersionPtr)(PRTL_OSVERSIONINFOW);
  auto ntdll = GetModuleHandleW(L"ntdll.dll");
  if (!ntdll) return false;
  auto rtlGetVersion = reinterpret_cast<RtlGetVersionPtr>(GetProcAddress(ntdll, "RtlGetVersion"));
  if (!rtlGetVersion) return false;
  rtlGetVersion(reinterpret_cast<PRTL_OSVERSIONINFOW>(&osvi));
  return (osvi.dwMajorVersion > 10) ||
         (osvi.dwMajorVersion == 10 && osvi.dwBuildNumber >= 19041);
}

bool platform_start(uint32_t targetPid, uint32_t loopbackMode, uint32_t sampleRate, uint32_t channels,
                    Napi::ThreadSafeFunction tsfn) {
  if (g_captureRunning.load()) return false;
  g_tsfn_win = tsfn;
  g_captureRunning.store(true);
  g_status.store(1); // starting
  {
    std::lock_guard<std::mutex> lock(g_statusMutex);
    g_lastError.clear();
  }

  // Create event so we can wait for the thread to finish init
  g_initDoneEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  g_captureThread = std::thread(CaptureThreadFunc, targetPid, loopbackMode, sampleRate, channels);

  // Wait up to 3 seconds for the thread to signal init done
  if (g_initDoneEvent) {
    WaitForSingleObject(g_initDoneEvent, 3000);
    CloseHandle(g_initDoneEvent);
    g_initDoneEvent = nullptr;
  }

  // If the thread reported an error, clean up
  if (g_status.load() == 3) {
    g_captureRunning.store(false);
    if (g_captureThread.joinable()) g_captureThread.join();
    return false;
  }

  return true;
}

void platform_stop() {
  g_captureRunning.store(false);
  if (g_captureThread.joinable()) {
    g_captureThread.join();
  }
  g_status.store(0);
}

// Exposed to screen_audio.cc via header
const char* platform_get_last_error() {
  std::lock_guard<std::mutex> lock(g_statusMutex);
  // Return pointer to static string — valid until next call
  static std::string s_copy;
  s_copy = g_lastError;
  return s_copy.c_str();
}

int platform_get_status() {
  return g_status.load();
}

// Resolve the owning process id for a top-level window handle. Used to target a
// single application's audio (INCLUDE process tree) when sharing one window.
uint32_t platform_pid_for_hwnd(int64_t hwnd) {
  if (hwnd == 0) return 0;
  DWORD pid = 0;
  GetWindowThreadProcessId(reinterpret_cast<HWND>(static_cast<uintptr_t>(hwnd)), &pid);
  return static_cast<uint32_t>(pid);
}
