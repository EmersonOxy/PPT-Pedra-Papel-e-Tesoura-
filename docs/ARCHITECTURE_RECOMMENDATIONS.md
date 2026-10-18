# Recomendações de arquitetura

Estado atualizado em 18/10/2026: a implementação do Marco 2 foi concluída e validada em `feature/marco-2-modularizacao`. O baseline foi publicado em `origin/main` no commit `00a5a3c18764e6dcc8e4773a06c52fcc0fbfadeb`. O HTML original continua íntegro; a aplicação modular possui `index.html`, CSS/assets extraídos, núcleo JavaScript puro, adaptador DOM genérico e configuração visual validada. A recomendação anterior de extrair o núcleo “após aprovação do Marco 2” foi cumprida nesta branch.

## Arquitetura aplicada no Marco 2

| Camada | Local atual | Responsabilidade |
|---|---|---|
| Entrada | `index.html`, `src/game/main.js` | Carregar a config visual e inicializar a UI modular. |
| Regras | `src/game/core/rules.js` | Estado, RPS, poderes, IA, dano, prêmio, faltas e transições. JavaScript ES sem DOM. |
| Interface/controller | `src/game/ui/game-ui.js` | Composição de estado, eventos e integração das regras. |
| Apresentação | `src/game/ui/game-view.js` | HUD, botões, barras, mensagens de progresso e telas de resultado. |
| Relógio visual | `src/game/ui/turn-clock.js` | Exibição do prazo e timeout; depende do estado por callbacks. |
| Animações | `src/game/ui/game-animations.js` | Movimento das mãos, recuo/recuperação e feedback de dano. |
| Contrato visual | `src/game/ui/visual-config.js`, `config/editor-elements.schema.json` | Validar IDs e allowlist; aplicar texto simples, cores validadas e assets locais conhecidos. |
| Recursos | `assets/styles/`, `assets/images/` | CSS e PNG locais extraídos sem conversão. |
| Referência | `Jogar-Trindade-transicao-preta.html`, `reference/` | Arquivo original executável e oráculo de caracterização congelados. |

A suíte `tests/characterization/run-baseline.mjs` executa os mesmos 14 cenários no trecho de regras extraído da referência e no módulo atual, comparando estado final e chamadas de RNG. A comparação de screenshot com cenário de início determinístico foi pixel a pixel idêntica em 1366×768, 390×844 e 320×568. Esses resultados caracterizam a tela inicial da partida e ainda não substituem a revisão manual de todos os estados de combate.

## Diagnóstico atual

O baseline congelado continua entregue pelo único arquivo `Jogar-Trindade-transicao-preta.html`, com HTML, CSS, imagens embutidas e um IIFE JavaScript. A entrada modular em `index.html` separa CSS, PNG, regras puras e UI sem build nem dependências externas. O editor, persistência e integração desktop ainda não foram implementados.

O desenho é apropriado para um protótipo pequeno e offline. O custo de manutenção cresce quando sistemas passam a compartilhar estado e eventos no mesmo escopo. Já existem boas funções candidatas a um núcleo independente (`outcome`, `createGame`, `activateAbility`, `chooseEnemySign`, `awardBattle`, `play`, `nextBattle`, `missChoice`) e um parâmetro RNG em várias regras. O próximo passo técnico deve ser incremental e manter o HTML como ponto de entrada até a separação ser comprovada.

## Fronteiras recomendadas

```text
Interface HTML/CSS
  ├─ ações: iniciar, escolher sinal, ativar poder, reiniciar
  ├─ apresentação: HUD, mensagens, transições e animações
  └─ adapta estado para controles acessíveis
          ↓ comandos
Núcleo de simulação puro
  ├─ estado e fases válidas
  ├─ regras RPS, dano, habilidades e pontuação
  ├─ política de IA sem acesso à escolha não enviada
  └─ resultado/eventos determinísticos com RNG injetável
          ↓ estado serializável/eventos
Persistência local ou serviço online (futuro, opcional)
```

1. Definir um conjunto pequeno de comandos e transições: `start`, `choose(sign)`, `usePower(kind)`, `timeout`, `continueBattle`, `reset`.
2. Fazer o núcleo devolver próximo estado e eventos; não ler/escrever DOM durante cálculo de regra.
3. Separar o relógio de apresentação do relógio autoritativo quando houver online.
4. Injetar uma fonte de aleatoriedade e uma política de IA selecionáveis, permitindo replay determinístico e teste.
5. Preservar os recursos de imagem e os tempos visuais existentes até comparação de comportamento/screenshot aprovar mudança.

## Refatoração por etapas

| Etapa | Mudança | Critério para avançar |
|---|---|---|
| 1 | Adicionar testes de caracterização ao núcleo sem alterar regras. | Cenários atuais reproduzidos em seeds e estados extremos. |
| 2 | Extrair regras para módulo local puro; manter UI e carregamento simples. | Resultado de teste e fluxo manual equivalentes ao HTML de referência. |
| 3 | Dividir apresentação e entrada/eventos apenas quando houver várias telas/modos. | Dependências explícitas e baixa duplicação confirmadas por alteração real. |
| 4 | Introduzir bundler/TypeScript/framework apenas se módulos, assets ou equipe exigirem. | Benefício mensurável em manutenção/erros supera custo de build, deploy e dependências. |

