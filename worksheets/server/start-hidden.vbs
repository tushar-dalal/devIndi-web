' Starts the Class Manager server with no console window.
' Run at Windows sign-in by the "Class Manager" shortcut in the Startup folder
' (created by install-startup.ps1). Safe to run twice: a second copy exits.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "node """ & here & "\serve.mjs""", 0, False
