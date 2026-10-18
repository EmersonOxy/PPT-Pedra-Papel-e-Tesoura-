# Contrato de configuração do jogo

Status: configuração visual versionada implementada no runtime modular do Marco 2. A entrada original autocontida não lê configuração externa e permanece imutável. `gameplay.local.json` existe como formato reservado e ainda não é carregado.

## Separação de configuração

| Arquivo alvo | Uso | Editável no Studio |
|---|---|---|
| `config/visual.json` | texto, cor, fonte, imagem, posição, tamanho e overrides por breakpoint | Sim, por propriedade registrada. |
| `config/gameplay.local.json` | experimentos de regra no modo local de teste | Apenas em sandbox local, limites explícitos e aviso de modo. |
| defaults competitivos | valores efetivos das regras de jogo aprovadas | Não, até aprovação específica de design e arquitetura competitiva. |
| `config/editor-elements.schema.json` | validação de catálogo, IDs e propriedades | Não é arquivo de usuário; atualizado pelo código/PR. |

O runtime modular carrega `visual.json` antes de iniciar a UI. Os valores atuais reproduzem o padrão original: título, cor da arena, três assets de mão, cores das barras de vida e fundos dos botões de jogada. IDs dos assets são resolvidos por uma tabela local fechada; paths ou URLs vindos do JSON nunca são carregados diretamente.

Defaults existentes que a caracterização registra: vida máxima de 100 PV; dano normal de 20; crítico de 30; prêmio a cada 3 pontos próprios antes da vitória; vitória da partida a 10 pontos; 5 segundos por turno; derrota após 3 faltas; cura aleatória de 10 a 50 PV, limitada à vida máxima. Essas regras não vêm de `visual.json` e não podem ser alteradas pelo Studio.

## Formato alvo

Todos os documentos têm `schemaVersion` inteiro. O bloco visual tem tokens globais, valores base e overrides apenas nos breakpoints nomeados. Os valores guardam unidade e referência de asset por ID, não path absoluto. A configuração local de gameplay tem `mode: "local-sandbox"` e é ignorada pelo modo competitivo.

## Validação e fallback

1. Verificar parse JSON, versão, IDs do catálogo e tipos de valores.
2. Verificar `schemaVersion`, aplicando migrações sequenciais conhecidas.
3. Validar IDs contra o catálogo, tipos, limites, enums e unidade.
4. Resolver assets por IDs conhecidos e conferir conteúdo/tipo por `node scripts/validate-assets.mjs`.
5. Aplicar somente propriedades com adaptador registrado. A validação da configuração ocorre antes da aplicação; valores inválidos não são interpretados como HTML, CSS ou código.
6. Se arquivo ausente, inválido ou em versão futura, preservar o arquivo, emitir uma mensagem no console e manter os defaults do HTML/CSS.

## Formato ativo

`visual.json` possui `schemaVersion` e um mapa `elements`. Cada elemento tem um bloco `base` e pode ter overrides por `responsive.mobile` ou `responsive.tablet`. A lista de propriedades e o sinalizador `responsive` ficam no catálogo `editor-elements.schema.json`. Breakpoints atuais: mobile até 600 px; tablet de 601 a 750 px. Nenhum override responsivo está ativado por enquanto.

O catálogo inicial possui nove elementos com IDs permanentes. Tipos atualmente aplicados: `text`, `color` (somente `#RRGGBB`) e `imageAsset` (somente IDs de PNG locais registrados). Cada propriedade declara um `binding` tipado. Elementos novos podem usar operações genéricas existentes (`textContent`, `styleVariable`, `firstChildBackground` ou `imageSource`) sem lógica específica por ID. Um tipo ou operação nova exige handler genérico seguro em `src/game/ui/visual-config.js`, validação correspondente e atualização dos testes e desta documentação.

`gameplay.local.json` usa `mode: "local-sandbox"` e está isolado. Enquanto o runtime não tiver tela de sandbox autorizada, o arquivo é ignorado e não altera as regras.

Configuração de versão futura não é reescrita por uma versão antiga. Migração não apaga chave desconhecida silenciosamente; ela reporta/quarentena o dado e preserva uma cópia.
