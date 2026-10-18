# Diretrizes do projeto

## Visão e estado atual

Este projeto é um jogo web de Pedra, Papel e Tesoura, com partidas rápidas, apresentação competitiva e evolução gradual. Preserve as regras, os estados de partida, os recursos visuais, as animações, os controles e a compatibilidade atuais enquanto não houver uma decisão aprovada para alterá-los.

O baseline original está em `Jogar-Trindade-transicao-preta.html` e sua referência imutável em `reference/Jogar-Trindade-transicao-preta.baseline.html`; ambos mantêm SHA-256 `C6011DB78BC72E7932959AD1FCD81EF7EA2D0D353FE58FA391AD72B1B07DF843`. O commit aprovado `00a5a3c18764e6dcc8e4773a06c52fcc0fbfadeb` foi publicado em `origin/main`, que é a branch padrão do GitHub. A modularização autorizada do Marco 2 está em `feature/marco-2-modularizacao`; `index.html` é a nova entrada modular, enquanto o HTML autocontido continua disponível como referência executável.

## Escopo e decisões

- Não implemente servidor, autenticação, banco de dados, matchmaking ou infraestrutura multiplayer sem uma tarefa explícita e aprovada para isso.
- Prepare propostas de multiplayer em torno de autoridade do servidor, validação das jogadas, sincronização de estados, reconexão e prevenção de trapaças.
- Antes de mudar regras, arquitetura, stack, identidade visual ou escopo do produto, apresente a motivação, alternativas, riscos e impacto sobre o comportamento existente.
- Prefira mudanças pequenas e reversíveis. Não reescreva o jogo inteiro para resolver um problema localizado.
- Não adicione dependências sem explicar o benefício, manutenção, licença, superfície de segurança e impacto no tamanho e na distribuição do jogo.
- Não execute scripts externos ou comandos de amplo alcance sem autorização específica. Skills e plugins são instruções e ferramentas de apoio; não autorizam por si só ações fora da tarefa solicitada.

## Fluxo de colaboração

O agente principal coordena o trabalho e chama apenas os especialistas necessários. Use os agentes personalizados em `.codex/agents/` quando estiverem disponíveis na sessão; os agentes herdam o modelo e as permissões do agente principal.

Para trabalho de produto que envolva várias disciplinas, siga esta ordem, pulando as etapas que não se aplicam:

1. Product Director esclarece objetivo, público, prioridade, critério de sucesso e limites.
2. Game Designer examina o ciclo de jogo, risco, recompensa, justiça e equilíbrio.
3. UI/UX Director define hierarquia, feedback, acessibilidade, movimento e adaptação de tela.
4. Tech Lead avalia arquitetura, compatibilidade, custo e riscos de mudança.
5. Senior Game Developer implementa somente após o escopo estar autorizado.
6. QA / Security Engineer verifica os critérios acordados e registra falhas e evidências.

Delegue em paralelo apenas perguntas independentes. Não permita que agentes editem simultaneamente os mesmos arquivos; peça a cada especialista uma análise ou entregável delimitado e consolide no agente principal. Tarefas pequenas podem ser resolvidas diretamente sem convocar a equipe toda.

## Engenharia e arquitetura

- Mantenha regras de jogo determinísticas e testáveis; injete aleatoriedade onde isso permitir reproduzir cenários.
- Separe, de forma incremental, regras, estado de partida, apresentação, entrada do jogador e persistência quando a mudança justificar essa separação.
- Defina estados e transições válidos de forma explícita. Valide entradas na fronteira e trate estados impossíveis sem mascarar erros.
- Preserve interfaces e comportamento observável. Ao refatorar, compare o antes e o depois nos fluxos relevantes.
- Prefira APIs nativas do navegador e o stack encontrado no projeto. Não introduza TypeScript, bundler ou framework só por preferência.
- Evite efeitos colaterais em cálculos de regras e acesso direto ao DOM dentro do núcleo de combate.

## Game design e produto

- Partidas devem ser curtas, legíveis e competitivas. Explique o efeito de cada ação antes da confirmação quando houver custo ou consequência pouco óbvia.
- Avalie equilíbrio com tabelas de resultados, probabilidades e simulações reproduzíveis; declare premissas e variação aleatória.
- Projete IA com comportamento verificável e dificuldade progressiva sem vantagem oculta injusta.
- Projete recompensas e progressão para apoiar domínio e retorno voluntário, sem pressão artificial ou práticas manipulativas.
- Priorize por impacto no jogador, esforço, risco, confiança da evidência e custo de manutenção. Defina uma métrica e uma condição de sucesso antes de propor um MVP.

## UI/UX, acessibilidade e desempenho

