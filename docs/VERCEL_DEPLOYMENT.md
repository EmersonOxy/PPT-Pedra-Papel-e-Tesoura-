# Publicação web e Vercel

## Estado verificado em 18/10/2026

- O projeto Vercel `pedrapapeltesoura` está vinculado ao repositório GitHub `EmersonOxy/PPT-Pedra-Papel-e-Tesoura-`.
- A produção observada foi gerada de `main` no baseline `00a5a3c18764e6dcc8e4773a06c52fcc0fbfadeb` e estava `READY`. Nenhuma configuração de produção, proteção, domínio ou alias foi alterada durante este trabalho.
- O time Vercel está no plano Hobby; `main` já tem deployment `production`, indicando a branch de produção atual. A integração GitHub está vinculada ao repositório correto. A consulta de projeto não expõe o toggle de deployment automático nem a opção de ignorar builds, então esses controles só serão investigados se um push aprovado não gerar Preview.
- O build da produção não preparou arquivos (`Skipping cache upload because no files were prepared`). A árvore da `main` contém o HTML original na raiz, mas não um `index.html`; o domínio raiz resulta em 404. O HTML original está disponível pelo caminho `Jogar-Trindade-transicao-preta.html` no repositório, mas não deve ser tratado como raiz do site.
- A integração Git não criou Preview para o PR #1. O PR/commit da branch existia antes da criação do projeto Vercel; não houve novo evento de push depois que o projeto foi conectado. A integração Git da Vercel costuma disparar Preview em push/PR. A próxima publicação autorizada na branch vinculada permitirá verificar esse gatilho.
- Durante esta tarefa foi criado um deployment Preview por upload direto dos arquivos de `dist/web`, com metadados do commit `3a027b8005b427aa1a184c50cc64926efb9ad241`. Ele terminou `READY`: <https://pedrapapeltesoura-4ohzhan74-emersonoxy.vercel.app/>. Este deployment demonstra a saída estática; não altera o deployment de produção nem representa uma execução de build pelo GitHub.
- O projeto exige autenticação SSO para os domínios Vercel padrão. Jogadores precisam de acesso autorizado enquanto essa proteção estiver ativa. A validação remota usou o mecanismo autenticado da integração Vercel; as proteções do projeto foram mantidas. Publicar para qualquer pessoa exigiria uma decisão separada sobre proteção e domínio.

## Build estático

O runtime modular é JavaScript sem bundler. O build de publicação copia uma allowlist fixa de arquivos, sem percorrer diretórios recursivamente, para `dist/web/`. Um novo módulo ou asset só será publicado depois de incluído explicitamente na allowlist e no teste de saída:

- `index.html`
- `assets/styles/game.css`
- `assets/images/hand-rock.png`
- `assets/images/hand-paper.png`
- `assets/images/hand-scissors.png`
- `src/game/main.js`
- `src/game/core/rules.js`
- `src/game/ui/game-animations.js`
- `src/game/ui/game-ui.js`
- `src/game/ui/game-view.js`
- `src/game/ui/turn-clock.js`
- `src/game/ui/visual-config.js`
- `config/editor-elements.schema.json`
- `config/visual.json`

Não publica o baseline HTML, `reference/`, arquivos internos do Codex, documentação, testes, `.git`, launcher, arquivos ocultos nem `config/gameplay.local.json`. O script rejeita symlinks e compara a saída com a lista esperada.

Em Windows, no diretório raiz do projeto:

```powershell
node scripts/build-web.mjs
node tests/deployment/web-dist-smoke.mjs
```

O teste serve os arquivos gerados localmente e verifica entrada, módulos, estilo, JSON e imagens com HTTP 200; verifica referência, documentação, configuração experimental e metadados internos com HTTP 404; e tenta traversal de caminho. O build e esse smoke test não requerem `npm`, `npx`, Vite ou instalação de dependências.

## Configuração Vercel proposta

O arquivo versionado `vercel.json` declara:

- framework: `Other`/sem preset, pois a aplicação publicada é HTML e JavaScript estáticos;
- build command: `node scripts/build-web.mjs`;
- output directory: `dist/web`;
- instalação de dependências: nenhuma.

