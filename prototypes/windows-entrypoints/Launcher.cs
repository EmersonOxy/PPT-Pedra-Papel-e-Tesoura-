using System;
using System.Diagnostics;
using System.IO;

internal static class Launcher
{
    private static int Main()
    {
        string launcherName = Path.GetFileNameWithoutExtension(Process.GetCurrentProcess().MainModule.FileName);
        string mode;
        if (String.Equals(launcherName, "Testar-Jogo", StringComparison.OrdinalIgnoreCase))
            mode = "test";
        else if (String.Equals(launcherName, "Enviar-Git", StringComparison.OrdinalIgnoreCase))
            mode = "git";
        else
        {
            Console.Error.WriteLine("Nome de launcher não reconhecido: " + launcherName);
            return 2;
        }

        string appPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Trindade-Studio.exe");
        if (!File.Exists(appPath))
        {
            Console.Error.WriteLine("Aplicativo principal não encontrado ao lado do launcher: " + appPath);
            return 3;
        }

        try
        {
            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = appPath;
            start.Arguments = "--mode=" + mode;
            start.WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory;
            start.UseShellExecute = false;
            using (Process child = Process.Start(start))
            {
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Falha ao iniciar o Trindade Studio: " + error.Message);
            return 4;
        }
    }
}
