"""Inline style.css + script.js into a single self-contained preview.html."""
import sys, pathlib
root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text()
css = (root / "style.css").read_text()
js = (root / "script.js").read_text()
html = html.replace('<link rel="stylesheet" href="style.css">', f"<style>\n{css}\n</style>")
html = html.replace('<script src="script.js"></script>', f"<script>\n{js}\n</script>")
out = pathlib.Path(sys.argv[1])
out.write_text(html)
print("written", out)
