# Arquitetura e contrato de extensibilidade do Trindade Studio

Status: proposta aprovada para o Marco 1; guia obrigatório para implementação futura. O editor completo não faz parte deste marco.

## Decisões

| Área | Decisão do Marco 1 | Compatibilidade exigida |
|---|---|---|
| Aplicativo desktop | Electron | Funcionar sem Node instalado na máquina do usuário final; Electron inclui o runtime necessário. |
| Interface do Studio | React + TypeScript + Vite | Não migrar a lógica do jogo para React nem impor TypeScript ao núcleo. |
| Runtime do jogo | JavaScript modular e DOM existente | Preservar comportamento, controles, identidade visual e funcionamento local. |
| Contrato do editor | Registro tipado, allowlist de propriedades e esquema JSON versionado | ID e propriedade existentes não mudam de significado sem migração. |
| Persistência | JSON validado, gravação atômica e backup recuperável | Arquivo inválido ou versão futura não pode sobrescrever dados existentes. |
| Preview | Instância do jogo em fronteira isolada | Mensagens tipadas e verificadas; sem acesso direto do preview a arquivos ou IPC. |
| Gameplay | Configuração local de sandbox separada | Valores competitivos permanecem read-only e mantêm defaults conhecidos. |

React e TypeScript atendem à complexidade dos painéis, seleção, histórico e estados de salvamento. Vite compila apenas a aplicação do Studio. O runtime do jogo continua vanilla JavaScript modular para preservar a entrada simples e permitir testes de regras sem framework.

## Componentes e fronteiras

1. **Processo principal Electron**: operações explícitas de abrir projeto, listar/importar assets, gravar arquivos permitidos, executar validação/teste e iniciar Git com argumentos estruturados. Não expor shell genérico.
2. **Preload**: disponibiliza uma API pequena e tipada via `contextBridge`; nunca repassar `ipcRenderer`, `fs`, `child_process` ou objetos do processo principal.
3. **Renderer do Studio**: painéis, camadas, inspetor de propriedades, seleção, undo/redo e estado dirty. Sem Node e sem acesso ao filesystem.
4. **Preview do jogo**: instância separada do runtime. Recebe configurações validadas e mensagens com esquema/origem/canal conferidos. Não compartilha uma origem privilegiada com o Studio.
5. **Runtime do jogo**: comandos e funções puras do núcleo separados da UI e animação. Consome configuração validada com fallback seguro.

Configuração alvo do Electron: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, CSP restritiva, validação de origem/remetente e validação dos argumentos de todo IPC. O preview não recebe IPC. A comunicação preview/Studio usa `postMessage` com versão de protocolo, origem dedicada e payload validado; o frame recebe apenas dados necessários à apresentação.

## Contrato de elemento editável

Toda funcionalidade nova que queira expor opções visuais deve registrar os elementos e propriedades no mesmo PR/alteração da funcionalidade. O registro é a fonte de verdade; o editor não descobre nem modifica seletores arbitrários.

Campos obrigatórios por elemento:

| Campo | Regra |
|---|---|
| `id` | ID estável, único e permanente, no formato `area.elemento`, por exemplo `hud.player.health`. Não derivar de texto traduzido ou posição na lista. |
| `kind` | Tipo conhecido pelo editor: `text`, `image`, `container`, `button`, `meter` ou extensão previamente aprovada. |
| `labelKey` | Chave de tradução para o nome acessível no painel de camadas. |
| `target` | Identificação por `data-editor-id="<id>"` ou adaptador de runtime registrado; nunca CSS/JS arbitrário escrito pelo usuário. |
| `properties` | Lista explícita e não vazia, cada propriedade com `key`, `type`, `default`, limites/unidades quando aplicável e adaptador permitido. |
| `responsive` | Indica se aceita valor em `base` e overrides dos breakpoints oficiais. |
| `version` | Versão do contrato de registro; mudanças incompatíveis requerem migração. |

Tipos iniciais permitidos: `text` (texto simples), `color` (tokens/hex validados), `fontFamily` (fontes locais registradas), `fontSize` (unidade e limites definidos), `imageAsset` (ID de asset importado), `position` e `size` (unidades/âncoras/limites próprios), `visibility` e enumerações registradas. Propriedades de animação selecionam presets identificados; não editam código de keyframe.

Exemplo conceitual (não conectado ao jogo neste marco):

```json
{
  "version": 1,
  "elements": [
    {
      "id": "hud.player.health",
      "kind": "meter",
      "labelKey": "editor.elements.playerHealth",
      "target": { "attribute": "data-editor-id" },
      "properties": [
        { "key": "label", "type": "text", "default": "Vida" },
        { "key": "fillColor", "type": "color", "default": "#58a56d" },
        { "key": "position", "type": "position", "default": { "anchor": "top-left", "x": 0, "y": 0 }, "responsive": true }
      ]
    }
  ]
}
```

