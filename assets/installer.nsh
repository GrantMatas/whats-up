!macro customInstall
  !ifdef MENU_FILENAME
    CreateDirectory "$SMPROGRAMS\${MENU_FILENAME}"
    CreateShortCut "$SMPROGRAMS\${MENU_FILENAME}\Uninstall ${PRODUCT_NAME}.lnk" "$INSTDIR\${UNINSTALL_FILENAME}" "" "$INSTDIR\${UNINSTALL_FILENAME}" 0
  !endif
!macroend

!macro customUnInstall
  !ifdef MENU_FILENAME
    Delete "$SMPROGRAMS\${MENU_FILENAME}\Uninstall ${PRODUCT_NAME}.lnk"
  !endif
!macroend
