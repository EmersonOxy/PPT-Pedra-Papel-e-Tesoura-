# Trindade Studio — arquitetura do primeiro incremento

## Objetivo e limite

O Marco 3 estabelece um editor visual Windows funcional para os elementos já registrados pelo jogo. O Studio seleciona elementos pela lista ou diretamente na prévia, edita somente propriedades permitidas pelo catálogo, mostra a prévia do runtime modular real, alterna entre edição e teste, desfaz/refaz e salva a configuração visual com cópia de recuperação.

O runtime do jogo continua em JavaScript modular e sem dependência de React, TypeScript ou Electron. Este marco não altera as regras nem o HTML de referência. O Studio não oferece edição arbitrária de código, HTML ou CSS.

## Componentes

| Componente | Responsabilidade |
| --- | --- |
| `studio/electron/main.cjs` | Ciclo da aplicação, janela, template/projeto aberto, menu e validação de remetente IPC. |
| `studio/electron/preload.cjs` | API nomeada e estreita para abrir projeto, salvar visual.json, estado de alterações, histórico e fechamento. |
| `studio/src/` | Interface React/TypeScript: lista de elementos, prévia, inspetor, histórico, modo de teste e avisos. |
| `studio/electron/project-service.cjs` | Allowlist de arquivos, validação de catálogo/configuração, caminhos seguros e salvamento atômico com `.bak`. |
| `studio/electron/preview-server.cjs` | Servidor GET/HEAD de loopback com allowlist para o runtime modular real, sem IPC. |
| `studio/electron/renderer-server.cjs` | Servidor local do renderer empacotado e política CSP. |
| `studio/scripts/prepare-game-template.mjs` | Copia somente os 14 arquivos aprovados do jogo para o bundle de distribuição. |
| `studio/package.json` / `studio/pnpm-lock.yaml` | Dependências exatas, ferramentas e instalador NSIS x64 por usuário. |

Fluxo de confiança: o renderer do Studio não tem Node (`nodeIntegration: false`), usa `contextIsolation` e sandbox. O preload expõe apenas métodos definidos. O processo principal confere janela, frame e origem em cada mensagem. A prévia usa outra origem de loopback/porta, sem preload nem IPC; seu protocolo aceita somente mensagens versionadas, de origem, janela-pai e sessão correspondentes.

## Pastas

```text
studio/
  electron/                 processo principal, preload e serviços confiáveis
  scripts/                  desenvolvimento e preparação da distribuição
  src/                      renderer React/TypeScript e estilos
  tests/                    testes unitários e de fronteira
  dist/                     build local gerado, ignorado pelo Git
  .bundle/game-template/    runtime autorizado, gerado e ignorado pelo Git
  release/                  empacotamento e evidências locais, ignorados pelo Git
docs/
  STUDIO_ARCHITECTURE.md
  STUDIO_USER_GUIDE.md
```

O fluxo de build web do jogo usa sua allowlist existente e não inclui `studio/`.

## Instalação Windows

O artefato de entrega é um instalador NSIS por usuário criado pelo `electron-builder` já usado no projeto. O instalador cria atalhos no desktop e menu Iniciar, executa sem Node.js e mantém os dados do usuário ao desinstalar. O EXE portable foi rejeitado como canal principal porque não completou o teste de inicialização automatizado neste ambiente. Não existe assinatura de código nesta etapa; não desative SmartScreen nem antivírus para contornar avisos.

O código roda em um único aplicativo Electron. O projeto de jogo selecionado é canonicalizado e carregado a partir da pasta escolhida; os recursos do Studio ficam no pacote do aplicativo. O salvamento altera somente `config/visual.json` dentro da raiz selecionada e preserva `.bak` antes da substituição atômica. Configurações do aplicativo ficam em `app.getPath('userData')`, separadas dos projetos. Desinstalar não apaga a pasta de projetos, configurações visuais nem backups. O Studio não chama Vercel nem faz publicação automática.

## Contrato de extensibilidade do editor

O contrato versionado está em `config/editor-elements.schema.json`; valores editáveis ficam em `config/visual.json`. Cada elemento novo precisa de:

1. ID estável, globalmente único, não traduzido, com tipo conhecido e alvo real `data-editor-id` ou adaptador já registrado.
2. Propriedade declarada no catálogo com tipo conhecido, default válido, limites, unidade quando aplicável, responsividade explícita e operação de vínculo permitida.
3. Default/configuração compatível que reproduza a aparência atual do jogo.
4. Validação no processo principal e no runtime; integração genérica por operação registrada, sem código específico para cada ID.
5. Testes negativos (propriedade desconhecida, tipo/valor inválido, caminho/asset não registrado), teste da aplicação no alvo real e documentação na mesma mudança.

