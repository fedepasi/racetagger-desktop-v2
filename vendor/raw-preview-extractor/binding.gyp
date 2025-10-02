{
  "targets": [
    {
      "target_name": "raw_extractor",
      "sources": [
        "src/cpp/main.cpp",
        "src/cpp/raw_extractor.cpp",
        "src/cpp/utils/endian.cpp",
        "src/cpp/utils/jpeg_validator.cpp",
        "src/cpp/utils/memory_map.cpp",
        "src/cpp/formats/tiff_parser.cpp",
        "src/cpp/formats/cr2_parser.cpp",
        "src/cpp/formats/cr3_parser.cpp",
        "src/cpp/formats/nef_parser.cpp",
        "src/cpp/formats/arw_parser.cpp",
        "src/cpp/formats/dng_parser.cpp",
        "src/cpp/formats/raf_parser.cpp",
        "src/cpp/formats/orf_parser.cpp",
        "src/cpp/formats/rw2_parser.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "src/cpp",
        "src/cpp/utils",
        "src/cpp/formats"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "NODE_ADDON_API_DISABLE_DEPRECATED"
      ],
      "conditions": [
        ["OS==\"win\"", {
          "defines": [
            "_HAS_EXCEPTIONS=1",
            "_UNICODE",
            "UNICODE",
            "_WIN32_WINNT=0x0A00"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "RuntimeLibrary": 2,
              "StringPooling": "true",
              "FunctionLevelLinking": "true",
              "WarningLevel": 3
            },
            "VCLinkerTool": {
              "GenerateDebugInformation": "true",
              "OptimizeReferences": 2,
              "EnableCOMDATFolding": 2
            }
          },
          "libraries": [
            "-ladvapi32.lib",
            "-lkernel32.lib"
          ]
        }],
        ["OS==\"mac\"", {
          "cflags_cc": [
            "-std=c++14", 
            "-stdlib=libc++"
          ],
          "xcode_settings": {
            "CLANG_CXX_LIBRARY": "libc++",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++14",
            "MACOSX_DEPLOYMENT_TARGET": "11.0",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "OTHER_CPLUSPLUSFLAGS": [
              "-std=c++14",
              "-stdlib=libc++",
              "-O3",
              "-ffast-math",
              "-funroll-loops"
            ],
            "GCC_OPTIMIZATION_LEVEL": "3",
            "DEAD_CODE_STRIPPING": "YES",
            "USE_HEADERMAP": "NO"
          }
        }],
        ["OS==\"linux\"", {
          "cflags": [
            "-fexceptions",
            "-frtti",
            "-O3",
            "-ffast-math",
            "-funroll-loops"
          ],
          "cflags_cc": [
            "-fexceptions",
            "-frtti",
            "-std=c++14",
            "-O3",
            "-ffast-math",
            "-funroll-loops"
          ]
        }]
      ]
    }
  ]
}