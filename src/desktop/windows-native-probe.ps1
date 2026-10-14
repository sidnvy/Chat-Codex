# Public Win32 identity and HWND-only capture. Never switch desktops or activate windows.
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
public static class StyxWindowProbe {
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformationW(IntPtr handle,int index,IntPtr buffer,uint bytes,out uint needed);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd,StringBuilder text,int size);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowTextLengthW(IntPtr hwnd);
 [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
 [DllImport("kernel32.dll")] static extern bool ProcessIdToSessionId(uint pid,out uint session);
 [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
 [StructLayout(LayoutKind.Sequential)] struct Rect { public int left,top,right,bottom; }
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
 [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd,IntPtr dc,uint flags);
 public class Proof {
  public string hwnd,pid,start_time,user_sid,title,thread_desktop;
  public uint session_id;
  public bool same_user,thread_receiving;
 }
 static void VerifyTargetDesktop(uint thread) {
  var desktop=GetThreadDesktop(thread); // borrowed handle: never close or switch it
  if(desktop==IntPtr.Zero)throw new InvalidOperationException();
  uint needed;var buffer=Marshal.AllocHGlobal(512);
  try {
   if(!GetUserObjectInformationW(desktop,2,buffer,512,out needed)||needed<2||needed>512||
    !String.Equals(Marshal.PtrToStringUni(buffer),"Default",StringComparison.Ordinal))throw new InvalidOperationException();
   if(!GetUserObjectInformationW(desktop,6,buffer,4,out needed)||needed!=4||Marshal.ReadInt32(buffer)!=1)throw new InvalidOperationException();
  }finally{Marshal.FreeHGlobal(buffer);}
 }
 public static Proof Read(string value) {
  long number;if(!Int64.TryParse(value,out number)||number<=0)throw new InvalidOperationException();
  var hwnd=new IntPtr(number);uint pid,session;
  if(!IsWindow(hwnd)||!IsWindowVisible(hwnd)||IsIconic(hwnd))throw new InvalidOperationException();
  uint thread=GetWindowThreadProcessId(hwnd,out pid);if(thread==0||pid==0)throw new InvalidOperationException();
  VerifyTargetDesktop(thread);
  var process=OpenProcess(0x1000,false,pid); // PROCESS_QUERY_LIMITED_INFORMATION
  if(process==IntPtr.Zero)throw new InvalidOperationException();
  IntPtr token=IntPtr.Zero;
  try {
   long created,exited,kernel,user;
   if(!GetProcessTimes(process,out created,out exited,out kernel,out user)||created<=0||
    !ProcessIdToSessionId(pid,out session)||session==0||session!=(uint)Process.GetCurrentProcess().SessionId||
    !OpenProcessToken(process,8,out token))throw new InvalidOperationException(); // TOKEN_QUERY
   using(var owner=new WindowsIdentity(token))using(var self=WindowsIdentity.GetCurrent()) {
    if(owner.User==null||self.User==null||!owner.User.Equals(self.User))throw new InvalidOperationException();
    int length=GetWindowTextLengthW(hwnd);if(length<0||length>=32767)throw new InvalidOperationException();
    var title=new StringBuilder(32768);int copied=GetWindowTextW(hwnd,title,title.Capacity);
    uint current;if(copied<0||copied>=32767||GetWindowThreadProcessId(hwnd,out current)!=thread||current!=pid||!IsWindow(hwnd))throw new InvalidOperationException();
    VerifyTargetDesktop(thread);
    return new Proof{hwnd=value,pid=pid.ToString(),start_time=created.ToString(),session_id=session,user_sid=owner.User.Value,same_user=true,title=title.ToString(),thread_desktop="Default",thread_receiving=true};
   }
  }finally{if(token!=IntPtr.Zero)CloseHandle(token);CloseHandle(process);}
 }
 public static string Capture(string value) {
  var hwnd=new IntPtr(Int64.Parse(value));Rect rect;
  if(!IsWindow(hwnd)||!IsWindowVisible(hwnd)||IsIconic(hwnd)||!GetWindowRect(hwnd,out rect))throw new InvalidOperationException();
  long width=(long)rect.right-rect.left,height=(long)rect.bottom-rect.top;
  if(width<1||height<1||width>4096||height>4096||width*height>8388608)throw new InvalidOperationException();
  using(var bitmap=new Bitmap((int)width,(int)height,PixelFormat.Format32bppArgb)) {
   using(var graphics=Graphics.FromImage(bitmap)) {
    graphics.Clear(Color.Black);var dc=graphics.GetHdc();
    try{if(!PrintWindow(hwnd,dc,0))throw new InvalidOperationException();}finally{graphics.ReleaseHdc(dc);}
   }
   // PrintWindow can legitimately return a blank frame. It never falls back to screen pixels.
   using(var stream=new MemoryStream()) {
    bitmap.Save(stream,ImageFormat.Png);
    if(stream.Length<100||stream.Length>393216)throw new InvalidOperationException();
    return Convert.ToBase64String(stream.ToArray());
   }
  }
 }
}
'@
