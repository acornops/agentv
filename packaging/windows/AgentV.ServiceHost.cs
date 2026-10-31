// Windows Framework 4.8; deliberately no packages, dynamic compilation, or HTTP.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace AcornOps.AgentV {
    internal static class Program {
        internal const string Name = "AcornOpsAgentV";
        internal static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AcornOps", "AgentV");
        internal static readonly string Release = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        internal static readonly string State = Path.Combine(Root, "state");
        internal static readonly string Logs = Path.Combine(Root, "logs");
        internal static readonly string Config = Path.Combine(Root, "config.json");
        static int Main(string[] args) {
            if (args.Length != 2 || args[0] != "--node" || !Environment.Is64BitProcess) return 2;
            try { ServiceBase.Run(new Host(args[1])); return 0; }
            catch { return 1; }
        }
    }

    internal static class TrustedPaths {
        internal static void Check(string path, bool directory) {
            if (!Path.IsPathRooted(path) || Path.GetFullPath(path) != path || path.StartsWith(@"\\")) throw new IOException("Untrusted path");
            string current = path;
            bool leaf = true;
            while (current != null) {
                FileAttributes attributes = File.GetAttributes(current);
                if ((attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Reparse path");
                bool isDirectory = (attributes & FileAttributes.Directory) != 0;
                if (leaf && directory != isDirectory) throw new IOException("Wrong path type");
                FileSystemSecurity acl = isDirectory ? (FileSystemSecurity)Directory.GetAccessControl(current) : File.GetAccessControl(current);
                string owner = acl.GetOwner(typeof(SecurityIdentifier)).Value;
                if (!Privileged(owner)) throw new IOException("Untrusted owner");
                FileSystemRights writes = FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership | FileSystemRights.Delete;
                if (leaf) writes |= FileSystemRights.Write | FileSystemRights.DeleteSubdirectoriesAndFiles;
                foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(SecurityIdentifier))) {
                    if (rule.AccessControlType == AccessControlType.Allow && (rule.FileSystemRights & writes) != 0 && !Privileged(rule.IdentityReference.Value)) throw new IOException("Untrusted write access");
                }
                current = Path.GetDirectoryName(current); leaf = false;
                if (String.IsNullOrEmpty(current)) break;
            }
        }
        internal static void Tree(string path) {
            Check(path, true);
            foreach (string item in Directory.GetFileSystemEntries(path)) {
                if ((File.GetAttributes(item) & FileAttributes.Directory) != 0) Tree(item); else Check(item, false);
            }
        }
        static bool Privileged(string sid) {
            return sid == "S-1-5-18" || sid == "S-1-5-32-544" || sid == "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
        }
        internal static void Node(string path) {
            Check(path, false);
            int major = FileVersionInfo.GetVersionInfo(path).FileMajorPart;
            if (major != 22 && major != 24) throw new IOException("Unsupported Node runtime");
            using (BinaryReader reader = new BinaryReader(File.OpenRead(path))) {
                reader.BaseStream.Position = 0x3c; int pe = reader.ReadInt32(); reader.BaseStream.Position = pe;
                if (reader.ReadUInt32() != 0x4550 || reader.ReadUInt16() != 0x8664) throw new IOException("Node must be x64");
            }
        }
    }

    internal sealed class Host : ServiceBase {
        readonly string node;
        Process child;
        Job job;
        int stopping;
        internal Host(string nodePath) { node = nodePath; ServiceName = Program.Name; CanStop = true; CanShutdown = true; AutoLog = false; }
        protected override void OnStart(string[] args) {
            try {
                TrustedPaths.Node(node);
                TrustedPaths.Tree(Program.Release);
                TrustedPaths.Check(Program.Config, false);
                // Logs/state deliberately have SID write ACLs, established by the installer.
                NoReparse(Program.State); NoReparse(Program.Logs);
                File.Delete(Path.Combine(Program.State, "authenticated.json"));
                string digest;
                using (FileStream config = File.OpenRead(Program.Config)) {
                    if (config.Length > 65536) throw new IOException("Config too large");
                    using (SHA256 hash = SHA256.Create()) digest = BitConverter.ToString(hash.ComputeHash(config)).Replace("-", "").ToLowerInvariant();
                }
                Dictionary<string, object> launch = new Dictionary<string, object> { { "launchId", Guid.NewGuid().ToString() }, { "configSha256", digest }, { "stateDirectory", Program.State } };
                JavaScriptSerializer json = new JavaScriptSerializer();
                File.WriteAllText(Path.Combine(Program.State, "launch.json"), json.Serialize(launch), new UTF8Encoding(false));
                job = new Job();
                ProcessStartInfo start = new ProcessStartInfo(node, Quote(Path.Combine(Program.Release, "dist", "windows-service-entry.js")) + " --config " + Quote(Program.Config));
                start.UseShellExecute = false; start.CreateNoWindow = true;
                start.RedirectStandardInput = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
                start.WorkingDirectory = Program.Release;
                start.EnvironmentVariables.Clear();
                string system = Environment.SystemDirectory;
                start.EnvironmentVariables["SystemRoot"] = Path.GetDirectoryName(system);
                start.EnvironmentVariables["WINDIR"] = Path.GetDirectoryName(system);
                start.EnvironmentVariables["PATH"] = system;
                start.EnvironmentVariables["TEMP"] = Program.State; start.EnvironmentVariables["TMP"] = Program.State;
                child = Process.Start(start);
                try { job.Assign(child.Handle); } catch { child.Kill(); child.WaitForExit(5000); throw; }
                Drain(child.StandardOutput.BaseStream, "stdout"); Drain(child.StandardError.BaseStream, "stderr");
                child.StandardInput.WriteLine(json.Serialize(new Dictionary<string, object> { { "command", "START" }, { "trustedSystemDirectory", system }, { "launch", launch } }));
                child.StandardInput.Flush();
                Thread watcher = new Thread(Watch); watcher.IsBackground = true; watcher.Start();
            } catch {
                Interlocked.Exchange(ref stopping, 1);
                if (job != null) { job.TerminateAndWait(); job.Dispose(); }
                Diagnostic("Service startup failed");
                throw new InvalidOperationException("AgentV service startup failed");
            }
        }
        static void NoReparse(string path) {
            string current = path;
            while (!String.IsNullOrEmpty(current)) {
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("Reparse state path");
                current = Path.GetDirectoryName(current);
            }
        }
        internal static string Quote(string value) {
            if (value.IndexOf('"') >= 0 || value.EndsWith("\\")) throw new IOException("Invalid launch path");
            return "\"" + value + "\"";
        }
        void Watch() {
            child.WaitForExit();
            if (Interlocked.CompareExchange(ref stopping, 2, 0) != 0) return;
            job.TerminateAndWait(); job.Dispose();
            Diagnostic("Agent process exited unexpectedly");
            // An unexpected host exit, without SERVICE_STOPPED, invokes SCM crash recovery.
            Environment.Exit(1);
        }
        protected override void OnStop() { StopTree(); }
        protected override void OnShutdown() { StopTree(); }
        void StopTree() {
            if (Interlocked.Exchange(ref stopping, 1) != 0) return;
            RequestAdditionalTime(22000);
            try {
                if (child != null && !child.HasExited) {
                    try { child.StandardInput.WriteLine("{\"command\":\"STOP\"}"); child.StandardInput.Flush(); } catch (IOException) { }
                    child.WaitForExit(15000);
                }
                bool empty = job == null || job.TerminateAndWait();
                if (!empty) { ExitCode = 1; Diagnostic("Process tree termination could not be confirmed"); }
            } catch { ExitCode = 1; Diagnostic("Service stop failed"); }
            finally { if (job != null) job.Dispose(); }
        }
        static void Drain(Stream source, string name) {
            Thread drain = new Thread(delegate() {
                byte[] buffer = new byte[16384];
                RotatingSink sink = new RotatingSink(Path.Combine(Program.Logs, name + ".log"));
                bool warned = false;
                try {
                    int count;
                    while ((count = source.Read(buffer, 0, buffer.Length)) != 0) {
                        if (sink == null) continue;
                        try { sink.Write(buffer, count); } catch {
                            sink.Dispose(); sink = null;
                            if (!warned) { warned = true; Diagnostic("Child log sink unavailable; draining without storage"); }
                        }
                    }
                } catch (IOException) { }
                finally { if (sink != null) sink.Dispose(); }
            });
            drain.IsBackground = true; drain.Start();
        }
        static void Diagnostic(string message) {
            Thread thread = new Thread(delegate() {
                try { using (RotatingSink sink = new RotatingSink(Path.Combine(Program.Logs, "host.log"))) { byte[] bytes = Encoding.UTF8.GetBytes(message + "\r\n"); sink.Write(bytes, bytes.Length); } } catch { }
            }); thread.IsBackground = true; thread.Start();
        }
    }

    internal sealed class RotatingSink : IDisposable {
        const long Limit = 5 * 1024 * 1024;
        readonly string path;
        FileStream stream;
        internal RotatingSink(string path) { this.path = path; }
        internal void Write(byte[] bytes, int count) {
            if (stream == null) stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read);
            if (stream.Length + count > Limit) {
                stream.Dispose(); stream = null;
                if (File.Exists(path + ".3")) File.Delete(path + ".3");
                for (int index = 2; index >= 1; index--) if (File.Exists(path + "." + index)) File.Move(path + "." + index, path + "." + (index + 1));
                File.Move(path, path + ".1");
                stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
            }
            stream.Write(bytes, 0, count); stream.Flush();
        }
        public void Dispose() { if (stream != null) { try { stream.Dispose(); } catch { } stream = null; } }
    }

    internal sealed class Job : IDisposable {
        IntPtr handle;
        internal Job() {
            handle = CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) throw new IOException("Cannot create job");
            ExtendedLimit limits = new ExtendedLimit(); limits.Basic.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE; no breakaway.
            if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimit)))) { Dispose(); throw new IOException("Cannot restrict job"); }
        }
        internal void Assign(IntPtr process) { if (!AssignProcessToJobObject(handle, process)) throw new IOException("Cannot contain agent"); }
        internal bool TerminateAndWait() {
            if (handle == IntPtr.Zero) return false;
            TerminateJobObject(handle, 1);
            Stopwatch timer = Stopwatch.StartNew();
            do {
                Accounting info;
                if (!QueryInformationJobObject(handle, 1, out info, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero)) return false;
                if (info.ActiveProcesses == 0) return true;
                Thread.Sleep(25);
            } while (timer.ElapsedMilliseconds < 5000);
            return false;
        }
        public void Dispose() { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
        [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long ProcessTime, JobTime; public uint LimitFlags; public UIntPtr MinimumWorkingSet, MaximumWorkingSet; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
        [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
        [StructLayout(LayoutKind.Sequential)] struct Accounting { public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime; public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimit info, uint size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out Accounting info, uint size, IntPtr returned);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    }
}
