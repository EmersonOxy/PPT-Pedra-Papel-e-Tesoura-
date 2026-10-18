# Auditoria completa — Pedra, Papel e Tesoura

**Data:** 17/10/2026
**Escopo:** auditoria estática do HTML/CSS/JavaScript e avaliação de produto. Nenhuma regra ou funcionalidade do jogo foi alterada.
**Arquivo auditado:** [`Jogar-Trindade-transicao-preta.html`](../Jogar-Trindade-transicao-preta.html)
**Integridade observada:** 1.238.352 bytes; SHA-256 `c6011db78bc72e7932959ad1fcd81ef7ea2d0d353fe58fa391ad72b1b07df843`.

## Resumo executivo

O projeto é um protótipo jogável de arquivo único, autocontido e sem dependências externas. Combina o reconhecimento imediato de Pedra, Papel e Tesoura com combate por pontos de vida, poderes de uso único, recompensa a cada três pontos, transferência de inventário e uma IA que considera o histórico do jogador. O núcleo já tem limites de estado e funções de regras razoavelmente identificáveis, mas ainda está misturado à interface no mesmo script e não dispõe de testes, telemetria ou infraestrutura online.

O principal risco de experiência é a combinação de cinco segundos por escolha, jogada automática aleatória após a falta e derrota por três faltas acumuladas na partida. O principal risco de balanceamento é a interação entre cura imediata, buffs consumíveis, inventário transferível e IA adaptativa sem níveis de dificuldade ou explicação completa de sua política. A avaliação visual em navegador não pôde ser concluída: o navegador bloqueou a abertura do arquivo local e a política proíbe contornar esse bloqueio. Por isso, pontos de layout, contraste e responsividade abaixo são observações do código, não resultados de inspeção visual.

### Estado atual

- Um HTML contém o markup, aproximadamente 19,7 KB de CSS e 19,5 KB de JavaScript embutidos; não há dependências externas, build, persistência, backend ou suíte de testes identificados.
- O arquivo tem 1.238.352 bytes. O markup inclui oito ocorrências de imagens Base64, correspondentes a três imagens únicas; a codificação repetida ocupa cerca de 1,19 MB do documento.
- O código separa parcialmente regras e interface: `outcome`, `createGame`, `activateAbility`, `chooseEnemySign`, `awardBattle`, `play` e `nextBattle` ficam no início do IIFE (HTML aprox. linhas 318–419), enquanto DOM, animações, eventos e relógio seguem no mesmo escopo.
- Não há modo PvP, contas, estatísticas persistentes, histórico entre sessões ou sistema de matchmaking.

### Fluxo e regras encontradas

1. A tela inicial oferece “Jogar”; uma cortina animada troca para a arena e respeita `prefers-reduced-motion` (HTML aprox. linhas 247–255 e 550–590).
2. Cada lado começa o combate com 100 PV. A jogada padrão causa 20 de dano; crítico causa 30; empate não causa dano. Cinco acertos não bloqueados podem zerar a vida adversária (HTML aprox. linhas 314–315, 318–320, 395–419).
3. O jogador tem cinco segundos para escolher Pedra, Papel ou Tesoura. A primeira e a segunda falta geram uma escolha aleatória e o turno acontece; a terceira falta acumulada encerra a partida por inatividade (HTML aprox. linhas 446–459 e 680–691).
4. Cura consome um item e sorteia de 10 a 50 PV, limitados ao espaço até 100. Defesa reduz pela metade, arredondando para cima, o próximo dano recebido; crítico causa 30 no próximo ataque. Cura pode coexistir com um buff. Defesa e crítico não podem coexistir. Buffs são consumidos após a próxima jogada, inclusive em empate ou quando a jogada não os favorece (HTML aprox. linhas 330–345 e 395–408).
5. Um combate termina quando alguém chega a 0 PV e concede um ponto. O vencedor recebe todos os poderes do adversário. Ao atingir 3, 6 ou 9 pontos próprios, recebe ainda um poder aleatório. Os PV voltam a 100 no combate seguinte; os poderes permanecem. A partida termina ao atingir 10 pontos (HTML aprox. linhas 373–388 e 410–419).
6. O jogo reinicia toda a partida pelo botão de reinício, sem confirmação. Há teclas 1/2/3 para as mãos e H/D/C para poderes, além de foco visível declarado no CSS.

