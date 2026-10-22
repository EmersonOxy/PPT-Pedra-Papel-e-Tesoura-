# Trindade — Card Battler

> **Status: experimental — primeira versão para testes de navegador.** Regras, custos e balanceamento são provisórios.

Aplicação web TypeScript + Vite, separada do jogo Pedra, Papel e Tesoura e do Trindade Studio. O HTML V3 fornecido orienta a linguagem visual; o runtime foi refeito em módulos, com regras fora do DOM.

## Rodar e compilar

Na pasta `games/trindade-card-battler`:

```powershell
pnpm install
pnpm dev
```

Abra `http://127.0.0.1:5173/`. Para verificar o bundle: `pnpm build`. Para executar os testes do motor: `pnpm test`.

As dependências são de desenvolvimento: Vite `8.3.4` (MIT) e TypeScript `7.0.2` (Apache-2.0), as mesmas versões já usadas na instalação local do Studio. O runtime não adiciona dependências JavaScript de terceiros. O lockfile fixa a árvore resolvida.

## Estrutura

- `src/game/cards.ts`: catálogo e valores demonstrativos das 12 cartas.
- `src/game/engine.ts`: criação do estado, transições de jogador e resolução protegida do lote de ataques prontos.
- `src/game/config.ts`: validação tipada do balanceamento, topologia do campo, orientação das linhas e espaços especiais.
- `src/game/targeting.ts`: estratégia substituível de alvos e orientação espelhada das linhas.
- `src/game/ai.ts`: decisões básicas do adversário, usando as mesmas transições públicas.
- `src/game/simulation.ts`: relógio determinístico, cadências independentes e ordenação explícita dos eventos simultâneos.
- `src/ui/`: composição DOM, entrada mouse/toque, ilustrações SVG e animações.
- `config/balance.experimental.json`: parâmetros experimentais que podem ser substituídos sem alterar o motor.
- `tests/engine.test.ts`: regras, estado, IA e resultados em cenários reproduzíveis.

## Temporizadores e simultaneidade (v0.2 experimental)

O motor não oferece mais uma ação pública para resolver um ataque arbitrário. `resolveDueAttacks` só processa tropas cujo `nextAttackAtMs` já alcançou `clockMs`; o avanço normal ocorre por `advanceTime`. Ao mover uma tropa o temporizador é preservado. Recolher e posicionar novamente inicia uma nova cadência completa.

Todos os ataques prontos no mesmo instante são escolhidos a partir do mesmo snapshot pós-IA. Os eventos são ordenados de forma estável por lado (player, depois enemy) e slot crescente; essa ordem só organiza o relatório, não prioriza quem causa dano. Cada atacante válido emite seu ataque mesmo que também seja destruído nesse lote. Dano contra cada tropa é somado e aplicado depois de escolher todos os alvos; dano direto também é somado por jogador. Assim, tropas podem se destruir mutuamente. Se ambos os jogadores chegarem a zero de vida no mesmo lote, o resultado é empate.

Se uma ação da IA e ataques coincidirem, a regra explícita é: executar uma ação da IA primeiro; então, se a partida continuar, resolver em lote os ataques prontos naquele instante usando o campo após a ação da IA. Portanto, uma magia da IA pode remover um atacante antes do snapshot do lote. Essa precedência está documentada e coberta por teste.

`fieldTopology` declara linhas, colunas, linha dianteira de cada lado e espaços especiais. A interface desta versão aceita somente 2 linhas × 3 colunas; formatos diferentes são rejeitados durante a validação para evitar grade e regras divergentes. `deckSize` é uma restrição explícita e precisa ser igual a `catálogo de cartas × copiesPerDefinition`; a configuração atual continua sendo 12 × 2 = 24.

Eventos de combate distinguem `damage`/`heal` para tropas e `life-damage`/`life-heal` para vida. Todos carregam quantidades não negativas.

## Regras experimentais ativas

20 de vida para cada lado; deck de 24 cartas com duas cópias de cada uma das 12 cartas do V3; mão inicial de seis e limite máximo de seis; ataque automático a cada 3 segundos por tropa; alvo na mesma coluna; linha próxima ao centro protege a retaguarda naquela coluna; sem tropa na coluna, o ataque vai direto à vida. Chama Errante causa 2 de dano; Pulso Rúnico cura 2 até o máximo de vida. Não há mana. A IA fica parada até a primeira ação válida do jogador e responde 4 segundos depois; então compra e tenta posicionar uma carta a cada 4 segundos. Ela não lê a mão do jogador.

Custos, sigilos e os números do combate continuam demonstrativos. Sigilos podem ser colocados e revelados, mas não têm gatilhos. Não há reciclagem automática do deck. Nenhum desses valores representa aprovação de balanceamento ou regras finais.

## Compatibilidade e limite de escopo

Esta aplicação é um pacote independente dentro do repositório. Não importa módulos do jogo legado nem do Studio, e seu build não modifica `index.html`, `vercel.json`, o baseline ou os diretórios publicados. Este incremento ainda não integra assets importados pelo Studio nem cria pipeline de exportação web para eles.
