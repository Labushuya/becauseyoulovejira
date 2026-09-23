param(
    [string]$ShortcutPath,
    [string]$TargetVbs,
    [string]$WorkDir
)

try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = "wscript.exe"
    $shortcut.Arguments = "`"$TargetVbs`""
    $shortcut.WorkingDirectory = $WorkDir
    $shortcut.WindowStyle = 0
    $shortcut.Save()
    exit 0
} catch {
    exit 1
}
