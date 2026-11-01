// Installer-only, precompiled Framework 4.8 interop. No running helper and no arbitrary service name.
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace AcornOps.AgentV {
    public sealed class FailurePolicy {
        public uint StartType { get; internal set; }
        public uint ResetSeconds { get; internal set; }
        public uint[] Delays { get; internal set; }
        public bool RestartOnly { get; internal set; }
        public bool DelayedAuto { get; internal set; }
        public uint ServiceType { get; internal set; }
        public uint ErrorControl { get; internal set; }
        public bool NonCrash { get; internal set; }
        public bool CustomCommand { get; internal set; }
        public string Account { get; internal set; }
        public bool Standard { get { return Allowed && ResetSeconds == 86400 && RestartOnly && Delays.Length == 3 && Delays[0] == 10000 && Delays[1] == 30000 && Delays[2] == 60000; } }
        // SCM canonicalizes removal of all actions to reset period0.
        public bool Suppressed { get { return Allowed && ResetSeconds == 0 && Delays.Length == 0; } }
        bool Allowed { get { return !NonCrash && !DelayedAuto && ServiceType == 16 && ErrorControl == 1 && !CustomCommand && String.Equals(Account, @"NT AUTHORITY\LocalService", StringComparison.OrdinalIgnoreCase) && (StartType == 2 || StartType == 3 || StartType == 4); } }
    }
    public static class InstallerPolicy {
        const string Name = "AcornOpsAgentV";
        const uint Query = 1, Change = 2, Start = 16;
        public static FailurePolicy Read() { using (ServiceHandle service = Open(Query)) return Read(service); }
        public static void DisableOwned() {
            using (ServiceHandle service = Open(Query | Change)) {
                FailurePolicy policy = Read(service); RequireOwned(policy);
                SetStart(service, 4);
            }
        }
        public static void SuppressOwned() {
            using (ServiceHandle service = Open(Query | Change | Start)) {
                FailurePolicy policy = Read(service); RequireOwned(policy);
                if (policy.StartType != 4) throw new InvalidOperationException("Disable the service before suppressing queued recovery");
                SetActions(service, false);
            }
        }
        // The lock-owning installer must observe stopped tree and monotonically drain65s first.
        // A never-started new service can skip that drain.
        public static void MakeManual() {
            using (ServiceHandle service = Open(Query | Change)) {
                FailurePolicy policy = Read(service);
                if (!policy.Suppressed || policy.StartType != 4) throw new InvalidOperationException("Recovery suppression required");
                SetStart(service, 3);
            }
        }
        public static void RestoreOwned(uint startType) {
            if (startType != 2 && startType != 3 && startType != 4) throw new ArgumentException("Invalid owned startup mode");
            using (ServiceHandle service = Open(Query | Change | Start)) {
                RequireOwned(Read(service)); SetActions(service, true); SetStart(service, startType);
            }
        }
        static void RequireOwned(FailurePolicy policy) { if (!policy.Standard && !policy.Suppressed) throw new InvalidOperationException("Unknown service recovery policy"); }
        static FailurePolicy Read(ServiceHandle service) {
            IntPtr buffer = Marshal.AllocHGlobal(8192);
            try {
                uint needed;
                if (!QueryServiceConfig(service, buffer, 8192, out needed)) throw new Win32Exception(Marshal.GetLastWin32Error());
                Config config = (Config)Marshal.PtrToStructure(buffer, typeof(Config));
                FailurePolicy result = new FailurePolicy { StartType = config.StartType, ServiceType = config.ServiceType, ErrorControl = config.ErrorControl, Account = Marshal.PtrToStringUni(config.Account) };
                if (!QueryServiceConfig2(service, 2, buffer, 8192, out needed)) throw new Win32Exception(Marshal.GetLastWin32Error());
                Actions actions = (Actions)Marshal.PtrToStructure(buffer, typeof(Actions));
                if (actions.Count > 8 || (actions.Count != 0 && actions.Items == IntPtr.Zero)) throw new InvalidOperationException("Unsupported failure policy size");
                result.ResetSeconds = actions.Reset;
                result.CustomCommand = !String.IsNullOrEmpty(Marshal.PtrToStringUni(actions.Command)) || !String.IsNullOrEmpty(Marshal.PtrToStringUni(actions.Reboot));
                result.Delays = new uint[actions.Count]; result.RestartOnly = true;
                for (int index = 0; index < actions.Count; index++) {
                    Action item = (Action)Marshal.PtrToStructure(IntPtr.Add(actions.Items, index * Marshal.SizeOf(typeof(Action))), typeof(Action));
                    result.Delays[index] = item.Delay; result.RestartOnly &= item.Type == 1;
                }
                if (!QueryServiceConfig2(service, 4, buffer, 8192, out needed)) throw new Win32Exception(Marshal.GetLastWin32Error());
                result.NonCrash = Marshal.ReadInt32(buffer) != 0;
                if (!QueryServiceConfig2(service, 3, buffer, 8192, out needed)) throw new Win32Exception(Marshal.GetLastWin32Error());
                result.DelayedAuto = Marshal.ReadInt32(buffer) != 0;
                return result;
            } finally { Marshal.FreeHGlobal(buffer); }
        }
        static void SetStart(ServiceHandle service, uint mode) {
            if (!ChangeServiceConfig(service, 0xffffffff, mode, 0xffffffff, null, null, IntPtr.Zero, null, null, null, null)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        static void SetActions(ServiceHandle service, bool standard) {
            IntPtr items = Marshal.AllocHGlobal(3 * Marshal.SizeOf(typeof(Action)));
            IntPtr buffer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Actions)));
            IntPtr empty = Marshal.StringToHGlobalUni("");
            try {
                uint[] delays = new uint[] { 10000, 30000, 60000 };
                for (int index = 0; index < 3; index++) Marshal.StructureToPtr(new Action { Type = 1, Delay = delays[index] }, IntPtr.Add(items, index * Marshal.SizeOf(typeof(Action))), false);
                // A non-null action pointer with count0 explicitly removes configured actions.
                Actions actions = new Actions { Reset = 86400, Count = standard ? 3u : 0u, Items = items, Command = empty, Reboot = empty };
                Marshal.StructureToPtr(actions, buffer, false);
                if (!ChangeServiceConfig2(service, 2, buffer)) throw new Win32Exception(Marshal.GetLastWin32Error());
                Marshal.WriteInt32(buffer, 0);
                if (!ChangeServiceConfig2(service, 4, buffer)) throw new Win32Exception(Marshal.GetLastWin32Error());
            } finally { Marshal.FreeHGlobal(empty); Marshal.FreeHGlobal(buffer); Marshal.FreeHGlobal(items); }
        }
        static ServiceHandle Open(uint access) {
            using (ServiceHandle manager = OpenSCManager(null, null, 1)) {
                if (manager.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                ServiceHandle service = OpenService(manager, Name, access);
                if (service.IsInvalid) { int error = Marshal.GetLastWin32Error(); service.Dispose(); throw new Win32Exception(error); }
                return service;
            }
        }
        sealed class ServiceHandle : SafeHandleZeroOrMinusOneIsInvalid {
            public ServiceHandle() : base(true) { }
            protected override bool ReleaseHandle() { return CloseServiceHandle(handle); }
        }
        [StructLayout(LayoutKind.Sequential)] struct Config { public uint ServiceType, StartType, ErrorControl; public IntPtr BinaryPath, LoadOrderGroup; public uint Tag; public IntPtr Dependencies, Account, DisplayName; }
        [StructLayout(LayoutKind.Sequential)] struct Action { public uint Type, Delay; }
        [StructLayout(LayoutKind.Sequential)] struct Actions { public uint Reset; public IntPtr Reboot, Command; public uint Count; public IntPtr Items; }
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern ServiceHandle OpenSCManager(string machine, string database, uint access);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern ServiceHandle OpenService(ServiceHandle manager, string name, uint access);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool CloseServiceHandle(IntPtr handle);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryServiceConfig(ServiceHandle service, IntPtr buffer, uint size, out uint needed);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryServiceConfig2(ServiceHandle service, uint level, IntPtr buffer, uint size, out uint needed);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ChangeServiceConfig(ServiceHandle service, uint type, uint start, uint error, string binary, string group, IntPtr tag, string dependencies, string account, string password, string display);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ChangeServiceConfig2(ServiceHandle service, uint level, IntPtr buffer);
    }
}
