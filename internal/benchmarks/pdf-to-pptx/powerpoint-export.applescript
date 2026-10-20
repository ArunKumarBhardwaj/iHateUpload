-- Opens a .pptx in Microsoft PowerPoint and saves it as PDF. Both paths must be inside PowerPoint's
-- sandbox container (~/Library/Containers/com.microsoft.Powerpoint/Data/...).
-- Usage: osascript powerpoint-export.applescript in.pptx out.pdf
on run argv
	set inPath to item 1 of argv
	set outPath to item 2 of argv
	with timeout of 300 seconds
		tell application id "com.microsoft.Powerpoint"
			open (POSIX file inPath)
			delay 3
			set thePres to active presentation
			save thePres in (POSIX file outPath) as save as PDF
			close thePres saving no
		end tell
	end timeout
end run
