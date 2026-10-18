# Configuração de desenvolvimento

Auditoria iniciada em 17/10/2026; atualização de estado em 18/10/2026. O baseline aprovado já foi publicado no GitHub e a implementação do Marco 2 foi concluída em branch própria.

## Diagnóstico do ambiente

- Ambiente de trabalho: Windows 10 Pro 10.0.19045, PowerShell, pasta `C:\Users\canal\OneDrive\Documentos\PPT`.
- Aplicativo Codex para Windows: pacote `26.1013.4894.0`. Codex CLI: `codex-cli 0.163.0-alpha.10.2`. O comando `codex features list` confirmou `apps`, `browser_use` e `multi_agent` habilitados.
- Antes da configuração inicial em 17/10/2026, o diretório não era um repositório Git e não continha `AGENTS.md`, dependências ou estrutura de projeto.
- O jogo está em `Jogar-Trindade-transicao-preta.html`, com aproximadamente 1,24 MB, CSS e um bloco JavaScript embutidos. A auditoria não encontrou scripts externos, imports, links de estilo externos, framework ou API de rede no bloco de jogo. Não há pacote npm, bundler ou testes do projeto disponíveis.
- Ferramentas visíveis: Codex CLI, Git, PowerShell, Node.js fornecido pelo runtime do Codex, browser use e captura de tela via ferramentas Codex. O comando `python` resolve para o alias da Microsoft Store e não encontra uma instalação executável. `npm` não foi encontrado no PATH.
- MCPs configurados na CLI: `cua_repl` e `node_repl` habilitados; `code-review` e `codex_app` aparecem como desabilitados com motivo `Unsupported` nesta CLI. As ferramentas integradas do aplicativo desktop continuam visíveis nesta sessão.
- Hash SHA-256 do HTML na auditoria inicial: `C6011DB78BC72E7932959AD1FCD81EF7EA2D0D353FE58FA391AD72B1B07DF843`.
- A sessão recebeu permissões de filesystem irrestritas; este diagnóstico não altera as permissões configuradas no aplicativo.

## Plugins oficiais instalados

Foram instalados pelo CLI através do marketplace `openai-curated-remote`. Os manifestos apontam para `https://github.com/openai/plugins`; nenhum dos três declara hooks. Os scripts foram inspecionados e não foram executados.

| Plugin | Versão | Licença declarada | Foco útil | Observação |
| --- | --- | --- | --- | --- |
| `build-web-apps` | 0.1.2 | MIT | Construção de interfaces web, boas práticas de frontend e QA no navegador | Inclui skills opcionais de React, shadcn, Stripe e Supabase; use apenas quando a stack e a tarefa pedirem. |
| `game-studio` | 0.1.2 | MIT | Fundamentos de jogos web, UI de jogo, pipeline de arte e playtest | Traz referências e scripts de processamento local de sprites; requer Pillow quando esses scripts forem usados. |
| `product-design` | 0.1.56 | Proprietary | Descoberta de produto, auditoria de fluxos, protótipos e direção de experiência | Pode usar ferramentas de design e mídia conectadas. Seus scripts de contexto escrevem em `CODEX_HOME/state/plugins/product-design`; bootstrap cria um protótipo apenas no destino explícito. Nenhum foi executado. |

O catálogo oferece `authPolicy` `ON_INSTALL` para Build Web Apps e Game Studio, e `ON_USE` para Product Design. A instalação CLI terminou sem pedido de conexão nesta sessão. Plugins ou skills recém-instalados podem exigir uma nova sessão para aparecerem no seletor de skills.

## Skills disponíveis

### Skills locais do projeto

- `.agents/skills/incremental-game-refactoring/SKILL.md`: refatoração incremental com preservação de comportamento.
- `.agents/skills/game-systems-design/SKILL.md`: regras, probabilidades, IA, habilidades e equilíbrio.
- `.agents/skills/game-product-planning/SKILL.md`: descoberta, MVP, prioridades, roadmap e métricas.

### Skills do Codex e plugins

