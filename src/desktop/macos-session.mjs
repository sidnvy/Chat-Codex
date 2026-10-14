import {localDesktopExec} from './exec.mjs';

// Native OS evidence only. The probe emits an opaque generation, never account
// names or the raw console-session UUID. Missing/malformed evidence fails closed.
export async function macOSSessionProbe(run=localDesktopExec){
 if(process.platform!=='darwin'||!process.getuid?.())return {ready:false};
 try{
  const result=await run('python3',['-c',`
import hashlib,json,os,plistlib,subprocess
raw=subprocess.check_output(['/usr/sbin/ioreg','-n','Root','-d1','-a'],timeout=5)
if len(raw)>4194304: raise ValueError('oversized native session evidence')
d=plistlib.loads(raw)
rows=d.get('IOConsoleUsers',[]) if isinstance(d,dict) else []
active=[r for r in rows if isinstance(r,dict) and r.get('kCGSSessionOnConsoleKey') is True and r.get('kCGSessionLoginDoneKey') is True]
valid=isinstance(d,dict) and len(active)==1
if valid:
 r=active[0]
 uid=r.get('kCGSSessionUserIDKey'); generation=r.get('CGSSessionUniqueSessionUUID'); session=r.get('kCGSSessionIDKey')
 valid=type(uid) is int and uid==os.geteuid() and isinstance(generation,str) and bool(generation) and type(session) is int
ready=valid and d.get('IOConsoleLocked') is False
if ready:
 identity=json.dumps([uid,generation,session],separators=(',',':')).encode()
 print(json.dumps({'ready':True,'session_id':hashlib.sha256(identity).hexdigest()}))
else: print(json.dumps({'ready':False,**({'state':'locked'} if valid and d.get('IOConsoleLocked') is True else {})}))
`],{timeout_ms:7000});
  const proof=JSON.parse(result);
  return proof.ready===true&&/^[a-f0-9]{64}$/.test(proof.session_id)?{ready:true,session_id:proof.session_id}:
   proof.ready===false&&proof.state==='locked'?{ready:false,state:'locked'}:{ready:false};
 }catch{return {ready:false};}
}
