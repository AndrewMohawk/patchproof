import json,pathlib,subprocess,os,hashlib
root=pathlib.Path('/home/andrewmohawk/.config/patchproof/demo-20260927/interface-redesign-01')
report=json.loads((root/'report.json').read_text());assert report['status']=='passed'
def stamp(ms):
 ticks=round(ms/10);return f'{ticks//360000}:{ticks//6000%60:02}:{ticks//100%60:02}.{ticks%100:02}'
header='''[Script Info]
ScriptType: v4.00+
PlayResX: 1440
PlayResY: 1120
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,25,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,70,70,27,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
for scene in report['scenes']:
 header+=f"Dialogue: 0,{stamp(scene['startMs'])},{stamp(scene['endMs'])},Default,,0,0,0,,{scene['caption']}\n"
caption=root/'captions.ass';caption.write_text(header);os.chmod(caption,0o600)
output=root/'patchproof-interface-demo.mp4'
subprocess.run(['ffmpeg','-v','warning','-n','-i',report['videoPath'],'-vf',f'pad=1440:1120:0:0:color=0x172033,ass={caption}','-c:v','libx264','-preset','fast','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart','-an',str(output)],check=True)
os.chmod(output,0o600)
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration:stream=codec_name,width,height','-of','json',str(output)]))
assert 30<float(probe['format']['duration'])<180
receipt={'recording':report,'editing':{'cuts':False,'speedChanges':False,'added':'120px caption strip below the original 1440x1000 browser capture','audio':False},'outputSha256':hashlib.sha256(output.read_bytes()).hexdigest(),'bytes':output.stat().st_size,'media':probe}
path=pathlib.Path('research/interface-redesign/verification/video-production.json');path.write_text(json.dumps(receipt,indent=2)+'\n')
subprocess.run(['ffmpeg','-v','error','-y','-ss','13','-i',str(output),'-frames:v','1','/tmp/patchproof-redesign-video-frame.png'],check=True)
print(json.dumps({k:receipt[k] for k in ['outputSha256','bytes','media']}))
