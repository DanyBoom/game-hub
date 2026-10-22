using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// One hidden console per server. CTRL+C is delivered only to this console,
// never to the user's Steam/game or unrelated server processes.
public static class ConsoleHost {
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AllocConsole();
    [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll")] static extern bool SetStdHandle(int kind,IntPtr handle);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GenerateConsoleCtrlEvent(uint code, uint group);
    delegate bool Handler(uint type);
    [DllImport("kernel32.dll")] static extern bool SetConsoleCtrlHandler(Handler handler, bool add);
    static readonly Handler KeepHostAlive = delegate(uint type) { return type == 0 || type == 1; };
    static readonly object OutputLock = new object();
    static Process server;
    static int stopped;
    static string Quote(string value) {
        StringBuilder result=new StringBuilder("\""); int slashes=0;
        foreach(char c in value) { if(c=='\\') {slashes++;continue;} if(c=='\"') {result.Append('\\',slashes*2+1);result.Append(c);slashes=0;continue;} result.Append('\\',slashes);slashes=0;result.Append(c); }
        result.Append('\\',slashes*2);result.Append('"');return result.ToString();
    }
    static void Print(string text, bool error) { lock(OutputLock) { if(error)Console.Error.WriteLine(text);else Console.Out.WriteLine(text); } }
    static void Stop() { if(Interlocked.Exchange(ref stopped,1)==0)GenerateConsoleCtrlEvent(0,0); }
    public static int Main(string[] args) {
        if(args.Length==0)return 2;
        IntPtr input=GetStdHandle(-10),output=GetStdHandle(-11),error=GetStdHandle(-12);
        if(GetConsoleWindow()==IntPtr.Zero){AllocConsole();SetStdHandle(-10,input);SetStdHandle(-11,output);SetStdHandle(-12,error);}ShowWindow(GetConsoleWindow(),0);SetConsoleCtrlHandler(KeepHostAlive,true);
        try {
            StringBuilder argv=new StringBuilder();for(int i=1;i<args.Length;i++) {if(i>1)argv.Append(' ');argv.Append(Quote(args[i]));}
            ProcessStartInfo start=new ProcessStartInfo(args[0],argv.ToString());start.UseShellExecute=false;start.CreateNoWindow=false;start.RedirectStandardOutput=true;start.RedirectStandardError=true;start.RedirectStandardInput=true;
            server=new Process();server.StartInfo=start;server.OutputDataReceived+=(s,e)=>{if(e.Data!=null)Print(e.Data,false);};server.ErrorDataReceived+=(s,e)=>{if(e.Data!=null)Print(e.Data,true);};
            server.Start();Print("__GAMEHUB_PID__"+server.Id,false);server.BeginOutputReadLine();server.BeginErrorReadLine();
            Thread commands=new Thread(()=>{try{string line;while((line=Console.ReadLine())!=null){if(line=="__GAMEHUB_STOP__")Stop();else server.StandardInput.WriteLine(line);}Stop();}catch{Stop();}});commands.IsBackground=true;commands.Start();
            server.WaitForExit();return server.ExitCode;
        } catch { Print("GameHub console host failed to launch the server.",true);return 3; }
    }
}