Não recomendo migrar agora para Phaser, React, TypeScript ou outro framework: o jogo atual é uma arena DOM 2D pequena, sem física, cena grande ou equipe usando framework. Uma migração acrescentaria build e dependências sem benefício demonstrado. TypeScript pode ser reavaliado quando o núcleo dividido tiver contratos suficientemente estáveis.

## Multiplayer 1×1 futuro

### Fluxo autoritativo sugerido

1. Cliente solicita criar/entrar em sala; servidor valida token de sala e versão de regras.
2. Servidor cria estado inicial, participantes, `matchId`, `turnId` e deadline baseado em relógio do servidor.
3. Cada cliente envia `submitMove(matchId, turnId, move, nonce)`. Não envia dano, vida, pontos, prêmio ou resultado como autoridade.
4. Servidor rejeita jogada fora de turno, duplicada, inválida ou fora do prazo; resolve as regras e atualiza estado em uma única transação lógica.
5. Servidor transmite estado/evento versionado aos dois clientes. Cliente pode animar previsão visual, mas reconcilia sempre com evento autoritativo.
6. Queda de conexão mantém a sala por janela definida; ao voltar, cliente recebe snapshot e sequência de eventos a partir de `lastEventId`.
7. Persistir resultado final e eventos necessários a suporte/antifraude, com retenção mínima e consentimento/política claros.

### Comparação de transporte

| Opção | Vantagens | Custos e riscos | Adequação |
|---|---|---|---|
| WebSocket com servidor autoritativo | Bidirecional, latência baixa, evento de turno imediato; boa base para salas e reconexão. | Processo/conexão duradoura, heartbeat, autenticação, estado de sala, distribuição horizontal e custo operacional. | Recomendado para MVP online se o produto justificar serviço sempre ativo. |
| HTTP polling/long polling | Simples de hospedar e depurar; bom para prova de conceito de jogadas por turno. | Atraso entre consultas, tráfego repetido e pior sensação de simultaneidade. | Alternativa temporária para teste fechado com baixa frequência de jogada. |
| WebRTC peer-to-peer | Pode reduzir tráfego servidor entre pares. | NAT/ICE, reconexão e sinalização; cliente não confiável pode falsificar resultado. | Não recomendado como autoridade para competição/ranking. |

### Segurança, identidade e operação

- O servidor é autoridade para turno, RNG, deadline, inventário, pontuação e fim de partida.
- Proteger contra replay de comando, duplicação, spam, alterações de cliente, clock drift e abandono estratégico; limitar comandos por sala/turno.
- Salas privadas podem começar com código de convite e sessão anônima efêmera. Oferecer conta só quando salvar progresso/ranking trouxer valor.
- Para ranking, definir política de desconexão, partidas inválidas, smurf/abuso, temporadas e suporte antes de publicar ladder.
- Armazenar o mínimo necessário. Separar dados de identidade, partidas e telemetria; estabelecer retenção e exportação/exclusão conforme a política do produto.
- O custo inicial depende de tempo de conexão, simultaneidade, regiões e persistência. Estimar esses dados antes de escolher hospedagem, serviço de salas ou banco; não há base para stack definitiva nesta auditoria.

## Testabilidade, desempenho e operação

- Testar RPS completo, dano/defesa/crítico, faixa de cura, empate, PV em zero, transições de combate, prêmio, transferência, final por 10 pontos e timeout.
- Propriedades úteis: PV nunca abaixo de 0 ou acima de 100; um turno consome buffs corretamente; não aceitar comando após estado final; partida tem um vencedor; mesmo seed+comandos produzem mesmos resultados.
- Manter teste de DOM/teclado para foco, botões, timer e final; manter screenshots de viewport de referência depois que navegador estiver disponível para auditoria.
- Medir tamanho do HTML e carga das imagens antes/depois de qualquer extração. A forma autocontida hoje permite funcionamento offline, que deve ser uma decisão explícita caso continue relevante.
- Não adicionar logging remoto/telemetria sem definição de dados, consentimento e finalidade.

## Decisão arquitetural aprovada para preparação (17/10/2026)

Émerson aprovou a stack inicial do Trindade Studio: Electron para o host desktop e React + TypeScript + Vite apenas na interface do editor. O runtime do jogo usa JavaScript ES modular sem framework no núcleo. O Marco 2 atualizou a estrutura em branch dedicada; a stack do Studio continua reservada aos marcos futuros.

O contrato de IDs e propriedades editáveis, persistência, fronteiras de segurança, schema e extensibilidade está documentado em [EDITOR_ARCHITECTURE.md](EDITOR_ARCHITECTURE.md). A estrutura alvo está em [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md). O requisito de experiência visual semelhante ao Canva permanece no produto, limitado por um catálogo seguro de elementos registrados.

## Recomendação de decisão anterior à aprovação

O plano mantém a referência original como oráculo, protege regras com comparação diferencial e deixa o jogo independente do Studio. A escolha React/TypeScript/Vite vale para o editor; não migra o núcleo do jogo. Para multiplayer, desenhar e provar primeiro um servidor autoritativo simples de sala 1×1; autenticação persistente, matchmaking, ranking e temporadas são etapas posteriores condicionadas a métricas e orçamento.
