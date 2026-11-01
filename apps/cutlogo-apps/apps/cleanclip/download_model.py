import urllib.request, pathlib, hashlib
p=pathlib.Path(__file__).resolve().parent/'models/big-lama.pt'
p.parent.mkdir(exist_ok=True)
expected='7ba7aa7ac37a4d41fdbbeba3a2af7ead18058552997e3a3cd1a3b2210c9e6b4c'
if not p.exists() or hashlib.sha256(p.read_bytes()).hexdigest()!=expected:
    temp=p.with_suffix('.download')
    urllib.request.urlretrieve('https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt',temp)
    if hashlib.sha256(temp.read_bytes()).hexdigest()!=expected:raise SystemExit('Model checksum mismatch')
    temp.replace(p)
print('Model verified:',p.stat().st_size,'bytes')
