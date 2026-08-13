/**
 * Platform-neutral native-shell entry point.
 *
 * Keep the old module name as a compatibility shim for the iOS project while
 * Android and new web code use this name. The implementation is shared
 * because both shells serve the same WebDist/GameRes contract.
 */
export {
 canPickGameDirectoryFromShell,
 canImportModFromShell,
 downloadModFromShell,
 getPlatformContentProvider,
 importModFromShell,
 installShellDebugLog,
 installShellRepl,
 isNativeShell,
 isTauriDesktopShell,
 selectNativeMenuVideoSource,
 pickGameDirectoryFromShell,
 seedGameResFromShell,
} from './iosSeed';
