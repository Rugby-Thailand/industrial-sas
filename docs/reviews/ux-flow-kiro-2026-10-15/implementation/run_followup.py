from pathlib import Path
import json,subprocess,sys
p=Path(__file__).parent
c=json.loads((p/"context.json").read_text())
a,name=sys.argv[1:3]
with (p/f"{name}.log").open("w") as f:
 child=subprocess.Popen(["/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat","chat","--model","claude-opus-5.5","--effort","high","--trust-all-tools","--no-interactive",(p/f"{name}-prompt.txt").read_text()],cwd=c["paths"][a],stdout=f,stderr=subprocess.STDOUT)
 print(f"Kiro {name}: pid={child.pid}",flush=True)
 code=child.wait();print(f"Kiro {name} exited {code}",flush=True);sys.exit(code)
