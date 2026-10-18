# Build, teste e compatibilidade

Status: plano e baseline do Marco 1. O build do Studio ainda não existe.

## Ambiente observado

- Windows 10 Pro 10.0.19045; PowerShell.
- Git disponível; Node.js `v24.19.0` visível pelo runtime do Codex.
- `npm`, `dotnet`, `csc`, `cl`, `msbuild` e Electron não encontrados no PATH. O compilador .NET Framework `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` existe fora do PATH e foi usado na prova dos launchers. `iexpress.exe` está presente, mas não será usado para fingir que scripts são executáveis de aplicação.
- Não instalar ferramentas durante o Marco 1 sem necessidade observada. Antes de iniciar build do Studio, decidir instalação controlada de Node.js LTS/npm e dependências com lockfile; SDK .NET só se a prova dos launchers demonstrar que é necessário.

## Execução local atual

`node scripts/serve-local.mjs` inicia um servidor HTTP somente leitura em `127.0.0.1:4173`, servindo arquivos da raiz do projeto e sem pacote npm/dependência externa. `TRINDADE_PORT` pode alterar a porta. O endereço padrão abre o HTML de entrada. O servidor aceita apenas GET/HEAD, canonicaliza caminhos, rejeita escapes da raiz e caminhos de arquivos ocultos, não habilita CORS e envia CSP restritiva compatível com o HTML autocontido. Encerre com Ctrl+C. `node tests/characterization/server-smoke.mjs` verifica GET/integridade do HTML, HEAD, rejeição de POST, ausência de CORS, traversal e arquivos `.git`/`.codex` ocultos.

## Testes de caracterização

Executar `node tests/characterization/run-baseline.mjs`. O harness usa apenas módulos nativos do Node e executa as funções de regra extraídas em memória da cópia congelada; ele não altera nem injeta código no HTML original.

Os 10 cenários cobrem matriz RPS/entrada inválida, estado inicial/constantes, cura (faixa e cap), buffs/empate/expiração, crítico/defesa, faltas, prêmio/transferência, fim por pontos, próxima batalha e determinismo da escolha da IA.

### Comparação na futura modularização

- Manter fixtures e entradas determinísticas independentes da implementação (movimentos, valores RNG, inventário e estados iniciais).
- Adaptar uma única suíte de cenários a um adaptador `baseline` e a outro `modular`; comparar estado final, eventos, dano, buffs consumidos, placar, inventário, fase, vencedor e razão de fim.
- Rodar seeds/casos fixos mais propriedades: PV em `[0, 100]`, inventário sem consumo duplicado, comando inválido não altera estado, buffs duram uma mão, mesma seed+comandos gera mesmo resultado.
- Cobrir DOM/teclado, clock/timeout, início/restart/próxima batalha e telas desktop/mobile via navegador; capturar snapshots de referência quando ambiente visual estiver disponível.
- Não comparar pixels para substituir testes de regra; usar screenshots para alterações de apresentação e acessibilidade.
- Toda divergência é classificada; não atualizar o baseline para acomodar uma mudança de mecânica sem aprovação do usuário.

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
