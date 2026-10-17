"""Generate the original Hisbenew double-chime ringtone (no external audio)."""
import array
import math
from pathlib import Path
import wave

rate = 44100
samples = array.array('h')
for i in range(rate * 4):
    t = i / rate
    pulse = t % 2
    active = pulse < .65 or .85 <= pulse < 1.5
    if active:
        local = pulse if pulse < .65 else pulse - .85
        envelope = min(1, local / .015, (.65 - local) / .04)
        tone = (.55 * math.sin(2 * math.pi * 880 * t)
                + .30 * math.sin(2 * math.pi * 1320 * t)
                + .15 * math.sin(2 * math.pi * 1760 * t))
        sample = .92 * max(0, envelope) * tone
    else:
        sample = 0
    samples.append(round(sample * 32767))
target = Path(__file__).resolve().parents[1] / 'android/app/src/main/res/raw/hisbenew_ring.wav'
target.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(target), 'wb') as output:
    output.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
    output.writeframes(samples.tobytes())
print(f'Created {target.name}: 4-second repeating double chime')
