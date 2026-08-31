/**
 * ScreenCaptureKit Audio Capture (macOS 13+)
 *
 * Captures audio EXCLUDING the Monky process using SCStream with
 * excludesCurrentProcessAudio = YES. When a window id is supplied the stream is
 * scoped to the application that owns it, so only that app's audio is captured
 * (#298); otherwise every application on the display is captured.
 *
 * Output: PCM float32 interleaved, 48kHz stereo (configurable). ScreenCaptureKit
 * delivers planar (non-interleaved) float32, so frames are interleaved here
 * before being handed to the renderer.
 * Delivers frames via Napi::ThreadSafeFunction to the Node.js event loop.
 */

#import "sc_capture.h"

#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>
#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#include <atomic>
#include <string>
#include <vector>

static std::atomic<bool> g_captureRunning_mac{false};
// 0=idle, 1=starting, 2=capturing, 3=error — espelha o contrato de getStatus()
// que o Windows ja implementava. Sem isso o `screen-audio:diagnose` do macOS
// sempre respondia "ocioso", mesmo com a captura no ar ou quebrada (#298).
static std::atomic<int> g_status_mac{0};
static Napi::ThreadSafeFunction g_tsfn_mac;

// Why the last start attempt failed. Written inside the ScreenCaptureKit
// completion handlers and read back on the calling thread after the flag
// they set, which orders the two.
static std::string g_lastError_mac;

const char* platform_get_last_error() {
  return g_lastError_mac.c_str();
}

int platform_get_status() {
  return g_status_mac.load();
}

// Entrega um frame de 0 bytes ao JS. O processo principal ja entende esse
// protocolo (introduzido no #442 para o WASAPI): buffer vazio significa "a
// captura morreu, leia getLastError()". Antes o macOS nao tinha nenhum canal de
// erro assincrono -- se o sistema parasse o stream, o app simplesmente ficava
// mudo sem avisar ninguem.
static void report_capture_failure_mac(const char* message) {
  g_lastError_mac = message ? message : "Falha desconhecida na captura de audio";
  g_status_mac.store(3);
  auto* empty = new std::vector<uint8_t>();
  napi_status callStatus = g_tsfn_mac.NonBlockingCall(
      empty, [](Napi::Env env, Napi::Function jsCallback, std::vector<uint8_t>* bufData) {
        if (env != nullptr && jsCallback != nullptr) {
          jsCallback.Call({Napi::Buffer<uint8_t>::New(env, 0)});
        }
        delete bufData;
      });
  if (callStatus != napi_ok) delete empty;
}

/**
 * Espera `done` virar true sem travar a thread que chamou.
 *
 * Do macOS 15 em diante o ScreenCaptureKit entrega os completion handlers na
 * main queue. Como `platform_start` roda na thread principal do Electron,
 * bloquea-la com `dispatch_semaphore_wait` impede que o handler seja executado:
 * a espera so termina no timeout e a captura nunca comeca. Girar o run loop
 * mantem a main queue viva enquanto esperamos, sem esse risco.
 */
static bool wait_for_completion_mac(std::atomic<bool>& done, double timeoutSeconds) {
  const CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + timeoutSeconds;
  while (!done.load()) {
    if (CFAbsoluteTimeGetCurrent() >= deadline) return false;
    if ([NSThread isMainThread]) {
      CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.02, true);
    } else {
      [NSThread sleepForTimeInterval:0.01];
    }
  }
  return true;
}

// SCStream delegate that receives audio samples
@interface MonkyAudioDelegate : NSObject <SCStreamOutput, SCStreamDelegate>
@property (nonatomic, assign) uint32_t sampleRate;
@property (nonatomic, assign) uint32_t channels;
@end

@implementation MonkyAudioDelegate