## Achados priorizados

| Prioridade | Achado e evidência | Efeito | Recomendação |
|---|---|---|---|
| P1 | Relógio de 5 s; escolha automática aleatória nas duas primeiras faltas; terceira falta termina a partida. A contagem de faltas não é reiniciada entre combates (constantes e `missChoice`, HTML aprox. linhas 315, 420–426, 680–691). | Pressiona decisão e acessibilidade; interrupções ou leitura lenta podem converter-se em derrota sem decisão estratégica. | Antes de alterar regras, medir faltas, duração e percepção de justiça. Testar modo casual/tempo maior ou falta por combate como alternativa opcional. |
| P1 | IA usa frequência recente e transições de até 35 sinais; após três sinais, tende a responder ao padrão mais provável, com 25% de aleatoriedade e escolha ponderada entre padrões mais comuns (HTML aprox. linhas 348–363). | Pode parecer que o adversário lê a jogada futura; a adaptação é baseada em histórico, mas sua política e dificuldade não são configuráveis. | Explicar que a IA aprende padrões; oferecer níveis com políticas observáveis e reproduzíveis. Validar taxa de vitória e justiça percebida por nível. |
| P1 | O botão ↻ chama `reset()` imediatamente e apaga pontos/inventário da partida sem confirmação (HTML aprox. linhas 591–600 e 711). | Toque acidental descarta progresso de uma partida longa. | Avaliar confirmação breve ou desfazer por poucos segundos; medir reinícios antes de implementar. |
| P2 | Cura restaura imediatamente e não consome turno; continua contando contra o relógio. Buffs de defesa/crítico são consumidos na próxima mão mesmo em empate ou resultado desfavorável (HTML aprox. linhas 330–345, 395–408). | Cura é geralmente a melhor opção quando há item e vida faltante; buffs podem parecer desperdiçados se o jogador não perceber o custo de oportunidade. | Mostrar efeito e consequência antes de ativar; balancear com dados de uso e resultados, sem presumir que o poder precisa de nerf. |
| P2 | `.power-meta span` e `.power-meta small` são ocultados por CSS; nomes de poder têm regras de tamanho pequeno em telas estreitas (HTML aprox. CSS linha 115 e regras mobile posteriores). | A progressão até Luck Block e a transferência de poderes ficam menos descobríveis durante a partida. | Tornar a informação essencial visível ou contextual; validar a compreensão em teste com jogadores iniciantes. |
| P2 | A tela final foca “Próximo combate”, mas as mudanças menu→jogo e overlay→arena não definem foco de destino. O overlay não é marcado como diálogo modal (HTML aprox. linhas 286–300 e 550–590). | Foco de teclado/leitor de tela pode ficar em elemento oculto depois das transições. | Definir e restaurar foco por estado; avaliar semântica de diálogo e navegação assistiva. |
| P2 | Não existem testes automatizados, critérios observáveis no código ou infraestrutura de reprodução de aleatoriedade na interface. Embora o núcleo aceite RNG injetável, UI chama `Math.random` diretamente. | Regressões de balanceamento e estados extremos são difíceis de reproduzir. | Extrair o núcleo em passo pequeno e adicionar testes de regras/estado antes de ampliar mecânicas. |
| P3 | O HTML embute as imagens repetidamente em Base64; não foram observados recursos remotos. | A distribuição offline é simples e confiável, mas o arquivo fica grande e mais difícil de revisar. | Preservar portabilidade; se o projeto crescer, testar extração de assets em arquivos locais com cache e comparação de carga antes de mudar. |

## Engenharia e qualidade

### Arquitetura e manutenção

