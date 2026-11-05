# MIT KEMAR の compact set（elev*/H*e*a.wav）から src/data/kemar.json を作る
# 使い方: py -I tools/build_kemar.py <compact のフォルダ>
# データ: Bill Gardner & Keith Martin, MIT Media Lab, 1994（44.1kHz、128 タップ、ステレオ int16。方位は 0〜180° だけで、左は左右の耳を入れ替える）
import sys, os, wave, base64, re, json

src = sys.argv[1]
out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src', 'data', 'kemar.json')
entries, pcm = [], bytearray()
for d in sorted(os.listdir(src)):
    m = re.fullmatch(r'elev(-?\d+)', d)
    if not m: continue
    for f in sorted(os.listdir(os.path.join(src, d))):
        mm = re.fullmatch(r'H(-?\d+)e(\d{3})a\.wav', f)
        if not mm: continue
        with wave.open(os.path.join(src, d, f)) as w:
            assert w.getnchannels() == 2 and w.getsampwidth() == 2 and w.getframerate() == 44100
            assert w.getnframes() == 128
            pcm += w.readframes(128)
        entries.append([int(mm.group(1)), int(mm.group(2))])
with open(out, 'w') as fo:
    json.dump({'rate': 44100, 'taps': 128, 'pos': entries, 'pcm': base64.b64encode(bytes(pcm)).decode()}, fo)
print(len(entries), 'directions')
