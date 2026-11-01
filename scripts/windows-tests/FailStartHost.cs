// Synthetic disposable-CI fixture only; never package this as a release host.
// Reproduces a synchronous SCM startup rejection without launching any child.
using System;
using System.ServiceProcess;
internal sealed class FailStartHost : ServiceBase {
    private FailStartHost() { ServiceName = "AcornOpsAgentV"; AutoLog = false; }
    protected override void OnStart(string[] arguments) {
        throw new InvalidOperationException("Disposable CI synchronous startup fault");
    }
    private static void Main() { ServiceBase.Run(new FailStartHost()); }
}