## Registro de funcionalidades pelo Codex

Ao criar um poder, tela, HUD ou animação editável, o Codex deverá:

1. Criar um ID novo, estável e único; confirmar unicidade no validador.
2. Marcar o elemento no runtime com `data-editor-id` ou implementar adaptador já previsto.
3. Registrar apenas propriedades seguras, com tipo, default, unidade, limites e breakpoint aplicáveis.
4. Adicionar chaves de tradução para o nome no painel e ajuda contextual.
5. Atualizar o esquema/versionamento e a migração, se necessário.
6. Adicionar testes de catálogo, validação, renderização e compatibilidade visual/responsiva.
7. Atualizar guia e documentação técnica quando o contrato ou o fluxo mudar.

Registro incompleto falha na validação de build/teste. Elemento sem registro continua funcionando no jogo, mas não é anunciado como editável no Studio. O Studio mostra somente elementos e propriedades registrados.

## Configuração e salvamento

- `visual.json` contém texto, cores, fontes, assets e geometria autorizada, incluindo overrides responsivos.
- `gameplay.local.json` contém alterações experimentais locais e tem toggle/identificação evidente de sandbox; nunca é aplicado a um modo competitivo.
- JSON tem `schemaVersion`; migrações são determinísticas, encadeadas e testadas. Versão futura fica somente leitura até atualização compatível.
- O editor valida sintaxe, esquema, IDs, ranges, referências de asset e consistência antes de salvar. Grava em temporário, sincroniza/fecha e renomeia atomicamente, mantendo backup anterior.
- Histórico undo/redo guarda comandos semânticos sobre valores permitidos, não snapshots executáveis ou source code. Edição contínua de slider agrupa uma transação.
- Colisão de ID, propriedade desconhecida ou asset ausente produz erro legível e não apaga configuração.

## Segurança e privacidade

- Não permitir import de HTML/JS, URL remota, CSS arbitrary, SVG ativo sem sanitização, arquivo executável ou fonte remota.
- Seleção de arquivos do sistema ocorre no processo principal e a cópia resultante recebe nome seguro dentro de `assets/`.
- Rejeitar traversal, symlink que escape raiz, MIME/extensão incompatíveis, tamanho/dimensão acima dos limites publicados.
- Operações Git/teste usam tarefas fechadas, lista permitida de argumentos, cwd canônico do projeto e apresentação do diff/resultado.
- Nunca guardar credencial, token ou conteúdo de `.env` na configuração nem no log.

## Pontos de entrada Windows: prova e decisão

O host Electron único será `Trindade-Studio.exe`. Os outros dois nomes serão launchers nativos leves, compilados do mesmo `Launcher.cs`, que iniciam o host ao lado com argumentos fixos `--mode=test` e `--mode=git`; eles propagam o exit code do host. O Studio implementa essas rotas como telas dentro da mesma aplicação e do mesmo pacote. Isso evita três cópias do runtime Chromium/Node e não cria três aplicações independentes.

Alternativas avaliadas:

| Alternativa | Resultado |
|---|---|
| Um único pacote Electron + dois launchers C# pequenos | Recomendada. No Windows auditado, `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` existe mesmo sem `dotnet` no PATH. Protótipo compilado e executado com host substituto confirmou argumento e exit code de cada modo. Não exige SDK .NET para compilar os wrappers neste ambiente. |
| Três builds completos Electron | Tecnicamente possível com fontes/configuração compartilhadas, mas distribui três hosts e triplica artefatos/runtime; rejeitada por custo e por não atender ao requisito de uma só aplicação compartilhada. |
| Atalhos `.lnk` para um Electron com argumentos | Mais simples, mas não atende aos três nomes `.exe` pedidos. |
| IExpress, `.bat`/`.cmd` renomeado ou cópia renomeada de EXE | Não atende ao contrato de executável real/entrypoint e não será usado. |
| Tauri/WPF | Exigiria Rust/WebView2 ou outra stack de UI e aumentaria a migração; sem vantagem suficiente para este jogo desktop local. |

Fontes e prova ficam em `prototypes/windows-entrypoints/`. `run-probe.ps1` compila um host de teste chamado `Trindade-Studio.exe` e dois launchers descartáveis em `%TEMP%`, verifica os argumentos fixos e confirma propagação dos códigos 23/29. O teste não é o Studio e não valida ainda a integração com o pacote Electron. O build Electron continua condicionado à instalação de Node/npm e lockfile no marco apropriado.

Compatibilidade da proposta: host Electron Windows x64; dois wrappers .NET Framework 4 que usam apenas APIs suportadas pelo runtime presente no Windows 10 deste ambiente. Empacotamento assinado não faz parte do Marco 1. A prova final com host Electron empacotado e instalação limpa será requisito de aceitação do Marco 5.