- Preserve a identidade visual existente; proponha uma direção visual antes de uma revisão ampla.
- Mantenha hierarquia clara para jogada, tempo, resultado, vida, pontuação e próxima ação. Feedback de combate deve ser perceptível sem depender apenas de cor ou som.
- Faça a interface funcionar em desktop e telas estreitas. Use alvos de toque adequados, foco visível, semântica HTML, nomes acessíveis e navegação por teclado.
- Respeite `prefers-reduced-motion`; evite movimento contínuo quando uma transição curta comunica o mesmo estado.
- Evite trabalho síncrono, animações custosas e conteúdo de terceiros desnecessário. Preserve carregamento rápido e funcionamento local quando hoje disponível.

## Qualidade, segurança e multiplayer futuro

- Defina critérios de aceitação observáveis para cada mudança. Quando a tarefa solicitar validação, escolha verificações proporcionais: regras, estados extremos, navegador, resoluções e acessibilidade conforme o escopo.
- Não alegue que testes automatizados existem ou passaram se não foram executados. Se não houver infraestrutura de teste, explique a validação manual ou a lacuna.
- Considere conteúdo HTML injetado, dados persistidos inválidos, origem de dependências e exposição de segredos. Nunca confie no cliente para decidir resultado competitivo em um futuro modo online.
- Para uma proposta de multiplayer, desenhe protocolo e fluxo de reconexão antes da implementação. O servidor deve validar jogadas, relógios, resultados e transições de estado.
- Só adicione testes, ferramentas ou infraestrutura quando isso fizer parte da tarefa ou for necessário para satisfazer seus critérios de aceitação.

## Marco 2 — baseline, compatibilidade e runtime modular

- O Marco 1 foi concluído e o Marco 2 foi autorizado. Trabalhe somente em `feature/marco-2-modularizacao`; não altere `main` nem a branch de auditoria.
- Preserve `Jogar-Trindade-transicao-preta.html` e `reference/Jogar-Trindade-transicao-preta.baseline.html` byte a byte. Confirme o SHA-256 dos dois em qualquer validação final.
- O runtime modular começa em `index.html`; regras puras ficam em `src/game/core/`, integração DOM em `src/game/ui/`, recursos em `assets/` e opções visuais validadas em `config/visual.json`. Não importe código do jogo para o Studio.
- Faça mudanças pequenas e valide cada etapa com os comandos em `docs/BUILD_AND_TEST.md`. A suíte diferencial deve executar as mesmas entradas/RNG na referência e no núcleo modular; divergência de regras interrompe o avanço até ser explicada e corrigida.
- Use `node scripts/serve-local.mjs` para abrir `http://127.0.0.1:4173/`; o servidor permanece somente leitura, em loopback, sem CORS e contido à raiz. Não contorne políticas de `file://`, browser ou segurança do sistema.
- Não substitua nem atualize a referência para fazer teste passar. Mecânicas só mudam com solicitação/aprovação própria. Não inicie o Marco 3.
- Não instale ferramentas ou dependências globais sem necessidade demonstrada e decisão apresentada. Para o Studio, Electron/React/TypeScript/Vite são a stack de UI aprovada como proposta; o runtime do jogo continua em JavaScript modular sem framework imposto.

## Contrato obrigatório para elementos editáveis no Studio

- Toda funcionalidade nova que queira ser editável deve registrar elemento com ID estável, único e não traduzido, tipo conhecido, nome acessível/traduzido, target por `data-editor-id`/adaptador registrado e allowlist de propriedades com tipos, defaults, unidades, limites e responsividade.
- O registro e seu schema versionado são o contrato entre jogo e Studio. A funcionalidade que introduz elemento deve atualizar catálogo, migrações quando necessárias, testes e documentação na mesma mudança.
- O catálogo inicial usado pelo jogo está em `config/editor-elements.schema.json`; os elementos publicados precisam ter um target real em `index.html`, `binding` suportado pelo runtime e valores padrão/configurados em `config/visual.json`. Prefira operações genéricas já suportadas para que o Studio descubra novos alvos sem lógica específica por ID.
- Nunca expor HTML, JavaScript, CSS arbitrário, selector executável, comando de sistema, asset remoto ou propriedade não validada no editor.
- Valores visuais ficam em `config/visual.json`; experimentos de regra ficam em `config/gameplay.local.json` isolados. Parâmetros competitivos permanecem somente leitura até aprovação explícita.
- Mudança incompatível de ID, tipo, default, unidade ou semântica requer incremento de versão, migração determinística, backup e teste de compatibilidade. Versões futuras não podem ser sobrescritas por cliente antigo.
- O contrato detalhado e o procedimento para o Codex estão em `docs/EDITOR_ARCHITECTURE.md` e `docs/GAME_CONFIGURATION.md`; consulte-os ao implementar qualquer nova tela, poder, HUD, asset ou animação.

