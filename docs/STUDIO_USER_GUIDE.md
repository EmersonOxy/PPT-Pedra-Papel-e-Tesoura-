# Trindade Studio — guia da primeira versão

## Abrir e editar

1. Execute o instalador atual `studio/release/Trindade-Studio-Setup-0.2.0.exe` com duplo clique e conclua o assistente por usuário. Ele cria atalhos na área de trabalho e no menu Iniciar. O aplicativo não exige terminal ou Node.js instalado.
2. Abra **Trindade Studio** pelo atalho. A tela inicial é a Central de Projetos; não cria nem escolhe um projeto silenciosamente.
3. Use **Novo projeto** para criar uma pasta independente usando o único modelo disponível, Pedra, Papel e Tesoura, ou **Abrir projeto** para selecionar uma pasta existente. A Central lista projetos recentes e não apaga arquivos ao remover um cartão.
4. No editor, em **Telas**, selecione um estado demonstrativo. **Elementos da tela** mostra somente os alvos registrados para aquele estado; também é possível clicar diretamente em um alvo na prévia.
5. Em **Propriedades**, use as seções Transformação, Texto e tipografia, Aparência, Imagem e Visibilidade. O Studio oferece somente os controles registrados e compatíveis com o elemento: texto, família de fonte registrada, tamanho em px, peso/alinhamento quando declarados, cores, opacidade, visibilidade, assets locais conhecidos e geometria suportada. As alterações aparecem na prévia, integram undo/redo e ficam pendentes até **Salvar**.
6. **Salvar** grava a configuração dentro da pasta do projeto e mantém `config/visual.json.bak`. Ao voltar à Central ou fechar com mudanças pendentes, escolha salvar, descartar ou continuar editando.

**Telas e estados disponíveis:** Menu inicial; Combate; Resultado de vitória e derrota no combate; Recompensa desbloqueada (prêmio determinístico de Cura); Resultado de vitória e derrota na partida; Derrota por inatividade. Esses estados usam fixtures de demonstração restritas ao DOM da prévia; não executam nem alteram as regras do jogo. O modo **Testar** carrega o runtime normal.

**Desktop/Celular** muda o enquadramento da prévia, não o dispositivo real. As camadas e propriedades aceitas vêm do catálogo e dos alvos registrados que pertencem à tela selecionada. Se um estado futuro não tiver alvos editáveis, o Studio informa esse limite. A geometria atual usa deslocamentos CSS limitados (`flow-box-v1`), não posicionamento absoluto livre. O Studio não edita HTML/CSS livremente, regras, commits/envios nem publica na web.

Elementos ocultos continuam na lista **Elementos da tela** e podem ser selecionados para reexibir. **Restaurar valores visuais originais** remove overrides visuais do elemento selecionado, preservando sua geometria. Defaults opcionais não são gravados até a primeira alteração; remover o override devolve ao jogo o valor original do HTML/CSS.

O título do Menu e o botão Jogar expõem tipografia/aparência registradas; o cartão e componentes selecionados da Arena expõem somente propriedades declaradas no catálogo. Outros controles podem oferecer cor, asset ou nenhuma propriedade tipográfica. Fontes são opções registradas que dependem das famílias disponíveis no sistema; não há download de fontes.

Na seção **Imagens**, use **Importar imagem** para adicionar ao projeto um PNG, JPEG ou WebP estático. O Studio copia o arquivo para `assets/imported/`, atribui um ID estável e lista dimensões, tamanho e elementos que o utilizam. Limites: 5 MiB, 4096 px por lado, 16 MP e até 500 imagens por projeto. SVG, formatos animados, URLs externas e conteúdo cuja estrutura não corresponda à extensão são recusados. A imagem permanece no projeto quando duplicado/transferido. O seletor do inspetor permite atribuir assets registrados; undo/redo, salvar e testar aplicam-se normalmente. A saída web/Vercel atual ainda não publica imagens importadas; esse caminho requer uma alteração própria no build allowlist e nova validação de publicação.

