; Teyvat Arkhon - NSIS 自定义脚本
; 作用：
;  1. customCheckAppRunning：安装/更新前自动关闭正在运行的旧实例（托盘常驻不弹"请关闭"）。
;  2. customRemoveFiles：更新/卸载时删除安装目录中除 data（订阅档案、工作配置等用户数据）
;     以外的所有文件。data 目录原地保留——不移动、不阻塞，即使内核仍在占用也无需删除
;     data 即可完成升级（data 唯一存放位置 = 安装目录 data/）。

!macro customCheckAppRunning
  DetailPrint "正在关闭已运行的 ${PRODUCT_NAME} 旧实例..."
  ; 杀主进程及 Electron 同影像名子进程（/f 强杀）
  nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /im "Teyvat Arkhon.exe" /f`
  ; 杀内核（sidecar mihomo）子进程：其工作目录在安装目录 data/ 内
  nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /im "arkhon-windows-x64.exe" /f`
  ; 等待主进程与内核真正退出（最多 10s），确保文件释放后才进入卸载/复制段；
  ; 升级时卸载器（旧版宏）会暂存 data 目录，进程未退出会导致移动失败而中止安装
  StrCpy $R0 0
  killWait:
    IntOp $R0 $R0 + 1
    Sleep 1000
    nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c tasklist /FI "IMAGENAME eq Teyvat Arkhon.exe" /FO csv | find "Teyvat Arkhon.exe"`
    Pop $R1
    nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c tasklist /FI "IMAGENAME eq arkhon-windows-x64.exe" /FO csv | find "arkhon-windows-x64.exe"`
    Pop $R2
    ${if} $R1 == 0
    ${orIf} $R2 == 0
      ${if} $R0 < 10
        Goto killWait
      ${endIf}
    ${endIf}
!macroend

!macro customRemoveFiles
  ; 枚举 $INSTDIR 顶层条目，仅删除除 data 外的内容；data 原地保留
  FindFirst $2 $3 "$INSTDIR\*"
  StrCmp "$2" "" done
  loop:
    StrCmp "$3" "" done
    StrCmp "$3" "." next
    StrCmp "$3" ".." next
    StrCmp "$3" "data" next
    IfFileExists "$INSTDIR\$3\*" 0 nextFile
      RMDir /r "$INSTDIR\$3"
      Goto next
    nextFile:
      Delete "$INSTDIR\$3"
    next:
    FindNext "$2" "$3"
    Goto loop
  done:
    FindClose "$2"
!macroend