- **Fato:** arquivo HTML único com IIFE estrito; regras, estado, IA, relógio, DOM, animações e eventos residem no mesmo escopo.
- **Fato:** as regras centrais têm fronteiras identificáveis e algumas dependências injetáveis (`rng` em funções de regra), o que facilita separar sem reescrever a interface.
- **Fato:** não há import/export, framework, backend, armazenamento local ou chamadas de rede observadas no JavaScript analisado.
- **Risco:** a interface é proprietária do estado; eventos/timers/animações assíncronas não têm uma camada formal de comandos ou redução de estado. Alterações novas podem acoplar regras a DOM e efeitos.
- **Recomendação:** manter HTML/CSS e fluxo visual na primeira etapa; extrair somente o núcleo de regra para módulo puro após testes de caracterização. TypeScript ou framework não são necessários para estabilizar este protótipo.

### Performance

O DOM é pequeno e não há loop de renderização contínua; o relógio atualiza um elemento a cada 45 ms e animações usam Web Animations API. O arquivo, porém, é aproximadamente 1,24 MB, majoritariamente Base64 repetido. A nota abaixo é uma avaliação estática: não foi possível medir carregamento, FPS, memória ou desempenho em aparelho móvel.

### IA

A escolha do adversário é feita antes de registrar a mão atual, portanto não lê a escolha ainda não submetida. A IA começa aleatória e adapta-se à frequência recente, transições após a última mão e repetição. Não há níveis de dificuldade nem estratégia de poder configurável. Cura é priorizada com PV ≤45; defesa é tentada com PV ≤60; crítico é tentado quando o jogador tem PV ≤60, com probabilidades próprias, respeitando a ordem cura→defesa→crítico (HTML aprox. linhas 348–371). A política não dá evidência de trapaça, mas pode ser difícil de interpretar sem explicação explícita.

### Risco de duração — modelo ilustrativo

Premissa matemática, não telemetria: decisões R/P/T independentes, jogador e adversário simétricos, sem poderes e com empate uniforme. Uma corrida de combate até cinco vitórias líquidas tem esperança aproximada de 7,54 jogadas decisivas; com empate em um terço das mãos, isso representa cerca de 11,31 escolhas. Uma corrida de partida até 10 pontos leva em média cerca de 16,48 combates, total aproximado de 186 escolhas, ou 15,5 minutos se cada escolha consumir os cinco segundos completos. Poderes, adaptação da IA, transições, escolha antecipada e faltas mudam bastante o valor real. Use a estimativa só como sinal para medir duração e abandono em playtest.

## Avaliação (0–10)

As notas são uma leitura do protótipo, não uma certificação. A ausência de execução no navegador limita experiência, visual, responsividade e desempenho real.

| Critério | Nota | Base da avaliação |
|---|---:|---|
| Qualidade do código | 6 | Funções de regra nomeadas, estado explícito e guardas de entrada; arquivo único, sem testes, com interface e regras no mesmo IIFE. |
| Arquitetura | 4 | Boa separação conceitual inicial, sem módulos ou fronteira formal entre simulação, visual e eventos. |
| Performance | 7* | DOM pequeno, sem dependências remotas nem loop contínuo; arquivo de 1,24 MB e ausência de medição. *Estimativa estática. |
| Game design | 6 | RPS reconhecível com combate e progressão de partida; timer punitivo e adaptação pouco configurável podem reduzir justiça percebida. |
| Balanceamento | 5 | Dano e vida são simples; cura variável, buff de um turno, transferência total e IA adaptativa ainda não têm evidência de playtest. |
| Inteligência artificial | 6 | Adapta-se a histórico observado e não lê o movimento futuro; sem níveis explícitos, telemetria ou validação contra jogadores. |
| Qualidade visual | Não avaliado | A inspeção visual em navegador foi bloqueada; CSS e assets estão no arquivo, mas screenshot real não foi obtido. |
| Experiência do usuário | 6* | Fluxo, mensagens, controles semânticos e HUD estão estruturados no HTML; hierarquia, cortes e leitura real precisam de navegador. *Evidência estática limitada. |
| Potencial competitivo | 5 | Placar a 10 pontos e leitura de padrões oferecem base para duelo; atualmente há apenas um adversário local e regras com aleatoriedade. |
| Preparação para multiplayer | 2 | Não há autoridade de servidor, sincronização, identidade, persistência, salas ou reconexão; núcleo ainda está acoplado ao arquivo. |
| Potencial de progressão e retenção | 4 | Há progressão dentro da partida, sem histórico ou evolução entre sessões; retorno de longo prazo não está validado. |
| Maturidade geral | 4 | Protótipo autocontido funcional em código, ainda sem repositório estabelecido anteriormente, build, testes ou serviço de jogo. |