- (void)stream:(SCStream *)stream
    didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
                   ofType:(SCStreamOutputType)type {
  // Os frames de video existem so para manter o SCStream saudavel (ver o
  // addStreamOutput em platform_start); sao descartados aqui.
  if (type != SCStreamOutputTypeAudio) return;
  if (!g_captureRunning_mac.load()) return;
  if (!CMSampleBufferDataIsReady(sampleBuffer)) return;

  CMFormatDescriptionRef formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer);
  if (!formatDesc) return;

  const AudioStreamBasicDescription* asbd =
      CMAudioFormatDescriptionGetStreamBasicDescription(
          (CMAudioFormatDescriptionRef)formatDesc);
  if (!asbd) return;

  // We only know how to convert 32-bit float PCM, which is what SCStream emits.
  if (!(asbd->mFormatFlags & kAudioFormatFlagIsFloat) || asbd->mBitsPerChannel != 32) return;

  const CMItemCount frames = CMSampleBufferGetNumSamples(sampleBuffer);
  if (frames <= 0) return;

  // ScreenCaptureKit hands us *planar* (non-interleaved) float32 — one buffer per
  // channel. The renderer's ring buffer consumes interleaved frames, so reading the
  // raw block buffer directly made it treat [L L L ...][R R R ...] as L/R pairs,
  // playing everything back an octave up ("chipmunk" audio, #314).
  size_t ablSize = 0;
  OSStatus status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer, &ablSize, NULL, 0, kCFAllocatorDefault, kCFAllocatorDefault,
      kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, NULL);
  if (status != noErr || ablSize == 0) return;

  std::vector<uint8_t> ablStorage(ablSize);
  AudioBufferList* abl = reinterpret_cast<AudioBufferList*>(ablStorage.data());
  CMBlockBufferRef retainedBlockBuffer = NULL;

  status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer, NULL, abl, ablSize, kCFAllocatorDefault, kCFAllocatorDefault,
      kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, &retainedBlockBuffer);
  if (status != noErr) {
    if (retainedBlockBuffer) CFRelease(retainedBlockBuffer);
    return;
  }

  const uint32_t outChannels = self.channels > 0 ? self.channels : 2;
  std::vector<uint8_t>* buf =
      new std::vector<uint8_t>(static_cast<size_t>(frames) * outChannels * sizeof(float));
  float* out = reinterpret_cast<float*>(buf->data());

  if (abl->mNumberBuffers > 1) {
    // Planar: mBuffers[ch] holds every sample for that channel.
    for (uint32_t ch = 0; ch < outChannels; ch++) {
      const uint32_t srcIdx = ch < abl->mNumberBuffers ? ch : abl->mNumberBuffers - 1;
      const float* src = reinterpret_cast<const float*>(abl->mBuffers[srcIdx].mData);
      const size_t srcFrames = abl->mBuffers[srcIdx].mDataByteSize / sizeof(float);
      for (CMItemCount i = 0; i < frames; i++) {
        out[i * outChannels + ch] =
            (src && static_cast<size_t>(i) < srcFrames) ? src[i] : 0.0f;
      }
    }
  } else {
    // Single buffer: already interleaved (or mono, which we duplicate).
    const float* src = reinterpret_cast<const float*>(abl->mBuffers[0].mData);
    const uint32_t srcChannels =
        abl->mBuffers[0].mNumberChannels > 0 ? abl->mBuffers[0].mNumberChannels : 1;
    const size_t srcSamples = abl->mBuffers[0].mDataByteSize / sizeof(float);
    for (CMItemCount i = 0; i < frames; i++) {
      for (uint32_t ch = 0; ch < outChannels; ch++) {
        const uint32_t sc = ch < srcChannels ? ch : srcChannels - 1;
        const size_t idx = static_cast<size_t>(i) * srcChannels + sc;
        out[i * outChannels + ch] = (src && idx < srcSamples) ? src[idx] : 0.0f;
      }
    }
  }

  if (retainedBlockBuffer) CFRelease(retainedBlockBuffer);

  napi_status callStatus = g_tsfn_mac.NonBlockingCall(buf, [](Napi::Env env, Napi::Function jsCallback,
                                     std::vector<uint8_t>* bufData) {
    if (env != nullptr && jsCallback != nullptr && bufData != nullptr) {
      auto nodeBuffer = Napi::Buffer<uint8_t>::Copy(env, bufData->data(), bufData->size());
      jsCallback.Call({nodeBuffer});
    }
    delete bufData;
  });

  if (callStatus != napi_ok) {
    delete buf;
    return;
  }

  g_status_mac.store(2);
}

