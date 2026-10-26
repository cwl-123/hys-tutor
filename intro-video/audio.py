import asyncio
import json
import math
import subprocess
import wave
from pathlib import Path

import edge_tts
import numpy as np

ROOT = Path(__file__).resolve().parent
AUDIO = ROOT / "assets" / "audio"
OUTPUT = ROOT / "output"
SRC = ROOT / "src"
VOICE = "zh-CN-YunxiNeural"
RATE = "-2%"
PITCH = "-2Hz"
SAMPLE_RATE = 48000


def run(command):
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def duration(path):
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def read_wav(path):
    with wave.open(str(path), "rb") as source:
        channels = source.getnchannels()
        samples = np.frombuffer(source.readframes(source.getnframes()), dtype=np.int16)
    samples = samples.astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples.reshape(-1, channels)
    return samples


def write_wav(path, samples):
    samples = np.clip(samples, -1, 1)
    channels = 1 if samples.ndim == 1 else samples.shape[1]
    with wave.open(str(path), "wb") as target:
        target.setnchannels(channels)
        target.setsampwidth(2)
        target.setframerate(SAMPLE_RATE)
        target.writeframes((samples * 32767).astype(np.int16).tobytes())


def srt_time(seconds):
    milliseconds = max(0, round(seconds * 1000))
    hours, milliseconds = divmod(milliseconds, 3600000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    secs, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"


def note_frequency(name):
    names = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    pitch = name[:-1]
    octave = int(name[-1])
    midi = 12 * (octave + 1) + names[pitch]
    return 440.0 * 2 ** ((midi - 69) / 12)


def envelope(length, attack, release):
    result = np.ones(length, dtype=np.float32)
    attack_samples = min(int(attack * SAMPLE_RATE), length // 2)
    release_samples = min(int(release * SAMPLE_RATE), length // 2)
    if attack_samples:
        result[:attack_samples] = np.sin(np.linspace(0, math.pi / 2, attack_samples)) ** 2
    if release_samples:
        result[-release_samples:] = np.cos(np.linspace(0, math.pi / 2, release_samples)) ** 2
    return result


def make_music(total, scenes):
    count = math.ceil(total * SAMPLE_RATE)
    left = np.zeros(count, dtype=np.float32)
    right = np.zeros(count, dtype=np.float32)
    chords = [
        ["D3", "F#3", "A3", "C#4"],
        ["B2", "D3", "F#3", "A3"],
        ["G2", "B2", "D3", "F#3"],
        ["A2", "C#3", "E3", "G3"],
    ]
    chord_duration = 3.75
    rng = np.random.default_rng(20261026)
    chord_index = 0
    start = 0.0
    while start < total:
        offset = int(start * SAMPLE_RATE)
        length = min(int((chord_duration + 1.4) * SAMPLE_RATE), count - offset)
        if length <= 0:
            break
        time = np.arange(length, dtype=np.float32) / SAMPLE_RATE
        env = envelope(length, 1.1, 1.4)
        notes = chords[chord_index % len(chords)]
        for note_index, name in enumerate(notes):
            frequency = note_frequency(name)
            amplitude = 0.028 if note_index == 0 else 0.018
            phase = rng.uniform(0, math.tau)
            tone = np.sin(math.tau * frequency * time + phase)
            tone += 0.22 * np.sin(math.tau * frequency * 2 * time + phase * 0.7)
            tone *= amplitude * env
            left[offset : offset + length] += tone * 0.92
            right[offset : offset + length] += np.sin(math.tau * frequency * 1.0007 * time + phase + 0.15) * amplitude * env
        bass_frequency = note_frequency(notes[0]) / 2
        bass = np.sin(math.tau * bass_frequency * time) * 0.025 * env
        left[offset : offset + length] += bass
        right[offset : offset + length] += bass
        start += chord_duration
        chord_index += 1

    beat = chord_duration / 4
    step = 0
    start = 7.5
    while start < total - 4.5:
        notes = chords[(step // 8) % len(chords)]
        name = notes[[0, 2, 1, 3, 2, 1, 3, 2][step % 8]]
        frequency = note_frequency(name) * 2
        offset = int(start * SAMPLE_RATE)
        length = min(int(0.85 * SAMPLE_RATE), count - offset)
        time = np.arange(length, dtype=np.float32) / SAMPLE_RATE
        env = np.exp(-time * 5.5) * np.minimum(1, time * 100)
        pluck = (np.sin(math.tau * frequency * time) + 0.18 * np.sin(math.tau * frequency * 2 * time)) * 0.018 * env
        pan = 0.35 + 0.3 * ((step % 4) / 3)
        left[offset : offset + length] += pluck * (1 - pan)
        right[offset : offset + length] += pluck * pan
        step += 1
        start = 7.5 + step * beat

    duck = np.ones(count, dtype=np.float32)
    for scene in scenes:
        start = int(scene["voiceStart"] * SAMPLE_RATE)
        end = int(scene["voiceEnd"] * SAMPLE_RATE)
        ramp = int(0.22 * SAMPLE_RATE)
        duck[start:end] = np.minimum(duck[start:end], 0.48)
        if start > ramp:
            duck[start - ramp : start] = np.minimum(duck[start - ramp : start], np.linspace(1, 0.48, ramp))
        if end + ramp < count:
            duck[end : end + ramp] = np.minimum(duck[end : end + ramp], np.linspace(0.48, 1, ramp))

    music = np.stack([left, right], axis=1)
    peak = max(float(np.max(np.abs(music))), 0.001)
    music = music / peak * 0.5
    music *= duck[:, None]
    fade_in = min(int(2 * SAMPLE_RATE), count)
    fade_out = min(int(4 * SAMPLE_RATE), count)
    music[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
    music[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None]
    return music


async def main():
    AUDIO.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    SRC.mkdir(parents=True, exist_ok=True)
    content = json.loads((ROOT / "content.json").read_text())
    for scene in content["scenes"]:
        target = AUDIO / f"{scene['id']}.mp3"
        communicator = edge_tts.Communicate(scene["narration"], VOICE, rate=RATE, pitch=PITCH)
        await communicator.save(str(target))
        run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(target),
                "-af",
                "silenceremove=start_periods=1:start_duration=0.04:start_threshold=-48dB:stop_periods=-1:stop_duration=0.12:stop_threshold=-48dB,highpass=f=75,lowpass=f=14500,acompressor=threshold=-20dB:ratio=2.2:attack=8:release=160,loudnorm=I=-16:TP=-1.5:LRA=9,aresample=48000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(AUDIO / f"{scene['id']}.wav"),
            ]
        )

    scenes = []
    captions = []
    cursor = 0.0
    for scene in content["scenes"]:
        voice_duration = duration(AUDIO / f"{scene['id']}.wav")
        start = cursor
        voice_start = start + scene["pre"]
        voice_end = voice_start + voice_duration
        end = voice_end + scene["post"]
        item = {
            "id": scene["id"],
            "start": round(start, 4),
            "end": round(end, 4),
            "voiceStart": round(voice_start, 4),
            "voiceEnd": round(voice_end, 4),
            "voiceDuration": round(voice_duration, 4),
        }
        scenes.append(item)
        weights = [max(1, len(text.replace("，", "").replace("。", ""))) for text in scene["captions"]]
        weight_total = sum(weights)
        caption_cursor = voice_start
        for index, (text, weight) in enumerate(zip(scene["captions"], weights)):
            caption_end = voice_end if index == len(weights) - 1 else caption_cursor + voice_duration * weight / weight_total
            captions.append({"start": round(caption_cursor, 4), "end": round(caption_end, 4), "text": text})
            caption_cursor = caption_end
        cursor = end
        print(f"{scene['id']}: {voice_duration:.2f}s")

    timeline = {
        "title": content["title"],
        "fps": content["fps"],
        "width": content["width"],
        "height": content["height"],
        "total": round(cursor, 4),
        "scenes": scenes,
        "captions": captions,
    }
    (SRC / "timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=2))
    srt = "\n\n".join(
        f"{index}\n{srt_time(caption['start'])} --> {srt_time(caption['end'])}\n{caption['text']}"
        for index, caption in enumerate(captions, start=1)
    )
    (OUTPUT / "hys-tutor-intro-zh-CN.srt").write_text(srt + "\n")

    voice = np.zeros(math.ceil(cursor * SAMPLE_RATE), dtype=np.float32)
    for scene in scenes:
        samples = read_wav(AUDIO / f"{scene['id']}.wav")
        offset = round(scene["voiceStart"] * SAMPLE_RATE)
        length = min(len(samples), len(voice) - offset)
        voice[offset : offset + length] += samples[:length]
    write_wav(AUDIO / "voice.wav", voice)
    music = make_music(cursor, scenes)
    write_wav(AUDIO / "music.wav", music)
    mix = music * 0.28 + np.stack([voice, voice], axis=1)
    peak = float(np.max(np.abs(mix)))
    if peak > 0.94:
        mix *= 0.94 / peak
    write_wav(AUDIO / "mix.wav", mix)
    print(f"total: {cursor:.2f}s")


asyncio.run(main())
