# src/data/store.json から、読み上げの音声（public/sounds/*.wav）と、その一覧（src/data/sounds.json）を作る。
# 音声は Windows なら Microsoft Haruka（System.Speech）、macOS なら say（Kyoko）で、全部を同じ声で作り直す。
# 使い方: py -I tools/build_assets.py   （macOS は python3 -I tools/build_assets.py）
import json, os, subprocess, tempfile, sys, shutil, wave, array, glob

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
store = json.load(open(os.path.join(root, 'src', 'data', 'store.json'), encoding='utf-8'))
out_dir = os.path.join(root, 'public', 'sounds')

# 読み上げる言葉: 表示名 → 読み。商品は「表示名|読み」と書ける
speech = {}
def add(n):
    name, _, yomi = n.partition('|')
    speech.setdefault(name, yomi or name)
for isl in store['islands']:
    add(isl['name'])
    add(f"{isl['name']}へ案内します")
    add(f"{isl['name']}に着きました")
    for sh in isl['shelves']:
        add(sh['name'])
        for c in sh['categories']:
            add(c['name'])
            for it in c['items']: add(it)
for p in store['phrases']: add(p)

# Windows: 1 回の PowerShell で全部の WAV（16kHz、16bit、モノラル）を作る
HARUKA = r'''
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Haruka Desktop')
$s.Rate = 2
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($e in (Get-Content -Raw -Encoding UTF8 $args[0] | ConvertFrom-Json)) {
  $s.SetOutputToWaveFile($e.wav, $fmt); $s.Speak($e.text); $s.SetOutputToNull()
}
'''

def trim(src, dst, th=300, keep=0.03):
    # 前後の無音を削る（Haruka は末尾に 0.6 秒ほど無音を付ける）。言葉の前後に keep 秒だけ残す
    with wave.open(src) as w:
        fr, d = w.getframerate(), array.array('h', w.readframes(w.getnframes()))
    loud = [i for i, v in enumerate(d) if abs(v) > th]
    if loud: d = d[max(0, loud[0] - int(fr * keep)):min(len(d), loud[-1] + int(fr * keep))]
    with wave.open(dst, 'wb') as o:
        o.setnchannels(1); o.setsampwidth(2); o.setframerate(fr); o.writeframes(d.tobytes())

with tempfile.TemporaryDirectory() as tmp:
    jobs = [(n, yomi, os.path.join(tmp, f'{i + 1:03d}.wav')) for i, (n, yomi) in enumerate(speech.items())]
    if sys.platform == 'win32':
        ps1, lst = os.path.join(tmp, 'haruka.ps1'), os.path.join(tmp, 'list.json')
        open(ps1, 'w', encoding='utf-8-sig').write(HARUKA)
        json.dump([{'wav': w, 'text': y} for _, y, w in jobs], open(lst, 'w', encoding='utf-8'), ensure_ascii=False)
        subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, lst], check=True)
    elif shutil.which('say'):
        for _, yomi, wav in jobs:
            subprocess.run(['say', '-v', 'Kyoko', '-r', '230', '-o', wav, '--data-format=LEI16@16000', yomi], check=True)
    else:
        sys.exit('音声を作れません: Windows か macOS で実行してください')
    os.makedirs(out_dir, exist_ok=True)
    for old in glob.glob(os.path.join(out_dir, '*.wav')): os.remove(old)
    manifest = {}
    for n, _, wav in jobs:
        trim(wav, os.path.join(out_dir, os.path.basename(wav)))
        manifest[n] = os.path.basename(wav)
    with open(os.path.join(root, 'src', 'data', 'sounds.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n')
print(len(speech), 'names')
