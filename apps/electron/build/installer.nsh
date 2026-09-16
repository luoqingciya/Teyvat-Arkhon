; Teyvat Arkhon - NSIS 自定义脚本
; 作用：
;  1. customCheckAppRunning：安装/更新前自动关闭正在运行的旧实例。
;     应用关闭主窗口是隐藏到系统托盘、进程常驻（设计如此），若让 electron-builder 默认
;     检测弹"软件正在运行请关闭"会卡住用户；这里直接 taskkill 后继续。
;     必须先杀进程，否则后续卸载段暂存 data 目录时文件被占用会触发 Abort 保护。
;  2. customRemoveFiles：更新/卸载时保留安装目录下的 data 目录（订阅档案、工作配置等
;     用户数据）。electron-builder 定义该宏后不再执行默认整目录删除，改由本宏接管。

!macro customCheckAppRunning
  DetailPrint "正在关闭已运行的 ${PRODUCT_NAME} 旧实例..."
  ; 杀主进程及 Electron 同影像名子进程（/f 强杀）
  nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /im "Teyvat Arkhon.exe" /f`
  ; 杀内核（sidecar mihomo）子进程：其工作目录在安装目录 data/ 内，
  ; 若不退出会占用 data 文件，导致后续 customRemoveFiles 暂存 data 时 Abort。
  nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /im "arkhon-windows-x64.exe" /f`
  ; 等待主进程真正退出（最多 5s），确保文件释放后才进入文件复制/卸载段
  StrCpy $R0 0
  killWait:
    IntOp $R0 $R0 + 1
    Sleep 1000
    nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c tasklist /FI "IMAGENAME eq Teyvat Arkhon.exe" /FO csv | find "Teyvat Arkhon.exe"`
    Pop $R1
    ${if} $R1 == 0
    ${andIf} $R0 < 5
      Goto killWait
    ${endIf}
!macroend

!macro customRemoveFiles
  ; data 目录先移出安装目录
  StrCpy $0 "$INSTDIR\data"
  StrCpy $1 "$TEMP\teyvat-arkhon-data-backup"
  IfFileExists "$0\*" 0 noData
    ; 清理上次残留备份，避免 Rename 目标已存在
    RMDir /r "$1"
    ClearErrors
    Rename "$0" "$1"
    IfErrors 0 noData
      ; 移动失败（如被占用）：中止卸载以保护用户数据，宁可更新失败也不丢数据
      Abort "无法暂存 data 目录，已中止卸载以保护用户数据"
  noData:
  ; 删除安装目录其余内容（本宏接管后，默认整目录删除不再执行）
  RMDir /r "$INSTDIR"
  ; 重建安装目录并恢复 data
  CreateDirectory "$INSTDIR"
  IfFileExists "$1\*" 0 done
    ClearErrors
    Rename "$1" "$0"
    IfErrors done
      CreateDirectory "$INSTDIR\data"
      CopyFiles /SILENT "$1\*" "$0"
      RMDir /r "$1"
  done:
!macroend
