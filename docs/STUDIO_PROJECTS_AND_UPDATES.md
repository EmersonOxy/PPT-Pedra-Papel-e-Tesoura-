# Central de Projetos e atualizações do Trindade Studio

## Limite de responsabilidades

- **Trindade Studio** é a aplicação gráfica que organiza projetos e oferece ferramentas de criação.
- **Trindade Engine** é a fronteira planejada para capacidades reutilizáveis de execução; nesta versão, o manifesto declara compatibilidade, mas não há uma engine genérica nova.
- **Modelos** fornecem a estrutura inicial de um projeto. O catálogo é dirigido por dados e a Central não codifica os gêneros do jogo.
- **Projetos** são pastas independentes com manifesto, runtime, recursos, configurações e regras próprias.

Somente o modelo funcional `pedra-papel-tesoura-web` está disponível. Projeto vazio, puzzle, RPG e outros gêneros não são oferecidos até que tenham estrutura e validação reais.

## Manifesto de projeto

Cada projeto criado contém `trindade.project.json`, por exemplo:

```json
{
  "manifestVersion": 1,
  "id": "2d8f77f2-287b-46c4-87eb-7d7a62b44a90",
  "name": "Meu jogo",
  "createdAt": "data ISO-8601",
  "projectFormatVersion": 1,
  "engine": {
    "id": "trindade-engine",
    "testedVersion": "1.0.0",
    "minimumCompatibleVersion": "1.0.0"
  },
  "template": { "id": "pedra-papel-tesoura-web", "version": "1.0.0" }
}
```

O ID permanece estável mesmo que o nome visível mude. `manifestVersion`, `projectFormatVersion`, template e versões de engine são validados antes de abrir. O Studio atual recusa formatos incompatíveis/futuros e requisitos de engine superiores; não modifica automaticamente manifesto ou arquivos do projeto.

## Criar, abrir e recuperar

Projetos novos são copiados para uma subpasta da localização escolhida na Central (padrão: `Documentos/TrindadeProjetos`). O nome de uma pasta existente não é sobrescrito. A cópia usa uma lista explícita de arquivos do único modelo disponível. Cada projeto recebe `config/visual.json`, assets e código próprios.

Abrir um projeto antigo sem manifesto requer consentimento e cria primeiro um snapshot dos arquivos permitidos em `app.getPath('userData')/import-backups/`. O manifesto registra a referência ao backup. Os dados de lista recente ficam no diretório de dados do app e não são conteúdo do jogo. Remover um cartão recente não exclui a pasta. Ao abrir um repositório Git, a Central permite abrir a pasta escolhida ou criar uma cópia dos arquivos do jogo sem `.git`.

Uma falha ao criar cópia não deve deixar um projeto parcial apresentado como pronto. A implementação apaga somente o destino vazio/criado pela operação corrente. Salvamento de configuração permanece atômico, com backup `.bak` dentro do projeto.

## Atualização do Studio

O botão **Verificar atualizações** consulta a release estável na API oficial do GitHub. A resposta precisa ser uma release publicada estável, ter tag SemVer, URL oficial e o instalador NSIS esperado. A UI mostra versão/notas e abre a página oficial para que a pessoa baixe e instale deliberadamente. Sem conexão, projetos continuam acessíveis.

Esse fluxo é apenas informativo/manual. O build não tem assinatura Authenticode e não contém `electron-updater`: não baixa nem executa binários, não reinicia o app e não altera projetos. Não há release criada/publicada como parte deste incremento. Até existir um processo seguro de publicação, assinatura confiável e validação da distribuição, a Central não deve oferecer “atualizar agora” com instalação silenciosa.

Atualizar o Studio nunca implica migrar projetos. Qualquer migração futura será um comando/ação separado, com versão de origem e destino explícitas, backup confirmado, transformação determinística, validação pós-migração e recuperação testada. Clientes antigos não podem gravar em um formato futuro.

## Expansão prevista, ainda não implementada

Estruture novas capacidades atrás de contratos versionados e independentes da UI da Central: engine/runtime, modelos, cenas/objetos, extensões JavaScript e eventos visuais (eventos, condições e ações). Não adicione cards de demonstração para modelos inexistentes nem deixe regra específica do RPS vazar para catálogo/seleção geral de projeto. Um novo modelo só aparece depois de ter manifesto/versão, conteúdo inicial real, testes de compatibilidade e documentação.
