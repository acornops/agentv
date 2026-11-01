// Synthetic external curl boundary only. The production API helper owns every decision.
using System;
using System.IO;
using System.Text;

public static class ApiIoFixture
{
    public static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string scenario = File.ReadAllText(Path.Combine(root, "case.txt"));
        File.AppendAllText(Path.Combine(root, "called.txt"), "x");
        foreach (string name in new[] { "CURL_CA_BUNDLE", "SSL_CERT_FILE", "SSL_CERT_DIR", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY" })
            if (!String.IsNullOrEmpty(Environment.GetEnvironmentVariable(name))) return 90;
        string response = null;
        for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--output") response = args[i + 1];
        if (response == null) return 91;
        string body = "{\"marker\":\"synthetic-response-secret\"}";
        string code = "200";
        int exit = 0;
        switch (scenario)
        {
            case "transport": exit = 7; code = "000"; break;
            case "native-stderr": Console.Error.WriteLine("synthetic-native-secret https://synthetic-secret.invalid/private"); exit = 7; code = "000"; break;
            case "native-excessive": exit = 123456; code = "000"; break;
            case "invalid-status": code = "synthetic-status-secret"; break;
            case "excessive-status": code = new string('7', 4096); break;
            case "multiple-status": code = "200\n200"; break;
            case "unicode-status": code = "\u0662\u0660\u0660"; break;
            case "empty-status": code = ""; break;
            case "missing-response": break;
            case "malformed-response": body = "synthetic-body-secret {"; break;
            case "oversized-response": body = new string('x', 65537); break;
            case "boundary-response": body += new string(' ', 65536 - body.Length); break;
            case "rollback-denied": code = "409"; body = "{\"marker\":\"synthetic-response-secret\",\"allowed\":false}"; break;
            case "server-error": code = "503"; break;
            case "unusual-status": code = "999"; break;
            case "zero-status": code = "000"; break;
            case "success": break;
            default: return 92;
        }
        if (scenario != "missing-response") File.WriteAllText(response, body, new UTF8Encoding(false));
        Console.Write(code);
        return exit;
    }
}