## Cinco maiores pontos fortes

1. Regras clássicas reconhecíveis com decisão imediata e controles reais de teclado/botão.
2. Núcleo de estado e combate tem funções com limites claros, constantes visíveis e RNG injetável em partes centrais.
3. IA toma decisão antes da mão atual e mistura adaptação histórica com aleatoriedade; não há leitura antecipada evidenciada.
4. Combates, placar, poderes acumulados, resultado e mensagens criam um ciclo completo dentro da sessão.
5. HTML autocontido, sem dependências ou chamadas externas observadas; há breakpoints, foco visível e respeito CSS a movimento reduzido.

## Cinco maiores problemas/riscos

1. Relógio curto e derrota por falta cumulativa podem punir o jogador por razões externas à decisão.
2. IA adaptativa sem dificuldade controlável e explicação mais explícita pode parecer injusta.
3. Poderes variáveis e transferência integral de inventário podem criar vantagem acumulada e resultados difíceis de interpretar.
4. Ausência de testes automatizados e foco de teclado explícito nas trocas de tela limita confiança de mudança e acessibilidade.
5. Arquivo grande e monolítico dificulta revisão e expansão; o preparo para multiplayer é praticamente inexistente.

## Multiplayer futuro

Para PvP 1×1, a proposta é servidor autoritativo por sala: os clientes enviam intenção de jogada e sequência/nonce; servidor valida turno, prazo, inventário e estado, calcula resultado, persiste eventos e publica o novo estado aos dois jogadores por WebSocket. Usar relógio do servidor e janela de reconexão; não aceitar vida/pontos declarados pelo cliente. Começar com partidas privadas ou fila simples, identidade anônima opcional e persistência mínima. Matchmaking/ranking/temporadas só depois de testar retenção e fairness.

WebSocket é adequado para troca rápida e bidirecional de eventos, mas exige serviço com conexão duradoura, salas, heartbeats e escala coordenada. Polling é mais simples para protótipo e custo inicial, porém aumenta latência e tráfego; WebRTC peer-to-peer reduz tráfego do servidor mas não torna resultado confiável e complica NAT/reconexão, então não é recomendado como autoridade. A escolha de provedor, banco ou stack deve aguardar estimativa de volume, requisitos de disponibilidade e teste de custo.

## Testes e limites

- **Matriz de cenários solicitados:**

| Cenário | Evidência estática | Execução |
|---|---|---|
| Vitória, derrota e empate | `outcome`, `play` e `awardBattle` implementam os três resultados; empate não causa dano. | Não executado no jogo. |
| Vida chegando a zero | `play` limita PV a zero e chama encerramento do combate. | Não executado no jogo. |
| Timer expirando e faltas | `timeoutChoice` gera mão aleatória nas duas primeiras faltas e encerra na terceira. | Não executado no jogo. |
| Uso de poderes em estado inválido | Guards negam uso fora da fase playing, sem item, cura a PV cheio e segundo buff ativo. | Não executado no jogo. |
| Recompensas acumuladas/transferidas | `awardBattle` transfere o inventário e sorteia prêmio nos pontos 3/6/9 próprios. | Não executado no jogo. |
| Reinício durante animação | `reset()` retorna enquanto `busy`; botão de reinício é desabilitado durante resolução. | Não executado no jogo; concorrência visual não validada. |
| Cliques rápidos/alternância | `choose()` define `busy` sincronamente antes do primeiro `await`, e os comandos verificam `busy`. | Não executado no jogo. |
| Mobile e teclado | CSS prevê breakpoints; HTML tem botões e atalhos 1/2/3, H/D/C; existe `:focus-visible`. | Não executado em viewport/dispositivo/leitor de tela. |
| Reinício/continuidade | `nextBattle` restaura PV e mantém inventário; `reset` recria o estado completo. | Não executado no jogo. |

