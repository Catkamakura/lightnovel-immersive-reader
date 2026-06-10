# Generate bilingual narration clips with edge-tts and compute the segment plan
# (each segment = max(minMs, longest narration + 900ms tail)).
import asyncio, json, re, subprocess, sys
from pathlib import Path

import edge_tts
import imageio_ffmpeg

ROOT = Path(__file__).parent
FF = imageio_ffmpeg.get_ffmpeg_exe()
VOICES = {"zh": "zh-CN-XiaoxiaoNeural", "en": "en-US-AriaNeural"}

def dur_ms(path: Path) -> int:
    p = subprocess.run([FF, "-i", str(path)], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):(\d+)\.(\d+)", p.stderr)
    if not m:
        raise RuntimeError("no duration for " + str(path))
    h, mi, s, cs = map(int, m.groups())
    return ((h * 60 + mi) * 60 + s) * 1000 + cs * 10

async def main():
    data = json.loads((ROOT / "narration.json").read_text(encoding="utf-8"))
    plan = []
    for seg in data["segments"]:
        durs = {}
        for lang, voice in VOICES.items():
            out = ROOT / f"tts-{seg['id']}-{lang}.mp3"
            await edge_tts.Communicate(seg[lang], voice).save(str(out))
            durs[lang] = dur_ms(out)
        seg_ms = max(seg["minMs"], max(durs.values()) + 900)
        plan.append({"id": seg["id"], "ms": seg_ms, "zhMs": durs["zh"], "enMs": durs["en"]})
        print(f"{seg['id']}: zh={durs['zh']}ms en={durs['en']}ms -> segment {seg_ms}ms")
    (ROOT / "plan.json").write_text(json.dumps(plan, indent=2), encoding="utf-8")
    print("total:", sum(p["ms"] for p in plan) / 1000, "s")

asyncio.run(main())
