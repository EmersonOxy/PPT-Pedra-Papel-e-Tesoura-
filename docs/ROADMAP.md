# Roadmap proposto

Este roadmap não aprova nem implementa mudanças. As prioridades consideram impacto no jogador, esforço, risco e confiança atual. Como não há baseline de uso, métricas devem ser coletadas primeiro.

## Sequência aprovada do Trindade Studio

Esta sequência de entrega foi aprovada por Émerson em 17/10/2026. A aprovação autoriza somente o Marco 1; cada marco seguinte requer decisão própria.

| Etapa | Estado | Limite |
|---|---|---|
| Preparação dos agentes | Concluída | Perfis e skills orientam análises/implementações futuras. |
| Auditoria estática | Concluída | Documentada em `AUDITORIA_COMPLETA.md` e documentos relacionados. |
| Marco 1 — Arquitetura e baseline | Trabalho autorizado e preparado para revisão | Referência, caracterização, servidor local e protótipo de launcher; primeiro commit aguarda aprovação separada. |
| Marco 2 — Refatoração modular | Aguardando aprovação | Não iniciar antes de aprovação expressa. Preservar regras e comparar com o baseline. |
| Marco 3 — Editor visual | Planejado | Experiência visual semelhante ao Canva para editar elementos registrados, visualizar, salvar e testar. |

Marcos posteriores devem entregar: (a) modularização somente após Marco 2 aprovado; (b) editor e contrato de extensibilidade somente após escopo do Marco 3 aprovado; (c) exes de produção e fluxo Git após aceitação do shell; (d) documentação revisada junto das funcionalidades.

## Prioridades iniciais

| Ordem | Entrega | Impacto | Esforço | Risco | Confiança |
|---|---|---:|---:|---:|---:|
| 1 | Playtest e critérios de fairness/duração | Alto | Baixo | Baixo | Alta |
| 2 | Correções de estado, foco e clareza apoiadas por teste | Alto | Médio | Médio | Média |
| 3 | Extração incremental do núcleo e testes de regras | Alto | Médio | Baixo | Alta |
| 4 | Ajuste de combate, IA e poderes por experimentos | Alto | Médio | Alto | Média |
| 5 | Renovação visual orientada por screenshot e mobile | Médio/alto | Médio | Médio | Média |
| 6 | Progressão cosmética e PvP MVP após validação do loop | Alto | Alto | Alto | Baixa antes de pesquisa |

## Fase 1 — Estabilização

**Objetivo:** reproduzir regras e proteger estados extremos antes de expandir.
**Propostas:** mapear transições; definir fixtures/seed para IA; adicionar testes de outcome, dano, empate, HP zero, inventário e prêmio; tratar foco das transições; decidir UX de reinício; medir tamanho e carregamento inicial.
**Dependências:** critérios de vitória e regras existentes confirmados por Émerson; ambiente de teste acordado.
**Dificuldade:** média.
**Impacto:** confiança de que combate e placar não mudam acidentalmente.
**Riscos:** testes podem congelar comportamento indesejado; separar “caracterização” de “regra aprovada”.
**Conclusão:** fluxos principais/estados-limite testados; nenhum bug crítico aberto; navegação por teclado validada; baseline de duração/faltas registrado.

## Fase 2 — Combate aprimorado

**Objetivo:** aumentar decisão e justiça percebida sem perder aprendizado simples.
**Propostas:** apresentar política de IA e níveis explícitos; explicar chance/condição dos poderes; experimentar timer casual/competitivo; avaliar cura, defesa e crítico; verificar transferência de inventário e Luck Blocks.
**Dependências:** Fase 1 e playtests com regras atuais.
**Dificuldade:** média.
**Impacto:** partidas mais compreensíveis e com escolhas táticas legíveis.
**Riscos:** balanceamento pode tornar RPS subordinado a habilidades; reduzir urgência demais pode alongar partidas.
**Conclusão:** cada modo tem política/documentação; fairness e duração atingem metas definidas antes do experimento; nenhum poder domina sem escolha contrária viável.

## Fase 3 — Experiência visual

**Objetivo:** tornar combate, dano, ameaça e recompensa mais claros em desktop e celular.
**Propostas:** screenshots de estados inicial, turno, dano, poder e final; melhorar hierarquia do timer/vida/placar; ajustar texto pequeno e HUD estreito; definir identidade arcade moderna preservando mãos/identidade existente; revisar foco, contraste e movimento reduzido.
**Dependências:** Fases 1–2, captura de navegador e direção visual aprovada.
**Dificuldade:** média.
**Impacto:** melhor leitura e percepção de produto acabado.
**Riscos:** efeitos visuais podem competir com a decisão ou prejudicar acessibilidade/performance.
**Conclusão:** estados-chave aprovados em screenshots nos breakpoints definidos; alvos, contraste e reduced motion verificados; nenhuma informação essencial depende só de cor/animação.

## Fase 4 — Progressão

**Objetivo:** criar motivos de retorno sem pay-to-win ou pressão artificial.
**Propostas:** estatísticas locais opt-in; XP moderado; conquistas de domínio; cosméticos; missões opcionais sem prazo punitivo.
**Dependências:** combate estável e evidência de replay voluntário.
**Dificuldade:** média.
**Impacto:** metas de curto e médio prazo.
**Riscos:** recompensas podem deslocar foco da diversão ou incentivar partidas repetitivas; persistência demanda privacidade e migração.
**Conclusão:** jogador compreende por que recebeu progresso; derrota preserva participação sem equiparar mérito; progressão não altera poder competitivo; retorno/replay melhora sem aumentar faltas ou sessão involuntária.

## Fase 5 — Multiplayer MVP

**Objetivo:** duelos PvP 1×1 confiáveis, inicialmente privados.
**Propostas:** serviço autoritativo; salas por convite; protocolo de jogada e relógio; reconexão; identidade convidada opcional; histórico mínimo e métricas de operação.
**Dependências:** regras determinísticas, validação local, modelo de ameaça, orçamento de hosting e decisão de privacidade.
**Dificuldade:** alta.
**Impacto:** competição humana direta.
**Riscos:** latência, desconexão, abuso, custo de servidor e manutenção contínua.
**Conclusão:** dois clientes recebem o mesmo resultado validado pelo servidor; replay de eventos reconstrói estado; timeout/reconexão não duplica jogadas; clientes não podem escolher resultado ou pontos.

## Fase 6 — Competitivo e evolução contínua

**Objetivo:** escalar modos e retorno conforme procura demonstrada.
**Propostas:** matchmaking, ranking, histórico, temporada curta, cosméticos e eventos sem urgência coercitiva; ferramentas de suporte e moderação quando aplicável.
**Dependências:** PvP estável, população suficiente, política de dados, medição de fraude e custo unitário.
**Dificuldade:** alta.
**Impacto:** competição sustentável e personalização.
**Riscos:** filas vazias, smurfing, manipulação de ranking, custos de retenção e conteúdo operacional.
**Conclusão:** fila tem espera aceitável, ranking reproduzível, temporada não paga vantagem, custo e fraude monitorados; expandir somente se métricas e pesquisa justificarem.

## MVP recomendado para próxima aprovação

1. Playtest sem mudar regras e registrar baseline de duração, faltas e justiça.
2. Corrigir foco/semântica e explicar IA/poderes com critérios claros.
3. Extrair núcleo para testes de caracterização e regras aprovadas.

**Fora deste MVP:** XP, missões, cosméticos, temporada, framework/engine novo, contas, matchmaking e migração de stack. Esses itens dependem de evidência e aprovação posterior.
