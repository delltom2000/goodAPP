"""Open the local web app; start this project's service if it is not running."""
from pathlib import Path
import urllib.request,json,subprocess,sys,time,webbrowser
root=Path(__file__).resolve().parent
def alive():
    try:
        with urllib.request.urlopen('http://127.0.0.1:8765/health',timeout=2) as r:return json.load(r).get('name')=='CleanClip'
    except Exception:return False
if not alive():
    (root/'runtime').mkdir(exist_ok=True)
    with (root/'runtime/launcher.log').open('ab') as log:
        subprocess.Popen([sys.executable,str(root/'server.py'),'--host','127.0.0.1'],cwd=root,stdout=log,stderr=log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    for _ in range(40):
        if alive():break
        time.sleep(.25)
if not alive():raise SystemExit('Service failed to start. See runtime/launcher.log')
config=json.loads((root/'connection.json').read_text(encoding='utf8'))
webbrowser.open(config['local'])
print('Opened local CleanClip web app.')
