# Contrato de configuração do jogo

Status: desenho do Marco 1. O jogo ainda não carrega arquivos externos de configuração; esta especificação não altera seu comportamento atual.

## Separação de configuração

| Arquivo alvo | Uso | Editável no Studio |
|---|---|---|
| `config/visual.json` | texto, cor, fonte, imagem, posição, tamanho e overrides por breakpoint | Sim, por propriedade registrada. |
| `config/gameplay.local.json` | experimentos de regra no modo local de teste | Apenas em sandbox local, limites explícitos e aviso de modo. |
| defaults competitivos | valores efetivos das regras de jogo aprovadas | Não, até aprovação específica de design e arquitetura competitiva. |
| `config/editor-elements.schema.json` | validação de catálogo, IDs e propriedades | Não é arquivo de usuário; atualizado pelo código/PR. |

Defaults existentes que a primeira caracterização registra: vida máxima de 100 PV; dano normal de 20; crítico de 30; prêmio a cada 3 pontos próprios antes da vitória; vitória da partida a 10 pontos; 5 segundos por turno; derrota após 3 faltas; cura aleatória de 10 a 50 PV, limitada à vida máxima.

## Formato alvo

Todos os documentos têm `schemaVersion` inteiro. O bloco visual tem tokens globais, valores base e overrides apenas nos breakpoints nomeados. Os valores guardam unidade e referência de asset por ID, não path absoluto. A configuração local de gameplay tem `mode: "local-sandbox"` e é ignorada pelo modo competitivo.

## Validação e fallback

1. Verificar tamanho máximo e parse JSON.
2. Verificar `schemaVersion`, aplicando migrações sequenciais conhecidas.
3. Validar IDs contra o catálogo, tipos, limites, enums e unidade.
4. Resolver cada asset dentro da pasta aprovada e conferir conteúdo/tipo.
5. Aplicar config completa somente após validação. Se inválida, preservar o arquivo, exibir o erro e carregar defaults do jogo em modo somente leitura.

Configuração de versão futura não é reescrita por uma versão antiga. Migração não apaga chave desconhecida silenciosamente; ela reporta/quarentena o dado e preserva uma cópia.
