import {Runner} from './runner.mjs';
import {HostRunner} from './host-runner.mjs';

export function selectBackend(config) {
  const backend=config.backend===undefined?'docker':config.backend;
  if(!['docker','host'].includes(backend))throw Error('backend must be docker or host; omitted means docker');
  return backend;
}
export function validateHost() {
  if(process.platform!=='linux'||!process.getuid?.())throw Error('Host mode requires a non-root Linux user');
}
export function createRunner(config) {
  if(selectBackend(config)==='docker')return new Runner(config);
  validateHost();
  console.warn('WARNING: host backend runs arbitrary commands as your OS user, WITHOUT an OS sandbox. Commands can access same-user credentials, files outside the project and the network. File-tool path checks and a reduced environment do NOT isolate shell commands.');
  return new HostRunner(config);
}
