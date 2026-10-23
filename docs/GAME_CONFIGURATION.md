# Contrato de configuração do jogo

Status: configuração visual versionada usada pelo runtime modular e pelo inspetor do Marco 3. A entrada original autocontida não lê configuração externa e permanece imutável. `gameplay.local.json` existe como formato reservado e ainda não é carregado.

## Separação de configuração

| Arquivo alvo | Uso | Editável no Studio |
|---|---|---|
| `config/visual.json` | texto, cores, fontes registradas, tamanho/peso/alinhamento tipográfico, opacidade, visibilidade, imagem registrada, geometria `flow-box-v1` e overrides responsivos | Sim, por propriedade registrada. |
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

`visual.json` possui `schemaVersion` e um mapa `elements`. Cada elemento tem um bloco `base` e pode ter overrides por `responsive.mobile` ou `responsive.tablet`. A lista de propriedades, os bindings, a faixa de valores, o valor padrão e o sinalizador `responsive` ficam no catálogo `editor-elements.schema.json`. Breakpoints: mobile até 600 px; tablet de 601 a 750 px. Propriedades avançadas são opcionais: ficam ausentes até o usuário aplicar um override. Ao remover uma propriedade, o runtime restaura o valor original do HTML/CSS, sem gravar o default opcional.

O catálogo v3 registra onze elementos. Tipos aplicados: `text`; `color` com valores `#RRGGBB`; `fontFamily`, `fontWeight` e `textAlign` com opções locais fechadas; `fontSize` em CSS px com limites; `opacity` entre 0 e 1; `boolean` para visibilidade; `imageAsset` para IDs locais registrados. Cada propriedade declara um `binding` tipado e allowlist. A geometria `flow-box-v1` usa deslocamentos/tamanhos em CSS px limitados, não posicionamento absoluto. Fontes são nomes de família disponíveis no sistema/CSS, sem download de arquivos de fonte. Imagens só podem selecionar os assets já registrados; importação de imagens próprias ainda não faz parte deste incremento. Cada elemento expõe apenas os tipos de propriedades que declara.

Projetos com configuração/catalogo schema 1 e 2 permanecem compatíveis e não são migrados ou reescritos ao abrir. O Studio limita o inspetor às propriedades do catálogo de cada projeto antigo. Para adotar as propriedades do catálogo v3, uma migração deverá ser uma ação explícita, criar backup recuperável, validar uma cópia, mostrar as alterações e pedir confirmação antes de gravar. Versões futuras permanecem preservadas e não podem ser sobrescritas por um Studio antigo. Novos tipos/bindings exigem validação, handler seguro, testes de compatibilidade e documentação na mesma alteração.

No navegador de telas do Studio, alvos ausentes do catálogo de um projeto antigo são omitidos; telas e propriedades que já existem continuam acessíveis. Não é necessário converter um projeto antigo para editar o que já suporta. Migrações futuras devem ser explícitas e transacionais; em caso de falha, os arquivos originais permanecem ou são restaurados do backup.

`gameplay.local.json` usa `mode: "local-sandbox"` e está isolado. Enquanto o runtime não tiver tela de sandbox autorizada, o arquivo é ignorado e não altera as regras.

Configuração de versão futura não é reescrita por uma versão antiga. Migração não apaga chave desconhecida silenciosamente; ela reporta/quarentena o dado e preserva uma cópia.
