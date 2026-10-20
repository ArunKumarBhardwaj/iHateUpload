-- Opens a .pptx in Microsoft PowerPoint (read-only is enough) and prints, per slide, each shape's type and text.
-- Usage: osascript powerpoint-read.applescript in.pptx
on run argv
	set report to ""
	tell application id "com.microsoft.Powerpoint"
		open POSIX file (item 1 of argv)
		delay 4
		set thePres to active presentation
		set report to report & "slides " & (count of slides of thePres) & linefeed
		repeat with s from 1 to count of slides of thePres
			set theSlide to slide s of thePres
			set rowText to "slide " & s & ":"
			repeat with i from 1 to count of shapes of theSlide
				set sh to shape i of theSlide
				set shapeKind to (shape type of sh) as string
				set txt to ""
				try
					if has text frame of sh then set txt to content of text range of text frame of sh
				end try
				try
					if has table of sh then
						set tbl to table object of sh
						set shapeKind to "table " & (count of rows of tbl) & "x" & (count of columns of tbl)
						repeat with r from 1 to count of rows of tbl
							repeat with c from 1 to count of columns of tbl
								set txt to txt & (content of text range of text frame of shape of (cell r column c of tbl)) & "|"
							end repeat
						end repeat
					end if
				end try
				set rowText to rowText & " [" & kind & "] " & txt
			end repeat
			set report to report & rowText & linefeed
		end repeat
		close thePres saving no
	end tell
	return report
end run