- **Problema reproduzível somente por inspeção estática — timer/faltas (P1):** abrir uma partida e não escolher em três turnos dentro da mesma partida. Esperado para experiência acessível/competitiva: resultado de inatividade deve ser previsível e proporcional, com alternativa casual ou pausa se o produto exigir. Observado no código: duas mãos aleatórias são jogadas e a terceira falta encerra o jogo, mesmo após mudança de combate. Recomendação: medir faltas e testar timer casual como experimento, após aprovação.
- **Problema reproduzível somente por inspeção estática — reinício sem confirmação (P1):** durante a partida, acionar o botão ↻. Esperado: evitar perda acidental ou oferecer confirmação/recuperação. Observado: `reset()` recria estado e placar imediatamente; nenhuma confirmação aparece. Recomendação: avaliar confirmação curta ou desfazer e medir ocorrências.
- **Problema reproduzível somente por inspeção estática — foco de tela (P2):** iniciar partida e avançar do overlay final ao próximo combate via teclado. Esperado: foco entra no primeiro comando utilizável e retorna a um elemento visível após cada troca de tela. Observado: foco é enviado ao botão final ao mostrar resultado, mas não há foco explícito ao ocultar menu/overlay. Recomendação: definir destinos de foco por transição e validar com teclado/leitor de tela.
- **Problema de descoberta — poderes (P2):** chegar à arena sem usar poder. Esperado: ver progresso/regras essenciais dos Luck Blocks e transferência. Observado no CSS: `.power-meta span` e `.power-meta small` são ocultos; a explicação depende de outras áreas/feedback. Recomendação: manter uma explicação curta visível e testar compreensão.

- **Navegador/manual:** não executado. Edge recusou `file://` por política de segurança e só permite HTTP/HTTPS; o bloqueio proíbe contornar por outra superfície ou execução indireta.
- **Automação:** não executada. O projeto não tem harness de teste identificado e não foi criada infraestrutura nesta auditoria.
- **Verificações estáticas:** leitura e extração de markup, CSS e JavaScript; contagem de assets e dimensões; cálculo matemático ilustrativo separado do código do jogo.
- **Não verificado visualmente:** primeira impressão, contraste, sobreposição/cortes em breakpoints, alvos de toque, foco real, animações e movimento reduzido em execução, desempenho e memória de dispositivos.

## Três ações recomendadas

1. Fazer playtest instrumentado leve (com consentimento) para medir duração, faltas, conclusão, replay e justiça percebida, incluindo pessoas que jogam pela primeira vez.
2. Definir regras de caracterização e corrigir clareza/acessibilidade antes de alterar balanceamento: política de IA, custo de habilidades, foco e confirmação de reinício.
3. Extrair o núcleo de regras em mudança pequena e testável; só então decidir interface modular e protótipo PvP autoritativo.

## Organização Git desta auditoria

Na auditoria inicial de 17/10/2026, o diretório ainda não era um repositório Git e a consulta read-only a `origin` não encontrou refs. Em seguida o baseline aprovado foi commitado e publicado, sem reescrita de histórico, em `main`, que é a branch padrão no GitHub. O commit é `00a5a3c18764e6dcc8e4773a06c52fcc0fbfadeb`; a branch de auditoria continua preservada. O estado atual do Marco 2 está documentado em `docs/GIT_WORKFLOW.md`.