// O sistema pode derrubar o stream sozinho: permissao de gravacao revogada, a
// janela compartilhada fechou, o display sumiu. Sem delegate isso acontecia em
// silencio e o usuario so percebia que ninguem estava ouvindo nada.
- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
  if (!g_captureRunning_mac.exchange(false)) return;
  const char* description =
      error.localizedDescription.UTF8String ?: "A captura de audio foi interrompida pelo sistema";
  report_capture_failure_mac(description);
}

@end

static SCStream* g_stream = nil;
static MonkyAudioDelegate* g_delegate = nil;

bool platform_is_supported() {
  if (@available(macOS 13.0, *)) {
    return true;
  }
  return false;
}

bool platform_start(uint32_t excludePid, uint32_t loopbackMode, int64_t includeWindowId,
                    uint32_t sampleRate, uint32_t channels,
                    Napi::ThreadSafeFunction tsfn) {
  (void)excludePid;
  (void)loopbackMode; // macOS ScreenCaptureKit always excludes the current process
  if (g_captureRunning_mac.load()) return false;

  if (@available(macOS 13.0, *)) {
    g_tsfn_mac = tsfn;
    g_captureRunning_mac.store(true);
    g_status_mac.store(1);

    static std::atomic<bool> done{false};
    done.store(false);
    static std::atomic<bool> startOk{false};
    startOk.store(false);
    g_lastError_mac.clear();

    [SCShareableContent getShareableContentWithCompletionHandler:^(
        SCShareableContent* _Nullable content, NSError* _Nullable error) {
      if (error || !content) {
        g_lastError_mac = error.localizedDescription.UTF8String
                              ?: "Nao foi possivel listar o conteudo compartilhavel "
                                 "(verifique a permissao de Gravacao de Tela)";
        g_captureRunning_mac.store(false);
        done.store(true);
        return;
      }

      SCContentFilter* filter = nil;

      if (includeWindowId > 0) {
        // Sharing a single window used to stream the audio of the whole machine,
        // while the UI promised only the app's audio (#298).
        //
        // A desktop-independent window filter is not enough: ScreenCaptureKit
        // scopes only the *video* to the window, and keeps tapping system-wide
        // audio, so the first attempt at this fix still leaked other apps. Audio
        // is scoped per process, so the filter has to name the *application*
        // that owns the window.
        SCWindow* targetWindow = nil;
        for (SCWindow* window in content.windows) {
          if ((int64_t)window.windowID == includeWindowId) {
            targetWindow = window;
            break;
          }
        }

        SCRunningApplication* owner = targetWindow.owningApplication;
        if (targetWindow && owner) {
          // The stream needs a display, but only its (2x2, discarded) video
          // depends on which one — the audio comes from the application list.
          // Prefer the display the window sits on so the pair stays coherent on
          // multi-monitor setups.
          SCDisplay* display = nil;
          for (SCDisplay* candidate in content.displays) {
            if (CGRectIntersectsRect(candidate.frame, targetWindow.frame)) {
              display = candidate;
              break;
            }
          }
          if (!display) display = content.displays.firstObject;

          if (display) {
            filter = [[SCContentFilter alloc] initWithDisplay:display
                                        includingApplications:@[ owner ]
                                             exceptingWindows:@[]];
          }
        }

        // Falling back to the full display here would silently leak every other
        // app's audio, which is exactly the bug we are fixing. Fail instead.
        if (!filter) {
          g_lastError_mac = targetWindow
                                ? "Nao foi possivel identificar o aplicativo dono da janela"
                                : "A janela escolhida nao esta mais disponivel para captura";
          g_captureRunning_mac.store(false);
          done.store(true);
          return;
        }
      } else {
        // Sharing a whole screen: capture that display's audio.
        SCDisplay* display = content.displays.firstObject;
        if (!display) {
          g_lastError_mac = "Nenhuma tela disponivel para captura";
          g_captureRunning_mac.store(false);
          done.store(true);
          return;
        }
        // Listar todos os aplicativos em vez de usar `excludingWindows:@[]`:
        // com a lista de exclusao vazia o ScreenCaptureKit tem um bug conhecido
        // em que o stream "inicia" mas nunca entrega um unico callback, o que
        // deixa a tela inteira muda. Nomear os aplicativos da o mesmo resultado
        // (o mix do sistema) por um caminho que o SCK trata bem.
        NSArray<SCRunningApplication*>* allApplications = content.applications;
        filter = allApplications.count > 0
                     ? [[SCContentFilter alloc] initWithDisplay:display
                                         includingApplications:allApplications
                                              exceptingWindows:@[]]
                     : [[SCContentFilter alloc] initWithDisplay:display
                                              excludingWindows:@[]];
      }

      SCStreamConfiguration* config = [[SCStreamConfiguration alloc] init];
      config.capturesAudio = YES;
      config.excludesCurrentProcessAudio = YES;
      config.sampleRate = sampleRate;
      config.channelCount = channels;
      // We only want audio, minimize video overhead
      config.width = 2;
      config.height = 2;
      config.showsCursor = NO;
      config.queueDepth = 8;
      config.minimumFrameInterval = CMTimeMake(10, 1); // um frame de video a cada 10s

      g_delegate = [[MonkyAudioDelegate alloc] init];
      g_delegate.sampleRate = sampleRate;
      g_delegate.channels = channels;

      // O delegate do stream (diferente do delegate de output) e o unico jeito
      // de saber que o sistema derrubou a captura -- passar nil aqui era o que
      // fazia qualquer falha posterior virar silencio absoluto.
      g_stream = [[SCStream alloc] initWithFilter:filter configuration:config
                                         delegate:g_delegate];

      NSError* addOutputError = nil;

      // Mesmo querendo so audio, o SCStream precisa de um consumidor de video.
      // Sem ele o ScreenCaptureKit reclama internamente e, na pratica, para de
      // entregar audio -- e a razao mais provavel de o som ter sumido nos dois
      // modos (#298). Os frames chegam em 2x2, a cada 10 segundos, e o delegate
      // os descarta na hora.
      [g_stream addStreamOutput:g_delegate type:SCStreamOutputTypeScreen
             sampleHandlerQueue:dispatch_get_global_queue(QOS_CLASS_BACKGROUND, 0)
                          error:&addOutputError];
      if (addOutputError) {
        g_lastError_mac =
            addOutputError.localizedDescription.UTF8String ?: "addStreamOutput (video) falhou";
        g_captureRunning_mac.store(false);
        done.store(true);
        return;
      }

      [g_stream addStreamOutput:g_delegate type:SCStreamOutputTypeAudio
                 sampleHandlerQueue:dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0)
                              error:&addOutputError];

      if (addOutputError) {
        g_lastError_mac = addOutputError.localizedDescription.UTF8String ?: "addStreamOutput falhou";
        g_captureRunning_mac.store(false);
        done.store(true);
        return;
      }

      [g_stream startCaptureWithCompletionHandler:^(NSError* _Nullable startError) {
        startOk.store(startError == nil);
        if (startError != nil) {
          g_lastError_mac = startError.localizedDescription.UTF8String ?: "startCapture falhou";
          g_captureRunning_mac.store(false);
        }
        done.store(true);
      }];
    }];

    wait_for_completion_mac(done, 10.0);
    if (!startOk.load() && g_lastError_mac.empty()) {
      // The wait timed out: no completion handler ever ran.
      g_lastError_mac = "Tempo esgotado ao iniciar a captura de audio";
      g_captureRunning_mac.store(false);
    }
    const bool ok = startOk.load();
    g_status_mac.store(ok ? 2 : 3);
    return ok;
  }

  g_lastError_mac = "Captura de audio da tela exige macOS 13 ou superior";
  g_status_mac.store(3);
  return false;
}

void platform_stop() {
  // Sem early return: quando o proprio sistema derruba o stream o
  // g_captureRunning_mac ja esta false, e sair aqui deixaria o SCStream vivo
  // (audio fantasma e CPU consumida ate o app fechar).
  g_captureRunning_mac.store(false);

  if (g_stream) {
    static std::atomic<bool> stopped{false};
    stopped.store(false);
    [g_stream stopCaptureWithCompletionHandler:^(NSError* _Nullable error) {
      stopped.store(true);
    }];
    // Mesma razao do start: bloquear a thread principal impediria o completion
    // handler de rodar no macOS 15+.
    wait_for_completion_mac(stopped, 5.0);
    g_stream = nil;
  }
  g_delegate = nil;
  g_status_mac.store(0);
}
