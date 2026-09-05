// 将 mihomo（MetaCubeX/mihomo，Go）编译为 C 共享库的 cgo 桥接层（已按 v1.19.30 API 校准）。
//
// 构建（需 Go + cgo 工具链，Windows 上使用 mingw-w64 gcc）：
//   CGO_ENABLED=1 CC=<gcc> go build -buildmode=c-shared \
//     -ldflags "-s -w -X github.com/metacubex/mihomo/constant.Version=v1.19.30" \
//     -o libmihomo.dll .
//
// ABI 契约见 src/mihomo_bridge.h（packages/native）。
package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"unsafe"

	"github.com/metacubex/mihomo/config"
	"github.com/metacubex/mihomo/constant"
	"github.com/metacubex/mihomo/hub"
	"github.com/metacubex/mihomo/hub/executor"
	"github.com/metacubex/mihomo/hub/route"
)

var errNotStarted = errors.New("core is not started")

// 内核生命周期串行化，避免并发 Start/Reload/Stop 竞态
var (
	mu      sync.Mutex
	started bool
	lastErr string
)

func setErr(err error) {
	if err != nil {
		lastErr = err.Error()
	} else {
		lastErr = ""
	}
}

func applyConfigFile(configPath string) error {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}
	// 切到配置文件所在目录，保证 geo 数据/相对路径引用以工作配置目录为基准
	if dir := filepath.Dir(configPath); dir != "." {
		_ = os.Chdir(dir)
	}
	cfg, err := config.Parse(data)
	if err != nil {
		return err
	}
	// hub.ApplyConfig = 启动/重建 REST 控制器（route）+ 分发执行器（executor）
	hub.ApplyConfig(cfg)
	return nil
}

//export mihomo_bridge_version
func mihomo_bridge_version() *C.char {
	return C.CString("mihomo-embedded " + constant.Version)
}

//export mihomo_bridge_start
func mihomo_bridge_start(configPath *C.char) C.int {
	mu.Lock()
	defer mu.Unlock()

	if err := applyConfigFile(C.GoString(configPath)); err != nil {
		setErr(err)
		return -1
	}
	started = true
	setErr(nil)
	return 0
}

//export mihomo_bridge_stop
func mihomo_bridge_stop() C.int {
	mu.Lock()
	defer mu.Unlock()

	if started {
		executor.Shutdown()
		// 关闭 REST 控制器监听（空配置的 ReCreateServer 仅执行关闭逻辑）
		route.ReCreateServer(&route.Config{})
		started = false
	}
	setErr(nil)
	return 0
}

//export mihomo_bridge_reload
func mihomo_bridge_reload(configPath *C.char) C.int {
	mu.Lock()
	defer mu.Unlock()

	if !started {
		setErr(errNotStarted)
		return -1
	}
	if err := applyConfigFile(C.GoString(configPath)); err != nil {
		setErr(err)
		return -1
	}
	setErr(nil)
	return 0
}

//export mihomo_bridge_last_error
func mihomo_bridge_last_error() *C.char {
	mu.Lock()
	defer mu.Unlock()

	if lastErr == "" {
		return nil
	}
	return C.CString(lastErr)
}

//export mihomo_bridge_free
func mihomo_bridge_free(ptr *C.char) {
	C.free(unsafe.Pointer(ptr))
}

func main() {} // -buildmode=c-shared 需要 main 包