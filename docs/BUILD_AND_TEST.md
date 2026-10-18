# Build, teste e compatibilidade

Status: comandos locais do jogo modular e verificações do Marco 2. Build do Studio não existe e pertence a marco posterior.

## Ambiente observado

- Windows 10 Pro 10.0.19045; PowerShell.
- Git disponível; Node.js `v24.19.0` visível pelo runtime do Codex.
- `npm`, `dotnet`, `csc`, `cl`, `msbuild` e Electron não encontrados no PATH. O compilador .NET Framework `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` existe fora do PATH e foi usado na prova dos launchers. `iexpress.exe` está presente, mas não será usado para fingir que scripts são executáveis de aplicação.
- Não instalar ferramentas durante o Marco 1 sem necessidade observada. Antes de iniciar build do Studio, decidir instalação controlada de Node.js LTS/npm e dependências com lockfile; SDK .NET só se a prova dos launchers demonstrar que é necessário.

## Execução local

`node scripts/serve-local.mjs` inicia servidor HTTP somente leitura em `127.0.0.1:4173`, sem npm/dependências externas. A raiz `/` abre o jogo modular `index.html`; `/Jogar-Trindade-transicao-preta.html` abre o original autocontido. O servidor aceita apenas GET/HEAD, canonicaliza caminhos, rejeita escapes da raiz e arquivos ocultos, não habilita CORS e aplica CSP restritiva. Encerre com Ctrl+C. `TRINDADE_PORT` pode escolher outra porta.

O jogo modular usa módulos ES e assets externos locais, portanto deve ser aberto por HTTP. Não use `file://` nem desative proteções do navegador. O original permanece autocontido para referência.

## Testes de caracterização

Executar `node tests/characterization/run-baseline.mjs`. O harness usa apenas módulos nativos do Node; extrai as funções da cópia congelada em memória, executa os mesmos 14 cenários no baseline e em `src/game/core/rules.js`, compara estado final e chamadas de RNG e não altera o original.

Os cenários cobrem matriz RPS/entrada inválida, estado inicial/constantes, cura e limites, buffs/empate/expiração, crítico/defesa, faltas, prêmio/transferência, fim por pontos, próxima batalha, escolha da IA, comando inválido sem mutação, clamp de RNG, fim de combate por PV zero e cura da IA com preservação de histórico/faltas.

## Validação de configuração e assets

- `node scripts/validate-config.mjs` valida JSON, unicidade dos IDs, targets e referências de configuração.
- `node scripts/validate-assets.mjs` verifica SHA-256 dos três PNG, dimensões 500×500 e canal alpha.
- `node tests/characterization/server-smoke.mjs` roda com o servidor ativo e verifica entrada modular, HTML original, HEAD, rejeição de escrita, CORS, traversal e caminhos ocultos.

## Comparação visual

Capturas controladas foram feitas no Edge com movimento reduzido, RNG e relógio fixos, mesma escala e tela no baseline e no jogo modular. Pixels diferentes: 0 nos estados de jogo inicial em 1366×768 (desktop), 390×844 (celular) e 320×568 (estreito). A extração não mudou estilo ou recursos visuais. Essa verificação cobre uma tela após início; os estados de dano, poderes, empate, prêmio, timeout, resultado e próxima batalha ainda precisam de screenshots e revisão manual antes de considerar a equivalência visual completa.

## Fluxo de desenvolvimento

```powershell
node scripts/serve-local.mjs
```

Em outro terminal:

```powershell
node tests/characterization/run-baseline.mjs
node scripts/validate-config.mjs
node scripts/validate-assets.mjs
node tests/characterization/server-smoke.mjs
```

Não há build step ou dependência de npm para o runtime do jogo. O Studio e seus executáveis Windows continuam fora do Marco 2.

## Gates do `Testar-Jogo.exe`

1. Resolver raiz e arquivos do projeto.
2. Validar schema e migrações de configuração.
3. Executar testes unitários/caracterização e testes do catálogo editor.
4. Gerar build local e verificar saída.
5. Abrir o runtime sem chrome do editor apenas se os gates anteriores passarem.
6. Mostrar logs, duração, exit code e falha/remediação por etapa. Só retornar sucesso quando todos os gates requeridos concluírem.

Testes de UI com Playwright Electron podem ser usados depois da instalação; sua API de Electron é experimental e deve ter um smoke test manual de Windows junto do automatizado.

## Prova dos pontos de entrada

`prototypes/windows-entrypoints/run-probe.ps1` compila os dois launchers pelo compilador .NET Framework já disponível, usando o mesmo `Launcher.cs`, e os executa contra um host substituto em `%TEMP%`. A prova confirmou `Testar-Jogo.exe → Trindade-Studio.exe --mode=test` e `Enviar-Git.exe → Trindade-Studio.exe --mode=git`, propagando exit codes distintos (23/29). O host de teste não é um build Electron; a integração real requer o host empacotado no Marco 5.
