# Estrutura atual e evolução do projeto

Estado: implementação do Marco 2 concluída e validada na branch `feature/marco-2-modularizacao`, a partir do baseline publicado `00a5a3c18764e6dcc8e4773a06c52fcc0fbfadeb`. O editor completo do Marco 3 ainda não existe.

## Estrutura entregue no Marco 2

```text
index.html                              entrada modular do jogo
Jogar-Trindade-transicao-preta.html     jogo original autocontido, preservado
reference/
  Jogar-Trindade-transicao-preta.baseline.html  oráculo imutável
src/game/
  main.js                               carrega config visual e interface
  core/rules.js                         regras puras extraídas do baseline
  ui/game-ui.js                         composição de eventos e estado local da UI
  ui/game-view.js                       HUD, controles, renderização e telas de resultado
  ui/turn-clock.js                      timer visual e timeout do turno
  ui/game-animations.js                 movimentos da arena e feedback de combate
  ui/visual-config.js                   valida/aplica propriedades editáveis seguras
assets/
  images/hand-{rock,paper,scissors}.png imagens PNG extraídas
  styles/game.css                       CSS extraído sem redesign
config/
  editor-elements.schema.json           catálogo/contrato versionado
  visual.json                            apresentação editável validada
  gameplay.local.json                    sandbox local, ainda ignorada pelo runtime
scripts/
  serve-local.mjs                        servidor HTTP local somente leitura
  validate-assets.mjs                    valida hash, formato, dimensões e alpha
  validate-config.mjs                    valida catálogo, IDs, targets e configs
tests/characterization/
  run-baseline.mjs                       executa cenários no baseline e no core modular
  server-smoke.mjs                       valida servidor, entrada modular e HTML original
docs/
  ...                                    arquitetura, contrato, setup, testes e roadmap
```

## Fronteiras dos módulos

- `src/game/core/rules.js` mantém funções sem DOM para estado, jogadas, poderes, IA, pontuação e faltas. As assinaturas e o consumo de RNG foram preservados para comparar resultados.
- `src/game/ui/game-ui.js` mantém os fluxos existentes de renderização, controles, teclado, clock, mensagens, transições e animações. Ele consome o módulo de regras.
- `src/game/ui/visual-config.js` valida a configuração em relação ao catálogo e aplica somente texto simples, cores hexadecimais e IDs de asset conhecidos. Não aceita CSS, HTML, JavaScript ou URL remota.
- `assets/` guarda os PNG e CSS extraídos. A execução modular usa HTTP local porque seus módulos e arquivos externos não são carregados por `file://` em navegadores modernos.
- `Jogar-Trindade-transicao-preta.html` e `reference/...baseline.html` continuam autocontidos, executáveis e imutáveis. Ambos devem conservar SHA-256 `C6011DB78BC72E7932959AD1FCD81EF7EA2D0D353FE58FA391AD72B1B07DF843`.

## Próximas áreas planejadas

```text
apps/studio/main/       processo principal Electron e operações permitidas
apps/studio/preload/    ponte tipada e mínima
apps/studio/renderer/   React/TypeScript/Vite para seleção e inspetor visual
apps/studio/preview/    origem isolada de preview
src/game/editor-contract/ validadores/adaptadores compartilhados quando necessários
content/locales/        rótulos traduzidos do editor
tests/unit/             casos adicionais do núcleo
tests/editor/           schema, migrações e catálogo do Studio
tests/desktop/          integração dos executáveis e fluxo desktop
```

Essas pastas só devem ser criadas quando tiverem implementação real. Electron, React, TypeScript, Vite, drag-and-drop, integração Git do Studio e executáveis de produção pertencem aos marcos posteriores autorizados.

## Regras de evolução

- Novos módulos de regras não dependem de DOM, Electron ou framework.
- Funcionalidade visual nova que deva ser editável registra ID estável em `config/editor-elements.schema.json`, target `data-editor-id`, allowlist, defaults e teste na mesma mudança.
- Mudanças em regras exigem aprovação de game design e comparação com o baseline; a modularização por si só não altera os valores efetivos.
- Configuração visual tem fallback seguro aos estilos e conteúdo padrão. `gameplay.local.json` é isolado e não é aplicado pelo runtime atual.
- A entrada original e o arquivo em `reference/` não são movidos nem regenerados.
