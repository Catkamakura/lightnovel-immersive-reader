# Assemble the demo: trim the recording head, encode h264 once, lay each
# language's narration clips at the recorded segment offsets, mux per language.
import json, subprocess
from pathlib import Path

import imageio_ffmpeg

ROOT = Path(__file__).parent
FF = imageio_ffmpeg.get_ffmpeg_exe()
meta = json.loads((ROOT / "offsets.json").read_text(encoding="utf-8"))
segs = meta["offsets"]
raw = meta["video"]
HEAD = max(0, segs[0]["at"] - 1500)  # open the video 1.5s before the first narration

def run(args):
    p = subprocess.run([FF, "-y", *args], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[-2000:])

base = ROOT / "base.mp4"
run(["-i", raw, "-ss", f"{HEAD/1000:.3f}", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", str(base)])
print("base.mp4 done")

for lang in ("zh", "en"):
    inputs, delays = [], []
    for k, s in enumerate(segs):
        inputs += ["-i", str(ROOT / f"tts-{s['id']}-{lang}.mp3")]
        delays.append(f"[{k}:a]adelay={max(0, s['at'] - HEAD)}:all=1[a{k}]")
    fc = ";".join(delays) + ";" + "".join(f"[a{k}]" for k in range(len(segs))) + f"amix=inputs={len(segs)}:normalize=0[mix]"
    aud = ROOT / f"narr-{lang}.m4a"
    run([*inputs, "-filter_complex", fc, "-map", "[mix]", "-c:a", "aac", "-b:a", "128k", str(aud)])
    out = ROOT.parent / "docs" / "assets" / f"demo-{lang}.mp4"
    run(["-i", str(base), "-i", str(aud), "-map", "0:v", "-map", "1:a", "-c", "copy", "-movflags", "+faststart", str(out)])
    print(f"demo-{lang}.mp4 done ({out.stat().st_size // 1024} KB)")
