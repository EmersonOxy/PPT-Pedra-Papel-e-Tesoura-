# Estrutura proposta do projeto

Status: proposta aprovada para o Marco 1 em 17/10/2026. A estrutura de produção só será aplicada no Marco 2, após nova aprovação.

## Estrutura alvo

```text
apps/
  studio/
    main/                 processo principal Electron e IPC permitido
    preload/              ponte tipada e mínima com o sistema operacional
    renderer/              interface React/TypeScript do Studio
    preview/               host/origem isolada do jogo em preview
src/
  game/
    core/                  regras puras, estado e transições
    ui/                    DOM do jogo, entrada e adaptação de estado
    animation/             animações e efeitos visuais
    editor-contract/       tipos, validadores e adaptadores de propriedades
assets/
  images/
  fonts/
content/locales/
  pt-BR.json
config/
  editor-elements.schema.json
  visual.json
  gameplay.local.json
tests/
  characterization/       cenários versionados de comportamento
  unit/
  editor/
  desktop/
scripts/
docs/
reference/
  Jogar-Trindade-transicao-preta.baseline.html
Jogar-Trindade-transicao-preta.html  entrada atual preservada durante a migração
```

## Regras de evolução da estrutura

- A referência congelada é somente leitura. Não a substitua pela implementação modular.
- A entrada atual permanece executável até que a equivalência da versão modular seja aprovada.
- O núcleo do jogo permanece JavaScript em módulos ES. React/TypeScript/Vite pertencem ao Studio, sem obrigação para `src/game/core`.
- Não mover nem renomear a entrada atual durante o Marco 1.
- A separação de diretórios é gradual: não criar arquivos vazios ou camadas sem uso concreto.
- Todos os caminhos editáveis pelo Studio permanecem dentro da raiz de projeto escolhida pelo usuário.

## Propriedade dos arquivos

- `src/game/core`: mecânicas, estado serializável e eventos de resultado; sem DOM, timer de apresentação ou APIs de desktop.
- `src/game/ui` e `animation`: renderização, controles, acessibilidade e efeitos visuais.
- `apps/studio/main`: seletores de arquivo, gravação atômica e invocação de tarefas permitidas.
- `apps/studio/renderer`: painéis, seleção, histórico de propriedades e comunicação validada com o preview.
- `config/visual.json`: apresentação editável e valores responsivos.
- `config/gameplay.local.json`: somente ajustes locais de teste, separados de regras competitivas.
- `config/editor-elements.schema.json` e registros por funcionalidade: contrato de extensibilidade documentado em [EDITOR_ARCHITECTURE.md](EDITOR_ARCHITECTURE.md).
- `reference/` e `tests/characterization/`: oráculo e cenários de compatibilidade.
