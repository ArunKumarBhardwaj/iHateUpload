-- Asks Adobe Acrobat for the words on every page of the front document. Usage: osascript acrobat-words.applescript
-- Acrobat returns the value of the last statement, so the result variable comes last. The text is percent-encoded:
-- AppleScript hands it back in Mac Roman, which turns letters like Ł or Д into dots. Decode it with urllib.parse.unquote.
tell application id "com.adobe.Acrobat.Pro"
	set js to "var r = ''; try { var d = app.activeDocs[0]; var w = []; var counts = []; for (var p = 0; p < d.numPages; p++) { var n = d.getPageNumWords(p); counts.push(n); for (var i = 0; i < n; i++) w.push(d.getPageNthWord(p, i, true)); } r = 'words per page ' + counts.join(',') + ': ' + w.join(' '); } catch (e) { r = 'error ' + e; } encodeURIComponent(r);"
	set answer to do script js
	close every document saving no
end tell
return answer
