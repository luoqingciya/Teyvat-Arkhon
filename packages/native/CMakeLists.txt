cmake_minimum_required(VERSION 3.16)
project(mihomo_binding LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# Windows 构建宏
if(WIN32)
  add_definitions(-DNOMINMAX -DWIN32_LEAN_AND_MEAN)
endif()

# 不使用 find_package(Node-API)：直接采用 cmake-js 提供的 CMAKE_JS_INC / CMAKE_JS_LIB
# （node headers 自带 node_api.h，napi.h 来自 node-addon-api）

# node-addon-api 头文件：兼容 pnpm hoisted 与 strict 两种布局
set(NODE_ADDON_API_CANDIDATES
  "${CMAKE_CURRENT_SOURCE_DIR}/../../node_modules/node-addon-api"
  "${CMAKE_CURRENT_SOURCE_DIR}/node_modules/node-addon-api"
)
set(NODE_ADDON_API_DIR "")
foreach(cand IN LISTS NODE_ADDON_API_CANDIDATES)
  if(EXISTS "${cand}/napi.h")
    set(NODE_ADDON_API_DIR "${cand}")
    break()
  endif()
endforeach()
if(NOT NODE_ADDON_API_DIR)
  message(FATAL_ERROR "未找到 node-addon-api 头文件，请先运行 pnpm install")
endif()

add_library(mihomo_binding SHARED
  src/addon.cc
)

target_include_directories(mihomo_binding PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
  "${NODE_ADDON_API_DIR}"
  "${CMAKE_JS_INC}"
)

target_link_libraries(mihomo_binding PRIVATE
  ${CMAKE_JS_LIB}
)

# 输出为 Node 可加载的 .node 文件，落到 packages/native/bin
set_target_properties(mihomo_binding PROPERTIES
  PREFIX ""
  SUFFIX ".node"
  LIBRARY_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/bin"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/bin"
)

if(MSVC)
  target_compile_options(mihomo_binding PRIVATE /W4)
else()
  target_compile_options(mihomo_binding PRIVATE -Wall -Wextra)
endif()