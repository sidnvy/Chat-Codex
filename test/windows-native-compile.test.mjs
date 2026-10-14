import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createWindowsNativeScript} from '../src/desktop/windows-native-source.mjs';

// Compiles both exact embedded C# declarations. Does not invoke Read/Capture,
// inspect session state, touch windows, or override PowerShell execution policy.
test('embedded Windows native declarations compile without desktop access',{
 skip:process.platform!=='win32'?'Requires Windows PowerShell and native reference assemblies':false,
 timeout:30000
},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'styx-native-compile-'));
 try{
  const file=join(directory,'compile.ps1');
  await writeFile(file,createWindowsNativeScript({compileOnly:true}));
  const {stdout,stderr}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-File',file],{
   encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:1048576
  });
  assert.equal(stdout,'compiled');assert.equal(stderr,'');
 }finally{await rm(directory,{recursive:true,force:true});}
});
