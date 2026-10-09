; Included by electron-builder (nsis.include). Removes the toast activator registration the packaged app writes for
; its pinned CLSID (TOAST_ACTIVATOR_CLSID in src/shared/app-identity.ts, N-D3). Kept on an update: the new version
; registers the same key again.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\CLSID\{16B1084D-58B0-47CA-BB9E-C33FDAB9B30C}"
  ${endIf}
!macroend