O arquivo não altera as configurações já salvas no dashboard. Como ele ainda não está no remoto, o próximo deployment do Git deverá verificar se a configuração versionada é reconhecida e se o GitHub Integration consegue instalar/usar o Node previsto pelo projeto. O build script usa APIs nativas do Node e requer Node 18 ou superior.

## Fluxo GitHub e Preview

1. Cada atualização autorizada da branch do PR deve acionar a integração Git Vercel e gerar um Preview daquela revisão.
2. O Preview deve passar o build estático, os testes diferenciais e a validação de assets/configuração antes da revisão.
3. A aprovação do PR e o merge em `main` continuam sendo ações separadas, sob autorização de Émerson.
4. O deployment de produção deve resultar somente da `main` aprovada. Confirme commit e estado `READY` antes de considerar concluída a publicação.
5. Não atribua aliases de produção a Preview. Não mude proteção SSO, domínios ou variáveis de produção para testar.

Até a integração Git ser exercitada com um novo evento de push autorizado, o deployment file-based acima é evidência de que os arquivos estáticos sobem e servem corretamente, mas não prova o gatilho automático do PR.

Se um push aprovado não gerar Preview, confira no projeto Vercel o toggle de deployments automáticos, as regras/ignored build step e o acesso da GitHub App ao repositório. Confirme também a branch e o root directory do projeto. Faça essa investigação sem alterar produção nem a proteção de acesso; registre antes qualquer mudança proposta.

## Recuperação

Preserve o commit do baseline e os deployments Vercel imutáveis. Depois que a produção modular for aprovada, registre o URL e SHA do deployment anterior e do novo. O rollback imediato no plano Hobby só alcança o deployment de produção imediatamente anterior; no estado atual, esse deployment é o baseline com 404 na raiz. Portanto, essa ação restaura o estado anterior, mas não garante que o site volte a abrir na raiz.

Como alternativa, o Preview modular validado permanece disponível e pode ser promovido manualmente no dashboard Vercel, se a conta permitir. Uma promoção altera produção e exige autorização de Émerson. Não apague deployments nem referências Git necessárias à recuperação. A Vercel documenta rollback e promoção de deployments existentes ([rollback de produção](https://vercel.com/docs/deployments/rollback-production-deployment), [promoção de deployment](https://vercel.com/docs/deployments/promoting-a-deployment)).

## Teste de jogo

Foi validada a saída `dist/web` com o smoke de build e os testes locais do Edge. O browser smoke executou o runtime modular e a referência original em 1366×768 e 390×844, verificou 22 condições de UI e registrou zero erros de console ou falhas de rede. A suíte diferencial comparou 14 cenários de regras.

O deployment remoto foi conferido por chamadas HTTP autenticadas: raiz, todos os módulos, CSS, configurações visuais/schema e três imagens retornaram 200. O caminho do baseline e arquivos fora da allowlist retornaram 404. A interface remota não foi aberta em uma sessão de navegador autenticada, portanto jogadas, animações e console do browser no ambiente Vercel permanecem por validar visualmente ali; a execução de partida e os fluxos de UI foram exercitados no build local equivalente.

## Plugin e ferramentas

O pacote de skills Vercel versão `0.54.1` e o connector Vercel já estavam disponíveis na sessão. O manifesto local declara Vercel Labs, licença Apache-2.0 e MCP em `https://mcp.vercel.com`; a configuração de app aponta para o connector Vercel. Não foram encontrados hooks no pacote em cache inspecionado. `node` está disponível no runtime do Codex, mas `npm` e `npx` não estão no PATH. Portanto, o comando de instalação via `npx plugins add vercel/vercel-plugin` não foi executado e nenhuma ferramenta global foi instalada; as capacidades disponíveis foram suficientes para inspecionar o projeto e preparar o Preview.

## Evolução do Trindade Studio

O Studio futuro deve fornecer, por interface gráfica, ações para criar/visualizar build Preview, exibir o commit, resultado dos gates, log resumido e link de Preview. Publicação em produção deve exigir aprovação explícita em tela, mostrar o commit e destino antes de confirmar e nunca promover branch Preview automaticamente. As operações Vercel devem ficar atrás de uma API nomeada do processo principal, com escopo limitado ao projeto autorizado; não expor token, API genérica ou shell ao renderer.
