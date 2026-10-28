cmake_minimum_required(VERSION 3.14)
project(subspace_rich_presence VERSION 1.0.0 LANGUAGES CXX)

set(SUBSPACE_RP_TOP_LEVEL OFF)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
  set(SUBSPACE_RP_TOP_LEVEL ON)
endif()
option(SUBSPACE_RP_BUILD_EXAMPLE "Build the example program" ${SUBSPACE_RP_TOP_LEVEL})
option(SUBSPACE_RP_BUILD_TESTS "Build the tests" ${SUBSPACE_RP_TOP_LEVEL})

find_package(Threads REQUIRED)

add_library(subspace_rich_presence STATIC src/rich_presence.cpp)
add_library(subspace::rich_presence ALIAS subspace_rich_presence)
target_include_directories(subspace_rich_presence PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)
target_compile_features(subspace_rich_presence PUBLIC cxx_std_17)
target_link_libraries(subspace_rich_presence PUBLIC Threads::Threads)
if(WIN32)
  target_link_libraries(subspace_rich_presence PUBLIC ws2_32)
endif()

set(SUBSPACE_RP_WARNINGS)
if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  set(SUBSPACE_RP_WARNINGS -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Wsign-conversion)
elseif(MSVC)
  set(SUBSPACE_RP_WARNINGS /W4)
endif()
target_compile_options(subspace_rich_presence PRIVATE ${SUBSPACE_RP_WARNINGS})

if(SUBSPACE_RP_BUILD_EXAMPLE)
  add_executable(subspace_rich_presence_example example/main.cpp)
  target_link_libraries(subspace_rich_presence_example PRIVATE subspace::rich_presence)
  target_compile_options(subspace_rich_presence_example PRIVATE ${SUBSPACE_RP_WARNINGS})
endif()

if(SUBSPACE_RP_BUILD_TESTS)
  enable_testing()
  add_executable(subspace_rich_presence_test tests/rich_presence_test.cpp)
  target_link_libraries(subspace_rich_presence_test PRIVATE subspace::rich_presence)
  target_compile_options(subspace_rich_presence_test PRIVATE ${SUBSPACE_RP_WARNINGS})
  add_test(NAME subspace_rich_presence_test COMMAND subspace_rich_presence_test)
endif()

install(TARGETS subspace_rich_presence EXPORT subspace_rich_presence ARCHIVE DESTINATION lib)
install(DIRECTORY include/ DESTINATION include)
