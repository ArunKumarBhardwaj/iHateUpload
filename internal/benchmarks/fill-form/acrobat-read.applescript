-- Asks Adobe Acrobat's own JavaScript for every form field of the front document (open it first with: open -a "Adobe Acrobat" file.pdf).
-- Usage: osascript acrobat-read.applescript
tell application id "com.adobe.Acrobat.Pro"
	set js to "var r = ''; try { var d = app.activeDocs[0]; var s = 'docs ' + app.activeDocs.length + ' fields ' + d.numFields + ' pages ' + d.numPages; for (var i = 0; i < d.numFields; i++) { var f = d.getField(d.getNthFieldName(i)); s += ' | ' + f.name + '=' + f.value + (f.readonly ? ' (ro)' : '') + (f.required ? ' (req)' : ''); } r = s; } catch (e) { r = 'error ' + e; } r;"
	set answer to do script js
	close every document saving no
end tell
return answer
