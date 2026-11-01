using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.ServiceProcess;
using System.Threading;
using System.Web.Script.Serialization;
using System.Collections.Generic;
class Probe : ServiceBase {
    static string root;
    static string release;
    static string output;
    static int Main(string[] args) {
        if (args.Length == 2 && args[0] == "--identity") {
            IntPtr token; if (!OpenProcessToken(Process.GetProcessById(Int32.Parse(args[1])).Handle, 8, out token)) return 2;
            try { using (WindowsIdentity identity = new WindowsIdentity(token)) {
                List<string> groups = new List<string>(); foreach (IdentityReference group in identity.Groups) groups.Add(group.Value);
                Console.WriteLine(new JavaScriptSerializer().Serialize(new Dictionary<string,object> { { "user", identity.User.Value }, { "groups", groups } }));
            } } finally { CloseHandle(token); } return 0;
        }
        if (args.Length == 2 && args[0] == "--job") {
            bool value; if (!IsProcessInJob(Process.GetProcessById(Int32.Parse(args[1])).Handle, IntPtr.Zero, out value)) return 2;
            Console.WriteLine(value ? "contained" : "uncontained"); return value ? 0 : 1;
        }
        if (args.Length != 4) return 2;
        root = args[1]; release = args[2]; output = args[3];
        if (args[0] == "--user") { Check(); return 0; }
        ServiceBase.Run(new Probe()); return 0;
    }
    Probe() { ServiceName = "AcornOpsAgentVProbe"; AutoLog = false; }
    protected override void OnStart(string[] args) { Check(); ThreadPool.QueueUserWorkItem(delegate(object state) { Thread.Sleep(500); Stop(); }); }
    static void Check() {
        Dictionary<string, object> result = new Dictionary<string, object>();
        WindowsIdentity identity = WindowsIdentity.GetCurrent(); result["user"] = identity.User.Value;
        List<string> groups = new List<string>(); foreach (IdentityReference group in identity.Groups) groups.Add(group.Value); result["groups"] = groups;
        result["configRead"] = Access(Path.Combine(root, "config.json"), FileAccess.Read);
        result["configWrite"] = Access(Path.Combine(root, "config.json"), FileAccess.Write);
        result["runtimeWrite"] = Access(Path.Combine(release, "AgentV.ServiceHost.exe"), FileAccess.Write);
        result["stateWrite"] = Access(Path.Combine(root, "state", "launch.json"), FileAccess.Write);
        File.WriteAllText(output, new JavaScriptSerializer().Serialize(result));
    }
    static bool Access(string path, FileAccess access) { try { using (FileStream stream = new FileStream(path, FileMode.Open, access)) { return true; } } catch (UnauthorizedAccessException) { return false; } }
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
}
