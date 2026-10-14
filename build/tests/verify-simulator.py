"""Verify the built app inside an already booted simulator, using an isolated DB."""
import json
import math
import pathlib
import shutil
import struct
import subprocess
import sys
import time
import wave

project = pathlib.Path(__file__).resolve().parents[2]
device = sys.argv[1] if len(sys.argv) > 1 else 'booted'
bundle = 'com.duketao.zhiyan.sim'
def run(*args):
    result = subprocess.run(['xcrun', 'simctl', *args], text=True, capture_output=True)
    if result.returncode: raise RuntimeError(result.stderr or result.stdout)
    return result.stdout.strip()

run('install', device, str(project / 'dist/ZhiYan-sim.app'))
container = pathlib.Path(run('get_app_container', device, bundle, 'data'))
isolated = container / 'Documents/GardenVerification'
media = isolated / 'media'
media.mkdir(parents=True, exist_ok=True)
with wave.open(str(media / 'test-tone.wav'), 'wb') as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(44100)
    audio.writeframes(b''.join(struct.pack('<h', int(200 * math.sin(2 * math.pi * 440 * i / 44100))) for i in range(88200)))

output = project / 'verify/garden'
output.mkdir(parents=True, exist_ok=True)
for action in ['selftest', 'garden-test', 'draft-check', 'export-check', 'services-test', 'snapshot']:
    logfile = isolated / f'ios-{action}.log'
    logfile.write_text('')
    args = ['launch', '--terminate-running-process', f'--stderr={logfile}', device, bundle,
            '--database', str(isolated / 'notes.db')]
    if action == 'snapshot':
        # Clear only the test preference left by draft-check.
        (isolated / 'preferences.json').write_text('{}')
        args += ['--snapshot', str(isolated / 'home.png'), '--theme', 'light']
    else:
        args += ['--act', action]
    run(*args)
    result = ''
    for _ in range(200):
        result = logfile.read_text()
        if 'RESULT=' in result or 'snapshot ok' in result or '[FATAL]' in result:
            break
        time.sleep(.1)
    if action == 'snapshot':
        assert 'snapshot ok' in result, result
        shutil.copyfile(isolated / 'home.png', output / 'ios-native.png')
    else:
        assert 'RESULT=PASS' in result, result
    shutil.copyfile(logfile, output / logfile.name)
    print(action + ': PASS', flush=True)
print('Isolated simulator artifacts:', output)
