import test from 'node:test';
import assert from 'node:assert/strict';
import {containerArgs} from '../src/runner.mjs';
test('runner mounts only the project and enforces execution isolation',()=>{
 const a=containerArgs({project:'/tmp/project',user:'1000:1000',image:'node:22-bookworm-slim'},'test');
 assert.equal(a.filter(x=>x==='--mount').length,1);
 assert.ok(a.includes('type=bind,src=/tmp/project,dst=/workspace'));
 for(const [flag,value] of [['--network','none'],['--user','1000:1000'],['--cap-drop','ALL'],['--pids-limit','128'],['--log-driver','none']])assert.equal(a[a.indexOf(flag)+1],value);
 assert.ok(a.includes('--read-only'));assert.ok(a.includes('no-new-privileges'));
 assert.ok(!a.some(x=>x.includes('docker.sock')));
});
