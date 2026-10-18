# Prova dos pontos de entrada Windows

`run-probe.ps1` cria temporariamente três executáveis: um host substituto com o nome `Trindade-Studio.exe` e dois launchers compilados do mesmo `Launcher.cs`. O host imprime os argumentos e retorna códigos específicos para provar que cada launcher escolhe o modo esperado e propaga o resultado.

Execute no Windows com:

```powershell
.\prototypes\windows-entrypoints\run-probe.ps1
```

O compilador usado é o .NET Framework `csc.exe` encontrado em `Framework64\v4.0.30319`; nenhum SDK .NET foi instalado. O host substituto não é o Trindade Studio e não valida integração com Electron. A integração empacotada deve ser provada quando o shell Electron estiver autorizado.
