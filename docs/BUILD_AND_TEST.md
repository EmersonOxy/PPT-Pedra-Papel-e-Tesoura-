# Build, teste e compatibilidade

Status: comandos locais do jogo modular, verificações de compatibilidade e build/testes do primeiro incremento do Trindade Studio.

## Ambiente observado

- Windows 10 Pro 10.0.19045; PowerShell.
- Git disponível; Node.js `v24.19.0` visível pelo runtime do Codex.
- Runtime local do Codex: Node.js `v24.19.0` e pnpm `v11.25.0`; dependências do Studio ficam em `studio/node_modules` (ignorado) e versões exatas em `studio/pnpm-lock.yaml`.
- O build Windows do Studio usa instalador NSIS x64 por usuário via `electron-builder`; o usuário final não precisa de Node nem SDK .NET. O ambiente de build usa o runtime Node/pnpm configurado pelo Codex.

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

## Build para Preview Web

O build estático para Vercel é determinístico, usa allowlist e não instala dependências:

```powershell
node scripts/build-web.mjs
node tests/deployment/web-dist-smoke.mjs
```

A saída permitida é `dist/web/`. O smoke valida respostas HTTP de entrada, módulos, CSS, configuração e imagens, além da ausência de referência, documentação, arquivos internos e configuração experimental. Veja [`VERCEL_DEPLOYMENT.md`](VERCEL_DEPLOYMENT.md) para o diagnóstico da integração Vercel, configurações recomendadas e limites da validação Preview.

## Comparação visual

`node tests/characterization/run-browser-smoke.mjs` usa um Electron/Chromium de teste com perfil temporário separado; não abre, fecha ou modifica o perfil Edge existente. RNG e relógio são fixados, os controles percorrem empate, ataque, poderes e resultado, e as animações Web Animations reais são pausadas em 75 ms para comparar o mesmo frame. `node tests/characterization/compare-visual-captures.mjs` compara pixel a pixel as capturas baseline/modular. Resultado atual: 22 verificações por viewport, zero erros de console/rede e zero canais de pixel diferentes em 14 cenas a 1366×768 e 390×844. Cenas: menu, combate inicial, empate, ataque, combate após ataque, resultado e poder disponível. Capturas locais ignoradas pelo Git ficam em `studio/release/visual-comparison/`.

## Fluxo de desenvolvimento do jogo

```powershell
node scripts/serve-local.mjs
```

Em uma segunda janela de desenvolvimento:

```powershell
node tests/characterization/run-baseline.mjs
node scripts/validate-config.mjs
node scripts/validate-assets.mjs
node tests/characterization/server-smoke.mjs
```

O runtime do jogo não requer build step ou dependência de npm. Seu acesso cotidiano ocorre pela URL pública/Preview ou pelo servidor local documentado; use o Studio abaixo para testar alterações visuais.

## Trindade Studio — testes e empacotamento

As dependências do Studio ficam isoladas em `studio/` e são fixadas por `pnpm-lock.yaml`. `pnpm-workspace.yaml` permite scripts de instalação revisados somente para Electron (download do runtime) e electron-winstaller (seleção do 7-Zip interno). Nenhum comando instala Node, pnpm ou dependência global.

```powershell
cd studio
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build:renderer
pnpm run prepare:game-template
pnpm run build:windows
```

`pnpm run build:windows` produz `studio/release/Trindade-Studio-Setup-0.2.0.exe`, instalador Windows por usuário com atalhos de desktop e menu Iniciar. O usuário final instala uma vez e usa o atalho gráfico; não precisa iniciar servidores, terminal ou PowerShell. A pasta `release/`, `dist/`, `.bundle/` e `node_modules/` não entram no Git. Veja [`STUDIO_USER_GUIDE.md`](STUDIO_USER_GUIDE.md), [`STUDIO_PROJECTS_AND_UPDATES.md`](STUDIO_PROJECTS_AND_UPDATES.md) e [`STUDIO_ARCHITECTURE.md`](STUDIO_ARCHITECTURE.md) para uso, compatibilidade e limites.

