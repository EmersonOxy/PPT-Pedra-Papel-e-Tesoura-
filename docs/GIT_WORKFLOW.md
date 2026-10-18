# Fluxo Git proposto

Status: política aprovada; o primeiro commit está preparado para revisão, ainda sem commit/push.

## Situação do repositório no Marco 1

- Remote `origin`: `https://github.com/EmersonOxy/PPT-Pedra-Papel-e-Tesoura-.git`.
- Branch local atual: `audit/comprehensive-game-audit`; nenhum commit local.
- `git ls-remote --heads origin` concluiu sem erro e não retornou refs. Não há base `main` remota observável.
- Identidade local está configurada neste repo; conferir se está correta antes de commit, sem reproduzir email pessoal em documentação.
- Sem commit ou push feito nesta etapa. Uma primeira publicação para estabelecer baseline remoto exige aprovação separada.

## Protocolo de primeiro commit

1. Revisar e publicar a lista exata staged (paths e status), quantidade/tamanho e hash da referência.
2. Verificar staged e unstaged: `git status`, `git diff --cached --check`, inventário de extensões/arquivos grandes e scanner de segredos apropriado; revisar manualmente falsos positivos.
3. Excluir `.codex/`, `.agents/`, configurações locais e arquivos temporários da proposta de commit, salvo decisão expressa; eles não são necessários ao projeto versionado.
4. Verificar que original e referência têm hash idêntico e que testes de baseline passam.
5. Mostrar o resumo e pedir aprovação do usuário. Sem resposta/aprovação, não executar `git commit`.
6. Depois do commit aprovado, confirmar SHA e árvore limpa; pedir aprovação de push separadamente. Nunca `--force` ou `--force-with-lease`.

## Fluxo futuro do Studio

- Branch feature a partir de base disponível e confirmada; não inventar `main` vazia.
- Exibir origem, branch, status, diff completo e arquivos escolhidos antes de stage.
- Stage somente de paths explicitamente selecionados; bloquear segredos, env files, executáveis não declarados e arquivos fora da raiz.
- Commit e push têm confirmações distintas. Push para `main` requer confirmação adicional.
- Se o remoto divergir, parar, explicar e oferecer integração revisável; sem reset, rebase automático com perda, force push ou alteração silenciosa de histórico.
- Usar Git Credential Manager/helper configurado no Windows, sem copiar token para arquivo/config/log.
- Testar o fluxo em repositório descartável com remote local falso antes de habilitar o botão.