O ambiente já tinha skills de sistema `imagegen`, `openai-docs`, `review-agent`, `skill-creator` e `skill-installer`. Os plugins instalados adicionam workflows de game UI/playtest, browser frontend QA, construção web e product design. Os detalhes e referências permanecem nos pacotes oficiais instalados em `%USERPROFILE%\.codex\plugins\cache\openai-curated-remote\`.

## Agentes personalizados

Os perfis TOML estão em `.codex/agents/` e definem Tech Lead, Senior Game Developer, Game Designer, UI/UX Director, Product Director e QA/Security Engineer. Não foi fixado um modelo; cada perfil herda o modelo e as permissões da sessão. `.codex/config.toml` habilita a delegação e limita a três subagentes concorrentes.

Codex documenta agentes de projeto em `.codex/agents/<perfil>.toml` com `name`, `description` e `developer_instructions`. O suporte é para sessões locais confiáveis; a sessão atual pode precisar ser reaberta para carregar novos perfis.

## Colaboração

O agente principal pode acionar somente os especialistas necessários. Em mudanças multidisciplinares, o fluxo recomendado está em `AGENTS.md`: produto, game design, UI/UX, arquitetura, implementação e QA. Delegue investigações independentes em paralelo e mantenha um único agente responsável por editar cada arquivo. Mudanças de regra, arquitetura ou escopo exigem uma decisão do usuário antes da implementação.

## Qualidade e testes

O runtime do jogo usa módulos nativos do navegador e não tem dependências npm ou build step. Existem 14 cenários diferenciais de caracterização, smoke test do servidor HTTP, validador de configuração e validador de assets; os comandos estão em `docs/BUILD_AND_TEST.md`. O screenshot foi comparado com Edge headless, usando os mesmos estados e viewports. O Studio e sua automação de UI continuam sem build/testes porque não foram implementados.

Para futuras tarefas de multiplayer, exija uma proposta antes de infraestrutura: servidor autoritativo, validação de jogadas e tempo, sincronização do estado, reconexão e prevenção de trapaças. Nenhuma infraestrutura online foi criada nesta etapa.

## Validação desta configuração

- `codex --version`: confirmou `codex-cli 0.163.0-alpha.10.2`; o processo desktop confirmou o pacote `26.1013.4894.0`.
- `codex features list`: confirmou `multi_agent` habilitado nesta instalação.
- `codex plugin add ... --json`: confirmou a instalação dos três plugins e suas versões.
- O parser TOML do Python empacotado com o Codex leu os sete arquivos TOML sem erro.
- Uma execução efêmera somente de leitura listou os seis agentes em `.codex/agents/` e as três skills locais em `.agents/skills/`. Os três plugins aparecem como instalados e habilitados em `codex plugin list`.
- Os três manifests `SKILL.md` têm front matter delimitado e os campos `name` e `description`.
- `codex exec` registrou avisos não bloqueantes de ícones fora da pasta `assets/` nos metadados de interface de um plugin. As skills e plugins continuaram carregados.
- O SHA-256 final do HTML é idêntico ao hash da auditoria inicial; o jogo não foi alterado.

## Baseline Git publicado (18/10/2026)

- `origin` aponta para `https://github.com/EmersonOxy/PPT-Pedra-Papel-e-Tesoura-.git`.
- A identidade Git está configurada somente neste repositório via `git config --local`; os valores pessoais não são reproduzidos nesta documentação.
- O commit de baseline `00a5a3c18764e6dcc8e4773a06c52fcc0fbfadeb` está publicado em `origin/main`; `main` é a branch padrão do GitHub. A branch `audit/comprehensive-game-audit` permanece preservada.
- O Marco 2 está em `feature/marco-2-modularizacao`, criada a partir do commit aprovado. O commit local registra a implementação aprovada; publicação e merge dependem de autorização separada.
- A referência em `reference/` e o HTML autocontido mantêm SHA-256 `C6011DB78BC72E7932959AD1FCD81EF7EA2D0D353FE58FA391AD72B1B07DF843`.
- Node.js `v24.19.0` ficou disponível nesta execução, junto do Node bundled do Codex; `npm`, `dotnet`, compiladores C#/C++ e Electron continuam ausentes no PATH. Veja `BUILD_AND_TEST.md` para o servidor HTTP e testes nativos já criados.
- Histórico: antes da publicação inicial, `origin` não anunciava refs e o repositório local ainda não tinha commit. O baseline foi aprovado e publicado depois pelo usuário; não use o estado histórico como status atual.

## Fontes oficiais consultadas

- [Custom agents e configuração de subagentes do Codex](https://developers.openai.com/codex/subagents)
- [Skills locais do Codex e instalação](https://developers.openai.com/codex/skills)
- [Plugins OpenAI: Build Web Apps](https://github.com/openai/plugins/tree/main/plugins/build-web-apps)
- [Plugins OpenAI: Game Studio](https://github.com/openai/plugins/tree/main/plugins/game-studio)
- [Plugin Product Design no catálogo Codex](https://github.com/openai/plugins/tree/main/plugins/product-design)
