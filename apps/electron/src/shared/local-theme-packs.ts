/** Desktop theme packs belong to the device, including in remote frontend mode. */
export const LOCAL_THEME_PACK_IPC = '__local-theme-packs'
export const LOCAL_THEME_PACK_CHANGED = '__local-theme-packs:changed'
export const LOCAL_THEME_PACK_METHODS = [
  'getThemePacks', 'getThemePacksDir', 'getThemePack', 'getSelectedThemePack',
  'setSelectedThemePack', 'getThemePackAsset', 'importThemePack',
  'importThemePackFolder', 'deleteThemePack',
] as const
