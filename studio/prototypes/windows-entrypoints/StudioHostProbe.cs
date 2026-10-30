using System;

internal static class StudioHostProbe
{
    private static int Main(string[] args)
    {
        Console.WriteLine("host=" + AppDomain.CurrentDomain.FriendlyName);
        Console.WriteLine("args=" + String.Join(" ", args));
        if (args.Length != 1) return 10;
        if (args[0] == "--mode=test") return 23;
        if (args[0] == "--mode=git") return 29;
        return 11;
    }
}