Os testes em `studio/tests/` exercitam a allowlist, onze alvos editáveis, catálogo/configuração v1-v3, compatibilidade sem migração, defaults opcionais, valores avançados inválidos e fora de limites, rejeição de campos desconhecidos e caminhos internos, schema futuro, cópia `.bak`, gravação atômica, falha interrompida, prévia local com origem/sessão restritas, criação de projeto com manifesto/allowlist, importação de projetos com backup, isolamento de recents, detecção Git e validação das versões declaradas. Testes do verificador simulam releases estáveis, inválidas e indisponibilidade; não publicam release. A criação de symlink pode ser ignorada quando a política Windows do ambiente não permite essa operação.

`pnpm run test:package` inicia o executável Electron empacotado num projeto temporário. O smoke valida as oito cenas do catálogo contra o DOM real no menu, arena, resultados e prêmio; captura estados selecionados no app; valida seleção pelo canvas, tipografia/cor/aparência/opacidade/visibilidade e asset registrado, isolamento de propriedades compartilhadas, recuperação de camadas ocultas, undo/redo, alternância desktop/celular com override responsivo, defaults originais, jogo real e jogada no modo Testar, retorno a Editar, salvamento/backup e persistência após fechar/reabrir. O modo Testar recarrega o runtime real e não usa fixtures. O harness usa movimento reduzido e animações resolvidas imediatamente; ele verifica o fluxo funcional, não a duração visual de cada animação. Capturas locais ficam em `studio/release/` e não são versionadas.

`pnpm run test:browser` é um nome alternativo para o mesmo smoke no Electron empacotado. Mantê-lo evita apontar para um runner Chromium externo que não está incluído nem é dependência deste projeto.

`pnpm test` também valida o inventário `studio/scenes.json`: IDs únicos, alvos presentes no catálogo, valores delimitados e correspondência aos estados descritos em `game-ui.js`, `game-view.js` e `core/rules.js`. O teste do servidor valida a rota autenticada do catálogo e que ela não é acessível sem o vínculo da prévia.

O smoke injeta uma raiz de projeto-fixture por variável de teste e, portanto, não opera o diálogo nativo **Abrir projeto** do Windows. Cancelamento do seletor, recusa de pasta inválida e troca entre duas pastas reais continuam como checklist de aceitação manual no Windows. O default do app empacotado usa `app.getPath('documents')/TrindadeProjetos`; o caminho `%TEMP%/trindade-studio-package-smoke-...` nas capturas é fornecido somente pelo harness via `TRINDADE_STUDIO_TEST_PROJECTS_DIR` em modo de teste.

O wrapper portable gerado no primeiro build não completou o teste de inicialização pelo canal de depuração em duas tentativas; o produto padrão foi alterado para o instalador NSIS. Não use o portable como evidência de uma execução aprovada. O instalador foi instalado em pasta temporária, os dois atalhos foram confirmados apontando ao app, o executável instalado passou o smoke completo e o desinstalador foi executado. Projeto de teste, `visual.json`, `.bak` e `studio-settings.json` permaneceram após desinstalar; os atalhos e a pasta instalada foram removidos.

O instalador 0.2.0 também foi reinstalado sobre uma instalação 0.2.0 na mesma pasta temporária. Marcadores de configuração/projeto fora da pasta do app e os dois atalhos foram preservados e continuaram apontando ao executável; depois, o desinstalador removeu app e atalhos, sem remover esses dados. Não havia um instalador 0.1.0 anterior disponível para simular upgrade entre versões. Portanto, não declare esse cenário entre versões testado; a configuração NSIS mantém o mesmo `appId`, instalação por usuário e retenção de dados.

`project-center` smoke valida início na Central, criação de projetos independentes pelo único modelo disponível, manifesto e configuração independentes, abrir/remover recents sem apagar pastas, confirmações de alterações não salvas e chamada real do endpoint GitHub (sujeita a rede). O aplicativo não migra projeto ao abrir nem ao verificar atualização. A página de release só é aberta após validação de origem e clique do usuário.

O teste automatizado de UI e comparação visual foi concluído em Electron/Chromium isolado, com perfil temporário separado; a sessão Edge existente permaneceu aberta e inalterada. As 22 verificações por viewport passaram sem erros de console/rede, e as 14 capturas de referência e modular tiveram igualdade pixel a pixel. O harness não usa o perfil Edge do usuário. A validação final do fluxo de edição do Studio também foi feita no executável instalado; a abertura literal do atalho por clique físico não foi automatizada neste ambiente, mas o destino dos atalhos e o executável instalado foram verificados e o executável completou o fluxo de uso.

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
