; Teyvat Arkhon - NSIS 自定义脚本
; 作用：更新/卸载时保留安装目录下的 data 目录（订阅档案、工作配置等用户数据）。
; electron-builder 定义 customRemoveFiles 宏后，将不再执行默认的
; "RMDir /r $INSTDIR 删除整个安装目录"，改由本宏接管文件删除。

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
