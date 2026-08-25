/**
 * ScreenCaptureKit Audio Capture (macOS 13+)
 *
 * Captures system audio EXCLUDING the Monky process using SCStream with
 * excludesCurrentProcessAudio = YES.
 *
 * Output: PCM float32 interleaved, 48kHz stereo (configurable).
 * Delivers frames via Napi::ThreadSafeFunction to the Node.js event loop.
 */

#import "sc_capture.h"

#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>
#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#include <atomic>
#include <vector>

static std::atomic<bool> g_captureRunning_mac{false};
static Napi::ThreadSafeFunction g_tsfn_mac;

// SCStream delegate that receives audio samples
@interface MonkyAudioDelegate : NSObject <SCStreamOutput>
@property (nonatomic, assign) uint32_t sampleRate;
@property (nonatomic, assign) uint32_t channels;
@end

@implementation MonkyAudioDelegate

- (void)stream:(SCStream *)stream
    didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
                   ofType:(SCStreamOutputType)type {
  if (type != SCStreamOutputTypeAudio) return;
  if (!g_captureRunning_mac.load()) return;

  CMBlockBufferRef blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer);
  if (!blockBuffer) return;

  size_t totalLength = 0;
  size_t lengthAtOffset = 0;
  char* dataPointer = nullptr;

  OSStatus status = CMBlockBufferGetDataPointer(blockBuffer, 0, &lengthAtOffset,
                                                 &totalLength, &dataPointer);
  if (status != kCMBlockBufferNoErr || !dataPointer || totalLength == 0) return;

  // Deliver PCM data via TSFN
  std::vector<uint8_t>* buf = new std::vector<uint8_t>(
      reinterpret_cast<uint8_t*>(dataPointer),
      reinterpret_cast<uint8_t*>(dataPointer) + totalLength);

  g_tsfn_mac.NonBlockingCall(buf, [](Napi::Env env, Napi::Function jsCallback,
                                     std::vector<uint8_t>* bufData) {
    auto nodeBuffer = Napi::Buffer<uint8_t>::Copy(env, bufData->data(), bufData->size());
    jsCallback.Call({nodeBuffer});
    delete bufData;
  });
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

bool platform_start(uint32_t excludePid, uint32_t loopbackMode, uint32_t sampleRate, uint32_t channels,
                    Napi::ThreadSafeFunction tsfn) {
  (void)excludePid;
  (void)loopbackMode; // macOS ScreenCaptureKit always excludes the current process
  if (g_captureRunning_mac.load()) return false;

  if (@available(macOS 13.0, *)) {
    g_tsfn_mac = tsfn;
    g_captureRunning_mac.store(true);

    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block bool startOk = false;

    [SCShareableContent getShareableContentWithCompletionHandler:^(
        SCShareableContent* _Nullable content, NSError* _Nullable error) {
      if (error || !content) {
        g_captureRunning_mac.store(false);
        dispatch_semaphore_signal(sem);
        return;
      }

      // Use the main display
      SCDisplay* display = content.displays.firstObject;
      if (!display) {
        g_captureRunning_mac.store(false);
        dispatch_semaphore_signal(sem);
        return;
      }

      // Filter: capture entire display audio
      SCContentFilter* filter = [[SCContentFilter alloc] initWithDisplay:display
                                                       excludingWindows:@[]];

      SCStreamConfiguration* config = [[SCStreamConfiguration alloc] init];
      config.capturesAudio = YES;
      config.excludesCurrentProcessAudio = YES;
      config.sampleRate = sampleRate;
      config.channelCount = channels;
      // We only want audio, minimize video overhead
      config.width = 2;
      config.height = 2;
      config.minimumFrameInterval = CMTimeMake(1, 1); // 1 fps minimum video

      g_delegate = [[MonkyAudioDelegate alloc] init];
      g_delegate.sampleRate = sampleRate;
      g_delegate.channels = channels;

      g_stream = [[SCStream alloc] initWithFilter:filter configuration:config
                                         delegate:nil];

      NSError* addOutputError = nil;
      [g_stream addStreamOutput:g_delegate type:SCStreamOutputTypeAudio
                 sampleHandlerQueue:dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0)
                              error:&addOutputError];

      if (addOutputError) {
        g_captureRunning_mac.store(false);
        dispatch_semaphore_signal(sem);
        return;
      }

      [g_stream startCaptureWithCompletionHandler:^(NSError* _Nullable startError) {
        startOk = (startError == nil);
        if (!startOk) {
          g_captureRunning_mac.store(false);
        }
        dispatch_semaphore_signal(sem);
      }];
    }];

    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
    return startOk;
  }

  return false;
}

void platform_stop() {
  if (!g_captureRunning_mac.load()) return;
  g_captureRunning_mac.store(false);

  if (g_stream) {
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    [g_stream stopCaptureWithCompletionHandler:^(NSError* _Nullable error) {
      dispatch_semaphore_signal(sem);
    }];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
    g_stream = nil;
  }
  g_delegate = nil;
}
