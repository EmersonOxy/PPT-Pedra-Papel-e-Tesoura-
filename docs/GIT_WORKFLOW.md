# Fluxo Git do projeto

Status: baseline inicial publicado; Marco 2 implementado e commitado localmente em branch isolada. Push e merge não estão autorizados.

## Estado atual

- Remote `origin`: `https://github.com/EmersonOxy/PPT-Pedra-Papel-e-Tesoura-.git`.
- `main` local acompanha `origin/main`, e a branch padrão no GitHub é `main`.
- Commit de baseline: `00a5a3c18764e6dcc8e4773a06c52fcc0fbfadeb`.
- Branch `audit/comprehensive-game-audit` preservada no baseline.
- Branch de trabalho autorizada: `feature/marco-2-modularizacao`.
- O commit do Marco 2 foi criado após revisão e aprovação; ainda não houve push ou merge.
- Identidade Git está configurada localmente neste repositório; não reproduzir nome/email pessoal em documentação.

## Revisão do Marco 2

1. Conferir branch, base, working tree, hashes do HTML e referência.
2. Revisar diff completo, lista exata de arquivos, arquivos grandes e possíveis segredos.
3. Executar a caracterização diferencial, smoke do servidor, validação de configuração/assets e comparação visual previstos em `docs/BUILD_AND_TEST.md`.
4. O commit local do Marco 2 foi criado após autorização expressa, sem alterar `main`.
5. Solicitar autorização separada para push. Não executar push ou merge sem essa autorização.

## Fluxo futuro do Studio

- Criar branch a partir de base remota confirmada e atualizada; não partir de `main` divergente silenciosamente.
- Exibir branch, working tree, diff e arquivos escolhidos antes de stage.
- Stage somente de paths selecionados; bloquear segredos, arquivos locais de ambiente, executáveis não declarados e caminhos fora da raiz.
- Commit e push têm aprovações distintas; publicar `main` requer autorização adicional explícita.
- Se o remoto divergir, parar, explicar e propor integração revisável. Não usar reset destrutivo, rebase com perda ou force push.
- Usar helper Git Credential Manager configurado no Windows; nunca copiar tokens para arquivo/config/log.
- Testar automação de Git em repositório descartável e remote local antes de habilitar uma ação de UI.

## Histórico do baseline

No primeiro exame de 17/10/2026, o repositório local não tinha commits e `origin` não anunciava refs. Depois da aprovação explícita, o commit inicial foi criado e publicado normalmente como `main`; a publicação foi verificada sem reescrita de histórico.
