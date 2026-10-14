# Read-only console-session evidence. No policy, privilege or desktop switching.
$ErrorActionPreference = 'Stop'
try {
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
public static class StyxConsoleProbe {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 struct Level1 {
  public uint SessionId; public int State; public int Flags;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=33)] public string Station;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=21)] public string User;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=18)] public string Domain;
  public long LogonTime, ConnectTime, DisconnectTime, LastInputTime, CurrentTime;
  public uint IncomingBytes, OutgoingBytes, IncomingFrames, OutgoingFrames, IncomingCompressedBytes, OutgoingCompressedBytes;
 }
 [StructLayout(LayoutKind.Sequential)] struct InfoEx { public uint Level; public Level1 Data; }
 [DllImport("kernel32.dll")] static extern uint WTSGetActiveConsoleSessionId();
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 [DllImport("wtsapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 static extern bool WTSQuerySessionInformationW(IntPtr server, uint session, int kind, out IntPtr buffer, out uint bytes);
 [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr buffer);
 [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
 [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
 [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
 [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
 [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 static extern bool GetUserObjectInformationW(IntPtr handle, int index, IntPtr buffer, uint bytes, out uint needed);
 public class Evidence {
  public bool supported, same_user, input_receiving, thread_receiving;
  public uint process_session, console_session, reported_session;
  public int state, flags;
  public string station, input_desktop, thread_desktop, generation;
 }
 static string ObjectName(IntPtr handle) {
  if(handle==IntPtr.Zero)throw new InvalidOperationException();
  uint needed; IntPtr p=Marshal.AllocHGlobal(512);
  try { if(!GetUserObjectInformationW(handle,2,p,512,out needed)||needed<2||needed>512)throw new InvalidOperationException(); return Marshal.PtrToStringUni(p); }
  finally { Marshal.FreeHGlobal(p); }
 }
 static bool ReceivesInput(IntPtr desktop) {
  if(desktop==IntPtr.Zero)throw new InvalidOperationException();
  uint needed; IntPtr p=Marshal.AllocHGlobal(4);
  try { if(!GetUserObjectInformationW(desktop,6,p,4,out needed)||needed!=4)throw new InvalidOperationException(); return Marshal.ReadInt32(p)==1; }
  finally { Marshal.FreeHGlobal(p); }
 }
 static string SessionText(uint session,int kind) {
  IntPtr p=IntPtr.Zero;uint bytes;
  try { if(!WTSQuerySessionInformationW(IntPtr.Zero,session,kind,out p,out bytes)||p==IntPtr.Zero||bytes<2||bytes>4096)throw new InvalidOperationException();return Marshal.PtrToStringUni(p); }
  finally { if(p!=IntPtr.Zero)WTSFreeMemory(p); }
 }
 public static Evidence Read() {
  // Windows7/Server2008R2 invert lock flags; unsupported OS evidence fails closed.
  if(Environment.OSVersion.Version < new Version(6,2))throw new InvalidOperationException();
  var e=new Evidence();e.supported=true;
  e.process_session=(uint)Process.GetCurrentProcess().SessionId;
  e.console_session=WTSGetActiveConsoleSessionId();
  if(e.process_session==0||e.console_session==UInt32.MaxValue||e.process_session!=e.console_session)throw new InvalidOperationException();
  IntPtr p=IntPtr.Zero;uint bytes;InfoEx info;
  try {
   if(!WTSQuerySessionInformationW(IntPtr.Zero,e.process_session,25,out p,out bytes)||p==IntPtr.Zero||bytes<Marshal.SizeOf(typeof(InfoEx)))throw new InvalidOperationException();
   info=(InfoEx)Marshal.PtrToStructure(p,typeof(InfoEx));
   if(info.Level!=1||info.Data.LogonTime<=0)throw new InvalidOperationException();
  } finally {if(p!=IntPtr.Zero)WTSFreeMemory(p);}
  e.reported_session=info.Data.SessionId;e.state=info.Data.State;e.flags=info.Data.Flags;
  var user=SessionText(e.process_session,5);var domain=SessionText(e.process_session,7);
  if(String.IsNullOrEmpty(user)||String.IsNullOrEmpty(domain))throw new InvalidOperationException();
  using(var identity=WindowsIdentity.GetCurrent()) {
   var owner=(SecurityIdentifier)new NTAccount(domain,user).Translate(typeof(SecurityIdentifier));
   e.same_user=identity.User!=null&&identity.User.Equals(owner);
   var raw=owner.Value+"|"+e.process_session.ToString()+"|"+info.Data.LogonTime.ToString();
   using(var hash=SHA256.Create())e.generation=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(raw))).Replace("-","").ToLowerInvariant();
  }
  e.station=ObjectName(GetProcessWindowStation());
  var input=OpenInputDesktop(0,false,1); // DESKTOP_READOBJECTS only
  if(input==IntPtr.Zero)throw new InvalidOperationException();
  try {e.input_desktop=ObjectName(input);e.input_receiving=ReceivesInput(input);}
  finally {CloseDesktop(input);}
  var thread=GetThreadDesktop(GetCurrentThreadId()); // borrowed handle, never close
  e.thread_desktop=ObjectName(thread);e.thread_receiving=ReceivesInput(thread);
  return e;
 }
}
'@
# Read twice to reject a transition observed during the probe; not an atomic lock lease.
@([StyxConsoleProbe]::Read(), [StyxConsoleProbe]::Read()) | ConvertTo-Json -Compress
} catch { 'null' }
