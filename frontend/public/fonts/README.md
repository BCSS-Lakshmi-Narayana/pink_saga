# Fonts

Drop `NotoSansTelugu-Regular.ttf` here.

`src/pages/YouTubeMonitor.js` fetches it at `/fonts/NotoSansTelugu-Regular.ttf`
to embed in exported PDFs. jsPDF's built-in fonts are Latin-1 only, so without
it every Telugu character exports as a blank box.

The file is deliberately absent rather than filled with a placeholder: the
exporter already handles a missing font by falling back to Helvetica and
telling the user Telugu text will be omitted. A font present but lacking
Telugu glyphs would pass the load check and silently produce broken PDFs,
which is worse than a clear warning.

Get it from https://fonts.google.com/noto/specimen/Noto+Sans+Telugu
(Open Font License).
