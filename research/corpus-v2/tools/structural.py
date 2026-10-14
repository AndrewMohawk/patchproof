"""Parse JSON and Python AST only; never import or execute authored Python."""
import ast, datetime, hashlib, json, os, sys, re
from pathlib import Path
from jsonschema import Draft202012Validator
PROJECT_ROOT=Path(__file__).resolve().parents[3]
BASE=Path(os.environ.get('PATCHPROOF_EVALUATION_ROOT',PROJECT_ROOT.parent/'patchproof-evaluation-v2')).expanduser().resolve()
slot=sys.argv[1]
if slot not in [f'repo{i:02d}' for i in range(1,13)]:raise SystemExit('Explicit repository slot required')
job=json.loads((BASE/'shared/jobs'/f'{slot}.json').read_text())
workspace=BASE/'authors'/slot
submission_file=sys.argv[2] if len(sys.argv)>2 else 'submission.json'
if not re.fullmatch(r'submission(?:-revision-\d{3})?\.json',submission_file):raise SystemExit('Explicit valid submission filename required')
submission=json.loads((workspace/submission_file).read_text())
revision=workspace/submission['revision']
issues=[];source_counts=0
allowed={'collections','math','re','itertools','functools','statistics','json','decimal','fractions','string','unicodedata','bisect','heapq','operator','copy'}
for task_id in job['taskIds']:
 for folder,schemafile in [('fixtures','fixture'),('gold','oracle'),('negative-controls','negative-control')]:
  path=revision/folder/f'{task_id}.json';value=json.loads(path.read_text())
  schema=json.loads((BASE/'shared'/f'{schemafile}.schema.json').read_text())
  for error in Draft202012Validator(schema).iter_errors(value):
   issues.append({'taskId':task_id,'scope':folder,'code':'author_profile_schema','path':list(error.absolute_path),'message':error.message})
  maps=[value.get('files',{})]if folder=='fixtures' else [value.get('goldFiles',{})]if folder=='gold' else[c.get('files',{})for c in value.get('controls',[])]
  for sources in maps:
   own={Path(p).stem for p in sources}
   for filename,source in sources.items():
    source_counts+=1
    try:tree=ast.parse(source)
    except SyntaxError as error:
     issues.append({'taskId':task_id,'scope':folder,'code':'python_syntax','file':filename,'line':error.lineno,'message':error.msg});continue
    for node in ast.walk(tree):
     if isinstance(node,(ast.Import,ast.ImportFrom)):
      names=[x.name.split('.')[0]for x in node.names]if isinstance(node,ast.Import)else[(node.module or '').split('.')[0]]
      for name in names:
       if name not in allowed|own:issues.append({'taskId':task_id,'scope':folder,'code':'import_requires_review','file':filename,'line':node.lineno,'module':name})
     if isinstance(node,ast.Call):
      name=node.func.id if isinstance(node.func,ast.Name)else node.func.attr if isinstance(node.func,ast.Attribute)else ''
      if name in {'eval','exec','compile','open','input','print','__import__','globals','locals','breakpoint','exit','quit','system','popen','fork','spawn','now','today','utcnow','sleep'}:
       issues.append({'taskId':task_id,'scope':folder,'code':'forbidden_effectful_call','file':filename,'line':node.lineno,'call':name})
report={'purpose':'json-schema-and-python-ast-only','slot':slot,'repoId':job['repoId'],'submissionDigest':'sha256:'+hashlib.sha256((workspace/submission_file).read_bytes()).hexdigest(),'sourceMapsParsed':source_counts,'candidateExecuted':False,'issues':issues}
directory=BASE/'review'/slot;directory.mkdir(mode=0o700,exist_ok=True)
out=directory/(datetime.datetime.now(datetime.timezone.utc).isoformat().replace(':','-')+'-structural.json');out.write_text(json.dumps(report,indent=2)+'\n');out.chmod(0o600)
print(json.dumps({'slot':slot,'sourcesParsed':source_counts,'issueCount':len(issues),'privateReport':str(out)}));sys.exit(2 if issues else 0)
