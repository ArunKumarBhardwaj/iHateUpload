-- Opens a .pptx in Keynote and exports it to PDF. Usage: osascript keynote-export.applescript in.pptx out.pdf
on run argv
	set inFile to POSIX file (item 1 of argv)
	set outFile to POSIX file (item 2 of argv)
	with timeout of 300 seconds
	tell application id "com.apple.Keynote"
		set theDoc to open inFile
		delay 2
		export theDoc to outFile as PDF
		close theDoc saving no
	end tell
	end timeout
end run
