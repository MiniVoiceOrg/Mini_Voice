/**
 * WASAPI Process Loopback Capture (Windows 10 2004+)
 *
 * Captures system audio EXCLUDING the MiniVoice process tree using
 * ActivateAudioInterfaceAsync with PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE.
 *
 * Output: PCM float32 interleaved, 48kHz stereo (configurable).
 * Delivers frames via Napi::ThreadSafeFunction to the Node.js event loop.
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
#include <cstring>

// Only available on Windows 10 2004+ (build 19041+)
#include <audioclientactivationparams.h>

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::FtmBase;

static std::atomic<bool> g_captureRunning{false};
static std::thread g_captureThread;
static Napi::ThreadSafeFunction g_tsfn_win;

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

static void CaptureThreadFunc(uint32_t excludePid, uint32_t sampleRate, uint32_t channels) {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) return;

  // Setup activation params for process loopback exclude
  AUDIOCLIENT_ACTIVATION_PARAMS clientParams = {};
  clientParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  clientParams.ProcessLoopbackParams.TargetProcessId = excludePid;
  clientParams.ProcessLoopbackParams.ProcessLoopbackMode =
      PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

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

  if (FAILED(hr)) { CoUninitialize(); return; }

  WaitForSingleObject(completionHandler->GetEvent(), 5000);

  HRESULT activateResult = E_FAIL;
  ComPtr<IUnknown> activatedInterface;
  hr = completionHandler->GetOperation()->GetActivateResult(&activateResult, &activatedInterface);
  if (FAILED(hr) || FAILED(activateResult)) { CoUninitialize(); return; }

  ComPtr<IAudioClient> audioClient;
  hr = activatedInterface.As(&audioClient);
  if (FAILED(hr)) { CoUninitialize(); return; }

  // Configure format: float32, specified sample rate and channels
  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
  format.nChannels = static_cast<WORD>(channels);
  format.nSamplesPerSec = sampleRate;
  format.wBitsPerSample = 32;
  format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
  format.cbSize = 0;

  // Use event-driven mode for low-latency capture
  HANDLE hCaptureEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);

  hr = audioClient->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
      0, 0, &format, nullptr);

  if (FAILED(hr)) {
    CloseHandle(hCaptureEvent);
    CoUninitialize();
    return;
  }

  hr = audioClient->SetEventHandle(hCaptureEvent);
  if (FAILED(hr)) { CloseHandle(hCaptureEvent); CoUninitialize(); return; }

  ComPtr<IAudioCaptureClient> captureClient;
  hr = audioClient->GetService(__uuidof(IAudioCaptureClient),
                               reinterpret_cast<void**>(captureClient.GetAddressOf()));
  if (FAILED(hr)) { CloseHandle(hCaptureEvent); CoUninitialize(); return; }

  // Boost thread priority
  DWORD taskIndex = 0;
  HANDLE hTask = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);

  hr = audioClient->Start();
  if (FAILED(hr)) {
    if (hTask) AvRevertMmThreadCharacteristics(hTask);
    CloseHandle(hCaptureEvent);
    CoUninitialize();
    return;
  }

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

      size_t byteLen = numFrames * format.nBlockAlign;
      if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT) && byteLen > 0) {
        // Copy data and deliver via TSFN
        std::vector<uint8_t>* buf = new std::vector<uint8_t>(data, data + byteLen);
        g_tsfn_win.NonBlockingCall(buf, [](Napi::Env env, Napi::Function jsCallback,
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
  CloseHandle(hCaptureEvent);
  CoUninitialize();
}

bool platform_is_supported() {
  // Check Windows 10 build 19041+ (2004)
  OSVERSIONINFOEXW osvi = {};
  osvi.dwOSVersionInfoSize = sizeof(osvi);
  // Use RtlGetVersion (always available, not lie-prone like GetVersionEx)
  typedef NTSTATUS(NTAPI* RtlGetVersionPtr)(PRTL_OSVERSIONINFOW);
  auto ntdll = GetModuleHandleW(L"ntdll.dll");
  if (!ntdll) return false;
  auto rtlGetVersion = reinterpret_cast<RtlGetVersionPtr>(GetProcAddress(ntdll, "RtlGetVersion"));
  if (!rtlGetVersion) return false;
  rtlGetVersion(reinterpret_cast<PRTL_OSVERSIONINFOW>(&osvi));
  return (osvi.dwMajorVersion > 10) ||
         (osvi.dwMajorVersion == 10 && osvi.dwBuildNumber >= 19041);
}

bool platform_start(uint32_t excludePid, uint32_t sampleRate, uint32_t channels,
                    Napi::ThreadSafeFunction tsfn) {
  if (g_captureRunning.load()) return false;
  g_tsfn_win = tsfn;
  g_captureRunning.store(true);
  g_captureThread = std::thread(CaptureThreadFunc, excludePid, sampleRate, channels);
  return true;
}

void platform_stop() {
  g_captureRunning.store(false);
  if (g_captureThread.joinable()) {
    g_captureThread.join();
  }
}
