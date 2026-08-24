{
  "targets": [
    {
      "target_name": "screen_audio",
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "sources": ["src/screen_audio.cc"],
      "conditions": [
        [
          "OS=='win'",
          {
            "sources": ["src/win/wasapi_loopback.cpp"],
            "libraries": [
              "-lMmdevapi",
              "-lOle32",
              "-lAvrt",
              "-lKsuser",
              "-lUser32"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "AdditionalOptions": ["/std:c++17"]
              }
            }
          }
        ],
        [
          "OS=='mac'",
          {
            "sources": ["src/mac/sc_capture.mm"],
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "OTHER_CPLUSPLUSFLAGS": ["-std=c++17"],
              "OTHER_LDFLAGS": [
                "-framework ScreenCaptureKit",
                "-framework CoreMedia",
                "-framework AVFoundation",
                "-framework Foundation",
                "-framework CoreAudio"
              ]
            },
            "defines": ["__MACOS__"]
          }
        ]
      ]
    }
  ]
}
