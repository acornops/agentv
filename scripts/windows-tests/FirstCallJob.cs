using System;
using System.Runtime.InteropServices;
using System.Threading;

// Diagnostic ownership only. Unnamed job, no breakaway, no existing-session access.
public sealed class FirstCallJob : IDisposable {
    IntPtr handle;
    Timer watchdog;
    readonly object gate = new object();
    public volatile bool WatchdogFired;
    [StructLayout(LayoutKind.Sequential)] struct Basic {
        public long ProcessTime, JobTime; public uint Flags;
        public UIntPtr Minimum, Maximum; public uint Active; public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct Io { public ulong A, B, C, D, E, F; }
    [StructLayout(LayoutKind.Sequential)] struct Limits {
        public Basic Basic; public Io Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
    }
    public FirstCallJob() {
        handle = CreateJobObject(IntPtr.Zero, null);
        if (handle == IntPtr.Zero) throw new InvalidOperationException("JOB_CREATE_FAILED");
        Limits limits = new Limits(); limits.Basic.Flags = 0x2000;
        if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(typeof(Limits)))) {
            Dispose(); throw new InvalidOperationException("JOB_LIMIT_FAILED");
        }
    }
    public void Assign(IntPtr process) {
        if (!AssignProcessToJobObject(handle, process)) throw new InvalidOperationException("JOB_ASSIGN_FAILED");
    }
    public bool Contains(IntPtr process) {
        bool contained; return IsProcessInJob(process, handle, out contained) && contained;
    }
    public void StartWatchdog() {
        watchdog = new Timer(delegate(object state) { WatchdogFired = true; Terminate(); }, null, 12000, Timeout.Infinite);
    }
    public void StopWatchdog() { if (watchdog != null) watchdog.Dispose(); }
    public bool Terminate() { lock (gate) { return handle != IntPtr.Zero && TerminateJobObject(handle, 1); } }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long User, Kernel, PeriodUser, PeriodKernel;
        public uint Faults, Total, Active, Terminated;
    }
    public bool Empty() {
        Accounting value; uint length;
        return QueryInformationJobObject(handle, 1, out value, (uint)Marshal.SizeOf(typeof(Accounting)), out length) && value.Active == 0;
    }
    public void Dispose() {
        StopWatchdog();
        lock (gate) { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
    }
    [DllImport("kernel32.dll")] static extern bool QueryInformationJobObject(IntPtr job, int info, out Accounting value, uint size, out uint length);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int info, ref Limits value, uint size);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
    [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr value);
}
