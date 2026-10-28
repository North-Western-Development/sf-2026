cmake_minimum_required(VERSION 3.16)
project(subspace_bot VERSION 0.1.0 LANGUAGES CXX)

set(SUBSPACE_BOT_TOP_LEVEL OFF)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
  set(SUBSPACE_BOT_TOP_LEVEL ON)
endif()
option(SUBSPACE_BOT_BUILD_EXAMPLE "Build the example bot" ${SUBSPACE_BOT_TOP_LEVEL})
option(SUBSPACE_BOT_BUILD_TESTS "Build the tests" ${SUBSPACE_BOT_TOP_LEVEL})
option(SUBSPACE_BOT_FETCH_JSON "Download nlohmann/json with FetchContent when find_package cannot find it" ON)
option(SUBSPACE_BOT_INSTALL "Generate install rules" ${SUBSPACE_BOT_TOP_LEVEL})

find_package(Threads REQUIRED)
# libcurl for HTTP(S) and the gateway WebSocket (curl_ws_*, curl 7.86 or later built with WebSockets).
find_package(CURL 7.86 REQUIRED)
# OpenSSL 1.1.1 or later for Ed25519 signature checks (verify_interaction).
find_package(OpenSSL 1.1.1 REQUIRED COMPONENTS Crypto)
find_package(nlohmann_json 3.9 QUIET)
if(NOT nlohmann_json_FOUND)
  if(NOT SUBSPACE_BOT_FETCH_JSON)
    message(FATAL_ERROR "nlohmann_json not found; install it (vcpkg nlohmann-json, apt nlohmann-json3-dev, brew nlohmann-json) or set SUBSPACE_BOT_FETCH_JSON=ON")
  endif()
  set(JSON_Install ${SUBSPACE_BOT_INSTALL} CACHE INTERNAL "")
  include(FetchContent)
  FetchContent_Declare(nlohmann_json
    URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
    URL_HASH SHA256=d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d)
  FetchContent_MakeAvailable(nlohmann_json)
endif()

add_library(subspace_bot STATIC src/bot.cpp)
add_library(subspace::bot ALIAS subspace_bot)
target_include_directories(subspace_bot PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)
target_compile_features(subspace_bot PUBLIC cxx_std_17)
target_link_libraries(subspace_bot
  PUBLIC nlohmann_json::nlohmann_json Threads::Threads
  PRIVATE CURL::libcurl OpenSSL::Crypto)
if(WIN32)
  target_compile_definitions(subspace_bot PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
  target_link_libraries(subspace_bot PRIVATE ws2_32)
endif()

set(SUBSPACE_BOT_WARNINGS)
if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  set(SUBSPACE_BOT_WARNINGS -Wall -Wextra -Wpedantic -Wshadow)
elseif(MSVC)
  set(SUBSPACE_BOT_WARNINGS /W4 /utf-8)
endif()
target_compile_options(subspace_bot PRIVATE ${SUBSPACE_BOT_WARNINGS})

if(SUBSPACE_BOT_BUILD_EXAMPLE)
  add_executable(subspace_bot_example example/dice_bot.cpp)
  target_link_libraries(subspace_bot_example PRIVATE subspace::bot)
  target_compile_options(subspace_bot_example PRIVATE ${SUBSPACE_BOT_WARNINGS})
  if(MSVC)
    target_compile_definitions(subspace_bot_example PRIVATE _CRT_SECURE_NO_WARNINGS)
  endif()
endif()

if(SUBSPACE_BOT_BUILD_TESTS)
  enable_testing()
  add_executable(subspace_bot_test tests/bot_test.cpp)
  # The fake server in the tests uses OpenSSL's SHA-1 and base64 for the WebSocket handshake.
  target_link_libraries(subspace_bot_test PRIVATE subspace::bot OpenSSL::Crypto)
  if(WIN32)
    target_compile_definitions(subspace_bot_test PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
    target_link_libraries(subspace_bot_test PRIVATE ws2_32)
  endif()
  target_compile_options(subspace_bot_test PRIVATE ${SUBSPACE_BOT_WARNINGS})
  add_test(NAME subspace_bot_test COMMAND subspace_bot_test)
endif()

if(SUBSPACE_BOT_INSTALL)
  include(GNUInstallDirs)
  include(CMakePackageConfigHelpers)
  install(TARGETS subspace_bot EXPORT subspace_bot_targets ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR})
  install(DIRECTORY include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
  install(EXPORT subspace_bot_targets FILE subspace_botTargets.cmake NAMESPACE subspace:: DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/subspace_bot)
  configure_package_config_file(cmake/subspace_botConfig.cmake.in
    ${CMAKE_CURRENT_BINARY_DIR}/subspace_botConfig.cmake
    INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/subspace_bot)
  write_basic_package_version_file(${CMAKE_CURRENT_BINARY_DIR}/subspace_botConfigVersion.cmake COMPATIBILITY SameMinorVersion)
  install(FILES ${CMAKE_CURRENT_BINARY_DIR}/subspace_botConfig.cmake ${CMAKE_CURRENT_BINARY_DIR}/subspace_botConfigVersion.cmake
    DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/subspace_bot)
endif()
