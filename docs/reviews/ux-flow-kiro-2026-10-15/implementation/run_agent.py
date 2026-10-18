from pathlib import Path
import json,subprocess,sys,time
p=Path(__file__).parent
c=json.loads((p/"context.json").read_text())
a=sys.argv[1]
command=["/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat","chat","--model","claude-opus-5.5","--effort","high","--trust-all-tools","--no-interactive",(p/f"{a}-prompt.txt").read_text()]
with (p/f"{a}-implementation.log").open("w") as f:
 process=subprocess.Popen(command,cwd=c["paths"][a],stdout=f,stderr=subprocess.STDOUT)
 print(f"Started Kiro {a}, pid={process.pid}, log={p}/{a}-implementation.log",flush=True)
 code=process.wait()
 print(f"Kiro {a} exited {code}",flush=True)
 sys.exit(code)