Operações permitidas no primeiro incremento: `textContent`, variáveis CSS nomeadas e registradas, fundo do primeiro filho do alvo e fonte de imagem por ID de asset. O Studio não aceita HTML/JS/CSS arbitrário, seletores fornecidos por dados, caminhos de arquivo, URLs remotas, comandos nem propriedades competitivas. Texto é simples e limitado; cores seguem `#RRGGBB`; imagem escolhe um ID registrado. O preview em modo de edição bloqueia entradas de jogo e comunica seleção; modo de teste libera a partida.

Uma mudança incompatível em ID/tipo/default/unidade/significado incrementa a versão do schema e inclui migração determinística, backup e testes de round-trip. Clientes antigos nunca devem sobrescrever uma versão futura.

Para novas telas, poderes ou animações, o Codex deve primeiro escolher os controles visuais que façam sentido. Regras e números competitivos permanecem fora do inspetor visual; não se deve expor um parâmetro de gameplay como propriedade editável sem uma aprovação de produto própria.

## Salvamento e recuperação

Salvar valida novamente o catálogo e o documento, grava `config/visual.json.bak` com a versão anterior e substitui a configuração com um temporário sincronizado. Se a troca falhar, mantém a versão anterior. A interface mantém undo/redo em memória e pergunta antes de descartar alterações ao fechar ou abrir outro projeto.

O Studio inicializa uma cópia local do runtime modelo em `Documentos/Trindade Studio/Projetos/Pedra-Papel-e-Tesoura`, em vez de editar o checkout de desenvolvimento implicitamente. O usuário pode abrir uma pasta de projeto compatível. Nesta etapa o Studio ainda não tem integração Git, sincronização remota, publicação ou gerenciamento de vários projetos.

## Decisões, alternativas e riscos

- **Electron + React + TypeScript + Vite** permanece a escolha de UI aprovada. O runtime do jogo não usa esse framework. A janela única reúne as três ações futuras; não há três aplicativos ou cópias independentes.
- **Instalador NSIS por usuário x64**, criado com o `electron-builder` já usado no projeto. A prova do wrapper portable falhou na inicialização, enquanto o executável instalado completou o smoke de uso; por isso o instalador é o canal desta fase. O app incorpora o runtime Electron e o modelo allowlisted, não requer Node.js instalado pelo usuário e preserva os dados do projeto ao desinstalar. Não é assinado, então o Windows SmartScreen pode exibir aviso de editor desconhecido. Distribuição pública requer assinatura e política de atualização aprovadas.
- **pnpm com lockfile** fixa versões de dependência. `studio/pnpm-workspace.yaml` aprova apenas os scripts revisados de `electron` (download do runtime necessário) e `electron-winstaller` (seleção do binário 7-Zip interno); o restante de scripts de dependência continua negado por padrão.
- **Servidor de prévia de loopback** foi escolhido para manter origem isolada e o jogo modular funcionando com módulos ES. Somente `127.0.0.1`, GET/HEAD e 14 caminhos são expostos. Ainda é necessário endurecer e revisar a proteção contra CSRF para qualquer feature que altere a superfície de escrita.
- **Risco de assets:** o catálogo atual só escolhe três imagens registradas, não importa novas imagens. Um fluxo de importação exigirá validação real de MIME/conteúdo, tamanho, extensão e caminho, plus sanitização e backup.
- **Risco de plataforma:** a prova de empacotamento é Windows x64 e depende dos navegadores/sistema suportados pelo Electron atual. macOS/Linux e atualização automática estão fora do escopo.
- **Compatibilidade de dados:** o app aceita schema 1 e rejeita versões futuras; backups `.bak` são cópias simples para restauração manual, sem interface de histórico de versões.

## Compatibilidade

- A referência original permanece byte a byte inalterada com SHA-256 `C6011DB78BC72E7932959AD1FCD81EF7EA2D0D353FE58FA391AD72B1B07DF843`.
- `index.html` segue como entrada modular do jogo, servido em origem isolada do Studio. `Jogar-Trindade-transicao-preta.html` continua como referência autocontida e não recebe mensagens do Studio.
- A configuração mantém `schemaVersion: 1`; o catálogo deve conter exatamente alvos reais e defaults válidos. Arquivos internos e código do Studio não entram na prévia nem no bundle Vercel.
- O contrato de preview usa protocolo 1, origem exata, `event.source` e nonce de sessão de 256 bits. Ao mudar o formato, aumentar versão e manter somente a compatibilidade necessária.
