import {readFileSync} from 'node:fs';
// Both runtime and compile-only CI use the exact same public native declarations.
export function createWindowsNativeScript({compileOnly=false}={}){
 const session=readFileSync(new URL('../../scripts/windows-session-probe.ps1',import.meta.url),'utf8');
 const native=readFileSync(new URL('./windows-native-probe.ps1',import.meta.url),'utf8');
 const marker='# Read twice to reject a transition observed during the probe; not an atomic lock lease.';
 if(!session.includes(marker))throw new Error('Unexpected session source');
 const declarations=session.slice(0,session.indexOf(marker))+native;
 if(compileOnly)return declarations+"\n[Console]::Out.Write('compiled')\n} catch { throw }\n";
 return declarations+`
$first=[StyxConsoleProbe]::Read()
if (-not ($first.supported -and $first.same_user -and $first.input_receiving -and $first.thread_receiving -and
 $first.process_session -gt 0 -and $first.process_session -eq $first.console_session -and
 $first.process_session -eq $first.reported_session -and $first.state -eq 0 -and $first.flags -eq 1 -and
 $first.station -ceq 'WinSta0' -and $first.input_desktop -ceq 'Default' -and $first.thread_desktop -ceq 'Default')) { throw 'Unavailable session' }
$before=$null; $after=$null; $png=$null
if ($args[0] -ne 'session') { $before=[StyxWindowProbe]::Read($args[1]) }
if ($args[0] -eq 'capture') { $png=[StyxWindowProbe]::Capture($args[1]) }
if ($args[0] -ne 'session') { $after=[StyxWindowProbe]::Read($args[1]) }
$last=[StyxConsoleProbe]::Read()
@{sessions=@($first,$last);before=$before;after=$after;png=$png} | ConvertTo-Json -Depth 5 -Compress
} catch { 'null' }
`;
}