Projetos schema 1 e 2 permanecem sem migração e sem propriedades novas gravadas ao abrir. O inspetor respeita o catálogo antigo. Uma eventual migração deverá pedir confirmação, criar backup recuperável e validar uma cópia antes de alterar o projeto.

## Abrir outro projeto

Use **Abrir projeto** e escolha a pasta raiz do projeto. Para o único modelo implementado, ela contém `index.html`, `config/editor-elements.schema.json`, `config/visual.json` e os arquivos allowlisted. Cada projeto tem um `trindade.project.json` com ID estável e versões do formato, modelo e engine. Pastas inválidas ou versões incompatíveis são recusadas com mensagem. A configuração e backup são gravados na pasta selecionada, nunca nos recursos empacotados.

A localização padrão em uma instalação normal é `app.getPath('documents')/TrindadeProjetos`, normalmente dentro da pasta Documentos do perfil Windows (incluindo quando Documentos está redirecionado pelo OneDrive). O caminho temporário mostrado nas capturas automatizadas vem exclusivamente de `TRINDADE_STUDIO_TEST_PROJECTS_DIR` no smoke de teste e não é selecionado em uso real.

A lista da Central só oferece o modelo real `pedra-papel-e-tesoura-web`. Outros gêneros ainda não estão implementados. Atualizações do Studio não migram nem alteram seus projetos. Consulte [`STUDIO_PROJECTS_AND_UPDATES.md`](STUDIO_PROJECTS_AND_UPDATES.md) para criação, importação, compatibilidade e o verificador de releases.

A validação automatizada do Electron instalado importa PNG, JPEG e WebP por caminhos de teste controlados e confirma miniatura, atribuição, renderização, salvamento e reabertura. Ela não substitui o seletor nativo do Windows nem o teste de teclas físicas. O NSIS 0.2.0 foi instalado em pasta temporária isolada; abertura, projetos schema 1, importação/renderização dos três formatos, salvamento/reabertura, atalhos Desktop/Iniciar e desinstalação foram verificados, e um projeto fora da instalação permaneceu intacto. Antes da distribuição, ainda é necessário um teste interativo do diálogo: abrir **Importar imagem**, conferir o filtro PNG/JPG/JPEG/WebP, escolher um arquivo de cada formato e confirmar; reabrir e cancelar, confirmando que a biblioteca não muda. Verificar também Ctrl+O, Ctrl+S, Ctrl+Z e Ctrl+Shift+Z por entrada de teclado real no app instalado. O fluxo web/Vercel continua sem publicar assets importados.

## Executar a prova de build

Esses comandos são destinados ao ambiente de desenvolvimento/Codex, não ao uso cotidiano do jogador:

```powershell
cd studio
pnpm install --frozen-lockfile
pnpm run build:windows
```

O build gera `studio/release/Trindade-Studio-Setup-0.2.0.exe` (instalador NSIS por usuário). A depuração pode ser executada com `pnpm dev` no desenvolvimento, mas o usuário final não precisa iniciar servidores ou executar comandos. O desinstalador remove o aplicativo e atalhos, preservando projetos, configurações e backups em Documentos e nos dados locais do usuário.

## Recuperar uma configuração

Feche o Studio. Se a configuração salva apresentar problema, copie `config/visual.json.bak` para `config/visual.json` na pasta do projeto e reabra o Studio. Guarde uma cópia dos dois arquivos antes de restaurar. Não substitua a pasta do jogo ou a referência HTML para restaurar apenas uma configuração visual.

## Limites desta prova

O artefato atual é um instalador x64 por usuário, não assinado. O Windows pode mostrar SmartScreen; não desative nem contorne essa proteção. A Central consulta a release estável oficial e oferece abrir a página para download manual; não baixa nem instala atualização e não migra projetos. Não publique arquivos de release sem o fluxo de assinatura e distribuição aprovado. Build e desenvolvimento usam Node/pnpm; instalação e uso não exigem Node independente. O Studio não publica automaticamente no Vercel.
