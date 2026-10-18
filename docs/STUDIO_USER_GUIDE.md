# Trindade Studio — guia da primeira versão

## Abrir e editar

1. Execute `studio/release/Trindade-Studio-Setup-0.1.0.exe` com duplo clique e conclua o assistente por usuário. O instalador cria o atalho **Trindade Studio** na área de trabalho e no menu Iniciar. O aplicativo não exige terminal ou Node.js instalado.
2. Abra pelo atalho **Trindade Studio**. Na primeira execução, o Studio cria um projeto local inicial em `Documentos/Trindade Studio/Projetos/Pedra-Papel-e-Tesoura`.
3. Selecione um dos nove elementos no painel **Elementos** ou clique nele diretamente na prévia do jogo.
4. No painel **Propriedades**, altere somente texto, cor ou asset que apareça para aquele alvo. A prévia recebe as mudanças na hora.
5. Use **Desfazer** / **Refazer** para revisar; use **Testar** para jogar na prévia; **Voltar a editar** volta a bloquear os controles do jogo.
6. Clique em **Salvar** para gravar `config/visual.json`. Uma versão anterior é preservada em `config/visual.json.bak`. Ao fechar com mudanças pendentes, escolha salvar, descartar ou continuar editando.

**Desktop/Celular** muda o enquadramento da prévia, não o dispositivo real. A seleção e as propriedades aceitas vêm do catálogo. Este primeiro incremento não importa imagens, cria elementos novos, altera HTML/CSS livremente, edita regras, faz commits/envios ou publica na web.

## Abrir outro projeto

Use **Abrir projeto** e escolha a pasta raiz que contém `index.html`, `config/editor-elements.schema.json`, `config/visual.json` e os arquivos allowlisted do jogo. Uma pasta inválida é recusada com mensagem; o Studio não repara nem cria arquivos silenciosamente. A configuração e o backup são gravados dentro da pasta selecionada, nunca dentro dos recursos empacotados do aplicativo.

## Executar a prova de build

Esses comandos são destinados ao ambiente de desenvolvimento/Codex, não ao uso cotidiano do jogador:

```powershell
cd studio
pnpm install --frozen-lockfile
pnpm run build:windows
```

O build gera `studio/release/Trindade-Studio-Setup-0.1.0.exe` (instalador NSIS por usuário). A depuração pode ser executada com `pnpm dev` no desenvolvimento, mas o usuário final não precisa iniciar servidores ou executar comandos. O desinstalador remove o aplicativo e os atalhos, preservando projetos, configurações e backups em Documentos e nos dados locais do usuário.

## Recuperar uma configuração

Feche o Studio. Se a configuração salva apresentar problema, copie `config/visual.json.bak` para `config/visual.json` na pasta do projeto e reabra o Studio. Guarde uma cópia dos dois arquivos antes de restaurar. Não substitua a pasta do jogo ou a referência HTML para restaurar apenas uma configuração visual.

## Limites desta prova

O artefato atual é um instalador x64 por usuário, não assinado. O Windows pode mostrar SmartScreen; não desative nem contorne essa proteção. Distribuição pública requer decidir assinatura, canal de atualização e suporte. A instalação/uso não requer runtime Node independente; build e desenvolvimento usam Node/pnpm do ambiente de desenvolvimento. O instalador e o aplicativo continuam locais e não publicam automaticamente no Vercel.
