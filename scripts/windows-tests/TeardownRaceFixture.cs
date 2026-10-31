// Synthetic SCM fault fixture, never a release asset. Links exact host source.
using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Threading;
using AcornOps.AgentV;

internal static class TeardownRaceFixture {
    static int Main(string[] args) {
        if (args.Length == 1 && args[0] == "--member") { Thread.Sleep(60000); return 0; }
        if (args.Length == 1 && args[0] == "--parent") { Thread.Sleep(500); return 0; }
        if (args.Length != 2 || (args[1] != "confirmed" && args[1] != "unconfirmed")) return 2;
        ServiceBase.Run(new RaceService(args[0], args[1])); return 0;
    }
    sealed class RaceService : ServiceBase {
        readonly string directory, mode;
        readonly TreeTeardown teardown;
        Job job;
        int disposals;
        internal RaceService(string path, string result) {
            directory = path; mode = result; ServiceName = "AcornOpsAgentV"; CanStop = true; AutoLog = false;
            teardown = new TreeTeardown(delegate { }, Terminate, DisposeJob, delegate {
                File.WriteAllText(Path.Combine(directory, "unexpected-exit"), "1"); Environment.Exit(1);
            });
        }
        protected override void OnStart(string[] args) {
            job = new Job();
            string executable = Process.GetCurrentProcess().MainModule.FileName;
            Process member = Process.Start(new ProcessStartInfo(executable, "--member") { UseShellExecute = false, CreateNoWindow = true });
            job.Assign(member.Handle);
            Process parent = Process.Start(new ProcessStartInfo(executable, "--parent") { UseShellExecute = false, CreateNoWindow = true });
            job.Assign(parent.Handle);
            File.WriteAllText(Path.Combine(directory, "pids"), parent.Id + "," + member.Id);
            Thread watcher = new Thread(delegate() { parent.WaitForExit(); parent.Dispose(); member.Dispose(); teardown.ChildExited(); });
            watcher.IsBackground = true; watcher.Start();
        }
        bool Terminate() {
            // This callback can only run after production arbitration claims
            // watcher ownership. The real Job still contains a live member.
            File.WriteAllText(Path.Combine(directory, "watcher-claimed"), "1");
            Stopwatch timer = Stopwatch.StartNew();
            while (!File.Exists(Path.Combine(directory, "release-teardown"))) {
                if (timer.ElapsedMilliseconds >= 10000) return false;
                Thread.Sleep(10);
            }
            bool empty = job.TerminateAndWait();
            File.WriteAllText(Path.Combine(directory, "native-empty"), empty ? "1" : "0");
            return mode == "confirmed" && empty;
        }
        void DisposeJob() {
            job.Dispose();
            File.WriteAllText(Path.Combine(directory, "disposals"), Interlocked.Increment(ref disposals).ToString());
        }
        protected override void OnStop() {
            RequestAdditionalTime(22000);
            File.WriteAllText(Path.Combine(directory, "stop-entered"), "1");
            bool observed = teardown.Stop();
            if (!observed) ExitCode = 1;
            File.WriteAllText(Path.Combine(directory, "stop-result"), observed ? "1" : "0");
        }
    }
}