## Segurança do Studio e preview

- Electron: manter `contextIsolation`, sandbox e `nodeIntegration: false`; CSP explícita; sem APIs genéricas de filesystem/shell/Git no renderer.
- A ponte preload expõe somente operações nomeadas; o processo principal valida remetente, argumentos e caminhos canonicalizados dentro do projeto aberto.
- O preview roda isolado, sem IPC, com origem/canal e payload verificados. Não habilitar combinações amplas de sandbox que coloquem preview e editor na mesma origem privilegiada.
- Salvamento valida JSON e assets, grava atomicamente e mantém backup. Importação rejeita traversal, links fora da raiz, MIME/extensão incompatíveis e conteúdo ativo não sanitizado.
- Segredos nunca entram na configuração, logs ou Git. Git usa helper de credenciais existente e stage explícito.

## Publicação Web e Vercel

- O fluxo cotidiano de jogo deve usar a URL pública ou autorizada do projeto; validar atualizações em links Preview. PowerShell e servidor local são ferramentas internas de diagnóstico, não requisitos para o jogador. O acesso público deve respeitar a decisão de Émerson sobre SSO e domínios.
- A saída web é estática e determinística: `node scripts/build-web.mjs` gera somente os arquivos explícitos da allowlist em `dist/web/`; não copie diretórios recursivamente. Ao adicionar runtime necessário, atualize a allowlist e o teste de publicação na mesma mudança. Não inclua baseline original, `reference/`, documentação, testes, código do editor, `.git`, launcher, `config/gameplay.local.json`, arquivos ocultos ou segredos.
- `vercel.json` configura o projeto como saída estática: comando `node scripts/build-web.mjs`, diretório de saída `dist/web`. Não adicione framework, dependências npm ou comandos de instalação para esse build sem decisão técnica documentada.
- Execute `node tests/deployment/web-dist-smoke.mjs` após o build. A verificação deve confirmar caminhos essenciais com 200, conteúdo interno fora da allowlist com 404 e rejeição de traversal.
- Preview deve partir da branch de trabalho e não deve receber aliases de produção. Produção continua vinculada à `main`; não altere settings de proteção, domínios ou ambiente de produção como parte de uma validação Preview.
- Não publicar ou fazer push sem autorização expressa. A criação de um deployment Preview também precisa estar dentro do escopo autorizado da tarefa.
- Manter `docs/VERCEL_DEPLOYMENT.md` e `docs/BUILD_AND_TEST.md` atualizados com configuração, build, testes, causa de falhas e fluxo futuro. A documentação do Studio deve prever ações gráficas para publicar Preview, ver build e PR e promover para produção somente depois de aprovação explícita.
- Para testar Preview protegido, mantenha SSO e demais proteções. Não altere a política de proteção para facilitar teste; use acesso autenticado suportado ou registre a limitação. Não compartilhe nem persista links temporários de bypass.
- npm/npx não fazem parte do build estático e não devem ser instalados globalmente só para essa publicação. O plugin/connector Vercel já disponível na sessão pode ser usado; se a integração futura depender de outra ferramenta, documente e peça decisão antes de instalar.

## Critérios de aprovação

Uma mudança está pronta quando respeita o escopo aprovado, preserva os fluxos não envolvidos, inclui evidência de validação compatível com a tarefa, descreve limitações e riscos restantes e mantém as instruções e a documentação atualizadas. Nenhuma nova mecânica ou alteração de regra é presumida aprovada por estar tecnicamente implementada.

## Repositório oficial e fluxo Git

- Repositório oficial: `https://github.com/EmersonOxy/PPT-Pedra-Papel-e-Tesoura-.git` (remote `origin`).
- `main` é a branch estável; faça novas mudanças em branches específicas e descritivas.
- Use mensagens de commit claras e descritivas. Revise os arquivos staged antes de cada commit.
- Não adicione senhas, tokens, segredos ou arquivos sensíveis ao Git; confira o escopo do stage antes de gravar alterações.
- Não reescreva histórico existente sem autorização explícita. Nunca use force push neste projeto.
- Não publique nem faça push automaticamente. Envie alterações ao remoto somente após aprovação de Émerson.
- O primeiro commit do baseline também exige aprovação após revisão da lista staged, verificação de segredos, diff/checks e integridade/hash. Push exige aprovação separada; não use force push.
- A autorização de Marco 2 não autoriza iniciar o Marco 3. Conclua as etapas e peça aprovação para qualquer próximo Marco.
- Não crie commit, push ou merge sem aprovação expressa de Émerson após a revisão da entrega. Não use force push.
- Use a identidade Git local já configurada neste repositório; não copie nome/email pessoal para a documentação nem propague a configuração para o Git global.
